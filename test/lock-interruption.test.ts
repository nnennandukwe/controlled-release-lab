import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acquireLock, readLockOwner, releaseReconciledLock } from '../tools/evidence.js';
import { target } from './helpers/lock-target.js';

it.each(['before', 'after'])('recovers after a process stops %s lock publication', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'lock-interruption-'));
  const script = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const wait = () => { process.stdout.write('ready\\n'); return new Promise(() => setInterval(() => {}, 1000)); };
    if (process.env.FIXTURE_PHASE === 'before') { fs.rename = wait; syncBuiltinESMExports(); }
    const { acquireLock } = await import('./tools/evidence.ts');
    await acquireLock(process.env.FIXTURE_ROOT, JSON.parse(process.env.FIXTURE_TARGET), 'interrupted');
    await wait();
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd(), env: { PATH: process.env.PATH, FIXTURE_ROOT: root, FIXTURE_TARGET: JSON.stringify(target), FIXTURE_PHASE: phase }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const completion = new Promise<void>(resolve => child.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('ready\n')) resolve(); });
      child.once('error', reject); child.once('exit', code => reject(new Error(`Fixture exited ${code}: ${errors}`)));
    });
    child.kill('SIGTERM'); await completion;
    expect(await readLockOwner(root, target)).toBe(phase === 'after' ? 'interrupted' : undefined);
    if (phase === 'after') {
      await expect(acquireLock(root, target, 'next')).rejects.toMatchObject({ code: 'OPERATION_LOCKED' });
      await releaseReconciledLock(root, target, 'interrupted');
    }
    const release = await acquireLock(root, target, 'next');
    await releaseReconciledLock(root, target, 'interrupted');
    expect(await readLockOwner(root, target)).toBe('next');
    await release(); expect(await readLockOwner(root, target)).toBeUndefined();
  } finally { child.kill('SIGKILL'); await completion; await rm(root, { recursive: true, force: true }); }
});
