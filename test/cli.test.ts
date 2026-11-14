import { expect, it, vi } from 'vitest';
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
it.each([['verify', '--target', 'live', '--release-dir', 'unused', '--apply'], ['verify', '--target', 'live', '--release-dir', 'unused', '--image', 'ignored']].map(args => ({ args })))('rejects ambiguous verification arguments before any network access', async ({ args }) => {
  const output: string[] = [];
  expect(await runCli(args, {}, text => output.push(text))).toBe(2);
  expect(JSON.parse(output.join('')).reasonCodes).toEqual(['VERIFY_IS_READ_ONLY']);
});

it.each([['expose','--stage','internal','--rate','10'],['disable','--stage','internal'],['observe-exposure','--apply'],['reconcile-exposure','--release-dir','unused']])('refuses exposure contract overrides before provider access: %j',async (...args)=>{
 const output:string[]=[];expect(await runCli([args[0]!, '--target','live',...args.slice(1)] as string[],{},text=>output.push(text))).toBe(2);
 expect(JSON.parse(output.join('')).reasonCodes).toEqual(['INVALID_EXPOSURE_ARGUMENT']);
});

it.each([
 ['expose','--target','live','--stage','internal','--apply'],
 ['expose','--target','staging','--stage','5','--apply'],
 ['expose','--target','staging','--stage','internal'],
 ['disable','--target','staging','--apply'],
].map(args=>({args})))('rejects unsafe flag rehearsal arguments before credentials or network: $args',async({args})=>{
 const output:string[]=[];
 expect(await runCli([...args,'--rehearse-response-loss'],{},text=>output.push(text))).toBe(2);
 expect(JSON.parse(output.join('')).reasonCodes).toEqual(['REHEARSAL_TARGET_REJECTED']);
});

it('rejects an empty config argument before provider access even with an environment map', async () => {
  const output: string[] = [];
  const transport = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fixture provider sentinel'));
  try {
    const target = { projectId: '11111111-1111-4111-8111-111111111111', serviceId: '22222222-2222-4222-8222-222222222222', environmentId: '33333333-3333-4333-8333-333333333333', url: 'https://example.up.railway.app' };
    expect(await runCli(['doctor', '--target', 'staging', '--config', ''], { LAB_CONFIG_JSON: JSON.stringify({ staging: target }), RAILWAY_PROJECT_TOKEN: 'synthetic-fixture-token' }, text => output.push(text), () => {})).toBe(1);
    expect(JSON.parse(output.join('')).reasonCodes).toEqual(['INVALID_CONFIG_PATH']);
    expect(transport).not.toHaveBeenCalled();
  } finally { transport.mockRestore(); }
});
