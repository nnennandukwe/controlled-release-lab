import { expect, it } from 'vitest';
import { init } from '@launchdarkly/node-server-sdk';
import { TestData } from '@launchdarkly/node-server-sdk/integrations';
import { initializeFlags, syntheticRoster, FLAG_KEY } from '../src/flags.js';
import { flagSnapshot, desiredFlagState } from '../tools/launchdarkly.js';
import captured from './fixtures/launchdarkly-off.json' with { type: 'json' };

it('the real SDK retains treatment membership through 5, 25 and 100 percent with excluded controls', async () => {
  const data = new TestData(), raw = structuredClone(captured);
  let snapshot = flagSnapshot(raw, 'staging');
  const publish = async () => {
    await data.usePreconfiguredFlag({ key: FLAG_KEY, ...snapshot.state, version: snapshot.version, variations: [false, true],
      rules: snapshot.state.rules.map(({ _id, ...rule }) => ({ ...rule, id: _id })) });
  };
  await publish();
  const evaluator = await initializeFlags({ LAB_ENVIRONMENT: 'staging', LD_SDK_KEY: 'sdk-fixture-only', LD_PROJECT_KEY: 'default', LD_ENVIRONMENT_KEY: 'test', LD_FLAG_KEY: FLAG_KEY },
    (key, options) => init(key, { ...options, updateProcessor: data.getFactory(), sendEvents: false, diagnosticOptOut: true }));
  let previous = new Set<string>();
  try {
    for (const stage of ['internal', '5', '25', '100'] as const) {
      const desired = desiredFlagState(snapshot, stage);
      snapshot = flagSnapshot({ ...raw, environments: { ...raw.environments, test: { ...desired, version: snapshot.version + 1,
        rules: desired.rules.map((rule, index) => ({ ...rule, _id: rule._id ?? `rule-${index}` })) } } }, 'staging');
      await publish();
      const treatment = new Set<string>(), eligibleControl = new Set<string>();
      for (const context of syntheticRoster()) {
        const evaluation = await evaluator.evaluate(context);
        expect(evaluation).toMatchObject({ sdkInitialized: true, fallbackUsed: false });
        if (context.cohort === 'excluded') expect(evaluation.value).toBe(false);
        if (context.cohort === 'internal') expect(evaluation.value).toBe(true);
        if (context.cohort === 'eligible') (evaluation.value ? treatment : eligibleControl).add(context.key);
      }
      for (const key of previous) expect(treatment.has(key)).toBe(true);
      if (stage === '5' || stage === '25') { expect(treatment.size).toBeGreaterThanOrEqual(20);expect(eligibleControl.size).toBeGreaterThanOrEqual(200); }
      if (stage === '100') { expect(treatment.size).toBe(1000);expect(eligibleControl.size).toBe(0); }
      previous = treatment;
    }
  } finally { await evaluator.close(); }
});
