import { afterEach, expect, it, vi } from 'vitest';
import { checkHostedReadEvents, hostedOperatorRecovery, type HostedReadEvent } from '../tools/hosted-operator-recovery.js';
import { Railway } from '../tools/railway.js';
import policy from '../config/release-policy.json' with { type: 'json' };
import { resolveRelease } from '../tools/release-workflow.js';

afterEach(() => vi.restoreAllMocks());

it('accepts observed read retries after the actual Railway adapter recovers', async () => {
  const events: HostedReadEvent[] = [{ status: 200 }, { injected: true, status: 400, errorCount: 1 }];
  let calls = 0;
  const transport: typeof fetch = async () => {
    const status = ++calls === 1 ? 429 : 200;
    events.push({ status });
    return Response.json({ data: { projectToken: policy.targets.staging } }, { status, headers: { 'retry-after': '0' } });
  };
  await new Railway('synthetic-test-token', policy.targets.staging, transport).assertScope();
  events.push({ status: 200 });
  expect(calls).toBe(2);
  expect(() => checkHostedReadEvents(events)).not.toThrow();
});

it.each([
  [{ status: 200 }, { injected: true, status: 400, errorCount: 1 }, { status: 200 }],
  [{ status: 200 }, { injected: true, status: 400, errorCount: 1 }, { status: 200 }, { status: 200 }, { mutationRejected: true }],
  [{ status: 200 }, { injected: true, status: 400, errorCount: 1 }, { status: 200 }, { status: 200 }, { status: 400, errorCount: 1 }],
])('rejects incomplete or unsafe provider read events: %j', (...events) => {
  expect(() => checkHostedReadEvents(events as HostedReadEvent[])).toThrow();
});

it.each([
  { LAB_TARGET: 'staging' },
  { LAB_HOSTED_RECOVERY_CHECK: 'true', LAB_TARGET: 'live' },
])('rejects hosted checks outside explicit staging opt-in before any request: %j', async environment => {
  const transport = vi.spyOn(globalThis, 'fetch');
  await expect(hostedOperatorRecovery(environment)).rejects.toMatchObject({ code: 'HOSTED_STAGING_OPT_IN_REQUIRED' });
  expect(transport).not.toHaveBeenCalled();
});

it('rejects an unprotected CI ref before provider access', async () => {
  const transport = vi.spyOn(globalThis, 'fetch');
  await expect(hostedOperatorRecovery({ LAB_HOSTED_RECOVERY_CHECK: 'true', LAB_TARGET: 'staging', GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/untrusted', GITHUB_REPOSITORY: 'nnennandukwe/controlled-release-lab', GH_TOKEN: 'synthetic-test-token' })).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  ['doctor', 'live'], ['reconcile', 'staging'], ['expose', 'staging'],
])('rejects the hosted-check workflow input for %s/%s before resolution', async (operation, target) => {
  const transport = vi.spyOn(globalThis, 'fetch');
  await expect(resolveRelease({ LAB_REHEARSE_OPERATOR_RECOVERY: 'true', LAB_OPERATION: operation, LAB_TARGET: target })).rejects.toMatchObject({ code: 'HOSTED_STAGING_OPT_IN_REQUIRED' });
  expect(transport).not.toHaveBeenCalled();
});
