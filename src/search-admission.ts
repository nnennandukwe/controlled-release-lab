import type { Evaluation, FlagEvaluator, SyntheticContext } from './flags.js';

const capacity = 16;

/** Per-process admission for the public demo; no queue or per-persona state. */
export function createSearchAdmission() {
  let active = 0, tokens = 20, updatedAt = performance.now();
  return () => {
    const now = performance.now();
    tokens = Math.min(20, tokens + (now - updatedAt) * 20 / 1000);
    updatedAt = now;
    if (active >= capacity || tokens < 1) return undefined;
    tokens--;active++;
    let released = false;
    return () => { if (!released) { released = true;active--; } };
  };
}

/** End the HTTP wait on cancellation while also bounding abandoned SDK work.
 * A stalled SDK may remain unavailable, but cannot retain all HTTP permits or
 * accumulate an unlimited number of underlying evaluation promises.
 */
export function createSearchEvaluation(evaluator: FlagEvaluator) {
  let pending = 0;
  return async (context: SyntheticContext, disconnected: AbortSignal): Promise<Evaluation> => {
    if (pending >= capacity) throw new Error('Flag evaluation capacity is unavailable.');
    const lifetime = AbortSignal.any([disconnected, AbortSignal.timeout(1000)]);
    lifetime.throwIfAborted();pending++;
    return new Promise<Evaluation>((resolve, reject) => {
      const abort = () => { lifetime.removeEventListener('abort', abort);reject(lifetime.reason); };
      lifetime.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => { lifetime.throwIfAborted();return evaluator.evaluate(context); }).then(
        value => { pending--;lifetime.removeEventListener('abort', abort);resolve(value); },
        error => { pending--;lifetime.removeEventListener('abort', abort);reject(error); },
      );
    });
  };
}
