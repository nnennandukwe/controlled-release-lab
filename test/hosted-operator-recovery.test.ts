import { afterEach, expect, it, vi } from 'vitest';
import { hostedOperatorRecovery } from '../tools/hosted-operator-recovery.js';
import { resolveRelease } from '../tools/release-workflow.js';

afterEach(() => vi.restoreAllMocks());

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
