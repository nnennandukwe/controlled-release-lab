import { z } from 'zod';

export async function requireProtectedEnvironment(environment: NodeJS.ProcessEnv, transport: typeof fetch = fetch) {
  const config = z.object({ GITHUB_REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/), GITHUB_REF: z.literal('refs/heads/main'), GH_TOKEN: z.string().min(1), LAB_GITHUB_ENVIRONMENT: z.enum(['image-publication', 'staging', 'live']) }).parse(environment);
  const response = await transport(`https://api.github.com/repos/${config.GITHUB_REPOSITORY}/environments/${config.LAB_GITHUB_ENVIRONMENT}`, {
    headers: { Authorization: `Bearer ${config.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Cannot verify GitHub environment protection (HTTP ${response.status}). Configure the environment before running this workflow.`);
  const settings = z.object({ protection_rules: z.array(z.object({ type: z.string(), reviewers: z.array(z.unknown()).optional() })), deployment_branch_policy: z.object({ protected_branches: z.boolean(), custom_branch_policies: z.boolean() }).nullable() }).parse(await response.json());
  if (!settings.protection_rules.some(rule => rule.type === 'required_reviewers' && rule.reviewers?.length)) throw new Error('A required reviewer must protect this GitHub environment before credentials can be used.');
  const policy = settings.deployment_branch_policy;
  if (!policy || policy.protected_branches === policy.custom_branch_policies) throw new Error('Restrict the GitHub environment to main or protected branches.');
}
