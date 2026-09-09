import { init, type LDClient, type LDOptions } from '@launchdarkly/node-server-sdk';
import { z } from 'zod';

export const FLAG_KEY = 'catalog-ranked-search';
export const ROSTER_VERSION = 1;
export type SyntheticContext = { kind: 'user'; key: string; cohort: 'internal' | 'eligible' | 'excluded'; eligible: boolean };
export type Evaluation = { flagKey: string; contextKey: string; cohort: SyntheticContext['cohort']; eligible: boolean; value: boolean; variationIndex: number | null; reason: { kind: string; ruleId?: string; errorKind?: string }; fallbackUsed: boolean; sdkInitialized: boolean };
export interface FlagEvaluator { evaluate(context: SyntheticContext): Promise<Evaluation>; close(): Promise<void> }

/** Resolve only the public synthetic roster; request attributes never grant cohort membership. */
export function syntheticContext(key = 'anonymous'): SyntheticContext {
  if (key === 'anonymous') return { kind: 'user', key, cohort: 'excluded', eligible: false };
  const match = /^(internal|eligible|excluded)-(\d+)$/.exec(key);
  if (!match) throw new Error('Use a valid synthetic context from the demonstration roster.');
  const cohort = match[1] as SyntheticContext['cohort'];
  const digits = cohort === 'eligible' ? 4 : 3;
  const maximum = cohort === 'eligible' ? 1000 : 20;
  if (match[2]!.length !== digits || Number(match[2]) < 1 || Number(match[2]) > maximum) throw new Error('Use a valid synthetic context from the demonstration roster.');
  return { kind: 'user', key, cohort, eligible: cohort !== 'excluded' };
}

/** Fixed roster order makes measurement denominators reproducible. */
export function syntheticRoster(): SyntheticContext[] {
  return (['internal', 'eligible', 'excluded'] as const).flatMap(cohort => Array.from({ length: cohort === 'eligible' ? 1000 : 20 }, (_, index) => syntheticContext(`${cohort}-${String(index + 1).padStart(cohort === 'eligible' ? 4 : 3, '0')}`)));
}

function fallback(context: SyntheticContext, errorKind: string, sdkInitialized = false): Evaluation {
  return { flagKey: FLAG_KEY, contextKey: context.key, cohort: context.cohort, eligible: context.eligible, value: false, variationIndex: null, reason: { kind: 'ERROR', errorKind }, fallbackUsed: true, sdkInitialized };
}

export const offlineFlags: FlagEvaluator = { evaluate: async context => fallback(context, 'OFFLINE'), close: async () => {} };

/** Require exact hosted mapping without returning the SDK credential in diagnostics. */
export function flagSettings(environment: NodeJS.ProcessEnv) {
  const target = z.enum(['local', 'staging', 'live']).parse(environment.LAB_ENVIRONMENT ?? 'local');
  if (target === 'local') return undefined;
  const config = z.object({ LD_SDK_KEY: z.string().startsWith('sdk-').min(10), LD_PROJECT_KEY: z.literal('default'), LD_ENVIRONMENT_KEY: z.enum(['test', 'production']), LD_FLAG_KEY: z.literal(FLAG_KEY) }).parse(environment);
  if (config.LD_ENVIRONMENT_KEY !== (target === 'staging' ? 'test' : 'production')) throw new Error('LaunchDarkly environment must match the configured Railway target.');
  return config;
}

/** Own one SDK client; cached evaluations never claim a current control-plane connection. */
export async function initializeFlags(environment: NodeJS.ProcessEnv, factory: (key: string, options: LDOptions) => LDClient = init): Promise<FlagEvaluator> {
  const config = flagSettings(environment);
  if (!config) return offlineFlags;
  const log = () => { process.stderr.write('LaunchDarkly SDK reported a connection or evaluation issue; inspect evaluation diagnostics.\n'); };
  const client = factory(config.LD_SDK_KEY, { allAttributesPrivate: true, logger: { debug: () => {}, info: () => {}, warn: log, error: log } });
  let closed = false;
  try { await client.waitForInitialization({ timeout: 3 }); }
  catch { process.stderr.write('LaunchDarkly initialization unavailable; serving original fallback until initialization succeeds.\n'); }
  return {
    async evaluate(context) {
      if (closed || !client.initialized()) return fallback(context, 'CLIENT_NOT_READY');
      try {
        const detail = await client.variationDetail(FLAG_KEY, context, false);
        if (typeof detail.value !== 'boolean' || detail.reason.kind === 'ERROR' || detail.variationIndex === undefined) return fallback(context, detail.reason.kind === 'ERROR' ? detail.reason.errorKind ?? 'EXCEPTION' : 'WRONG_TYPE', true);
        const reason: Evaluation['reason'] = { kind: detail.reason.kind };
        if (detail.reason.kind === 'RULE_MATCH' && detail.reason.ruleId) reason.ruleId = detail.reason.ruleId;
        return { flagKey: FLAG_KEY, contextKey: context.key, cohort: context.cohort, eligible: context.eligible, value: detail.value, variationIndex: detail.variationIndex, reason, fallbackUsed: false, sdkInitialized: true };
      } catch { return fallback(context, 'EXCEPTION', client.initialized()); }
    },
    async close() {
      if (closed) return;
      closed = true;
      let timer: NodeJS.Timeout | undefined;
      try { await Promise.race([client.flush(), new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]); }
      catch { process.stderr.write('LaunchDarkly event flush did not complete before shutdown.\n'); }
      finally { clearTimeout(timer); client.close(); }
    },
  };
}
