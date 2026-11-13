import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export class LabError extends Error {
  recoveryCommand?: string;
  constructor(public code: string, message: string, public outcome: 'failed' | 'blocked' | 'unknown_outcome' = 'blocked', options?: ErrorOptions) { super(message, options); }
}
export const imageSchema = z.string().regex(/^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/, 'Use a GHCR image qualified by sha256 digest.');
export const changeReferenceSchema = z.string().trim().min(3).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/, 'Use a change identifier or URL without spaces or query parameters.');
export const targetSchema = z.object({
  projectId: z.string().uuid(), serviceId: z.string().uuid(), environmentId: z.string().uuid(),
  url: z.url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash; }, 'Use the HTTPS origin without credentials, path, query, or fragment.'),
}).strict();
export type Target = z.infer<typeof targetSchema>;
export const recordSchema = z.object({
  schemaVersion: z.literal(1), attemptId: z.string().uuid(), operation: z.enum(['deploy', 'rollback', 'observe', 'reconcile']),
  changeReference: changeReferenceSchema.nullable().optional(),
  targetName: z.enum(['staging', 'live']), target: targetSchema,
  requestedImage: imageSchema.nullable(), requestedSourceSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  rollbackTarget: z.string().uuid().nullable(), deploymentId: z.string().uuid().nullable(),
  configurationFingerprint: z.string().nullable(), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
  outcome: z.enum(['verified', 'failed', 'blocked', 'unknown_outcome']), reasonCodes: z.array(z.string()),
  recoveryInstruction: z.string(), observations: z.array(z.unknown()),
}).strict();
export type EvidenceRecord = z.infer<typeof recordSchema>;

export function fingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item !== null && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : 1).map(([key, nested]) => [key, canonical(nested)])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export async function loadRecord(path: string) {
  const bytes = await readFile(path, 'utf8');
  const checksum = (await readFile(`${path}.sha256`, 'utf8')).trim();
  if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new LabError('EVIDENCE_CHECKSUM_MISMATCH', 'Restore an intact evidence record before continuing.');
  return recordSchema.parse(JSON.parse(bytes));
}

export async function loadAttempt(root: string, attemptId: string) {
  z.string().uuid().parse(attemptId);
  const directory = join(root, 'attempts', attemptId);
  try {
    const record = await loadRecord(join(directory, 'record.json'));
    assertAttemptIdentity(record.attemptId, attemptId);
    return record;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const entries = (await readdir(directory)).sort();
  const intent = entries.find(name => name.endsWith('-intent.json'));
  if (!intent) throw new LabError('MISSING_INTENT', 'This attempt has no durable intent. Inspect provider state before any further mutation.');
  const record = recordSchema.parse(JSON.parse(await readFile(join(directory, intent), 'utf8')).observation);
  assertAttemptIdentity(record.attemptId, attemptId);
  for (const name of entries.filter(name => name.endsWith('-accepted.json'))) {
    record.deploymentId = z.string().uuid().parse(JSON.parse(await readFile(join(directory, name), 'utf8')).observation.deploymentId);
  }
  return record;
}

export function assertAttemptIdentity(recordAttempt: string, requestedAttempt: string) {
  if (recordAttempt !== requestedAttempt) throw new LabError('ATTEMPT_IDENTITY_MISMATCH', 'The retained record belongs to another attempt. Restore the original attempt directory before reconciliation.');
}

function lockPath(root: string, target: Target) {
  return join(root, 'locks', `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
}

export async function readLockOwner(root: string, target: Target): Promise<string | undefined> {
  const path = lockPath(root, target);
  let entries: string[];
  try { entries = await readdir(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
    try { return await readFile(path, 'utf8'); }
    catch (readError) {
      if ((readError as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      // A concurrent legacy cleanup may already have published a new directory.
      if ((readError as NodeJS.ErrnoException).code === 'EISDIR') return readLockOwner(root, target);
      throw readError;
    }
  }
  if (!entries.length) return undefined;
  if (entries.length !== 1 || !/^[a-f0-9]{64}\.lock$/.test(entries[0]!)) throw new LabError('LOCK_STATE_INVALID', 'Preserve the malformed environment lock and inspect its owner markers before recovery.');
  let owner: string;
  try { owner = await readFile(join(path, entries[0]!), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  if (`${fingerprint(owner)}.lock` !== entries[0]) throw new LabError('LOCK_STATE_INVALID', 'Preserve the mismatched owner marker and restore its original bytes before recovery.');
  return owner;
}

export async function ownsLock(root: string, target: Target, attemptId: string) {
  return await readLockOwner(root, target) === attemptId;
}

export function reconciliationCommand(operation: 'reconcile' | 'reconcile-exposure', target: 'staging' | 'live', attempt: string, root: string, configPath?: string) {
  const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;
  return `npm run lab -- ${operation} --target ${target} --attempt ${attempt} --work-dir ${quote(root)}${configPath === undefined ? '' : ` --config ${quote(configPath)}`}`;
}

export function reconciliationPreflightError(error: unknown, command: string) {
  const failure = error instanceof LabError ? error : new LabError('RECONCILIATION_PREFLIGHT_FAILED', 'Read-only provider preflight failed. Resolve provider access or state before retrying.', 'blocked', { cause: error });
  failure.recoveryCommand = command;
  return failure;
}

export function lockCleanupWarning(error: unknown, recordPath: string, command: string) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const causeCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'UNKNOWN_IO_ERROR';
  return { code: 'LOCK_CLEANUP_REQUIRED', causeCode, recoveryInstruction: `The result's saved at ${recordPath}, but lock cleanup failed (${causeCode}). Run ${command} before another mutation.` };
}

export class Journal {
  private sequence = 0;
  readonly attemptId = randomUUID();
  readonly directory: string;
  constructor(root: string) { this.directory = join(root, 'attempts', this.attemptId); }
  async initialize() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  async append(phase: string, observation: unknown) {
    const file = await open(join(this.directory, `${String(this.sequence++).padStart(4, '0')}-${phase}.json`), 'wx', 0o600);
    try { await file.writeFile(JSON.stringify({ at: new Date().toISOString(), phase, observation }, null, 2)); await file.sync(); }
    finally { await file.close(); }
  }
  async finish(record: EvidenceRecord) {
    const bytes = `${JSON.stringify(recordSchema.parse(record), null, 2)}\n`;
    const temporary = join(this.directory, 'record.partial');
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await link(temporary, join(this.directory, 'record.json'));
    await unlink(temporary);
    const checksum = await open(join(this.directory, 'record.json.sha256'), 'wx', 0o600);
    try { await checksum.writeFile(`${createHash('sha256').update(bytes).digest('hex')}\n`); await checksum.sync(); } finally { await checksum.close(); }
    return join(this.directory, 'record.json');
  }
}

export async function acquireLock(root: string, target: Target, attemptId: string) {
  await mkdir(join(root, 'locks'), { recursive: true, mode: 0o700 });
  const preparations = join(root, 'lock-preparations');
  await mkdir(preparations, { recursive: true, mode: 0o700 });
  const prepared = await mkdtemp(join(preparations, 'owner-'));
  try {
    const file = await open(join(prepared, `${fingerprint(attemptId)}.lock`), 'wx', 0o600);
    try { await file.writeFile(attemptId); await file.sync(); } finally { await file.close(); }
    // POSIX rename replaces an empty directory, but never a populated owner or
    // legacy file. Publish the complete marker in one filesystem operation.
    await rename(prepared, lockPath(root, target));
  } catch (error) {
    try { await rm(prepared, { recursive: true, force: true }); }
    catch (cleanupError) { throw new LabError('LOCK_PREPARATION_CLEANUP_FAILED', `No lock was acquired. Preserve canonical locks and remove the unpublished preparation at ${prepared} after repairing access.`, 'blocked', { cause: new AggregateError([error, cleanupError]) }); }
    if (['EEXIST', 'ENOTEMPTY', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new LabError('OPERATION_LOCKED', 'An operation owns this environment. Reconcile its attempt before starting another mutation.');
    throw error;
  }
  return () => releaseReconciledLock(root, target, attemptId);
}

export async function releaseReconciledLock(root: string, target: Target, attemptId: string) {
  const path = lockPath(root, target);
  const marker = join(path, `${fingerprint(attemptId)}.lock`);
  try {
    if (await readFile(marker, 'utf8') !== attemptId) throw new LabError('LOCK_STATE_INVALID', 'Preserve the mismatched owner marker and restore its original bytes before recovery.');
    await unlink(marker); return;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
  }
  // Compatibility with retained plain-file locks. New acquisitions always use
  // directories, which a delayed legacy unlink cannot remove.
  try { if (await readFile(path, 'utf8') === attemptId) await unlink(path); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR') return;
    // macOS reports EPERM for unlink(directory); preserve actual file denials.
    if (code === 'EPERM' && (await lstat(path)).isDirectory()) return;
    throw error;
  }
}
