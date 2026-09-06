import { expect, it } from 'vitest';
import { runCli } from '../tools/lab.js';

it('makes help usable without credentials or configuration', async () => {
  const output: string[] = [];
  expect(await runCli(['--help'], {}, text => output.push(text))).toBe(0);
  expect(output.join('')).toContain('--restore-record');
});
it.each([[], ['deploy'], ['doctor', '--target', 'production'], ['deploy', '--unknown']].map(args => ({ args })))('fails invalid commands with a usable recovery instruction', async ({ args }) => {
  const output: string[] = [];
  expect(await runCli(args, {}, text => output.push(text))).toBe(1);
  expect(JSON.parse(output.join('')).recoveryInstruction).toContain('--help');
});
