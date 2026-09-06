import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { execute, type Operation } from '../tools/operations.js';
import { LabError, loadRecord } from '../tools/evidence.js';
import type { Hosting, Snapshot, Deployment } from '../tools/railway.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); roots.length = 0; });
async function root() { const path = await mkdtemp(join(tmpdir(), 'release-operations-')); roots.push(path); return path; }
const target = { projectId: '11111111-1111-4111-8111-111111111111', serviceId: '22222222-2222-4222-8222-222222222222', environmentId: '33333333-3333-4333-8333-333333333333', url: 'https://example.up.railway.app' };
const image = `ghcr.io/example/lab@sha256:${'b'.repeat(64)}`;
const sourceSha = 'a'.repeat(40);
const deploymentId = '44444444-4444-4444-8444-444444444444';
const deployment: Deployment = { id: deploymentId, ...target, status: 'SUCCESS', canRollback: true, image, metadataKeys: ['image'] };
const request: Operation = { operation: 'deploy', targetName: 'staging', target, image, sourceSha, durationSeconds: 0.1, rate: 10, maxRequests: 1, apply: true };
function host() {
  let current: Snapshot = { sourceImage: null, active: [], latestId: null, configurationFingerprint: 'config-a' };
  const hosting: Hosting = {
    assertScope: vi.fn(async () => {}), snapshot: vi.fn(async () => current), deployment: vi.fn(async () => deployment),
    updateImage: vi.fn(async updated => { current = { ...current, sourceImage: updated }; }),
    deploy: vi.fn(async () => { current = { ...current, active: [deployment], latestId: deploymentId }; return deploymentId; }),
    rollback: vi.fn(async () => deploymentId),
  };
  return hosting;
}
const traffic = vi.fn(async () => Response.json({ sourceSha, environment: 'staging', deploymentId, requestId: '55555555-5555-4555-8555-555555555555', ranking: 'original', results: [{ id: 'keyboard-compact' }, { id: 'keyboard-full' }] })) as typeof fetch;
it('rejects a mutable image without making a deployment mutation', async () => {
  const hosting = host();
  await expect(execute({ ...request, image: 'ghcr.io/example/lab:latest' }, hosting, await root(), traffic)).rejects.toThrow();
  expect(hosting.updateImage).not.toHaveBeenCalled();
});
it('records a lost mutation response as unknown and blocks another apply until reconciliation', async () => {
  const hosting = host();
  hosting.deploy = vi.fn(async () => { throw new LabError('PROVIDER_TRANSPORT', 'Timed out', 'unknown_outcome'); });
  const directory = await root();
  const result = await execute(request, hosting, directory, traffic);
  expect(result.outcome).toBe('unknown_outcome');
  expect((await loadRecord(result.recordPath)).requestedImage).toBe(image);
  await expect(execute(request, hosting, directory, traffic)).rejects.toThrow('Reconcile');
  expect(hosting.deploy).toHaveBeenCalledTimes(1);
});
it('verifies provider identity and a live observation before completing deployment', async () => {
  const result = await execute(request, host(), await root(), traffic);
  expect(result.outcome).toBe('verified');
  expect(await loadRecord(result.recordPath)).toMatchObject({ deploymentId, requestedImage: image, requestedSourceSha: sourceSha, configurationFingerprint: 'config-a' });
});
it('previews without invoking image or deployment mutations', async () => {
  const hosting = host();
  expect((await execute({ ...request, apply: false }, hosting, await root(), traffic)).outcome).toBe('preview');
  expect(hosting.updateImage).not.toHaveBeenCalled();
  expect(hosting.deploy).not.toHaveBeenCalled();
});
it('does not accept a different digest or a missing provider image claim', async () => {
  for (const wrong of [null, image.replace('b'.repeat(64), 'c'.repeat(64))]) {
    const hosting = host();
    hosting.deployment = vi.fn(async () => ({ ...deployment, image: wrong }));
    const result = await execute(request, hosting, await root(), traffic);
    expect(result.outcome).toBe('unknown_outcome');
    expect(result.reasonCodes).toContain(wrong ? 'DEPLOYED_IMAGE_MISMATCH' : 'IMAGE_EVIDENCE_UNAVAILABLE');
  }
});
it('rejects live requests for another deployment even if provider deployment succeeded', async () => {
  const wrongTraffic = (async () => Response.json({ ...(await (await traffic('https://example.com')).json()), deploymentId: '66666666-6666-4666-8666-666666666666' })) as typeof fetch;
  const result = await execute(request, host(), await root(), wrongTraffic);
  expect(result.reasonCodes).toContain('LIVE_IDENTITY_MISMATCH');
});
it('blocks state drift before mutation', async () => {
  const hosting = host();
  const initial = await hosting.snapshot();
  hosting.snapshot = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, configurationFingerprint: 'changed' });
  expect((await execute(request, hosting, await root(), traffic)).reasonCodes).toContain('STATE_CHANGED');
  expect(hosting.updateImage).not.toHaveBeenCalled();
});
it('restores an eligible earlier deployment and checks its saved configuration', async () => {
  const directory = await root();
  const baseline = await execute(request, host(), directory, traffic);
  const hosting = host();
  await hosting.updateImage(image);
  await hosting.deploy();
  const result = await execute({ ...request, operation: 'rollback', deploymentId, restoreRecord: baseline.recordPath }, hosting, directory, traffic);
  expect(result.outcome).toBe('verified');
  expect(hosting.rollback).toHaveBeenCalledOnce();
});
it('blocks an ineligible rollback without making a mutation', async () => {
  const directory = await root();
  const baseline = await execute(request, host(), directory, traffic);
  const hosting = host();
  hosting.deployment = vi.fn(async () => ({ ...deployment, canRollback: false }));
  expect((await execute({ ...request, operation: 'rollback', deploymentId, restoreRecord: baseline.recordPath }, hosting, directory, traffic)).reasonCodes).toContain('ROLLBACK_UNAVAILABLE');
  expect(hosting.rollback).not.toHaveBeenCalled();
});
it('reconciles an accepted deployment after its response was lost without repeating mutation', async () => {
  const hosting = host();
  const deploy = hosting.deploy;
  hosting.deploy = vi.fn(async () => { await deploy(); throw new LabError('PROVIDER_TRANSPORT', 'Lost response', 'unknown_outcome'); });
  const directory = await root();
  const original = await execute(request, hosting, directory, traffic);
  const attempt = (await loadRecord(original.recordPath)).attemptId;
  const reconciled = await execute({ ...request, operation: 'reconcile', attempt }, hosting, directory, traffic);
  expect(reconciled.outcome).toBe('verified');
  expect(hosting.deploy).toHaveBeenCalledOnce();
  expect((await loadRecord(original.recordPath)).outcome).toBe('unknown_outcome');
});
