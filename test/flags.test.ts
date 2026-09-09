import { afterEach, describe, expect, it, vi } from 'vitest';
import { init } from '@launchdarkly/node-server-sdk';
import { TestData } from '@launchdarkly/node-server-sdk/integrations';
import { FLAG_KEY, flagSettings, initializeFlags, syntheticContext, syntheticRoster, type FlagEvaluator } from '../src/flags.js';
import { createApplication } from '../src/server.js';

const clients: FlagEvaluator[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.close())); });
const settings = { LAB_ENVIRONMENT: 'staging', LD_SDK_KEY: 'sdk-synthetic-test-only', LD_PROJECT_KEY: 'default', LD_ENVIRONMENT_KEY: 'test', LD_FLAG_KEY: FLAG_KEY };

describe('real SDK evaluation and lifecycle', () => {
  it('evaluates targeting through SDK test data and changes HTTP ranking without changing membership', async () => {
    const data = new TestData();
    await data.update(data.flag(FLAG_KEY).booleanFlag().variationForAll(false).ifMatch('user', 'cohort', 'internal').thenReturn(true));
    const factory = vi.fn((key, options) => init(key, { ...options, updateProcessor: data.getFactory(), sendEvents: false, diagnosticOptOut: true }));
    const flags = await initializeFlags(settings, factory); clients.push(flags);
    const server = await createApplication({ LAB_ENVIRONMENT: 'local' }, flags);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
      for (const [key, expected, value] of [['internal-001', ['keyboard-full', 'keyboard-compact'], true], ['excluded-001', ['keyboard-compact', 'keyboard-full'], false]] as const) {
        const body = await (await fetch(`http://127.0.0.1:${address.port}/api/search?q=keyboard&context=${key}`)).json();
        expect(body.results.map((product: {id: string}) => product.id)).toEqual(expected);
        expect(body.evaluation).toMatchObject({ value, contextKey: key, fallbackUsed: false, sdkInitialized: true });
        expect(body.evaluation).not.toHaveProperty('version');
      }
      await data.update(data.flag(FLAG_KEY).booleanFlag().on(false).offVariation(false));
      expect(await flags.evaluate(syntheticContext('internal-001'))).toMatchObject({ value: false, reason: { kind: 'OFF' }, fallbackUsed: false });
      expect(factory).toHaveBeenCalledTimes(1);
      await flags.close(); await flags.close();
      expect(await flags.evaluate(syntheticContext('internal-001'))).toMatchObject({ value: false, fallbackUsed: true, sdkInitialized: false });
    } finally { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); }
  });
  it('distinguishes missing flags and wrong types from a healthy false decision', async () => {
    const data = new TestData();
    const flags = await initializeFlags(settings, (key, options) => init(key, { ...options, updateProcessor: data.getFactory(), sendEvents: false, diagnosticOptOut: true })); clients.push(flags);
    expect(await flags.evaluate(syntheticContext())).toMatchObject({ value: false, fallbackUsed: true, reason: { kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' } });
    await data.update(data.flag(FLAG_KEY).variations('true').variationForAll(0));
    expect(await flags.evaluate(syntheticContext())).toMatchObject({ value: false, fallbackUsed: true, reason: { kind: 'ERROR', errorKind: 'WRONG_TYPE' } });
  });
  it('rejects hosted key/mapping errors before constructing a client', async () => {
    const factory = vi.fn();
    await expect(initializeFlags({ ...settings, LD_SDK_KEY: '' }, factory)).rejects.toThrow('LD_SDK_KEY');
    await expect(initializeFlags({ ...settings, LD_ENVIRONMENT_KEY: 'production' }, factory)).rejects.toThrow('environment must match');
    expect(factory).not.toHaveBeenCalled();
    expect(flagSettings({ LAB_ENVIRONMENT: 'local' })).toBeUndefined();
  });
  it('defines 1040 unique server-derived synthetic identities', () => {
    const roster = syntheticRoster();
    expect(new Set(roster.map(context => context.key)).size).toBe(1040);
    expect(roster.filter(context => context.cohort === 'internal')).toHaveLength(20);
    expect(roster.filter(context => context.cohort === 'eligible')).toHaveLength(1000);
    expect(roster.filter(context => !context.eligible)).toHaveLength(20);
    expect(syntheticContext('internal-020').eligible).toBe(true);
    expect(() => syntheticContext('eligible-0000')).toThrow('synthetic');
  });
});

it('keeps initialization failure explicit and bounds a stuck event flush before closing',async()=>{
 vi.useFakeTimers();
 const fake={waitForInitialization:vi.fn().mockRejectedValue(new Error('initialization unavailable')),initialized:()=>false,flush:()=>new Promise<void>(()=>{}),close:vi.fn(),variationDetail:vi.fn()};
 try {
  const flags=await initializeFlags(settings,()=>fake as unknown as ReturnType<typeof init>);
  expect(fake.waitForInitialization).toHaveBeenCalledWith({timeout:3});
  expect(await flags.evaluate(syntheticContext('internal-001'))).toMatchObject({value:false,fallbackUsed:true,sdkInitialized:false});
  const closed=flags.close();await vi.advanceTimersByTimeAsync(1000);await closed;expect(fake.close).toHaveBeenCalledOnce();
  await flags.close();expect(fake.close).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
