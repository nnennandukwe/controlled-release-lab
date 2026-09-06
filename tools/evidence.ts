import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export class LabError extends Error {
  constructor(public code: string, message: string, public outcome: 'failed' | 'blocked' | 'unknown_outcome' = 'blocked') { super(message); }
}
export const imageSchema = z.string().regex(/^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/, 'Use a GHCR image qualified by sha256 digest.');
export const targetSchema = z.object({
  projectId: z.string().uuid(), serviceId: z.string().uuid(), environmentId: z.string().uuid(),
  url: z.url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash; }, 'Use the HTTPS origin without credentials, path, query, or fragment.'),
}).strict();
export type Target = z.infer<typeof targetSchema>;
export const recordSchema = z.object({
  schemaVersion: z.literal(1), attemptId: z.string().uuid(), operation: z.enum(['deploy', 'rollback', 'observe', 'reconcile']),
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
  try { return await loadRecord(join(directory, 'record.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const entries = (await readdir(directory)).sort();
  const intent = entries.find(name => name.endsWith('-intent.json'));
  if (!intent) throw new LabError('MISSING_INTENT', 'This attempt has no durable intent. Inspect provider state before any further mutation.');
  const record = recordSchema.parse(JSON.parse(await readFile(join(directory, intent), 'utf8')).observation);
  for (const name of entries.filter(name => name.endsWith('-accepted.json'))) {
    record.deploymentId = z.string().uuid().parse(JSON.parse(await readFile(join(directory, name), 'utf8')).observation.deploymentId);
  }
  return record;
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
  const directory = join(root, 'locks');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(attemptId); await file.sync(); } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LabError('OPERATION_LOCKED', 'An operation owns this environment. Reconcile its attempt before starting another mutation.');
    throw error;
  }
  return async () => { if (await readFile(path, 'utf8') === attemptId) await unlink(path); };
}

export async function releaseReconciledLock(root: string, target: Target, attemptId: string) {
  const path = join(root, 'locks', `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
  try { if (await readFile(path, 'utf8') === attemptId) await unlink(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
