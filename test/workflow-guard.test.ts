import { expect, it, vi } from 'vitest';
import { requireProtectedEnvironment } from '../tools/workflow-guard.js';
import policy from '../config/release-policy.json' with { type: 'json' };
const env = { GITHUB_REPOSITORY: policy.repository, GITHUB_REF: 'refs/heads/main', GH_TOKEN: 'fixture-token', LAB_GITHUB_ENVIRONMENT: 'live' };
const settings = { can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: Number(policy.ownerId) } }] }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
const branches = { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
it('requires the specific reviewer, selected main branch, no bypass and a protected main', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json(settings)).mockResolvedValueOnce(Response.json(branches)).mockResolvedValueOnce(Response.json({ protected: true }));
  await expect(requireProtectedEnvironment(env, transport)).resolves.toBeUndefined();
});
it.each([
  { ...settings, protection_rules: [] },
  { ...settings, can_admins_bypass: true },
  { ...settings, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } },
  { ...settings, protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 123 } }] }] },
])('rejects incomplete or broader protection', async value => {
  await expect(requireProtectedEnvironment(env, async () => Response.json(value))).rejects.toMatchObject({ code: 'PROTECTION_UNVERIFIABLE' });
});
it.each([{ total_count: 2, branch_policies: [...branches.branch_policies, { name: '*', type: 'branch' }] }, { total_count: 1, branch_policies: [{ name: 'main', type: 'tag' }] }])('rejects a broad rule or same-name tag', async value => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json(settings)).mockResolvedValueOnce(Response.json(value));
  await expect(requireProtectedEnvironment(env, transport)).rejects.toThrow();
});
it('refuses a feature branch before any GitHub call', async () => {
  const transport = vi.fn();
  await expect(requireProtectedEnvironment({ ...env, GITHUB_REF: 'refs/heads/feature' }, transport)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it('fails closed on protection API failure', async () => {
  await expect(requireProtectedEnvironment(env, async () => new Response('', { status: 403 }))).rejects.toMatchObject({ code: 'PROTECTION_UNVERIFIABLE' });
});
