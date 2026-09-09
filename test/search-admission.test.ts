import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { createApplication } from '../src/server.js';
import { createSearchAdmission } from '../src/search-admission.js';
import { offlineFlags, type FlagEvaluator } from '../src/flags.js';

it('limits admitted rate to 20 per second with burst 20 and makes permit release idempotent', () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const acquire = createSearchAdmission();
    for (let index = 0; index < 20; index++) { const release = acquire();expect(release).toBeTypeOf('function');release!();release!(); }
    expect(acquire()).toBeUndefined();now = 50;const refilled = acquire();expect(refilled).toBeTypeOf('function');refilled!();expect(acquire()).toBeUndefined();
    now = 1000;
    const pending = Array.from({ length: 16 }, () => acquire());expect(pending.every(Boolean)).toBe(true);expect(acquire()).toBeUndefined();
    pending[0]!();expect(acquire()).toBeTypeOf('function');expect(acquire()).toBeUndefined();
  } finally { clock.mockRestore(); }
});

it('admits at most 16 pending searches while keeping readiness responsive and releases capacity afterward', async () => {
  let resume!: () => void, evaluations = 0;
  const pending = new Promise<void>(resolve => { resume = resolve; });
  const flags: FlagEvaluator = { ...offlineFlags, evaluate: async context => { evaluations++;await pending;return offlineFlags.evaluate(context); } };
  const server = await createApplication({ LAB_ENVIRONMENT: 'local' }, flags);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`, statuses: number[] = [];
  const requests = Array.from({ length: 24 }, () => fetch(`${base}/api/search?q=keyboard`).then(async response => {
    statuses.push(response.status);await response.json();return response;
  }));
  try {
    await delay(150);
    expect(evaluations).toBe(16);
    expect(statuses).toEqual(Array(8).fill(429));
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    resume();const responses = await Promise.all(requests);
    expect(responses.filter(response => response.status === 200)).toHaveLength(16);
    expect(responses.filter(response => response.status === 429).every(response => response.headers.get('retry-after') === '1')).toBe(true);
    expect((await fetch(`${base}/api/search?q=keyboard`)).status).toBe(200);
  } finally {
    resume();await Promise.allSettled(requests);server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('releases teaching-delay capacity promptly when clients disconnect', async () => {
  let ready!: () => void, evaluations = 0;
  const admitted = new Promise<void>(resolve => { ready = resolve; });
  const flags: FlagEvaluator = { ...offlineFlags, evaluate: async context => {
    if (++evaluations === 16) ready();
    return { ...await offlineFlags.evaluate(context), value: true, variationIndex: 1, fallbackUsed: false, sdkInitialized: true };
  } };
  const server = await createApplication({ LAB_ENVIRONMENT: 'local' }, flags);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`, abort = new AbortController();
  const requests = Array.from({ length: 16 }, () => fetch(`${base}/api/search?q=workspace&context=internal-001`, { signal: abort.signal }).catch(() => null));
  try {
    await admitted;abort.abort();await Promise.all(requests);await delay(50);
    expect((await fetch(`${base}/api/search?q=keyboard`)).status).toBe(200);
  } finally {
    abort.abort();await Promise.allSettled(requests);server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it.each([false, true])('releases HTTP admission on disconnect and handles abandoned SDK work, reject=%s', async rejectLater => {
  let entered!: () => void, resume!: () => void, evaluations = 0;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>((resolve, reject) => { resume = () => rejectLater ? reject(new Error('Late SDK failure')) : resolve(); });
  const flags: FlagEvaluator = { ...offlineFlags, evaluate: async context => {
    const index = ++evaluations;if (index === 16) entered();if (index <= 16) await pending;return offlineFlags.evaluate(context);
  } };
  const server = await createApplication({ LAB_ENVIRONMENT: 'local' }, flags);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`, abort = new AbortController();
  const requests = Array.from({ length: 16 }, () => fetch(`${base}/api/search?q=keyboard`, { signal: abort.signal }).catch(() => null));
  try {
    await admitted;abort.abort();await Promise.all(requests);await delay(50);
    // HTTP admission is available, but do not start unlimited abandoned SDK work.
    const unavailable = await fetch(`${base}/api/search?q=keyboard`);
    expect(unavailable.status).toBe(503);expect(evaluations).toBe(16);
    expect(await unavailable.json()).toMatchObject({ error: { code: 'EVALUATION_UNAVAILABLE' } });
    resume();await delay(0);expect((await fetch(`${base}/api/search?q=keyboard`)).status).toBe(200);
  } finally {
    resume();abort.abort();await Promise.allSettled(requests);server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('bounds a stalled evaluation even while its client stays connected', async () => {
  const server = await createApplication({ LAB_ENVIRONMENT: 'local' }, { ...offlineFlags, evaluate: () => new Promise(() => {}) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('No listener');
  try {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/search?q=keyboard`, { signal: AbortSignal.timeout(2000) });
    expect(response.status).toBe(503);expect(performance.now() - started).toBeLessThan(2000);
  } finally { server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())); }
});
