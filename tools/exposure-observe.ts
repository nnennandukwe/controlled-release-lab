import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import config from '../config/exposure-policy.json' with { type: 'json' };
import { syntheticContext, syntheticRoster } from '../src/flags.js';
import { fingerprint, LabError } from './evidence.js';
import { sha256 } from './setup-verifier.js';
import type { ExposureStage, FlagSnapshot } from './launchdarkly.js';

export const exposurePolicy = config;
export const exposurePolicyDigest = sha256(await readFile(new URL('../config/exposure-policy.json', import.meta.url)));
export const rosterDigest = fingerprint(syntheticRoster());
export const exposureSubjectSchema = z.object({ sourceSha: z.string().regex(/^[a-f0-9]{40}$/), deploymentId: z.string().uuid(), targetName: z.enum(['staging', 'live']) }).strict();
export type ExposureSubject = z.infer<typeof exposureSubjectSchema>;
export const evaluationSchema = z.object({ flagKey: z.literal('catalog-ranked-search'), contextKey: z.string(), cohort: z.enum(['internal', 'eligible', 'excluded']), eligible: z.boolean(), value: z.boolean(), variationIndex: z.number().int().nullable(), reason: z.object({ kind: z.string(), ruleId: z.string().optional(), errorKind: z.string().optional() }).strict(), fallbackUsed: z.boolean(), sdkInitialized: z.boolean() }).strict();
export const exposureSampleSchema = z.object({ index: z.number().int().nonnegative(), contextKey: z.string(), query: z.enum(['keyboard', 'compact']), requestId: z.string(), durationMs: z.number().finite().nonnegative(), status: z.number().int().nullable(), error: z.string().nullable(), sourceSha: z.string().nullable(), deploymentId: z.string().nullable(), environment: z.string().nullable(), ranking: z.string().nullable(), results: z.array(z.string()), evaluation: evaluationSchema.nullable() }).strict();
export type ExposureSample = z.infer<typeof exposureSampleSchema>;
const responseSchema = z.object({ requestId: z.string().uuid(), sourceSha: z.string(), deploymentId: z.string(), environment: z.string(), ranking: z.enum(['original', 'ranked']), results: z.array(z.object({ id: z.string() })).max(20), evaluation: evaluationSchema });

/** Fix all contexts and queries before observing; no favorable resampling. */
export function exposureSequence(stage: ExposureStage) {
  const roster = syntheticRoster();
  const internalWindow = roster.filter(context => context.cohort !== 'eligible' || Number(context.key.slice(-4)) <= 20);
  const paired = roster.filter(context => context.cohort !== 'eligible' || Number(context.key.slice(-4)) <= 80);
  return [
    ...(stage === 'internal' ? internalWindow : roster).map(context => ({ contextKey: context.key, query: 'keyboard' as const })),
    ...(stage === 'internal' ? internalWindow : paired).map(context => ({ contextKey: context.key, query: 'compact' as const })),
  ];
}
export function exposureWindow(stage: ExposureStage) { return stage === 'internal' ? config.internal : config.population; }
const expectedResults = (query: 'keyboard' | 'compact', value: boolean) => query === 'keyboard' ? value ? ['keyboard-full', 'keyboard-compact'] : ['keyboard-compact', 'keyboard-full'] : value ? ['keyboard-compact', 'headphones-travel'] : ['headphones-travel', 'keyboard-compact'];
function evaluationMatches(evaluation: z.infer<typeof evaluationSchema>, flag: FlagSnapshot, contextKey: string) {
  const context = syntheticContext(contextKey);
  if (evaluation.contextKey !== context.key || evaluation.flagKey !== config.flagKey || evaluation.cohort !== context.cohort || evaluation.eligible !== context.eligible || evaluation.fallbackUsed || !evaluation.sdkInitialized || evaluation.reason.errorKind || evaluation.variationIndex !== Number(evaluation.value)) return false;
  if (flag.stage === 'off') return !evaluation.value && evaluation.reason.kind === 'OFF';
  if (context.cohort === 'eligible' && flag.stage === 'internal') return !evaluation.value && evaluation.reason.kind === 'FALLTHROUGH';
  const rule = flag.state.rules[context.cohort === 'excluded' ? 0 : context.cohort === 'internal' ? 1 : 2];
  return evaluation.reason.kind === 'RULE_MATCH' && !!rule?._id && evaluation.reason.ruleId === rule._id && (context.cohort === 'eligible' || evaluation.value === (context.cohort === 'internal'));
}

/** Recompute eligibility from raw samples; serialized summary claims never authorize advancement. */
export function assessExposure(samples: ExposureSample[], flag: FlagSnapshot, subject: ExposureSubject, elapsedMs: number, baselineP95Ms: number) {
  const expected = exposureSequence(flag.stage), window = exposureWindow(flag.stage);
  const reasons = new Set<string>();
  const counts: Record<string, number> = {};
  const groups = { internalTrue: new Set<string>(), eligibleTrue: new Set<string>(), eligibleFalse: new Set<string>(), excludedFalse: new Set<string>() };
  const contextValues = new Map<string, boolean>();
  let failures = 0;
  // Latency and coverage are independent gates. The deadline never expands
  // to collect a favorable population, even when individual responses are fast.
  if (samples.length < expected.length && elapsedMs >= config.deadlineSeconds * 1000) reasons.add('OBSERVATION_BUDGET_EXHAUSTED');
  if (samples.length !== expected.length || samples.length > config.maxRequests) reasons.add('INSUFFICIENT_SAMPLES');
  if (!Number.isFinite(elapsedMs) || elapsedMs < window.seconds * 1000 || elapsedMs > config.deadlineSeconds * 1000 + 1000) reasons.add('SHORT_WINDOW');
  if (!Number.isFinite(baselineP95Ms) || baselineP95Ms < 0) reasons.add('MISSING_BASELINE');
  if (new Set(samples.map(sample => sample.requestId)).size !== samples.length) reasons.add('DUPLICATE_REQUESTS');
  for (const [index, sample] of samples.entries()) {
    const evaluation = sample.evaluation;
    let valid = sample.index === index && sample.contextKey === expected[index]?.contextKey && sample.query === expected[index]?.query
      && sample.status === 200 && sample.error === null && z.string().uuid().safeParse(sample.requestId).success
      && sample.sourceSha === subject.sourceSha && sample.deploymentId === subject.deploymentId && sample.environment === subject.targetName
      && !!evaluation && evaluationMatches(evaluation, flag, sample.contextKey) && sample.ranking === (evaluation.value ? 'ranked' : 'original')
      && fingerprint(sample.results) === fingerprint(expectedResults(sample.query, evaluation.value));
    if (evaluation && contextValues.has(sample.contextKey) && contextValues.get(sample.contextKey) !== evaluation.value) valid = false;
    if (!valid || !evaluation) { failures++; continue; }
    contextValues.set(sample.contextKey, evaluation.value);
    const key = `${evaluation.cohort}/${evaluation.value ? 'ranked' : 'original'}/${sample.query}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (evaluation.cohort === 'internal' && evaluation.value) groups.internalTrue.add(evaluation.contextKey);
    if (evaluation.cohort === 'eligible') groups[evaluation.value ? 'eligibleTrue' : 'eligibleFalse'].add(evaluation.contextKey);
    if (evaluation.cohort === 'excluded' && !evaluation.value) groups.excludedFalse.add(evaluation.contextKey);
  }
  if (failures) reasons.add('INVALID_SAMPLES');
  if (groups.excludedFalse.size < config.roster.excluded) reasons.add('MISSING_EXCLUDED_CONTROL');
  if (flag.stage !== 'off' && groups.internalTrue.size < config.internal.minimumInternal) reasons.add('MISSING_INTERNAL_TREATMENT');
  if (flag.stage === 'internal' && groups.eligibleFalse.size < config.internal.minimumControl) reasons.add('MISSING_ELIGIBLE_CONTROL');
  if (flag.stage === '5' && (groups.eligibleTrue.size < config.population.minimumEligibleTreatment || groups.eligibleFalse.size < config.population.minimumEligibleControl)) reasons.add('INSUFFICIENT_ELIGIBLE_COHORTS');
  const durations = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
  const p95Ms = samples.length && samples.every(sample => sample.status !== null && Number.isFinite(sample.durationMs) && sample.durationMs >= 0) ? durations[Math.ceil(durations.length * 0.95) - 1]! : null;
  const latencyLimitMs = Math.max(config.p95FloorMs, baselineP95Ms * config.p95BaselineMultiplier);
  if (p95Ms === null || p95Ms > latencyLimitMs) reasons.add('LATENCY_HOLD');
  return { outcome: reasons.size ? 'blocked' as const : 'verified' as const, reasonCodes: [...reasons], requests: samples.length, expectedRequests: expected.length, failures, failureRate: samples.length ? failures / samples.length : null, p95Ms, latencyLimitMs, baselineP95Ms, counts, distinct: Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, values.size])) };
}

async function probeExposure(url: string, index: number, request: ReturnType<typeof exposureSequence>[number], timeoutMs: number, transport: typeof fetch): Promise<ExposureSample> {
  const started = performance.now(); const signal = AbortSignal.timeout(timeoutMs);
  const failed: ExposureSample = { index, ...request, requestId: '', durationMs: 0, status: null, error: null, sourceSha: null, deploymentId: null, environment: null, ranking: null, results: [], evaluation: null };
  try {
    const endpoint = new URL('/api/search', url); endpoint.searchParams.set('q', request.query); endpoint.searchParams.set('context', request.contextKey);
    const response = await transport(endpoint, { signal, redirect: 'error' }); failed.status = response.status;
    if (!response.ok) throw new Error('HTTP response failed');
    const reader = response.body?.getReader(); if (!reader) throw new Error('Missing response');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 64 * 1024) { await reader.cancel(); throw new Error('Oversized response'); } chunks.push(part.value); } } finally { reader.releaseLock(); }
    const parsed = responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return { index, ...request, ...parsed, results: parsed.results.map(product => product.id), status: response.status, durationMs: performance.now() - started, error: null };
  } catch { return { ...failed, durationMs: performance.now() - started, error: signal.aborted ? 'TIMEOUT' : 'REQUEST_OR_RESPONSE_ERROR' }; }
}

export async function observeExposure(url: string, flag: FlagSnapshot, subject: ExposureSubject, baselineP95Ms: number, onSample: (sample: ExposureSample) => Promise<void>, transport: typeof fetch = fetch) {
  const requests = exposureSequence(flag.stage), window = exposureWindow(flag.stage);
  const startedAt = new Date().toISOString(), start = performance.now(), deadline = start + config.deadlineSeconds * 1000;
  const samples: ExposureSample[] = [], pending = new Set<Promise<void>>();
  let persistenceError: unknown, next = start;
  for (const [index, request] of requests.entries()) {
    await delay(Math.max(0, Math.min(next, deadline) - performance.now()));
    while (pending.size >= config.concurrency && performance.now() < deadline) await Promise.race(pending);
    if (persistenceError) break;
    const remaining = Math.floor(deadline - performance.now()); if (remaining < 1) break;
    next = performance.now() + Math.max(1000 / config.rate, window.seconds * 1000 / requests.length);
    const task = probeExposure(url, index, request, Math.min(config.timeoutMs, remaining), transport).then(async sample => { samples.push(sample); await onSample(sample); }).catch(error => { persistenceError = error; });
    pending.add(task); void task.finally(() => pending.delete(task));
  }
  await Promise.all(pending); if (persistenceError) throw persistenceError;
  while (performance.now() < start + window.seconds * 1000) await delay(Math.ceil(start + window.seconds * 1000 - performance.now()));
  samples.sort((a, b) => a.index - b.index);
  const elapsedMs = performance.now() - start;
  return { startedAt, finishedAt: new Date().toISOString(), elapsedMs, samples, ...assessExposure(samples, flag, subject, elapsedMs, baselineP95Ms) };
}
export type ExposureMeasurement = Awaited<ReturnType<typeof observeExposure>>;
export function checkExposureMeasurement(input: unknown, flag: FlagSnapshot, subject: ExposureSubject, baselineP95Ms: number, fresh = true) {
  const measured = z.object({ startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), elapsedMs: z.number().finite(), samples: z.array(exposureSampleSchema).max(config.maxRequests) }).parse(input);
  const duration = Date.parse(measured.finishedAt) - Date.parse(measured.startedAt), now = Date.now();
  if (duration < exposureWindow(flag.stage).seconds * 1000 || Math.abs(duration - measured.elapsedMs) > 2000 || Date.parse(measured.finishedAt) > now + 30000 || (fresh && now - Date.parse(measured.finishedAt) > 1800000)) throw new LabError('EXPOSURE_WINDOW', 'Collect a fresh, complete observation window for this subject.');
  const assessed = assessExposure(measured.samples, flag, subject, measured.elapsedMs, baselineP95Ms);
  if (assessed.outcome !== 'verified') throw new LabError('EXPOSURE_HOLD', `Exposure evidence is insufficient: ${assessed.reasonCodes.join(', ')}.`);
  return { ...measured, ...assessed };
}
