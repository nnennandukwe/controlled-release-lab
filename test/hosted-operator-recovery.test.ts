import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { assertOperatorSource, checkHostedReadEvents, hostedFailure, hostedOperatorRecovery, type HostedReadEvent } from '../tools/hosted-operator-recovery.js';
import { Railway } from '../tools/railway.js';
import policy from '../config/release-policy.json' with { type: 'json' };
import { resolveRelease } from '../tools/release-workflow.js';

afterEach(() => vi.restoreAllMocks());

it('accepts observed read retries after the actual Railway adapter recovers', async () => {
  const events: HostedReadEvent[] = [{ status: 200, errorCount: 0 }, { injected: true, status: 400, errorCount: 1 }];
  let calls = 0;
  const transport: typeof fetch = async () => {
    const status = ++calls === 1 ? 429 : 200;
    events.push({ status, errorCount: status === 200 ? 0 : null });
    return Response.json({ data: { projectToken: policy.targets.staging } }, { status, headers: { 'retry-after': '0' } });
  };
  await new Railway('synthetic-test-token', policy.targets.staging, transport).assertScope();
  events.push({ status: 200, errorCount: 0 });
  expect(calls).toBe(2);
  expect(() => checkHostedReadEvents(events)).not.toThrow();
});

it.each([
  [{ status: 200, errorCount: 0 }, { injected: true, status: 400, errorCount: 1 }, { status: 200, errorCount: 0 }],
  [{ status: 200, errorCount: 0 }, { injected: true, status: 400, errorCount: 1 }, { status: 200, errorCount: null }, { status: 200, errorCount: 0 }],
  [{ status: 200, errorCount: 0 }, { injected: true, status: 400, errorCount: 1 }, { status: 200, errorCount: 0 }, { status: 200, errorCount: 0 }, { mutationRejected: true }],
  [{ status: 200, errorCount: 0 }, { injected: true, status: 400, errorCount: 1 }, { status: 200, errorCount: 0 }, { status: 200, errorCount: 0 }, { status: 400, errorCount: 1 }],
])('rejects incomplete or unsafe provider read events: %j', (...events) => {
  expect(() => checkHostedReadEvents(events as HostedReadEvent[])).toThrow();
});

it.each([
  { LAB_TARGET: 'staging' },
  { LAB_HOSTED_RECOVERY_CHECK: 'true', LAB_TARGET: 'live' },
])('rejects hosted checks outside explicit staging opt-in before any request: %j', async environment => {
  const transport = vi.spyOn(globalThis, 'fetch');
  await expect(hostedOperatorRecovery(environment)).rejects.toMatchObject({ code: 'HOSTED_STAGING_OPT_IN_REQUIRED' });
  expect(transport).not.toHaveBeenCalled();
});

it('rejects an unprotected CI ref before provider access', async () => {
  const transport = vi.spyOn(globalThis, 'fetch');
  await expect(hostedOperatorRecovery({ LAB_HOSTED_RECOVERY_CHECK: 'true', LAB_TARGET: 'staging', GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/untrusted', GITHUB_REPOSITORY: 'nnennandukwe/controlled-release-lab', GH_TOKEN: 'synthetic-test-token' })).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it('rejects an unknown hosted failure phase before any request', async () => {
  const transport = vi.spyOn(globalThis, 'fetch');
  await expect(hostedOperatorRecovery({ LAB_HOSTED_RECOVERY_CHECK: 'true', LAB_TARGET: 'staging', LAB_HOSTED_RECOVERY_FAILURE_PHASE: 'unknown' })).rejects.toMatchObject({ code: 'HOSTED_CHECK_PHASE_INVALID' });
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  ['doctor', 'live'], ['reconcile', 'staging'], ['expose', 'staging'],
])('rejects the hosted-check workflow input for %s/%s before resolution', async (operation, target) => {
  const transport = vi.spyOn(globalThis, 'fetch');
  await expect(resolveRelease({ LAB_REHEARSE_OPERATOR_RECOVERY: 'true', LAB_OPERATION: operation, LAB_TARGET: target })).rejects.toMatchObject({ code: 'HOSTED_STAGING_OPT_IN_REQUIRED' });
  expect(transport).not.toHaveBeenCalled();
});

it.each([502, 503, 504])('preserves the adapter retry for an HTML HTTP %s response through the hosted preload', async status => {
  const root = await mkdtemp(join(tmpdir(), 'hosted-gateway-'));
  const log = join(root, 'reads.ndjson'), nativeFetch = globalThis.fetch;
  try {
    vi.stubEnv('LAB_HOSTED_RECOVERY_CHECK', 'true'); vi.stubEnv('LAB_HOSTED_RECOVERY_LOG', log); vi.stubEnv('LAB_HOSTED_REJECT_READ', 'false');
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1
      ? new Response('<html>Gateway unavailable</html>', { status, headers: { 'retry-after': '0' } })
      : Response.json({ data: { projectToken: policy.targets.staging } });
    vi.resetModules();
    await import('../tools/hosted-operator-transport.js');
    await new Railway('synthetic-test-token', policy.targets.staging, globalThis.fetch).assertScope();
    expect(calls).toBe(2);
    const events = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(events).toMatchObject([{ status, errorCount: null }, { status: 200, errorCount: 0 }]);
  } finally { globalThis.fetch = nativeFetch; vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});

it('rejects an unknown terminal fixture before any provider request', async () => {
  const transport = vi.spyOn(globalThis, 'fetch');
  await expect(hostedOperatorRecovery({ LAB_HOSTED_RECOVERY_CHECK: 'true', LAB_TARGET: 'staging', LAB_HOSTED_RECOVERY_FIXTURE: 'unknown' })).rejects.toMatchObject({ code: 'HOSTED_CHECK_FIXTURE_INVALID' });
  expect(transport).not.toHaveBeenCalled();
});

async function sourceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'operator-source-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Recovery Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet'); await writeFile(join(root, 'operator.ts'), 'export const fixture = true;\n'); git('add', 'operator.ts'); git('commit', '--quiet', '-m', 'Fixture source');
  return { root, git, source: git('rev-parse', 'HEAD') };
}

it.each(['working', 'index', 'untracked'])('rejects %s source edits instead of attributing them to clean HEAD', async mode => {
  const fixture = await sourceFixture();
  try {
    expect(assertOperatorSource(fixture.root)).toBe(fixture.source);
    await writeFile(join(fixture.root, mode === 'untracked' ? 'extra.ts' : 'operator.ts'), 'export const fixture = false;\n');
    if (mode === 'index') fixture.git('add', 'operator.ts');
    expect(() => assertOperatorSource(fixture.root, fixture.source)).toThrow(expect.objectContaining({ code: 'DIRTY_OPERATOR_SOURCE' }));
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('rejects a clean but changed commit at the final source check', async () => {
  const fixture = await sourceFixture();
  try {
    await writeFile(join(fixture.root, 'operator.ts'), 'export const fixture = false;\n'); fixture.git('add', 'operator.ts'); fixture.git('commit', '--quiet', '-m', 'Changed fixture');
    expect(() => assertOperatorSource(fixture.root, fixture.source)).toThrow(expect.objectContaining({ code: 'OPERATOR_SOURCE_CHANGED' }));
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('reports a missing-git failure from the real hosted entry point', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/hosted-operator-recovery.ts'], { cwd: process.cwd(), encoding: 'utf8', env: { PATH: '/controlled-release-fixture-missing-path', LAB_HOSTED_RECOVERY_CHECK: 'true', LAB_TARGET: 'staging', RAILWAY_PROJECT_TOKEN: 'synthetic-fixture-token' } });
  expect(result.status).toBe(1);
  const failure = JSON.parse(result.stderr.trim().split('\n').at(-1)!);
  expect(failure).toMatchObject({ code: 'HOSTED_UNEXPECTED_FAILURE', causeCodes: ['ENOENT'], source: expect.stringContaining('tools/hosted-operator-recovery.ts:') });
});

it('reports provider cause codes without printing untrusted exception text', async () => {
  const secret = 'synthetic-secret-that-must-stay-out-of-diagnostics';
  const cause = Object.assign(new Error(secret), { code: 'ECONNRESET' });
  const transport: typeof fetch = async () => { throw cause; };
  let failure: unknown;
  try { await new Railway('synthetic-fixture-token', policy.targets.staging, transport).assertScope(); } catch (error) { failure = error; }
  const report = hostedFailure(failure);
  expect(report.causeCodes).toEqual(['PROVIDER_TRANSPORT', 'ECONNRESET']);
  expect(JSON.stringify(report)).not.toContain(secret);
});
