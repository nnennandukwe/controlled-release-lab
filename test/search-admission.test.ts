import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { createApplication } from '../src/server.js';
import { createSearchAdmission, searchClientAddress } from '../src/search-admission.js';
import { offlineFlags, type FlagEvaluator } from '../src/flags.js';
import * as buildInfo from '../src/build-info.js';

async function hostedApp(flags: FlagEvaluator) {
  const build = vi.spyOn(buildInfo, 'loadBuildInfo').mockResolvedValue({ sourceSha: 'a'.repeat(40), buildRunId: '1', catalogVersion: '1' });
  try {
    return await createApplication({ LAB_ENVIRONMENT: 'staging', RAILWAY_DEPLOYMENT_ID: '11111111-1111-4111-8111-111111111111', LD_SDK_KEY: 'sdk-test-only', LD_PROJECT_KEY: 'default', LD_ENVIRONMENT_KEY: 'test', LD_FLAG_KEY: 'catalog-ranked-search' }, flags);
  } finally { build.mockRestore(); }
}

it('uses only the Railway client header when hosted and ignores forged forwarding headers locally', () => {
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '192.0.2.1', 'x-forwarded-for': '192.0.2.2' } };
  expect(searchClientAddress(request, false)).toBe('127.0.0.1');expect(searchClientAddress(request, true)).toBe('192.0.2.1');
  for (const value of [undefined, 'invalid', 'fe80::1%eth0', '192.0.2.1, 192.0.2.2', ['192.0.2.1', '192.0.2.2']]) {
    expect(searchClientAddress({ ...request, headers: { 'x-real-ip': value } }, true)).toBeUndefined();
  }
  expect(searchClientAddress({ ...request, headers: { 'x-real-ip': '2001:0db8:0:0:0:0:0:1' } }, true)).toBe('[2001:db8::1]');
});

it('caps each client at four pending searches and twelve per second without consuming another client quota', () => {
  let now = 0;const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const acquire = createSearchAdmission();
    const held = Array.from({ length: 4 }, () => acquire('one'));expect(held.every(Boolean)).toBe(true);
    expect(acquire('one')).toBeUndefined();const other = acquire('two');expect(other).toBeTypeOf('function');other!();
    held.forEach(release => release!());
    for (let index = 0; index < 8; index++) acquire('one')!();
    expect(acquire('one')).toBeUndefined();now = 100;expect(acquire('one')).toBeTypeOf('function');
    // Active entries survive idle expiry; expired released entries can start again.
    now = 60_100;const fresh = acquire('two');expect(fresh).toBeTypeOf('function');fresh!();
  } finally { clock.mockRestore(); }
});

it('bounds idle client storage and never expires occupied permits', () => {
  let now = 0;const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const acquire = createSearchAdmission();
    for (let index = 0; index < 1024; index++) { now = Math.floor(index / 20) * 1000;const release = acquire(`client-${index}`);expect(release).toBeTypeOf('function');release!(); }
    expect(acquire('overflow')).toBeUndefined();const existing = acquire('client-0');expect(existing).toBeTypeOf('function');existing!();
    now = 120_000;const held = Array.from({ length: 4 }, () => acquire('held'));expect(held.every(Boolean)).toBe(true);
    now = 180_001;expect(acquire('held')).toBeUndefined();expect(acquire('new')).toBeTypeOf('function');held.forEach(release => release!());
  } finally { clock.mockRestore(); }
});

it('one client cannot consume every search permit with delayed workspace requests', async () => {
  let evaluations = 0;
  const flags: FlagEvaluator = { ...offlineFlags, evaluate: async context => { evaluations++;return { ...await offlineFlags.evaluate(context), value: true }; } };
  const server = await hostedApp(flags);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`, abort = new AbortController(), statuses: number[] = [];
  const requests = Array.from({ length: 16 }, () => fetch(`${base}/api/search?q=workspace&context=internal-001`, { headers: { 'X-Real-IP': '192.0.2.1' }, signal: abort.signal }).then(response => { statuses.push(response.status);return response; }).catch(() => null));
  try {
    await delay(150);
    expect(evaluations).toBe(4);expect(statuses).toEqual(Array(12).fill(429));
    const response = await fetch(`${base}/api/search?q=keyboard`, { headers: { 'X-Real-IP': '192.0.2.2' } });
    expect(response.status).toBe(200);expect((await response.json()).results).toHaveLength(2);
    expect((await fetch(`${base}/api/search?q=keyboard`)).status).toBe(503);
  } finally { abort.abort();await Promise.allSettled(requests);server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('one client cannot accumulate every abandoned SDK call by disconnecting and changing personas', async () => {
  let evaluations = 0, resume!: () => void;
  const pending = new Promise<void>(resolve => { resume = resolve; });
  const flags: FlagEvaluator = { ...offlineFlags, evaluate: async context => { evaluations++;if (context.cohort === 'internal') await pending;return offlineFlags.evaluate(context); } };
  const server = await hostedApp(flags);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`, abort = new AbortController();
  const requests = Array.from({ length: 4 }, () => fetch(`${base}/api/search?q=keyboard&context=internal-001`, { headers: { 'X-Real-IP': '192.0.2.1' }, signal: abort.signal }).catch(() => null));
  try {
    await delay(100);expect(evaluations).toBe(4);abort.abort();await Promise.all(requests);await delay(50);
    const unavailable = await fetch(`${base}/api/search?q=keyboard&context=internal-002`, { headers: { 'X-Real-IP': '192.0.2.1' } });
    expect(unavailable.status).toBe(503);expect(evaluations).toBe(4);
    const other = await fetch(`${base}/api/search?q=keyboard`, { headers: { 'X-Real-IP': '192.0.2.2' } });
    expect(other.status).toBe(200);expect(evaluations).toBe(5);
  } finally { resume();abort.abort();await Promise.allSettled(requests);server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('limits admitted rate to 20 per second with burst 20 and makes permit release idempotent', () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const acquire = createSearchAdmission();
    for (let index = 0; index < 20; index++) { const release = acquire(`client-${index}`);expect(release).toBeTypeOf('function');release!();release!(); }
    expect(acquire('next')).toBeUndefined();now = 50;const refilled = acquire('next');expect(refilled).toBeTypeOf('function');refilled!();expect(acquire('next')).toBeUndefined();
    now = 1000;
    const pending = Array.from({ length: 16 }, (_, index) => acquire(`pending-${index}`));expect(pending.every(Boolean)).toBe(true);expect(acquire('extra')).toBeUndefined();
    pending[0]!();expect(acquire('extra')).toBeTypeOf('function');expect(acquire('extra')).toBeUndefined();
  } finally { clock.mockRestore(); }
});

it('admits at most 16 pending searches while keeping readiness responsive and releases capacity afterward', async () => {
  let resume!: () => void, evaluations = 0;
  const pending = new Promise<void>(resolve => { resume = resolve; });
  const flags: FlagEvaluator = { ...offlineFlags, evaluate: async context => { evaluations++;await pending;return offlineFlags.evaluate(context); } };
  const server = await hostedApp(flags);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`, statuses: number[] = [];
  const requests = Array.from({ length: 24 }, (_, index) => fetch(`${base}/api/search?q=keyboard`, { headers: { 'X-Real-IP': `192.0.2.${index + 1}` } }).then(async response => {
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
    expect((await fetch(`${base}/api/search?q=keyboard`, { headers: { 'X-Real-IP': '192.0.2.250' } })).status).toBe(200);
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
  const server = await hostedApp(flags);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`, abort = new AbortController();
  const requests = Array.from({ length: 16 }, (_, index) => fetch(`${base}/api/search?q=workspace&context=internal-001`, { signal: abort.signal, headers: { 'X-Real-IP': `192.0.2.${index + 1}` } }).catch(() => null));
  try {
    await admitted;abort.abort();await Promise.all(requests);await delay(50);
    expect((await fetch(`${base}/api/search?q=keyboard`, { headers: { 'X-Real-IP': '192.0.2.250' } })).status).toBe(200);
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
  const server = await hostedApp(flags);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`, abort = new AbortController();
  const requests = Array.from({ length: 16 }, (_, index) => fetch(`${base}/api/search?q=keyboard`, { signal: abort.signal, headers: { 'X-Real-IP': `192.0.2.${index + 1}` } }).catch(() => null));
  try {
    await admitted;abort.abort();await Promise.all(requests);await delay(50);
    // HTTP admission is available, but do not start unlimited abandoned SDK work.
    const unavailable = await fetch(`${base}/api/search?q=keyboard`, { headers: { 'X-Real-IP': '192.0.2.250' } });
    expect(unavailable.status).toBe(503);expect(evaluations).toBe(16);
    expect(await unavailable.json()).toMatchObject({ error: { code: 'EVALUATION_UNAVAILABLE' } });
    resume();await delay(0);expect((await fetch(`${base}/api/search?q=keyboard`, { headers: { 'X-Real-IP': '192.0.2.250' } })).status).toBe(200);
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
