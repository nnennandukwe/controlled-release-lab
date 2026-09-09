import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { exposureSequence, assessExposure, originalQueryBaselines, type ExposureSample } from '../tools/exposure-observe.js';
import { desiredFlagState, type ExposureStage } from '../tools/launchdarkly.js';
import { checkFeatureProof, legacyFeatureProofSchema } from '../tools/feature-proof.js';
import { workflowArguments } from '../tools/workflow.js';
import { featureFixture, baselineQueries } from './helpers/feature-fixture.js';
import { policy } from '../tools/promotion.js';

const subject = { sourceSha: 'a'.repeat(40), deploymentId: randomUUID(), targetName: 'staging' as const,
  target: policy.targets.staging, image: `ghcr.io/${policy.repository}@sha256:${'b'.repeat(64)}`,
  configurationFingerprint: policy.configurationFingerprints.staging };

it('predeclares a challenge query for the full population without widening the budget', () => {
  const sequence = exposureSequence('off');
  expect(sequence).toHaveLength(1160);
  expect(sequence.filter(request => String(request.query) === 'workspace')).toHaveLength(1040);
  expect(sequence.filter(request => request.query === 'keyboard')).toHaveLength(60);
  expect(sequence.filter(request => request.query === 'compact')).toHaveLength(60);
  expect(exposureSequence('internal').some(request => String(request.query) === 'workspace')).toBe(false);
});

it.each(['off', 'internal', '5', '25', '100'] as const)('requires the declared healthy workload at %s', stage => {
  const proof = featureFixture(subject, stage);
  const checked = checkFeatureProof(proof, subject, 'any');
  expect(checked.measurement.outcome).toBe('verified');
  if (stage === '100') expect(checked.measurement.distinct).toMatchObject({ eligibleTrue: 1000, eligibleFalse: 0, internalTrue: 20, excludedFalse: 20 });
});

it('keeps missing query baselines insufficient even with a healthy aggregate baseline', () => {
  const proof = featureFixture(subject, '5');
  const samples = (proof.measurement as { samples: ExposureSample[] }).samples;
  expect(assessExposure(samples, proof.before, subject, 120000, 20, { keyboard: 20, compact: 20 }).reasonCodes).toContain('MISSING_QUERY_BASELINE');
});

it('inspects legacy feature evidence without accepting it under the new policy', () => {
  const { schemaVersion, baselineQueryP95Ms, ...legacy } = featureFixture(subject, 'off');
  expect(legacyFeatureProofSchema.parse(legacy)).toEqual(legacy);
  expect(() => checkFeatureProof(legacy, subject, 'off')).toThrow();
});

it('uses an absolute bootstrap bound and derives later baselines from each actual off query', () => {
  const proof = featureFixture(subject, 'off');
  const samples = (proof.measurement as { samples: ExposureSample[] }).samples;
  const timings = { keyboard: 100, compact: 200, workspace: 300 };
  for (const sample of samples) sample.durationMs = timings[sample.query];
  const baseline = checkFeatureProof({ ...proof, baselineQueryP95Ms: null }, subject, 'off');
  expect(originalQueryBaselines(baseline.measurement)).toEqual(timings);
  expect(baseline.measurement.queryMetrics['workspace/original']).toMatchObject({ baselineP95Ms: null, latencyLimitMs: 500 });
  for (const sample of samples) if (sample.query === 'workspace') sample.durationMs = 550;
  expect(() => checkFeatureProof({ ...proof, baselineP95Ms: 300, baselineQueryP95Ms: null }, subject, 'off')).toThrow('QUERY_LATENCY_HOLD');
});

it.each(['25', '100'] as const)('routes %s through the public workflow arguments', stage => {
  expect(workflowArguments({ LAB_OPERATION: 'expose', LAB_TARGET: 'live', LAB_STAGE: stage, LAB_RELEASE_DIR: 'work/release/current', LAB_APPLY: 'true' }))
    .toEqual(['expose', '--target', 'live', '--stage', stage, '--apply', '--release-dir', 'work/release/current']);
});

it.each(['internal', '5', '25', '100'] as const)('disables independently from %s without rewriting its definition', stage => {
  const proof = featureFixture(subject, stage);
  expect(desiredFlagState(proof.before, 'off')).toEqual({ ...proof.before.state, on: false });
});

it.each([['off', '25'], ['internal', '100'], ['5', '100'], ['25', '5'], ['100', '100']] as const)('refuses the unapproved %s -> %s transition', (before, after) => {
  expect(() => desiredFlagState(featureFixture(subject, before).before, after)).toThrow('Use off -> internal');
});

it('holds a slow treatment query even when the aggregate p95 is healthy', () => {
  const proof = featureFixture(subject, '5');
  const samples = (proof.measurement as { samples: ExposureSample[] }).samples;
  // A valid finite-roster assignment can contain only 20 eligible treatments.
  // With 20 internal treatments, the slow challenge group is below 5% of all
  // requests and disappears from the aggregate p95.
  for (const sample of samples) {
    if (sample.evaluation?.cohort === 'eligible' && Number(sample.contextKey.slice(-4)) > 20) {
      sample.evaluation.value = false; sample.evaluation.variationIndex = 0; sample.ranking = 'original';
      sample.results = ['keyboard-compact', 'keyboard-full', 'lamp-desk', 'stand-laptop'];
    }
    if (sample.query === 'workspace' && sample.evaluation?.value) sample.durationMs = 1000;
  }
  const result = assessExposure(samples, proof.before, subject, 120000, 20, baselineQueries);
  expect(result.p95Ms).toBe(20);
  expect(result.outcome).toBe('blocked');
  expect(result.reasonCodes).toContain('QUERY_LATENCY_HOLD');
  expect(result.failures).toBe(0);
  expect(result.queryMetrics['workspace/ranked']).toMatchObject({ distinct: 40, p95Ms: 1000 });
});

it('advances from five to twenty-five percent preserving existing targeting rule identity', () => {
  const proof = featureFixture(subject, '5');
  const next = desiredFlagState(proof.before, '25' as ExposureStage);
  expect(next.rules[2]?._id).toBe(proof.before.state.rules[2]?._id);
  expect(next.rules[2]?.rollout?.variations).toEqual([{ variation: 1, weight: 25000 }, { variation: 0, weight: 75000 }]);
});
