import * as fs from 'node:fs/promises';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { target } from './helpers/lock-target.js';
import { acquireLock, Journal, loadAttempt, loadRecord, fingerprint, ownsLock, releaseReconciledLock, type EvidenceRecord } from '../tools/evidence.js';

vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>() }));
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); roots.length = 0; });
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

it.each(['record', 'intent'])('rejects a %s stored under another attempt UUID', async format => {
  const directory = await root(), journal = new Journal(directory);
  await journal.initialize();
  const record: EvidenceRecord = { schemaVersion: 1, attemptId: '11111111-1111-4111-8111-111111111111', operation: 'deploy', targetName: 'staging', target, requestedImage: null, requestedSourceSha: null, rollbackTarget: null, deploymentId: null, configurationFingerprint: null, startedAt: new Date().toISOString(), finishedAt: null, outcome: 'unknown_outcome', reasonCodes: [], recoveryInstruction: '', observations: [] };
  if (format === 'record') await journal.finish(record); else await journal.append('intent', record);
  await expect(loadAttempt(directory, journal.attemptId)).rejects.toMatchObject({ code: 'ATTEMPT_IDENTITY_MISMATCH' });
});

// Pause immediately before the kernel unlink, after any ownership read.
it.each(['reconcile', 'release', 'legacy'] as const)('preserves a replacement owner during stale %s cleanup', async mode => {
  const directory = await root(), path = join(directory, 'locks', `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
  let release: () => Promise<void>;
  if (mode === 'legacy') {
    await mkdir(join(directory, 'locks')); await writeFile(path, 'original');
    release = () => releaseReconciledLock(directory, target, 'original');
  } else release = await acquireLock(directory, target, 'original');
  const nativeUnlink = fs.unlink;
  let entered!: () => void, resume!: () => void, intercepted = false;
  const paused = new Promise<void>(resolve => { entered = resolve; });
  const proceed = new Promise<void>(resolve => { resume = resolve; });
  vi.spyOn(fs, 'unlink').mockImplementation(async file => {
    if (!intercepted && String(file).startsWith(join(directory, 'locks'))) {
      intercepted = true; entered(); await proceed;
    }
    return nativeUnlink(file);
  });
  const stale = mode === 'release' ? release() : releaseReconciledLock(directory, target, 'original');
  await paused;
  try {
    await releaseReconciledLock(directory, target, 'original');
    await acquireLock(directory, target, 'replacement');
  } finally { resume(); }
  await stale;
  expect(await ownsLock(directory, target, 'replacement')).toBe(true);
  await expect(acquireLock(directory, target, 'third')).rejects.toMatchObject({ code: 'OPERATION_LOCKED' });
});

it.each(['mkdir', 'mkdtemp', 'open', 'writeFile', 'sync', 'close', 'rename'] as const)('keeps acquisition unpublished when %s fails', async phase => {
  const directory = await root();
  const denied = Object.assign(new Error(`fixture ${phase}`), { code: 'EACCES' });
  if (['mkdir', 'mkdtemp', 'open', 'rename'].includes(phase)) {
    vi.spyOn(fs, phase as 'mkdir').mockRejectedValueOnce(denied);
  } else {
    const nativeOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const file = await nativeOpen(...args);
      if (phase === 'close') {
        const close = file.close.bind(file);
        vi.spyOn(file, 'close').mockImplementationOnce(async () => { await close(); throw denied; });
      } else vi.spyOn(file, phase as 'sync').mockRejectedValueOnce(denied);
      return file;
    });
  }
  await expect(acquireLock(directory, target, 'first')).rejects.toBe(denied);
  vi.restoreAllMocks();
  expect(await ownsLock(directory, target, 'first')).toBe(false);
  expect(await fs.readdir(join(directory, 'lock-preparations')).catch(() => [])).toEqual([]);
  await (await acquireLock(directory, target, 'next'))();
});

it('reports an unpublished preparation when its cleanup also fails', async () => {
  const directory = await root();
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('fixture publication denied'), { code: 'EACCES' }));
  vi.spyOn(fs, 'rm').mockRejectedValueOnce(Object.assign(new Error('fixture cleanup denied'), { code: 'EACCES' }));
  await expect(acquireLock(directory, target, 'first')).rejects.toMatchObject({ code: 'LOCK_PREPARATION_CLEANUP_FAILED', message: expect.stringContaining('lock-preparations') });
  vi.restoreAllMocks();
  expect(await ownsLock(directory, target, 'first')).toBe(false);
  expect(await fs.readdir(join(directory, 'lock-preparations'))).toHaveLength(1);
  await (await acquireLock(directory, target, 'next'))();
});

async function abandonedPreparation(directory: string) {
  const prepared = join(directory, 'lock-preparations', 'owner-999999-aBcDeF');
  await mkdir(prepared, { recursive: true });
  await writeFile(join(prepared, `${fingerprint('interrupted')}.lock`), 'in');
  const kill = process.kill;
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === 999999 && signal === 0) throw Object.assign(new Error('fixture stopped process'), { code: 'ESRCH' });
    return kill(pid, signal);
  });
  return prepared;
}

it.each(['readdir', 'lstat', 'unlink', 'rmdir'] as const)('preserves canonical state when preparation cleanup %s fails', async phase => {
  const directory = await root(); await abandonedPreparation(directory);
  const failure = vi.spyOn(fs, phase).mockRejectedValueOnce(Object.assign(new Error('fixture cleanup denied'), { code: 'EACCES' }));
  await expect(acquireLock(directory, target, 'next')).rejects.toMatchObject({ code: 'LOCK_PREPARATION_CLEANUP_FAILED' });
  failure.mockRestore();
  expect(await ownsLock(directory, target, 'next')).toBe(false);
  expect(await fs.readdir(join(directory, 'lock-preparations'))).toHaveLength(1);
  const release = await acquireLock(directory, target, 'next');
  expect(await fs.readdir(join(directory, 'lock-preparations'))).toEqual([]);
  await release();
});

it.each(['legacy', 'unknown-file'])('preserves %s preparation data and supports explicit relocation recovery', async kind => {
  const directory = await root();
  const prepared = kind === 'legacy' ? join(directory, 'lock-preparations', 'owner-legacy') : await abandonedPreparation(directory);
  await mkdir(prepared, { recursive: true }); await writeFile(join(prepared, 'operator-note'), 'preserve this note');
  await expect(acquireLock(directory, target, 'next')).rejects.toMatchObject({ code: 'LOCK_PREPARATION_STATE_INVALID', message: expect.stringContaining('back up') });
  expect(await fs.readFile(join(prepared, 'operator-note'), 'utf8')).toBe('preserve this note');
  expect(await ownsLock(directory, target, 'next')).toBe(false);
  const backup = join(directory, 'operator-backup'); await fs.rename(prepared, backup);
  await (await acquireLock(directory, target, 'next'))();
  expect(await fs.readFile(join(backup, 'operator-note'), 'utf8')).toBe('preserve this note');
});

it('allows concurrent collectors to remove only the same stopped preparation', async () => {
  const directory = await root(); await abandonedPreparation(directory);
  const other = { ...target, environmentId: '66666666-6666-4666-8666-666666666666' };
  const releases = await Promise.all([acquireLock(directory, target, 'first'), acquireLock(directory, other, 'second')]);
  expect(await fs.readdir(join(directory, 'lock-preparations'))).toEqual([]);
  expect(await ownsLock(directory, target, 'first')).toBe(true); expect(await ownsLock(directory, other, 'second')).toBe(true);
  await Promise.all(releases.map(release => release()));
});

it('preserves a file added during stopped-preparation removal', async () => {
  const directory = await root(), prepared = await abandonedPreparation(directory), nativeUnlink = fs.unlink;
  const note = join(prepared, 'operator-note');
  vi.spyOn(fs, 'unlink').mockImplementation(async path => {
    if (String(path).startsWith(`${prepared}/`)) await writeFile(note, 'preserve concurrent note');
    return nativeUnlink(path);
  });
  await expect(acquireLock(directory, target, 'next')).rejects.toMatchObject({ code: 'LOCK_PREPARATION_CLEANUP_FAILED' });
  expect(await fs.readFile(note, 'utf8')).toBe('preserve concurrent note');
  expect(await ownsLock(directory, target, 'next')).toBe(false);
});

it('preserves preparations when process liveness cannot be established', async () => {
  const directory = await root(), prepared = await abandonedPreparation(directory);
  vi.mocked(process.kill).mockImplementation(() => { throw Object.assign(new Error('fixture process not inspectable'), { code: 'EPERM' }); });
  const release = await acquireLock(directory, target, 'next');
  expect(await fs.readdir(prepared)).toEqual([`${fingerprint('interrupted')}.lock`]);
  await release();
});

it.each(['readdir', 'readFile'] as const)('preserves a published owner when inspector %s fails', async phase => {
  const directory = await root();
  await acquireLock(directory, target, 'first');
  const denied = Object.assign(new Error('fixture inspector denied'), { code: 'EACCES' });
  vi.spyOn(fs, phase).mockRejectedValueOnce(denied);
  await expect(ownsLock(directory, target, 'first')).rejects.toBe(denied);
  vi.restoreAllMocks();
  expect(await ownsLock(directory, target, 'first')).toBe(true);
});

it('rejects malformed ownership without deleting its bytes', async () => {
  const directory = await root();
  await acquireLock(directory, target, 'first');
  const path = join(directory, 'locks', `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
  const marker = join(path, `${fingerprint('first')}.lock`);
  await writeFile(marker, 'changed');
  await expect(ownsLock(directory, target, 'first')).rejects.toMatchObject({ code: 'LOCK_STATE_INVALID' });
  await expect(releaseReconciledLock(directory, target, 'first')).rejects.toMatchObject({ code: 'LOCK_STATE_INVALID' });
  expect(await fs.readFile(marker, 'utf8')).toBe('changed');
  await writeFile(join(path, 'unrecognized'), 'preserve');
  await expect(ownsLock(directory, target, 'first')).rejects.toMatchObject({ code: 'LOCK_STATE_INVALID' });
  await expect(acquireLock(directory, target, 'next')).rejects.toMatchObject({ code: 'LOCK_STATE_INVALID' });
  expect(await fs.readFile(join(path, 'unrecognized'), 'utf8')).toBe('preserve');
});

it('preserves a legacy-file permission failure rather than treating it as a replacement directory', async () => {
  const directory = await root(), path = join(directory, 'locks', `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
  await mkdir(join(directory, 'locks')); await writeFile(path, 'first');
  const denied = Object.assign(new Error('fixture legacy file denial'), { code: 'EPERM' });
  vi.spyOn(fs, 'unlink').mockRejectedValueOnce(denied);
  await expect(releaseReconciledLock(directory, target, 'first')).rejects.toBe(denied);
  expect(await fs.readFile(path, 'utf8')).toBe('first');
});

it('preserves a retained legacy owner when another acquisition is refused', async () => {
  const directory = await root(), path = join(directory, 'locks', `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
  await mkdir(join(directory, 'locks')); await writeFile(path, 'retained-owner');
  await expect(acquireLock(directory, target, 'new-owner')).rejects.toMatchObject({ code: 'OPERATION_LOCKED' });
  expect(await fs.readFile(path, 'utf8')).toBe('retained-owner');
  expect(await ownsLock(directory, target, 'retained-owner')).toBe(true);
  await releaseReconciledLock(directory, target, 'retained-owner');
  await acquireLock(directory, target, 'new-owner');
  expect(await ownsLock(directory, target, 'new-owner')).toBe(true);
});

it.each(['held', 'released'])('diagnoses stray metadata beside a %s owner and preserves it through operator recovery', async state => {
  const directory = await root(), release = await acquireLock(directory, target, 'original');
  const path = join(directory, 'locks', `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
  if (state === 'released') await release();
  const metadata = Buffer.from('fixture metadata to preserve');
  await writeFile(join(path, '.DS_Store'), metadata);
  await expect(acquireLock(directory, target, 'next')).rejects.toMatchObject({ code: 'LOCK_STATE_INVALID', message: expect.stringContaining('Preserve') });
  expect(await fs.readFile(join(path, '.DS_Store'))).toEqual(metadata);
  // Model an operator preserving and relocating an identified file they own.
  await fs.cp(path, join(directory, 'lock-backup'), { recursive: true, errorOnExist: true, force: false });
  expect(await fs.readFile(join(directory, 'lock-backup/.DS_Store'))).toEqual(metadata);
  await fs.rename(join(path, '.DS_Store'), join(directory, 'preserved-metadata'));
  expect(await fs.readFile(join(directory, 'preserved-metadata'))).toEqual(metadata);
  expect(await ownsLock(directory, target, 'original')).toBe(state === 'held');
  if (state === 'held') await release();
  await acquireLock(directory, target, 'next');
  expect(await ownsLock(directory, target, 'next')).toBe(true);
});
