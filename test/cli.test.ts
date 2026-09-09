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
