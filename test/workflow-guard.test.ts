import { expect, it } from 'vitest';
import { requireProtectedEnvironment } from '../tools/workflow-guard.js';
const env = { GITHUB_REPOSITORY: 'owner/lab', GITHUB_REF: 'refs/heads/main', GH_TOKEN: 'fixture-token', LAB_GITHUB_ENVIRONMENT: 'live' };
it('refuses an automatically created environment without reviewer protection', async () => {
  await expect(requireProtectedEnvironment(env, (async () => Response.json({ protection_rules: [], deployment_branch_policy: null })) as typeof fetch)).rejects.toThrow('required reviewer');
});
it('refuses a workflow dispatched from a feature branch', async () => {
  await expect(requireProtectedEnvironment({ ...env, GITHUB_REF: 'refs/heads/feature' })).rejects.toThrow();
});
it('allows the trusted main workflow behind a configured reviewer and branch policy', async () => {
  await expect(requireProtectedEnvironment(env, (async () => Response.json({ protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'operator' } }] }], deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } })) as typeof fetch)).resolves.toBeUndefined();
});
it.each([false, true])('refuses invalid branch policy flags when both are %s', async enabled => {
  await expect(requireProtectedEnvironment(env, (async () => Response.json({
    protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }],
    deployment_branch_policy: { protected_branches: enabled, custom_branch_policies: enabled },
  })) as typeof fetch)).rejects.toThrow('Restrict');
});
