import { describe, expect, it } from 'vitest';
import { summarize, type Sample } from '../tools/observe.js';

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
