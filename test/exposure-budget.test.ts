import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { observeExposure, type ExposureSample } from '../tools/exposure-observe.js';
import { featureFixture, baselineQueries } from './helpers/feature-fixture.js';
import { policy } from '../tools/promotion.js';

vi.mock('node:timers/promises', () => ({ setTimeout: (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds)) }));
afterEach(() => vi.useRealTimers());

it('holds incomplete coverage at the deadline even when completed requests pass the latency gate', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  const subject = { sourceSha: 'a'.repeat(40), deploymentId: randomUUID(), targetName: 'staging' as const, target: policy.targets.staging, image: `ghcr.io/${policy.repository}@sha256:${'b'.repeat(64)}`, configurationFingerprint: policy.configurationFingerprints.staging };
  const proof = featureFixture(subject, 'off');
  const source = (proof.measurement as { samples: ExposureSample[] }).samples;
  const retained: ExposureSample[] = [];
  let active = 0, peak = 0;
  const transport: typeof fetch = async input => {
    active++; peak = Math.max(peak, active);
    const url = new URL(String(input));
    const sample = source.find(sample => sample.contextKey === url.searchParams.get('context') && sample.query === url.searchParams.get('q'))!;
    await new Promise(resolve => setTimeout(resolve, 500));
    active--;
    return Response.json({ ...sample, results: sample.results.map(id => ({ id })) });
  };
  const observing = observeExposure(subject.target.url, proof.before, subject, 20, async sample => { retained.push(sample); }, transport, baselineQueries);
  await vi.runAllTimersAsync();
  const measured = await observing;
  expect(peak).toBe(2);
  expect(measured.elapsedMs).toBeGreaterThanOrEqual(180000);
  expect(measured.elapsedMs).toBeLessThanOrEqual(181000);
  expect(measured.requests).toBeLessThan(1160);
  expect(measured.p95Ms).toBeLessThanOrEqual(500);
  expect(measured.reasonCodes).not.toContain('LATENCY_HOLD');
  expect(measured.reasonCodes).toEqual(expect.arrayContaining(['OBSERVATION_BUDGET_EXHAUSTED', 'INSUFFICIENT_SAMPLES']));
  expect(measured.outcome).toBe('blocked');
  expect(retained).toHaveLength(measured.requests);
}, 10000);
