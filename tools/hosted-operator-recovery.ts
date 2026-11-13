import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireLock, fingerprint, Journal, LabError, loadRecord, type EvidenceRecord } from './evidence.js';
import { Railway } from './railway.js';
import { requireProtectedEnvironment } from './workflow-guard.js';
import policy from '../config/release-policy.json' with { type: 'json' };

export async function hostedOperatorRecovery(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.LAB_HOSTED_RECOVERY_CHECK !== 'true' || environment.LAB_TARGET !== 'staging') throw new LabError('HOSTED_STAGING_OPT_IN_REQUIRED', 'Enable the hosted check explicitly for staging.');
  if (environment.GITHUB_ACTIONS === 'true') await requireProtectedEnvironment({ ...environment, LAB_GITHUB_ENVIRONMENT: 'staging' });
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const operatorSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  const startedAt = new Date().toISOString(), target = policy.targets.staging;
  const directProviderReads: { at: string; status: number }[] = [];
  const hosting = new Railway(environment.RAILWAY_PROJECT_TOKEN ?? '', target, async (input, options) => {
    const body = JSON.parse(String(options?.body)) as { query: string };
    if (String(input) !== 'https://backboard.railway.com/graphql/v2' || !/^query[\s(]/.test(body.query)) throw new LabError('HOSTED_CHECK_FAILED', 'Only Railway read requests are allowed.');
    const response = await fetch(input, { ...options, redirect: 'error' });
    directProviderReads.push({ at: new Date().toISOString(), status: response.status });
    return response;
  });
  await hosting.assertScope(target);
  const before = await hosting.snapshot();
  const parent = resolve(environment.LAB_HOSTED_RECOVERY_ROOT ?? 'work/hosted-operator-recovery');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, 'run-'));
  const root = join(directory, "operator's retained work"), config = join(directory, "operator's target map.json");
  await writeFile(config, JSON.stringify({ staging: target }), { flag: 'wx', mode: 0o600 });
  const journal = new Journal(root);
  await journal.initialize(); await acquireLock(root, target, journal.attemptId);
  const original: EvidenceRecord = { schemaVersion: 1, attemptId: journal.attemptId, operation: 'deploy', targetName: 'staging', target, requestedImage: before.sourceImage, requestedSourceSha: null, deploymentId: before.latestId, rollbackTarget: null, configurationFingerprint: before.configurationFingerprint, startedAt, finishedAt: startedAt, outcome: 'blocked', reasonCodes: ['TEACHING_FIXTURE_PRE_EFFECT_REJECTION'], recoveryInstruction: 'Teaching fixture: terminal rejection with interrupted owned-lock removal.', observations: [{ phase: 'actual-provider-before', snapshot: before }] };
  const originalPath = await journal.finish(original);
  const retained = await Promise.all([originalPath, `${originalPath}.sha256`].map(async path => [path, await readFile(path)] as const));
  const log = join(directory, 'provider-reads.ndjson');
  const preload = join(repository, 'test/helpers/hosted-operator-transport.ts');
  const run = async (command: string, args: string[], rejectRead: boolean) => {
    const child = spawn(command, args, { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'], env: {
      PATH: environment.PATH, RAILWAY_PROJECT_TOKEN: environment.RAILWAY_PROJECT_TOKEN, LD_READ_TOKEN: 'unused-in-terminal-cleanup',
      NODE_OPTIONS: `--import tsx --import ${JSON.stringify(preload)}`, LAB_HOSTED_RECOVERY_CHECK: 'true', LAB_HOSTED_RECOVERY_LOG: log, LAB_HOSTED_REJECT_READ: String(rejectRead),
    } });
    let stdout = '', stderr = '';
    child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000); timer.unref();
    try {
      const code = await new Promise<number | null>((accept, reject) => { child.once('error', reject); child.once('close', accept); });
      const name = rejectRead ? 'failed-read' : 'recovered-read';
      await writeFile(join(directory, `${name}.stdout`), stdout, { flag: 'wx', mode: 0o600 });
      await writeFile(join(directory, `${name}.stderr`), stderr, { flag: 'wx', mode: 0o600 });
      if (code !== 2) throw new LabError('HOSTED_CHECK_FAILED', `Expected blocked exit 2 from ${name}; inspect its retained output.`);
      return JSON.parse(stdout.trim().split('\n').at(-1)!) as { outcome: string; reasonCodes: string[]; recoveryInstruction: string; recordPath: string };
    } finally { clearTimeout(timer); }
  };
  const failed = await run(process.execPath, ['--import', 'tsx', 'tools/lab.ts', 'reconcile', '--target', 'staging', '--attempt', journal.attemptId, '--config', config, '--work-dir', root], true);
  const lock = join(root, 'locks', `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
  const command = failed.recoveryInstruction.match(/ Run (npm run lab -- .+)\.$/)?.[1];
  if (failed.outcome !== 'blocked' || !failed.reasonCodes.some(code => ['PROVIDER_HTTP', 'PROVIDER_REJECTED'].includes(code)) || !command?.includes(`--attempt ${journal.attemptId}`) || !command.includes('--config ') || await readFile(lock, 'utf8') !== journal.attemptId) throw new LabError('HOSTED_CHECK_FAILED', 'The real provider rejection did not preserve the original owner and retry command.');
  await loadRecord(failed.recordPath);
  const recovered = await run('/bin/sh', ['-c', command], false);
  if (recovered.outcome !== 'blocked' || recovered.reasonCodes.join() !== 'COMPLETED_ATTEMPT_CLEANUP' || (await readdir(join(root, 'locks'))).length !== 0) throw new LabError('HOSTED_CHECK_FAILED', 'Read-only retry did not complete blocked owned-lock cleanup.');
  await loadRecord(recovered.recordPath);
  for (const [path, bytes] of retained) if (!bytes.equals(await readFile(path))) throw new LabError('HOSTED_CHECK_FAILED', 'Original recovery evidence changed.');
  const events = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { injected?: boolean; status?: number; errorCount?: number; mutationRejected?: boolean });
  const rejected = events.filter(event => event.injected);
  if (events.some(event => event.mutationRejected) || events.length !== 4 || rejected.length !== 1 || !(rejected[0]!.errorCount || rejected[0]!.status! >= 400)) throw new LabError('HOSTED_CHECK_FAILED', 'Expected one actual provider rejection and four read requests without mutation attempts.');
  const after = await hosting.snapshot();
  if (fingerprint(before) !== fingerprint(after)) throw new LabError('HOSTED_CHECK_FAILED', 'Provider subject changed during the read-only recovery check.');
  const receipt = { schemaVersion: 1, outcome: 'hosted_cleanup_verified', authorized: false, operatorSourceSha, startedAt, finishedAt: new Date().toISOString(), targetName: 'staging', target, before, after, fixture: { syntheticTerminalRecord: true, simulatedFailure: 'one invalid read-only GraphQL field sent to the actual Railway endpoint' }, originalAttemptId: journal.attemptId, originalRecordUnchanged: true, lockRetainedAfterFailure: true, lockReleased: true, providerMutations: 0, providerRequests: events.length + directProviderReads.length, directProviderReads, failedRecordPath: failed.recordPath, recoveredRecordPath: recovered.recordPath, events, directory };
  await writeFile(join(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(await hostedOperatorRecovery())}\n`); }
  catch (error) { process.stderr.write(`${error instanceof LabError ? error.message : 'Hosted check failed; inspect retained evidence and staging access.'}\n`); process.exitCode = 1; }
}
