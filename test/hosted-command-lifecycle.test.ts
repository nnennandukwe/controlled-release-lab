import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';

const driver = fileURLToPath(new URL('./helpers/hosted-command-driver.ts', import.meta.url));
function running(pid: number) {
  try { return !execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().startsWith('Z'); }
  catch { return false; }
}

it.each(['timeout', 'cancel'])('stops owned descendants after hosted command %s', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'hosted-command-')), path = join(root, 'owned-pids.json');
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), driver], { env: { PATH: process.env.PATH, HOSTED_PROCESS_PID_FILE: path, HOSTED_PROCESS_CASE: mode }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', closed = false;
  child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
  const completion = new Promise<{ code: number | null; signal: string | null }>((accept, reject) => { child.once('error', reject); child.once('close', (code, signal) => { closed = true; accept({ code, signal }); }); });
  let pids: number[] = [];
  try {
    const deadline = performance.now() + 5000;
    while (true) {
      try { pids = JSON.parse(await readFile(path, 'utf8')) as number[]; break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (closed || performance.now() >= deadline) throw new Error(`Process fixture didn't start: ${stderr}`);
      await delay(20);
    }
    expect(pids).toHaveLength(2);
    if (mode === 'cancel') child.kill('SIGTERM');
    const finishDeadline = performance.now() + 4000;
    while (!closed && performance.now() < finishDeadline) await delay(20);
    expect(closed, `Command failed to finish: ${stderr}`).toBe(true);
    const result = await completion;
    if (mode === 'timeout') { expect(result.code).toBe(0); expect(JSON.parse(stdout).timedOut).toBe(true); }
    else expect(result.signal).toBe('SIGTERM');
    const reapDeadline = performance.now() + 2000;
    while (pids.some(running) && performance.now() < reapDeadline) await delay(20);
    expect(pids.filter(running)).toEqual([]);
  } finally {
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
    if (!closed) child.kill('SIGKILL');
    await completion;
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
