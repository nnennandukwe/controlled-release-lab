import { TestData } from '@launchdarkly/node-server-sdk/integrations';
import { init } from '@launchdarkly/node-server-sdk';
import { initializeFlags, FLAG_KEY } from '../src/flags.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createApplication } from '../src/server.js';
import type { Server } from 'node:http';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  servers.length = 0;
});

async function app() {
  const server = await createApplication({ LAB_ENVIRONMENT: 'local' });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing TCP listener');
  return `http://127.0.0.1:${address.port}`;
}

describe('catalog HTTP interface', () => {
  it('finds the independently specified original search results', async () => {
    const base = await app();
    const response = await fetch(`${base}/api/search?q=keyboard`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results.map((product: { id: string }) => product.id)).toEqual(['keyboard-compact', 'keyboard-full']);
    expect(body.ranking).toBe('original');
    expect(body.requestId).toEqual(expect.any(String));
    expect(body.evaluation).toMatchObject({ contextKey: 'anonymous', cohort: 'excluded', eligible: false, value: false, fallbackUsed: true, sdkInitialized: false });
  });
  it.each(['context=internal-000', 'context=eligible-1001', 'context=internal-001&context=internal-002', 'context=internal-001&eligible=true', 'cohort=internal'])('rejects invalid or spoofed synthetic context: %s', async params => {
    const response = await fetch(`${await app()}/api/search?q=keyboard&${params}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_CONTEXT', message: expect.stringContaining('synthetic') } });
  });
  it.each(['', ' '.repeat(3), 'x'.repeat(101)])('rejects invalid queries with corrective text', async query => {
    const response = await fetch(`${await app()}/api/search?q=${encodeURIComponent(query)}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_QUERY', message: expect.stringContaining('1-100') } });
  });
  it('exposes readiness and local identity without claiming a deployed digest', async () => {
    const base = await app();
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    expect(await (await fetch(`${base}/version`)).json()).toMatchObject({ sourceSha: 'local', environment: 'local', deploymentId: null });
  });
  it('rejects bad configuration before exposing a listener', async () => {
    await expect(createApplication({ LAB_ENVIRONMENT: 'oops' })).rejects.toThrow('LAB_ENVIRONMENT');
    await expect(createApplication({ LAB_ENVIRONMENT: 'live' })).rejects.toThrow();
    await expect(createApplication({ PORT: 'abc' })).rejects.toThrow('PORT');
  });
  it('serves an accessible search form and rejects unknown paths and methods', async () => {
    const base = await app();
    expect(await (await fetch(base)).text()).toContain('<label for="query">');
    expect((await fetch(`${base}/not-found`)).status).toBe(404);
    expect((await fetch(`${base}/api/search?q=keyboard`, { method: 'POST' })).status).toBe(405);
  });
});

it('the disclosed F fixture delays only ranked workspace requests while other HTTP requests remain responsive', async () => {
  const data = new TestData();
  await data.update(data.flag(FLAG_KEY).booleanFlag().variationForAll(false).ifMatch('user', 'cohort', 'internal').thenReturn(true));
  const flags = await initializeFlags({ LAB_ENVIRONMENT: 'staging', LD_PROJECT_KEY: 'default', LD_ENVIRONMENT_KEY: 'test', LD_FLAG_KEY: FLAG_KEY, LD_SDK_KEY: 'sdk-fixture-only' },
    (key, options) => init(key, { ...options, updateProcessor: data.getFactory(), sendEvents: false, diagnosticOptOut: true }));
  const server = await createApplication({ LAB_ENVIRONMENT: 'local' }, flags);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
    const base = `http://127.0.0.1:${address.port}`;
    const started = performance.now();
    const slow = fetch(`${base}/api/search?q=%20WORKSPACE%20&context=internal-001`).then(async response => ({ status: response.status, body: await response.json(), elapsed: performance.now() - started }));
    const ready = await fetch(`${base}/readyz`);
    const normal = await (await fetch(`${base}/api/search?q=keyboard&context=internal-001`)).json();
    const control = await (await fetch(`${base}/api/search?q=workspace&context=excluded-001`)).json();
    expect(ready.status).toBe(200);expect(normal.ranking).toBe('ranked');expect(control.ranking).toBe('original');
    expect(performance.now() - started).toBeLessThan(500);
    const delayed = await slow;
    expect(delayed.status).toBe(200);expect(delayed.elapsed).toBeGreaterThanOrEqual(1000);
    expect(delayed.body.results.map((product: { id: string }) => product.id)).toEqual(['stand-laptop', 'lamp-desk', 'keyboard-full', 'keyboard-compact']);
    expect(delayed.body.evaluation).toMatchObject({ value: true, sdkInitialized: true, fallbackUsed: false });
  } finally {
    server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));await flags.close();
  }
});
