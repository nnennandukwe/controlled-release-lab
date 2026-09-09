import { describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { observe, summarize, type Sample } from '../tools/observe.js';

const sample = (overrides: Partial<Sample> = {}): Sample => ({ requestId: '1', durationMs: 20, status: 200, error: null, functional: true, sourceSha: 'a'.repeat(40), deploymentId: 'deployment-a', environment: 'staging', ...overrides });
describe('observation evidence', () => {
  it('counts transport timeouts as failures without presenting completed latency as complete', () => {
    expect(summarize([sample(), sample({ status: null, error: 'TIMEOUT', durationMs: 5000, functional: false })], 2))
      .toMatchObject({ outcome: 'failed', requests: 2, failures: 1, failureRate: 0.5, p95Ms: null });
  });
  it('blocks an absent or incomplete sample instead of averaging it into health', () => {
    expect(summarize([], 2)).toMatchObject({ outcome: 'blocked', failureRate: null, reasonCodes: ['INSUFFICIENT_SAMPLES'] });
    expect(summarize([sample()], 2)).toMatchObject({ outcome: 'blocked', reasonCodes: ['INSUFFICIENT_SAMPLES'] });
  });
  it('rejects mixed deployments and missing identities', () => {
    expect(summarize([sample(), sample({ deploymentId: 'deployment-b' })], 2).reasonCodes).toContain('MIXED_IDENTITY');
    expect(summarize([sample({ sourceSha: null })], 1).outcome).toBe('blocked');
  });
  it('reports the nearest-rank p95 for a complete homogeneous sample', () => {
    expect(summarize([sample({ durationMs: 10 }), sample({ durationMs: 30 })], 2)).toMatchObject({ outcome: 'verified', p95Ms: 30, failureRate: 0 });
  });
});

function slowTarget() {
  let active = 0;
  let peak = 0;
  let requests = 0;
  const transport: typeof fetch = async (_url, init) => {
    requests++;
    peak = Math.max(peak, ++active);
    try {
      await delay(250, null, { signal: init!.signal! });
      return Response.json({ requestId: '55555555-5555-4555-8555-555555555555', sourceSha: 'a'.repeat(40), deploymentId: '44444444-4444-4444-8444-444444444444', environment: 'staging', ranking: 'original', results: [{ id: 'keyboard-compact' }, { id: 'keyboard-full' }] });
    } finally { active--; }
  };
  return { transport, counts: () => ({ active, peak, requests }) };
}

it('waits for capacity instead of discarding healthy slow requests', async () => {
  const target = slowTarget();
  const saved: Sample[] = [];
  const result = await observe('https://example.com', { durationSeconds: 0.3, rate: 10, maxRequests: 3, concurrency: 1 }, async sample => { saved.push(sample); }, target.transport);
  expect(result).toMatchObject({ outcome: 'verified', requests: 3, expectedRequests: 3 });
  expect(saved).toHaveLength(3);
  expect(target.counts()).toEqual({ active: 0, peak: 1, requests: 3 });
  expect(Date.parse(result.finishedAt) - Date.parse(result.startedAt)).toBeGreaterThanOrEqual(700);
});

it('stops queued and in-flight probes at the explicit total time budget', async () => {
  const target = slowTarget();
  const result = await observe('https://example.com', { durationSeconds: 0.3, maxDurationSeconds: 0.35, rate: 10, maxRequests: 3, concurrency: 1 }, async () => {}, target.transport);
  expect(result.outcome).toBe('blocked');
  expect(result.reasonCodes).toContain('OBSERVATION_BUDGET_EXHAUSTED');
  expect(result.requests).toBeLessThan(3);
  expect(target.counts().active).toBe(0);
});
