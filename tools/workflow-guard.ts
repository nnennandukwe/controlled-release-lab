import { z } from 'zod';
import { LabError } from './evidence.js';
import policy from '../config/release-policy.json' with { type: 'json' };

export async function requireProtectedEnvironment(environment: NodeJS.ProcessEnv, transport: typeof fetch = fetch) {
  const config = z.object({ GITHUB_REPOSITORY: z.literal(policy.repository), GITHUB_REF: z.literal('refs/heads/main'), GH_TOKEN: z.string().min(1), LAB_GITHUB_ENVIRONMENT: z.enum(['image-publication', 'staging', 'live']) }).parse(environment);
  const get = async (path: string) => {
    const response = await transport(`https://api.github.com/repos/${config.GITHUB_REPOSITORY}/${path}`, {
      headers: { Authorization: `Bearer ${config.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new LabError('PROTECTION_UNVERIFIABLE', `Cannot verify GitHub protection (HTTP ${response.status}). Configure the protected environment and main branch before apply.`);
    return response.json();
  };
  const settings = z.object({ can_admins_bypass: z.boolean(), protection_rules: z.array(z.object({ type: z.string(), reviewers: z.array(z.object({ type: z.string(), reviewer: z.object({ id: z.number() }) })).optional() })), deployment_branch_policy: z.object({ protected_branches: z.boolean(), custom_branch_policies: z.boolean() }).nullable() }).parse(await get(`environments/${config.LAB_GITHUB_ENVIRONMENT}`));
  if (!settings.protection_rules.some(rule => rule.type === 'required_reviewers' && rule.reviewers?.some(item => item.type === 'User' && item.reviewer.id === Number(policy.ownerId)))) throw new LabError('PROTECTION_UNVERIFIABLE', 'The owner must be a required reviewer before credentials can be used.');
  if (settings.can_admins_bypass) throw new LabError('PROTECTION_UNVERIFIABLE', 'Disable administrator environment bypass before apply.');
  if (!settings.deployment_branch_policy?.custom_branch_policies || settings.deployment_branch_policy.protected_branches) throw new LabError('PROTECTION_UNVERIFIABLE', 'Restrict the environment to the selected main branch only.');
  z.object({ total_count: z.literal(1), branch_policies: z.array(z.object({ name: z.literal('main'), type: z.literal('branch') })).length(1) }).parse(await get(`environments/${config.LAB_GITHUB_ENVIRONMENT}/deployment-branch-policies?per_page=100`));
  // Main metadata is readable with GITHUB_TOKEN. Administrative setup separately
  // verifies required checks, deletion/force-push restrictions and admin enforcement.
  z.object({ protected: z.literal(true) }).parse(await get('branches/main'));
}
