import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const entry = fileURLToPath(new URL('../tools/release-workflow.ts', import.meta.url));
const loader = import.meta.resolve('tsx');

function command(action: string, operation: string, check: (result: ReturnType<typeof spawnSync>, output: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'release-workflow-cli-'));
  const output = join(directory, 'output');
  try {
    const result = spawnSync(process.execPath, ['--import', loader, entry, action], {
      cwd: directory, encoding: 'utf8', timeout: 15_000,
      // No inherited provider credentials: these paths must finish without network access.
      env: { PATH: process.env.PATH, GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: output, LAB_TARGET: 'staging', LAB_OPERATION: operation },
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    check(result, output);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('the public release CLI resolves exposure reconciliation without awaiting its own module', () => {
  command('resolve', 'reconcile-exposure', (result, output) => {
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('has_request=false\n');
  });
});

test.each([
  ['resolve', 'expose'], ['resolve', 'disable'], ['resolve', 'observe-exposure'],
  ['finalize', 'expose'], ['seal', 'expose'], ['seal', 'reconcile-exposure'],
])('the public CLI reaches %s/%s input validation', (action, operation) => {
  command(action, operation, result => {
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('Release preparation failed. Check validated inputs, artifact availability and protected workflow configuration.\n');
  });
});

test('a failed new operator invocation removes the previous result before validating inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workflow-stale-result-'));
  try {
    mkdirSync(join(directory, 'work'));
    writeFileSync(join(directory, 'work/last-result.json'), JSON.stringify({ outcome: 'verified', recordPath: 'old-record.json' }));
    const result = spawnSync(process.execPath, ['--import', loader, fileURLToPath(new URL('../tools/workflow.ts', import.meta.url)), 'run'], {
      cwd: directory, encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '2', GITHUB_RUN_ATTEMPT: '1', LAB_OPERATION: 'expose', LAB_TARGET: 'live', LAB_STAGE: '75' },
    });
    expect(result.status).toBe(1);expect(result.error).toBeUndefined();
    expect(existsSync(join(directory, 'work/last-result.json'))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
