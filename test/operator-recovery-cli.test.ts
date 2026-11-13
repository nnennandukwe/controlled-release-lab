import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import capturedFlag from './fixtures/launchdarkly-off.json' with { type: 'json' };
import { fixtureResults } from './helpers/feature-fixture.js';
import { Journal, acquireLock, loadRecord, type EvidenceRecord } from '../tools/evidence.js';
import { Railway } from '../tools/railway.js';
import { syntheticContext } from '../src/flags.js';

it('preserves cancellation during CLI observation and recovers the original retained intent using local HTTP fixtures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'operator-cli-'));
  const target = { projectId: randomUUID(), serviceId: randomUUID(), environmentId: randomUUID(), url: 'https://operator-fixture.invalid' };
  const image = `ghcr.io/example/lab@sha256:${'a'.repeat(64)}`, sourceSha = 'b'.repeat(40), deploymentId = randomUUID();
  const deployment = { id: deploymentId, ...target, status: 'SUCCESS', canRollback: true, meta: { image } };
  let mutations = 0, requests = 0;
  let firstRequest: () => void = () => {};
  const observing = new Promise<void>(accept => { firstRequest = accept; });
  const server = createServer(async (request, response) => {
    const json = (value: unknown) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    if (request.url?.startsWith('/backboard.railway.com/')) {
      let body = ''; for await (const chunk of request) body += chunk;
      const query = (JSON.parse(body) as { query: string }).query;
      if (query.startsWith('mutation')) { mutations++; response.statusCode = 500; json({ error: 'No writes in read-only recovery' }); return; }
      if (query.includes('projectToken')) json({ data: { projectToken: target } });
      else if (query.includes('serviceInstance(')) json({ data: {
        serviceInstance: { source: { image, repo: null }, latestDeployment: { id: deploymentId }, activeDeployments: [deployment], healthcheckPath: '/readyz', startCommand: null, numReplicas: 1, region: 'synthetic-local' },
        variables: { LAB_ENVIRONMENT: 'staging', PORT: '3000', NODE_ENV: 'production' },
      } });
      else if (query.includes('deployment(')) json({ data: { deployment } });
      else { response.statusCode = 500; json({ error: 'Unexpected provider query' }); }
      return;
    }
    if (request.url?.startsWith('/app.launchdarkly.com/api/v2/flags/default/catalog-ranked-search')) { json(capturedFlag); return; }
    if (request.url?.startsWith('/operator-fixture.invalid/api/search')) {
      requests++; firstRequest();
      const url = new URL(request.url, 'http://fixture'), query = url.searchParams.get('q')!;
      const context = syntheticContext(url.searchParams.get('context') ?? undefined);
      // The captured managed flag is off. Model that provider's initialized
      // evaluation explicitly, while using the real synthetic persona parser.
      json({ sourceSha, deploymentId, environment: 'staging', requestId: randomUUID(), ranking: 'original', results: fixtureResults(query, false).map(id => ({ id })), evaluation: { flagKey: 'catalog-ranked-search', contextKey: context.key, cohort: context.cohort, eligible: context.eligible, value: false, variationIndex: 0, sdkInitialized: true, fallbackUsed: false, reason: { kind: 'OFF' } } });
      return;
    }
    response.statusCode = 500; json({ error: 'Unexpected local fixture route' });
  });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const fixtureUrl = `http://127.0.0.1:${address.port}`;
  const transport: typeof fetch = (input, options) => { const url = new URL(String(input)); return fetch(`${fixtureUrl}/${url.hostname}${url.pathname}${url.search}`, options); };
  const hosting = new Railway('synthetic-local-token', target, transport);
  const snapshot = await hosting.snapshot();
  const journal = new Journal(root);
  await journal.initialize();
  const record: EvidenceRecord = { schemaVersion: 1, attemptId: journal.attemptId, operation: 'deploy', targetName: 'staging', target, requestedImage: image, requestedSourceSha: sourceSha, deploymentId: null, rollbackTarget: null, configurationFingerprint: snapshot.configurationFingerprint, startedAt: new Date().toISOString(), finishedAt: null, outcome: 'unknown_outcome', reasonCodes: [], recoveryInstruction: '', observations: [] };
  // Teaching fixture: interrupted after a durable provider acknowledgement,
  // before the original observation and terminal record. No real deployment.
  await journal.append('intent', record);
  await journal.append('accepted', { deploymentId });
  await acquireLock(root, target, journal.attemptId);
  const original = await Promise.all((await readdir(journal.directory)).map(async name => [name, await readFile(join(journal.directory, name))] as const));
  const children: ChildProcess[] = [];
  const run = () => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', './test/helpers/local-operator-transport.ts', 'tools/lab.ts', 'reconcile', '--target', 'staging', '--attempt', journal.attemptId, '--work-dir', root, '--duration-seconds', '0.1', '--rate', '10', '--max-requests', '1'], {
      cwd: resolve('.'), env: { ...process.env, LAB_CONFIG_JSON: JSON.stringify({ staging: target }), RAILWAY_PROJECT_TOKEN: 'synthetic-local-token', LD_READ_TOKEN: 'synthetic-local-reader', OPERATOR_FIXTURE_URL: fixtureUrl }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let stdout = '', stderr = '';
    child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
    const completion = new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>((accept, reject) => { child.once('error', reject); child.once('close', (code, signal) => accept({ code, signal, stdout, stderr })); });
    return { child, completion };
  };
  try {
    const cancelled = run();
    await Promise.race([observing, cancelled.completion.then(result => { throw new Error(`CLI exited before observation: ${result.stderr} ${result.stdout}`); }), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('CLI observation startup timed out')), 10000); timer.unref(); })]);
    cancelled.child.kill('SIGTERM');
    expect((await cancelled.completion).signal).toBe('SIGTERM');
    expect(await readdir(join(root, 'locks'))).toHaveLength(1);
    const attempts = await readdir(join(root, 'attempts'));
    expect(attempts).toHaveLength(2);
    const interrupted = attempts.find(id => id !== journal.attemptId)!;
    await expect(readFile(join(root, 'attempts', interrupted, 'record.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const completed = await run().completion;
    expect(completed.code, completed.stderr + completed.stdout).toBe(0);
    const result = JSON.parse(completed.stdout);
    expect(result.outcome).toBe('verified');
    expect(await loadRecord(result.recordPath)).toMatchObject({ deploymentId, requestedImage: image, requestedSourceSha: sourceSha, configurationFingerprint: snapshot.configurationFingerprint });
    expect(await readdir(join(root, 'locks'))).toHaveLength(0);
    for (const [name, bytes] of original) expect(await readFile(join(journal.directory, name))).toEqual(bytes);
    expect(mutations).toBe(0);
    expect(requests).toBeLessThanOrEqual(1163);
  } finally {
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(accept => { child.once('close', () => accept()); child.kill('SIGKILL'); })));
    server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept()));
    await rm(root, { recursive: true, force: true });
  }
}, 150000);
