import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

export type Sample = { requestId: string; durationMs: number; status: number | null; error: string | null; functional: boolean; sourceSha: string | null; deploymentId: string | null; environment: string | null };
export function summarize(samples: Sample[], expected: number) {
  const failures = samples.filter(sample => sample.status !== 200 || sample.error !== null || !sample.functional).length;
  const reasonCodes: string[] = [];
  if (samples.length < expected || samples.length === 0) reasonCodes.push('INSUFFICIENT_SAMPLES');
  if (samples.some(sample => sample.status === 200 && (!sample.sourceSha || !sample.environment || (sample.environment !== 'local' && !sample.deploymentId)))) reasonCodes.push('MISSING_IDENTITY');
  if (new Set(samples.filter(sample => sample.status === 200).map(sample => `${sample.sourceSha}/${sample.deploymentId}/${sample.environment}`)).size > 1) reasonCodes.push('MIXED_IDENTITY');
  if (failures) reasonCodes.push('REQUEST_FAILURES');
  const durations = samples.map(sample => sample.durationMs).sort((left, right) => left - right);
  return {
    outcome: reasonCodes.some(code => code !== 'REQUEST_FAILURES') ? 'blocked' : failures ? 'failed' : 'verified',
    requests: samples.length, expectedRequests: expected, failures,
    failureRate: samples.length ? failures / samples.length : null,
    p95Ms: samples.length && samples.every(sample => sample.status !== null) ? durations[Math.ceil(durations.length * 0.95) - 1]! : null,
    reasonCodes,
  };
}

export const observationOptionsSchema = z.object({
  durationSeconds: z.number().min(0.1).max(300).default(60),
  maxDurationSeconds: z.number().min(0.1).max(300).default(300),
  rate: z.number().int().min(1).max(10).default(2),
  maxRequests: z.number().int().min(1).max(600).default(120),
  concurrency: z.number().int().min(1).max(2).default(2),
  timeoutMs: z.number().int().min(10).max(5000).default(5000),
}).strict()
  .refine(options => Math.ceil(options.durationSeconds * options.rate) <= options.maxRequests, 'Request budget must cover the selected duration and rate. Reduce duration or rate.')
  .refine(options => options.maxDurationSeconds >= options.durationSeconds, 'Maximum duration must cover the minimum observation window.');
export type ObservationOptions = z.infer<typeof observationOptionsSchema>;

export const versionSchema = z.object({
  sourceSha: z.string().regex(/^(local|[a-f0-9]{40})$/),
  deploymentId: z.string().uuid().nullable(),
  environment: z.enum(['local', 'staging', 'live']),
});
const searchResponseSchema = versionSchema.extend({
  results: z.array(z.object({ id: z.string() })), ranking: z.literal('original'), requestId: z.string().uuid(),
});

export async function probe(baseUrl: string, timeoutMs: number, transport: typeof fetch = fetch): Promise<Sample> {
  const started = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await transport(new URL('/api/search?q=keyboard', baseUrl), { signal, redirect: 'error' });
    if (!response.ok) return { requestId: '', durationMs: performance.now() - started, status: response.status, error: 'HTTP_ERROR', functional: false, sourceSha: null, deploymentId: null, environment: null };
    const parsed = searchResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('INVALID_RESPONSE');
    const body = parsed.data;
    const functional = body.results.map(product => product.id).join(',') === 'keyboard-compact,keyboard-full';
    return { requestId: body.requestId, durationMs: performance.now() - started, status: response.status, error: null, functional, sourceSha: body.sourceSha, deploymentId: body.deploymentId, environment: body.environment };
  } catch {
    return { requestId: '', durationMs: performance.now() - started, status: null, error: signal.aborted ? 'TIMEOUT' : 'REQUEST_OR_RESPONSE_ERROR', functional: false, sourceSha: null, deploymentId: null, environment: null };
  }
}

export async function observe(baseUrl: string, input: Partial<ObservationOptions>, onSample: (sample: Sample) => Promise<void>, transport: typeof fetch = fetch) {
  const options = observationOptionsSchema.parse(input);
  const expected = Math.ceil(options.durationSeconds * options.rate);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const deadline = started + options.maxDurationSeconds * 1000;
  let nextStart = started;
  let budgetExhausted = false;
  const samples: Sample[] = [];
  const pending = new Set<Promise<void>>();
  let persistenceFailure: unknown;
  for (let index = 0; index < expected; index++) {
    await delay(Math.max(0, Math.min(nextStart, deadline) - performance.now()));
    while (pending.size >= options.concurrency && performance.now() < deadline) await Promise.race(pending);
    if (persistenceFailure) break;
    const remainingMs = Math.floor(deadline - performance.now());
    if (remainingMs < 1) { budgetExhausted = true; break; }
    nextStart = performance.now() + 1000 / options.rate;
    const task = probe(baseUrl, Math.min(options.timeoutMs, remainingMs), transport).then(async sample => {
      samples.push(sample);
      await onSample(sample);
    }).catch(error => { persistenceFailure = error; });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  await Promise.all(pending);
  if (persistenceFailure) throw persistenceFailure;
  if (performance.now() >= deadline && samples.some(sample => sample.error === 'TIMEOUT')) budgetExhausted = true;
  await delay(Math.max(0, started + options.durationSeconds * 1000 - performance.now()));
  const summary = summarize(samples, expected);
  if (budgetExhausted) { summary.outcome = 'blocked'; summary.reasonCodes.push('OBSERVATION_BUDGET_EXHAUSTED'); }
  return { startedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - started, options, samples, ...summary };
}
