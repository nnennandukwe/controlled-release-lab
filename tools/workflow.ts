import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { runCli } from './lab.js';
import { requireProtectedEnvironment } from './workflow-guard.js';

export async function initializeState(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = resolve(root, 'state-format.json');
  try { await writeFile(path, '{"schemaVersion":1}\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  z.object({ schemaVersion: z.literal(1) }).strict().parse(JSON.parse(await readFile(path, 'utf8')));
}

const runSchema = z.object({ id: z.number().int().positive(), run_attempt: z.number().int().positive(), display_title: z.string(), head_branch: z.string().nullable(), status: z.string() });
const jobsSchema = z.object({ total_count: z.number(), jobs: z.array(z.object({
  name: z.string(), status: z.string(), conclusion: z.string().nullable(),
  steps: z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() })),
})) });

function operationWasSkipped(value: unknown) {
  const result = jobsSchema.parse(value);
  if (result.total_count !== result.jobs.length) return false;
  const matches = result.jobs.filter(job => job.name === 'operate');
  if (matches.length !== 1) return false;
  const job = matches[0]!;
  if (job.name !== 'operate' || job.status !== 'completed') return false;
  if (job.conclusion === 'skipped') return true;
  const operations = job.steps.filter(step => step.name === 'Execute the requested bounded operation');
  return operations.length === 1 && operations[0]!.status === 'completed' && operations[0]!.conclusion === 'skipped';
}

export async function previousOperation(environment: NodeJS.ProcessEnv, transport: typeof fetch = fetch) {
  const config = z.object({ GITHUB_REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/), GH_TOKEN: z.string().min(1), GITHUB_RUN_ID: z.string().regex(/^\d+$/), GITHUB_RUN_ATTEMPT: z.literal('1'), LAB_TARGET: z.enum(['staging', 'live']) }).parse(environment);
  const get = async (path: string): Promise<unknown> => {
    const response = await transport(`https://api.github.com/repos/${config.GITHUB_REPOSITORY}/${path}`, { headers: { Authorization: `Bearer ${config.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error(`Cannot recover previous operator state: GitHub HTTP ${response.status}.`);
    return response.json();
  };
  let attemptsInspected = 0;
  for (let page = 1; page <= 10; page++) {
    const runs = z.object({ workflow_runs: z.array(runSchema) }).parse(await get(`actions/workflows/operate.yml/runs?branch=main&per_page=100&page=${page}`)).workflow_runs;
    const candidates = runs.filter(run => run.head_branch === 'main' && run.id < Number(config.GITHUB_RUN_ID) && ['deploy', 'rollback', 'reconcile', 'rehearse-recovery'].some(operation => run.display_title === `${config.LAB_TARGET} / ${operation}`));
    for (const prior of candidates) {
      if (prior.status !== 'completed') throw new Error('The previous operation has not completed. Wait before starting another operation.');
      const artifacts = z.object({ artifacts: z.array(z.object({ name: z.string(), expired: z.boolean() })) }).parse(await get(`actions/runs/${prior.id}/artifacts?per_page=100`)).artifacts;
      for (let attempt = prior.run_attempt; attempt >= 1; attempt--) {
        if (++attemptsInspected > 20) throw new Error('Operation attempt history exceeds the bounded lookup. Recover prior state before continuing.');
        const name = `lab-state-${config.LAB_TARGET}-${prior.id}-${attempt}`;
        if (artifacts.some(artifact => artifact.name === name && !artifact.expired)) return { runId: String(prior.id), artifactName: name };
        const jobs = await get(`actions/runs/${prior.id}/attempts/${attempt}/jobs?per_page=100`);
        if (!operationWasSkipped(jobs)) throw new Error('Previous operation evidence is missing or expired and execution cannot be ruled out. Inspect provider state and recover that evidence before another workflow operation.');
      }
    }
    if (runs.length < 100) return { runId: '', artifactName: '' };
  }
  throw new Error('Operation history exceeds the bounded lookup. Recover the prior state explicitly before continuing.');
}

export function workflowArguments(environment: NodeJS.ProcessEnv): string[] {
  const operation = z.enum(['doctor', 'deploy', 'observe', 'rollback', 'reconcile', 'rehearse-recovery']).parse(environment.LAB_OPERATION);
  const args = [operation, '--target', z.enum(['staging', 'live']).parse(environment.LAB_TARGET)];
  if (environment.LAB_CHANGE_REFERENCE) args.push('--change-reference', environment.LAB_CHANGE_REFERENCE);
  if (operation !== 'doctor' && environment.LAB_MAX_DURATION_SECONDS !== undefined) {
    const maximum = z.coerce.number().min(60).max(300).parse(environment.LAB_MAX_DURATION_SECONDS);
    args.push('--max-duration-seconds', String(maximum));
  }
  if (environment.LAB_APPLY === 'true') args.push('--apply');
  if (environment.LAB_RELEASE_DIR && ['deploy', 'rollback', 'observe', 'rehearse-recovery'].includes(operation)) {
    args.push('--release-dir', environment.LAB_RELEASE_DIR);
  } else {
    if (operation === 'deploy') args.push('--image', environment.LAB_IMAGE ?? '', '--source-sha', environment.LAB_SOURCE_SHA ?? '');
    if (operation === 'rollback') args.push('--deployment', z.string().uuid().parse(environment.LAB_DEPLOYMENT), '--restore-record', `work/attempts/${z.string().uuid().parse(environment.LAB_RESTORE_ATTEMPT)}/record.json`);
  }
  if (operation === 'reconcile') args.push('--attempt', z.string().uuid().parse(environment.LAB_ATTEMPT));
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'prepare') {
      await requireProtectedEnvironment(process.env);
      const previous = await previousOperation(process.env);
      const output = z.string().min(1).parse(process.env.GITHUB_OUTPUT);
      await appendFile(output, `previous_run=${previous.runId}\nprevious_artifact=${previous.artifactName}\n`);
    } else if (process.argv[2] === 'run') {
      await initializeState('work');
      const output: string[] = [];
      process.exitCode = await runCli(workflowArguments(process.env), process.env, text => { output.push(text); process.stdout.write(text); });
      await writeFile('work/last-result.json', output.join(''), { mode: 0o600 });
    } else throw new Error('Use prepare or run.');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Workflow failed'}\n`);
    process.exitCode = 1;
  }
}
