import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { acquireLock, Journal, loadRecord, fingerprint, type EvidenceRecord } from '../tools/evidence.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); roots.length = 0; });
export const target = { projectId: '11111111-1111-4111-8111-111111111111', serviceId: '22222222-2222-4222-8222-222222222222', environmentId: '33333333-3333-4333-8333-333333333333', url: 'https://example.up.railway.app' };
async function root() { const path = await mkdtemp(join(tmpdir(), 'release-evidence-')); roots.push(path); return path; }
it('excludes a concurrent operator and allows entry after an explicit release', async () => {
  const directory = await root();
  const release = await acquireLock(directory, target, 'first');
  await expect(acquireLock(directory, target, 'second')).rejects.toThrow('Reconcile');
  await release();
  await (await acquireLock(directory, target, 'second'))();
});
it('writes checksummed evidence once and refuses changed bytes', async () => {
  const journal = new Journal(await root());
  await journal.initialize();
  const record: EvidenceRecord = { schemaVersion: 1, attemptId: journal.attemptId, operation: 'observe', targetName: 'staging', target, requestedImage: null, requestedSourceSha: null, rollbackTarget: null, deploymentId: null, configurationFingerprint: null, startedAt: new Date().toISOString(), finishedAt: null, outcome: 'blocked', reasonCodes: [], recoveryInstruction: '', observations: [] };
  const path = await journal.finish(record);
  expect((await loadRecord(path)).attemptId).toBe(journal.attemptId);
  await expect(journal.finish({ ...record, outcome: 'verified' })).rejects.toThrow();
  expect((await loadRecord(path)).outcome).toBe('blocked');
  await writeFile(path, '{}');
  await expect(loadRecord(path)).rejects.toThrow('intact');
});
it('canonicalizes object property order without ignoring meaningful changes', () => {
  expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
});
