import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import toolchain from '../config/toolchain.json' with { type: 'json' };

export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const verifierPath = resolve(import.meta.dirname, '../artifacts/bin/gh');
const executeFile = promisify(execFile);

function platformConfig() {
  const key = `${process.platform}-${process.arch}`;
  if (!(key in toolchain.platforms)) throw new Error('Verifier supports Linux x64 and macOS arm64. Use the documented runner platform.');
  return toolchain.platforms[key as keyof typeof toolchain.platforms];
}

export async function checkedVerifier() {
  const expected = platformConfig();
  if (sha256(await readFile(verifierPath)) !== expected.binarySha256) throw new Error('Verifier checksum mismatch. Run npm run setup:verifier.');
  return verifierPath;
}

export async function setupVerifier() {
  const expected = platformConfig();
  try { await checkedVerifier(); return; } catch { /* Reinstall only from the pinned archive. */ }
  const parent = resolve(verifierPath, '..');
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(resolve(parent, 'install-'));
  try {
    const response = await fetch(`https://github.com/cli/cli/releases/download/v${toolchain.ghVersion}/${expected.archive}`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Verifier download failed: HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 50 * 1024 * 1024 || sha256(bytes) !== expected.sha256) throw new Error('Verifier archive checksum mismatch.');
    const archive = resolve(temporary, expected.archive);
    await writeFile(archive, bytes, { flag: 'wx' });
    await executeFile('tar', ['-xf', archive, '-C', temporary, expected.binaryPath], { timeout: 10000 });
    const binary = resolve(temporary, expected.binaryPath);
    if (sha256(await readFile(binary)) !== expected.binarySha256) throw new Error('Verifier binary checksum mismatch.');
    await chmod(binary, 0o755);
    const version = await executeFile(binary, ['--version'], { timeout: 10000 });
    if (!version.stdout.startsWith(`gh version ${toolchain.ghVersion} `)) throw new Error('Unexpected verifier version.');
    await rename(binary, verifierPath);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await setupVerifier();
  process.stdout.write(`Verified GitHub CLI ${toolchain.ghVersion}: ${verifierPath}\n`);
}
