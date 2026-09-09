import { randomUUID } from 'node:crypto';
import captured from '../fixtures/launchdarkly-off.json' with { type: 'json' };
import { flagSnapshot, desiredFlagState, environmentKey, type ExposureStage } from '../../tools/launchdarkly.js';
import { syntheticContext } from '../../src/flags.js';
import { exposureSequence, exposurePolicyDigest, rosterDigest, type ExposureSample } from '../../tools/exposure-observe.js';
import { type FeatureSubject, type FeatureProof } from '../../tools/feature-proof.js';

export function featureFixture(subject: FeatureSubject, stage: ExposureStage = 'off'): FeatureProof {
  const env = environmentKey(subject.targetName);
  const raw = { ...captured, environments: { ...captured.environments, [env]: { ...captured.environments[env], on: stage !== 'off' } } };
  let flag = flagSnapshot(raw, subject.targetName);
  if (stage === '5') {
    const desired = desiredFlagState(flag, '5');
    flag = flagSnapshot({ ...raw, environments: { ...raw.environments, [env]: { ...desired, version: 3, rules: desired.rules.map((rule, index) => ({ ...rule, _id: rule._id ?? `rule-${index}` })) } } }, subject.targetName);
  }
  const samples: ExposureSample[] = exposureSequence(stage).map((request, index) => {
    const context = syntheticContext(request.contextKey);
    const value = stage !== 'off' && (context.cohort === 'internal' || stage === '5' && context.cohort === 'eligible' && Number(context.key.slice(-4)) <= 50);
    const ruleIndex = context.cohort === 'excluded' ? 0 : context.cohort === 'internal' ? 1 : 2;
    const ruleMatch = stage !== 'off' && !(stage === 'internal' && context.cohort === 'eligible');
    return { index, ...request, requestId: randomUUID(), durationMs: 20, status: 200, error: null, sourceSha: subject.sourceSha, deploymentId: subject.deploymentId, environment: subject.targetName, ranking: value ? 'ranked' : 'original',
      results: request.query === 'keyboard' ? value ? ['keyboard-full', 'keyboard-compact'] : ['keyboard-compact', 'keyboard-full'] : value ? ['keyboard-compact', 'headphones-travel'] : ['headphones-travel', 'keyboard-compact'],
      evaluation: { flagKey: 'catalog-ranked-search', contextKey: context.key, cohort: context.cohort, eligible: context.eligible, value, variationIndex: Number(value), fallbackUsed: false, sdkInitialized: true,
        reason: { kind: stage === 'off' ? 'OFF' : ruleMatch ? 'RULE_MATCH' : 'FALLTHROUGH', ...(ruleMatch ? { ruleId: flag.state.rules[ruleIndex]!._id! } : {}) } } };
  });
  const duration = stage === 'internal' ? 60000 : 120000;
  const provider = { sourceImage: subject.image, latestId: subject.deploymentId, configurationFingerprint: subject.configurationFingerprint, active: [{ ...subject.target, id: subject.deploymentId, image: subject.image, status: 'SUCCESS', canRollback: true, metadataKeys: ['image'] }] };
  return { policyDigest: exposurePolicyDigest, rosterDigest, subject, before: flag, after: flag, baselineP95Ms: 20, providerBefore: provider, providerAfter: provider,
    measurement: { startedAt: new Date(Date.now() - duration - 1000).toISOString(), finishedAt: new Date(Date.now() - 1000).toISOString(), elapsedMs: duration, samples } };
}
