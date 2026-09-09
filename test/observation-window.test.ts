import { afterEach, expect, it, vi } from 'vitest';
import { observe } from '../tools/observe.js';
const clock = vi.hoisted(() => ({ now: 0 }));
// Model the fractional early wakeup seen in hosted run 34321711822. This is a
// scheduler seam, not a substituted measurement or a weakened policy threshold.
vi.mock('node:timers/promises', () => ({ setTimeout: async (ms: number) => { clock.now += Math.max(0, ms - 0.25); } }));
afterEach(() => { vi.restoreAllMocks(); clock.now = 0; });
it('waits through an early timer wakeup until the whole required observation window has elapsed', async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  const traffic: typeof fetch = async () => Response.json({ sourceSha: 'a'.repeat(40), deploymentId: '44444444-4444-4444-8444-444444444444', environment: 'staging', requestId: '55555555-5555-4555-8555-555555555555', ranking: 'original', results: [{ id: 'keyboard-compact' }, { id: 'keyboard-full' }] });
  const result = await observe('https://example.up.railway.app', { durationSeconds: 0.1, maxDurationSeconds: 1, rate: 10, maxRequests: 1 }, async () => {}, traffic);
  expect(result.outcome).toBe('verified');
  expect(result.requests).toBe(1);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(100);
});
