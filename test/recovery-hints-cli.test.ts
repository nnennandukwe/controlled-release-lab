import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { acquireLock, Journal, loadRecord, type EvidenceRecord } from '../tools/evidence.js';

it.each([['blocked', 'snapshot'], ['verified', 'snapshot'], ['blocked', 'scope'], ['verified', 'scope']] as const)('retries a failed %s-owner %s read using the emitted CLI command and custom config', async (outcome, phase) => {
  const temporary = await mkdtemp(join(tmpdir(), 'operator-hints-'));
  const root = join(temporary, "operator's retained work"), config = join(temporary, "operator's target map.json");
  const target = { projectId: randomUUID(), serviceId: randomUUID(), environmentId: randomUUID(), url: 'https://operator-fixture.invalid' };
  await writeFile(config, JSON.stringify({ staging: target }));
  const journal = new Journal(root);
  await journal.initialize();
  // Teaching fixture: a terminal result with interrupted lock removal. These
  // identities and provider state are synthetic; no hosted release was run.
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
  const environment = { PATH: process.env.PATH, NODE_OPTIONS: '--import tsx --import ./test/helpers/local-operator-transport.ts', RAILWAY_PROJECT_TOKEN: 'synthetic-local-token', LD_READ_TOKEN: 'synthetic-local-reader', OPERATOR_FIXTURE_URL: `http://127.0.0.1:${address.port}` };
  const children: ChildProcess[] = [];
  const run = (executable: string, args: string[]) => {
    const child = spawn(executable, args, { cwd: resolve('.'), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let stdout = '', stderr = '';
    child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => { child.once('error', reject); child.once('close', code => accept({ code, stdout, stderr })); });
  };
  const output = (stdout: string) => JSON.parse(stdout.trim().split('\n').at(-1)!);
  try {
    const failed = await run(process.execPath, ['--import', 'tsx', 'tools/lab.ts', 'reconcile', '--target', 'staging', '--attempt', journal.attemptId, '--work-dir', root, '--config', config]);
    expect(failed.code, failed.stderr + failed.stdout).toBe(2);
    const result = output(failed.stdout);
    expect(result.reasonCodes).toEqual(['PROVIDER_HTTP']);
    if (phase === 'snapshot') expect(await loadRecord(result.recordPath)).toMatchObject({ outcome: 'blocked', target });
    else expect(result.recordPath).toBeUndefined();
    expect(await readdir(join(root, 'locks'))).toHaveLength(1);
    const command = (result.recoveryInstruction as string).match(/ Run (npm run lab -- .+)\.$/)?.[1];
    expect(command, result.recoveryInstruction).toBeDefined();
    expect(command).toContain(`--attempt ${journal.attemptId}`);
    expect(command).toContain('--config ');
    rejectSnapshot = outcome !== 'blocked';
    const retried = await run('/bin/sh', ['-c', command!]);
    expect(retried.code, retried.stderr + retried.stdout).toBe(2);
    const retryResult = output(retried.stdout);
    expect(retryResult.reasonCodes).toEqual([outcome === 'blocked' ? 'COMPLETED_ATTEMPT_CLEANUP' : 'PROVIDER_HTTP']);
    if (outcome === 'blocked' || phase === 'snapshot') expect(await loadRecord(retryResult.recordPath)).toMatchObject({ outcome: 'blocked', target });
    else expect(retryResult.recordPath).toBeUndefined();
    expect(await readdir(join(root, 'locks'))).toHaveLength(outcome === 'blocked' ? 0 : 1);
    for (const [path, bytes] of original) expect(await readFile(path)).toEqual(bytes);
    expect(mutations).toBe(0);
    expect(snapshots).toBe(phase === 'snapshot' ? 2 : outcome === 'blocked' ? 1 : 0);
  } finally {
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(accept => { child.once('close', () => accept()); child.kill('SIGKILL'); })));
    server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept()));
    await rm(temporary, { recursive: true, force: true });
  }
}, 30000);
