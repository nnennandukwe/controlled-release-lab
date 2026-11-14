// Release-operations preload: restrict hosted recovery children to Railway reads.
// The teaching fixture sends one invalid read, then observes actual provider responses.
import { appendFile } from 'node:fs/promises';

const log = process.env.LAB_HOSTED_RECOVERY_LOG;
if (!log || process.env.LAB_HOSTED_RECOVERY_CHECK !== 'true') throw new Error('Explicit hosted staging check required.');
const nativeFetch = globalThis.fetch;
let rejectRead = process.env.LAB_HOSTED_REJECT_READ === 'true';
const failurePhase = process.env.LAB_HOSTED_RECOVERY_FAILURE_PHASE ?? 'snapshot';
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.href !== 'https://backboard.railway.com/graphql/v2') throw new Error('Hosted check permits only Railway GraphQL reads.');
  const body = JSON.parse(String(options?.body)) as { query: string; variables?: unknown };
  if (!/^query[\s(]/.test(body.query)) {
    await appendFile(log, `${JSON.stringify({ mutationRejected: true })}\n`, { mode: 0o600 });
    throw new Error('Provider mutation rejected by hosted check.');
  }
  const injected = rejectRead && body.query.includes(failurePhase === 'scope' ? 'projectToken' : 'serviceInstance(');
  if (injected) { rejectRead = false; body.query = 'query { controlledReleaseRecoveryFixtureUnknownField }'; }
  const response = await nativeFetch(input, { ...options, redirect: 'error', body: JSON.stringify(body) });
  let errorCount: number | null = null;
  try {
    const payload: unknown = await response.clone().json();
    errorCount = payload && typeof payload === 'object' && 'errors' in payload && Array.isArray(payload.errors) ? payload.errors.length : 0;
  } catch { /* Keep unreadable payloads unknown; the adapter handles HTTP retries. */ }
  await appendFile(log, `${JSON.stringify({ at: new Date().toISOString(), endpoint: url.href, injected, status: response.status, errorCount })}\n`, { mode: 0o600 });
  return response;
};
export {};
