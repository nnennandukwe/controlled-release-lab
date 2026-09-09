import { expect, it } from 'vitest';
import { TestData } from '@launchdarkly/node-server-sdk/integrations';
import { init } from '@launchdarkly/node-server-sdk';
import { createApplication } from '../src/server.js';
import { initializeFlags, FLAG_KEY } from '../src/flags.js';

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
