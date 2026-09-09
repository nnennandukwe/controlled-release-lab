import { z } from 'zod';
import exposurePolicy from '../config/exposure-policy.json' with { type: 'json' };
import { FLAG_KEY } from '../src/flags.js';
import { fingerprint, LabError } from './evidence.js';

export const stageSchema = z.enum(['off', 'internal', '5']);
export type ExposureStage = z.infer<typeof stageSchema>;
const clauseSchema = z.object({ _id: z.string().optional(), attribute: z.string(), contextKind: z.literal('user'), op: z.literal('in'), values: z.array(z.union([z.string(), z.boolean()])), negate: z.literal(false) }).strict();
const rolloutSchema = z.object({ contextKind: z.literal('user'), bucketBy: z.literal('key').optional(), variations: z.array(z.object({ variation: z.number().int(), weight: z.number().int() }).strict()), kind: z.literal('rollout').optional() }).strict();
const ruleSchema = z.object({ _id: z.string().optional(), clauses: z.array(clauseSchema), variation: z.number().int().optional(), rollout: rolloutSchema.optional(), trackEvents: z.boolean() }).strict();
export const flagStateSchema = z.object({ on: z.boolean(), salt: z.string().min(1), sel: z.string().min(1), archived: z.literal(false), targets: z.array(z.unknown()).length(0), contextTargets: z.array(z.unknown()).length(0), rules: z.array(ruleSchema), fallthrough: z.object({ variation: z.literal(0) }).strict(), offVariation: z.literal(0), prerequisites: z.array(z.unknown()).length(0), trackEvents: z.literal(false), trackEventsFallthrough: z.literal(false) }).strict();
export type FlagState = z.infer<typeof flagStateSchema>;
const globalsSchema = z.object({ key: z.literal(FLAG_KEY), kind: z.literal('boolean'), archived: z.literal(false), variations: z.tuple([z.object({ _id: z.string(), value: z.literal(false) }).passthrough(), z.object({ _id: z.string(), value: z.literal(true) }).passthrough()]), defaults: z.object({ onVariation: z.literal(0), offVariation: z.literal(0) }).strict(), clientSideAvailability: z.object({ usingMobileKey: z.literal(false), usingEnvironmentId: z.literal(false) }).strict() });
export const flagSnapshotSchema = z.object({ projectKey: z.literal('default'), flagKey: z.literal(FLAG_KEY), environmentKey: z.enum(['test', 'production']), version: z.number().int().positive(), globals: globalsSchema, state: flagStateSchema, stage: stageSchema, digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type FlagSnapshot = z.infer<typeof flagSnapshotSchema>;
export interface FlagProvider { assertScope(): Promise<void>; snapshot(): Promise<FlagSnapshot>; update(before: FlagSnapshot, stage: ExposureStage): Promise<FlagSnapshot> }
export const environmentKey = (target: 'staging' | 'live') => target === 'staging' ? 'test' as const : 'production' as const;
const excludedRule = { clauses: [{ attribute: 'eligible', contextKind: 'user', op: 'in', values: [false], negate: false }], variation: 0, trackEvents: false };
const internalRule = { clauses: [{ attribute: 'cohort', contextKind: 'user', op: 'in', values: ['internal'], negate: false }], variation: 1, trackEvents: false };
const percentageRule = { clauses: [{ attribute: 'cohort', contextKind: 'user', op: 'in', values: ['eligible'], negate: false }], rollout: { contextKind: 'user', bucketBy: 'key', variations: [{ variation: 1, weight: 5000 }, { variation: 0, weight: 95000 }] }, trackEvents: false };
function targetingRules(rules: FlagState['rules']) {
  return rules.map(({ _id, ...rule }) => ({ ...rule, ...(rule.rollout ? { rollout: { contextKind: rule.rollout.contextKind, bucketBy: rule.rollout.bucketBy ?? 'key', variations: rule.rollout.variations } } : {}), clauses: rule.clauses.map(({ _id, ...clause }) => clause) }));
}
function definitionStage(state: FlagState): 'internal' | '5' {
  const rules = fingerprint(targetingRules(state.rules));
  if (rules === fingerprint([excludedRule, internalRule])) return 'internal';
  if (rules === fingerprint([excludedRule, internalRule, percentageRule])) return '5';
  throw new LabError('UNMANAGED_FLAG', 'Restore the reviewed synthetic targeting definition before operating this flag.');
}
/** Select and bind every managed field; provider metadata is not release authority. */
export function flagSnapshot(input: unknown, target: 'staging' | 'live'): FlagSnapshot {
  try {
    const payload = z.object({ environments: z.record(z.string(), z.unknown()) }).parse(input);
    const globals = globalsSchema.parse(input);
    const environment = z.object({ version: z.number().int().positive() }).passthrough().parse(payload.environments[environmentKey(target)]);
    const state = flagStateSchema.parse(Object.fromEntries(Object.keys(flagStateSchema.shape).map(key => [key, environment[key]])));
    const definition = definitionStage(state);
    const bound = { projectKey: 'default' as const, flagKey: FLAG_KEY as typeof FLAG_KEY, environmentKey: environmentKey(target), version: environment.version, globals, state, stage: state.on ? definition : 'off' as const };
    return { ...bound, digest: fingerprint(bound) };
  } catch (error) { if (error instanceof LabError) throw error; throw new LabError('UNMANAGED_FLAG', 'Flag response differs from the reviewed boolean, server-only targeting contract.'); }
}
export function validateFlagSnapshot(input: unknown, target: 'staging' | 'live') {
  const parsed = flagSnapshotSchema.parse(input);
  const actual = flagSnapshot({ ...parsed.globals, environments: { [parsed.environmentKey]: { ...parsed.state, version: parsed.version } } }, target);
  if (fingerprint(parsed) !== fingerprint(actual)) throw new LabError('FLAG_SUBJECT', 'Flag evidence does not match its exact environment, state and digest.');
  return actual;
}
export function desiredFlagState(before: FlagSnapshot, stage: ExposureStage): FlagState {
  stageSchema.parse(stage);
  if (stage === 'off') return { ...before.state, on: false };
  if ((stage === 'internal' && before.stage !== 'off') || (stage === '5' && before.stage !== 'internal')) throw new LabError('EXPOSURE_TRANSITION', 'Only off to internal, internal to 5%, and independently authorized disable transitions are allowed.');
  return flagStateSchema.parse({ ...before.state, on: true, rules: [...before.state.rules.slice(0, 2), ...(stage === '5' ? [percentageRule] : [])] });
}

/** Fixed provider/flag; Reader for reads and a separately supplied Writer for one conditional effect. */
export class LaunchDarkly implements FlagProvider {
  constructor(private reader: string, private writer: string | undefined, private target: 'staging' | 'live', private transport: typeof fetch = fetch) {
    if (!reader.trim()) throw new LabError('MISSING_FLAG_READER', 'Install LD_READ_TOKEN through the repository secret store.');
  }
  private async request(path: string, patch?: unknown, useWriter = patch !== undefined) {
    const mutation = patch !== undefined;
    if (useWriter && !this.writer?.trim()) throw new LabError('MISSING_FLAG_WRITER', 'LD_MANAGEMENT_TOKEN is available only to the protected flag operation.');
    try {
      const response = await this.transport(`https://app.launchdarkly.com/api/v2/${path}`, { method: mutation ? 'PATCH' : 'GET', headers: { Authorization: useWriter ? this.writer! : this.reader, 'LD-API-Version': '20240415', ...(mutation ? { 'Content-Type': 'application/json' } : {}) }, ...(mutation ? { body: JSON.stringify(patch) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (response.status === 409) throw new LabError('FLAG_CONFLICT', 'The flag changed after this request was prepared. Resolve a fresh request.');
      if (!response.ok) throw new LabError('FLAG_HTTP', `LaunchDarkly returned HTTP ${response.status}.`, mutation && response.status >= 500 ? 'unknown_outcome' : 'blocked');
      // Bound bytes during streaming, not only after allocating the body.
      const reader = response.body?.getReader(); if (!reader) throw new Error('Missing body');
      let size = 0; const chunks: Uint8Array[] = [];
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Oversized body'); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof LabError) throw error;
      throw new LabError('FLAG_TRANSPORT', 'LaunchDarkly request or response did not complete. Reconcile a submitted change before retrying.', mutation ? 'unknown_outcome' : 'blocked');
    }
  }
  private async checkScope(useWriter = false) {
    const projects = z.object({ items: z.array(z.object({ key: z.string() })), totalCount: z.number().optional() }).parse(await this.request('projects?limit=20', undefined, useWriter));
    const flags = z.object({ items: z.array(z.object({ key: z.string() })), totalCount: z.number().optional() }).parse(await this.request('flags/default?limit=20', undefined, useWriter));
    const allowed = [FLAG_KEY, 'ld-example-release-new-search', 'ld-example-experiment-dashboard-layout', 'ld-example-feature-premium-dashboard', 'ld-example-kill-switch-third-party-chat', 'ld-example-ops-maintenance-banner'];
    if (projects.items.length !== 1 || projects.items[0]?.key !== 'default' || (projects.totalCount ?? 1) !== 1 || flags.items.some(flag => !allowed.includes(flag.key)) || (flags.totalCount ?? flags.items.length) > allowed.length) throw new LabError('FLAG_ACCOUNT_SCOPE', 'This Writer credential requires the dedicated lab account. Revisit isolation before operating unrelated resources.');
  }
  async assertScope() { await this.checkScope(); }
  private boundSnapshot(input: unknown) {
    const snapshot = flagSnapshot(input, this.target);
    const identity = { variationIds: snapshot.globals.variations.map(variation => variation._id), salt: snapshot.state.salt, sel: snapshot.state.sel };
    const expected = { variationIds: exposurePolicy.flagIdentity.variationIds, ...exposurePolicy.flagIdentity.environments[snapshot.environmentKey] };
    if (fingerprint(identity) !== fingerprint(expected)) throw new LabError('FLAG_SUBJECT', 'The provider flag identity differs from the configured lab flag. Review account and flag configuration before continuing.');
    return snapshot;
  }
  async snapshot() { return this.boundSnapshot(await this.request(`flags/default/${FLAG_KEY}`)); }
  async update(input: FlagSnapshot, stage: ExposureStage) {
    let before: FlagSnapshot;
    try { before = validateFlagSnapshot(input, this.target); }
    catch { throw new LabError('FLAG_SUBJECT', 'Flag evidence must identify this exact managed environment.'); }
    const desired = desiredFlagState(before, stage);
    // Independently verify the credential that will submit the effect. A fixed
    // path and matching Reader state do not identify the Writer's account.
    if (!this.writer?.trim()) throw new LabError('MISSING_FLAG_WRITER', 'LD_MANAGEMENT_TOKEN is available only to the protected flag operation.');
    const identity = z.object({ accountId: z.string().min(1) });
    const readerIdentity = identity.safeParse(await this.request('caller-identity'));
    const writerIdentity = identity.extend({ serviceToken: z.literal(true) }).safeParse(await this.request('caller-identity', undefined, true));
    if (!readerIdentity.success || !writerIdentity.success || readerIdentity.data.accountId !== writerIdentity.data.accountId) throw new LabError('FLAG_ACCOUNT_SCOPE', 'Reader and Writer must identify the same dedicated lab account, with a service token for the Writer.');
    await this.checkScope(); await this.checkScope(true);
    const writerSnapshot = this.boundSnapshot(await this.request(`flags/default/${FLAG_KEY}`, undefined, true));
    if (writerSnapshot.digest !== before.digest) throw new LabError('FLAG_STATE_CHANGED', 'Writer sees a different managed flag state. Resolve a fresh request before PATCH.');
    const prefix = `/environments/${before.environmentKey}`;
    const patch: { op: 'test' | 'replace'; path: string; value: unknown }[] = [
      { op: 'test', path: `${prefix}/version`, value: before.version },
      ...Object.entries(before.globals).map(([key, value]) => ({ op: 'test' as const, path: `/${key}`, value })),
      ...Object.entries(before.state).map(([key, value]) => ({ op: 'test' as const, path: `${prefix}/${key}`, value })),
    ];
    if (fingerprint(desired.rules) !== fingerprint(before.state.rules)) patch.push({ op: 'replace', path: `${prefix}/rules`, value: desired.rules });
    patch.push({ op: 'replace', path: `${prefix}/on`, value: desired.on });
    const response = await this.request(`flags/default/${FLAG_KEY}`, patch);
    try { return this.boundSnapshot(response); }
    catch { throw new LabError('FLAG_RESPONSE', 'The acknowledged flag change returned an unexpected definition. Reconcile its actual state.', 'unknown_outcome'); }
  }
}
