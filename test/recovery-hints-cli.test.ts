import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';
import policy from '../config/release-policy.json' with { type: 'json' };
import { workflowArguments } from '../tools/workflow.js';
import { readLockOwner, acquireLock, Journal, loadRecord, type EvidenceRecord } from '../tools/evidence.js';

it.each([['blocked', 'snapshot', 'file'], ['verified', 'snapshot', 'file'], ['blocked', 'scope', 'file'], ['verified', 'scope', 'file'], ['blocked', 'snapshot', 'environment'], ['verified', 'snapshot', 'environment'], ['blocked', 'scope', 'environment'], ['verified', 'scope', 'environment'], ['blocked', 'scope', 'workflow'], ['blocked', 'snapshot', 'workflow']] as const)('retries a failed %s-owner %s read using the emitted CLI command and %s config', async (outcome, phase, configuration) => {
  await mkdir(resolve('work'), { recursive: true });
  const temporary = await mkdtemp(join(resolve('work'), 'operator-hints-'));
  const root = join(temporary, "operator's retained work"), config = join(temporary, "operator's target map.json");
  const target = configuration === 'workflow' ? policy.targets.staging : { projectId: randomUUID(), serviceId: randomUUID(), environmentId: randomUUID(), url: 'https://operator-fixture.invalid' };
  await writeFile(config, JSON.stringify({ staging: target }));
  const journal = new Journal(root);
  await journal.initialize();
  // Retained outcomes/provider responses are fixtures; no hosted release runs here.
  const record: EvidenceRecord = { schemaVersion: 1, attemptId: journal.attemptId, operation: 'deploy', targetName: 'staging', target, requestedImage: null, requestedSourceSha: null, deploymentId: null, rollbackTarget: null, configurationFingerprint: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), outcome, reasonCodes: outcome === 'blocked' ? ['RELEASE_SUBJECT_MISMATCH'] : [], recoveryInstruction: '', observations: [] };
  const originalPath = await journal.finish(record);
  await acquireLock(root, target, journal.attemptId);
  const original = await Promise.all([originalPath, `${originalPath}.sha256`].map(async path => [path, await readFile(path)] as const));
  let rejectSnapshot = true, mutations = 0, snapshots = 0;
  const server = createServer(async (request, response) => {
    const json = (value: unknown) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    let body = ''; for await (const chunk of request) body += chunk;
    const query = (JSON.parse(body) as { query: string }).query;
    if (query.startsWith('mutation')) { mutations++; response.statusCode = 400; json({ error: 'No writes in read-only recovery' }); return; }
    if (query.includes('projectToken')) {
      if (rejectSnapshot && phase === 'scope') { response.statusCode = 400; json({ error: 'Synthetic scope-read rejection' }); return; }
      json({ data: { projectToken: target } }); return;
    }
    if (query.includes('serviceInstance(')) {
      snapshots++;
      if (rejectSnapshot && phase === 'snapshot') { response.statusCode = 400; json({ error: 'Synthetic snapshot rejection' }); return; }
      json({ data: { serviceInstance: { source: null, latestDeployment: null, activeDeployments: [], healthcheckPath: '/readyz', startCommand: null, numReplicas: 1, region: 'synthetic-local' }, variables: { LAB_ENVIRONMENT: 'staging', PORT: '3000', NODE_ENV: 'production' } } });
      return;
    }
    response.statusCode = 400; json({ error: 'Unexpected local fixture query' });
  });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const cliCwd = resolve('test');
  const environment = { ...(configuration === 'workflow' ? { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: policy.repository, GITHUB_WORKFLOW_REF: `${policy.repository}/.github/workflows/operate.yml@refs/heads/main` } : {}), LAB_CONFIG_JSON: configuration !== 'file' ? JSON.stringify({ staging: target }) : undefined, PATH: process.env.PATH, NODE_OPTIONS: `--import tsx --import ${JSON.stringify(resolve('test/helpers/local-operator-transport.ts'))}`, RAILWAY_PROJECT_TOKEN: 'synthetic-local-token', LD_READ_TOKEN: 'synthetic-local-reader', OPERATOR_FIXTURE_URL: `http://127.0.0.1:${address.port}` };
  const children: ChildProcess[] = [];
  const run = (executable: string, args: string[], dropConfig = false, extraEnvironment: NodeJS.ProcessEnv = {}) => {
    const child = spawn(executable, args, { cwd: cliCwd, env: { ...environment, ...(dropConfig ? { LAB_CONFIG_JSON: undefined } : {}), ...extraEnvironment }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let stdout = '', stderr = '';
    child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => { child.once('error', reject); child.once('close', code => accept({ code, stdout, stderr })); });
  };
  const output = (stdout: string) => JSON.parse(stdout.trim().split('\n').at(-1)!);
  try {
    const failed = await run(process.execPath, ['--import', 'tsx', resolve('tools/lab.ts'), 'reconcile', '--target', 'staging', '--attempt', journal.attemptId, '--work-dir', relative(cliCwd, root), ...(configuration === 'file' ? ['--config', relative(cliCwd, config)] : [])]);
    expect(failed.code, failed.stderr + failed.stdout).toBe(2);
    const result = output(failed.stdout);
    expect(result.reasonCodes).toEqual(['PROVIDER_HTTP']);
    if (phase === 'snapshot') expect(await loadRecord(resolve(cliCwd, result.recordPath))).toMatchObject({ outcome: outcome === 'verified' ? 'unknown_outcome' : 'blocked', target });
    else expect(result.recordPath).toBeUndefined();
    expect(await readLockOwner(root, target)).toBe(journal.attemptId);
    const command = (result.recoveryInstruction as string).match(/ Run ((?:(?:LAB_CONFIG_JSON=.+ )?npm run lab --|gh workflow run) .+)\.$/)?.[1];
    expect(command, result.recoveryInstruction).toBeDefined();
    expect(command).toContain(journal.attemptId);
    expect(command).toContain(configuration === 'workflow' ? 'gh workflow run' : configuration === 'file' ? '--config ' : 'LAB_CONFIG_JSON=');
    rejectSnapshot = outcome !== 'blocked';
    let activeRoot = root;
    let retried: Awaited<ReturnType<typeof run>>;
    if (configuration === 'workflow') {
      const binary = join(temporary, 'bin'), capture = join(temporary, 'dispatch-args');
      await mkdir(binary);
      await writeFile(join(binary, 'gh'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$OPERATOR_DISPATCH_CAPTURE"\n', { mode: 0o700 });
      const dispatch = await run('/bin/sh', ['-c', command!], true, { PATH: `${binary}:${environment.PATH}`, OPERATOR_DISPATCH_CAPTURE: capture });
      expect(dispatch.code, dispatch.stderr).toBe(0);
      const arguments_ = (await readFile(capture, 'utf8')).trim().split('\n');
      expect(arguments_.slice(0, 3)).toEqual(['workflow', 'run', 'operate.yml']);
      expect(arguments_[arguments_.indexOf('--repo') + 1]).toBe(policy.repository);
      expect(arguments_[arguments_.indexOf('--ref') + 1]).toBe('main');
      const inputs: Record<string, string> = {};
      for (let index = 0; index < arguments_.length; index++) if (arguments_[index] === '-f') {
        const [key, value] = arguments_[++index]!.split('='); inputs[`LAB_${key!.toUpperCase()}`] = value!;
      }
      const forwarded = workflowArguments(inputs);
      expect(forwarded).toEqual(['reconcile', '--target', 'staging', '--attempt', journal.attemptId]);
      activeRoot = join(temporary, 'restored-work'); await cp(root, activeRoot, { recursive: true, errorOnExist: true, force: false });
      retried = await run(process.execPath, ['--import', 'tsx', resolve('tools/lab.ts'), ...forwarded, '--work-dir', activeRoot], true, { LAB_CONFIG_JSON: JSON.stringify({ staging: { ...target, environmentId: randomUUID() } }) });
    } else retried = await run('/bin/sh', ['-c', command!], true);
    expect(retried.code, retried.stderr + retried.stdout).toBe(2);
    const retryResult = output(retried.stdout);
    expect(retryResult.reasonCodes).toEqual([outcome === 'blocked' ? 'COMPLETED_ATTEMPT_CLEANUP' : 'PROVIDER_HTTP']);
    if (outcome === 'blocked' || phase === 'snapshot') expect(await loadRecord(retryResult.recordPath)).toMatchObject({ outcome: outcome === 'verified' ? 'unknown_outcome' : 'blocked', target });
    else expect(retryResult.recordPath).toBeUndefined();
    expect(await readLockOwner(activeRoot, target)).toBe(outcome === 'blocked' ? undefined : journal.attemptId);
    if (configuration === 'workflow') expect(await readLockOwner(root, target)).toBe(journal.attemptId);
    if (outcome === 'verified') {
      rejectSnapshot = false;
      const recovered = await run('/bin/sh', ['-c', command!], true);
      expect(recovered.code, recovered.stderr + recovered.stdout).toBe(2);
      const final = output(recovered.stdout);
      expect(final.reasonCodes).toEqual(['COMPLETED_SUBJECT_CHANGED', 'COMPLETED_ATTEMPT_CLEANUP']);
      expect((await loadRecord(final.recordPath)).outcome).toBe('blocked');
      expect(await readLockOwner(activeRoot, target)).toBeUndefined();
    }
    for (const [path, bytes] of original) expect(await readFile(path)).toEqual(bytes);
    expect(mutations).toBe(0);
    expect(snapshots).toBe((phase === 'snapshot' ? 2 : outcome === 'blocked' ? 1 : 0) + (outcome === 'verified' ? 1 : 0));
  } finally {
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(accept => { child.once('close', () => accept()); child.kill('SIGKILL'); })));
    server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept()));
    await rm(temporary, { recursive: true, force: true });
  }
}, 30000);
