import type { Evaluation, FlagEvaluator, SyntheticContext } from './flags.js';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

const capacity = 16;
const clientCapacity = 4;

/** Hosted ingress is Railway's HTTP proxy, which overwrites X-Real-IP.
 * Local requests must use the socket address; forwarded headers are untrusted.
 * Missing/ambiguous hosted identity fails closed rather than sharing a proxy key.
 */
export function searchClientAddress(request: { headers: IncomingMessage['headers']; socket: Pick<IncomingMessage['socket'], 'remoteAddress'> }, hosted: boolean) {
  const value = hosted ? request.headers['x-real-ip'] : request.socket.remoteAddress;
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) return undefined;
  return isIP(value) === 6 ? new URL(`http://[${value}]`).hostname : value;
}

/** Bounded, transient network-client quotas in addition to a global safety cap.
 * No queue, persistent client identifiers, or synthetic-persona rate-limit keys.
 */
export function createSearchAdmission() {
  let active = 0, tokens = 20, updatedAt = performance.now();
  const clients = new Map<string, { active: number; tokens: number; updatedAt: number }>();
  return (clientKey: string) => {
    const now = performance.now();
    tokens = Math.min(20, tokens + (now - updatedAt) * 20 / 1000);
    updatedAt = now;
    if (active >= capacity || tokens < 1) return undefined;
    // Thirty-second expiry leaves headroom under 1,024 entries at the global
    // rate, including the burst and active or temporarily throttled clients.
    for (const [key, client] of clients) if (client.active === 0 && now - client.updatedAt >= 30_000) clients.delete(key);
    let client = clients.get(clientKey);
    if (!client) {
      if (clients.size >= 1024) return undefined;
      client = { active: 0, tokens: 12, updatedAt: now };clients.set(clientKey, client);
    }
    client.tokens = Math.min(12, client.tokens + (now - client.updatedAt) * 12 / 1000);client.updatedAt = now;
    if (client.active >= clientCapacity || client.tokens < 1) return undefined;
    tokens--;active++;client.tokens--;client.active++;
    let released = false;
    return () => { if (!released) { released = true;active--;client.active--; } };
  };
}

/** End the HTTP wait on cancellation while also bounding abandoned SDK work.
 * A stalled SDK may remain unavailable, but cannot retain all HTTP permits or
 * accumulate an unlimited number of underlying evaluation promises.
 */
export function createSearchEvaluation(evaluator: FlagEvaluator) {
  let pending = 0;
  const clients = new Map<string, number>();
  return async (context: SyntheticContext, disconnected: AbortSignal, clientKey: string): Promise<Evaluation> => {
    const clientPending = clients.get(clientKey) ?? 0;
    if (pending >= capacity || clientPending >= clientCapacity) throw new Error('Flag evaluation capacity is unavailable.');
    const lifetime = AbortSignal.any([disconnected, AbortSignal.timeout(1000)]);
    lifetime.throwIfAborted();pending++;clients.set(clientKey, clientPending + 1);
    const settled = () => {
      pending--;const remaining = clients.get(clientKey)! - 1;
      if (remaining === 0) clients.delete(clientKey);else clients.set(clientKey, remaining);
    };
    return new Promise<Evaluation>((resolve, reject) => {
      const abort = () => { lifetime.removeEventListener('abort', abort);reject(lifetime.reason); };
      lifetime.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => { lifetime.throwIfAborted();return evaluator.evaluate(context); }).then(
        value => { settled();lifetime.removeEventListener('abort', abort);resolve(value); },
        error => { settled();lifetime.removeEventListener('abort', abort);reject(error); },
      );
    });
  };
}
