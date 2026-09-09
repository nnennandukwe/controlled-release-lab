import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import { rehearseRecovery } from '../tools/recovery-rehearsal.js';
import { execute } from '../tools/operations.js';
import { authorizeMutation, policy, policyDigest, releaseRequestSchema } from '../tools/promotion.js';
import { LabError } from '../tools/evidence.js';
import { sha256 } from '../tools/setup-verifier.js';
import type { Hosting } from '../tools/railway.js';

// Substitute only the trust-key lookup and authenticated image-verifier seam.
// The JWT signature, claims, server metadata, request gate and durable files run
// through the real implementation; production exposes no alternate trust roots.
vi.mock('jose', async original => ({ ...await original<typeof import('jose')>(), createRemoteJWKSet: () => async () => keys.publicKey }));
vi.mock('../tools/attestation.js', () => ({ repository: 'nnennandukwe/controlled-release-lab', issuer: 'https://token.actions.githubusercontent.com', verifyArtifact: async () => ({ runId: '10', runAttempt: '1', statements: [] }) }));
const keys = await generateKeyPair('RS256');
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(forged = false, purpose: 'release' | 'recovery-rehearsal' = 'release') {
  const root = await mkdtemp(join(tmpdir(), 'protected-execution-')); roots.push(root);
  const image = `ghcr.io/${policy.repository}@sha256:${'a'.repeat(64)}`, sourceSha = 'b'.repeat(40), operatorSha = 'c'.repeat(40);
  const bundle = 'authenticated image seam';
  const request = releaseRequestSchema.parse({ schemaVersion: 1, purpose, operation: 'deploy', targetName: 'staging', target: policy.targets.staging, image, sourceSha,
    build: { sourceSha, runId: '10', runAttempt: '1' }, operator: { sourceSha: operatorSha, runId: '20', runAttempt: '1' }, policyDigest,
    configurationFingerprint: policy.configurationFingerprints.staging, changeReference: 'BUILD-2-TEST', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(),
    attachments: [{ name: 'image.bundle.jsonl', sha256: sha256(bundle) }], rollbackDeploymentId: null });
  const bytes = JSON.stringify(request), requestDigest = sha256(bytes);
  await writeFile(join(root, 'release-request.json'), bytes); await writeFile(join(root, 'image.bundle.jsonl'), bundle);
  const jwt = await new SignJWT({ repository_id: policy.repositoryId, repository_owner_id: policy.ownerId, repository: policy.repository,
    sub: `${policy.subjectPrefix}:environment:staging`, environment: 'staging', ref: 'refs/heads/main', event_name: 'workflow_dispatch', runner_environment: 'github-hosted',
    workflow_ref: `${policy.repository}/.github/workflows/operate.yml@refs/heads/main`, workflow_sha: operatorSha, run_id: '20', run_attempt: '1', check_run_id: '30', actor_id: policy.ownerId })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer('https://token.actions.githubusercontent.com').setAudience(`https://github.com/${policy.repository}/release/${requestDigest}`)
    .setIssuedAt().setNotBefore('0s').setExpirationTime('5m').sign(keys.privateKey);
  vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', 'https://test.actions.githubusercontent.com/oidc'); vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', randomUUID());
  vi.stubEnv('GITHUB_REPOSITORY', policy.repository); vi.stubEnv('GITHUB_REF', 'refs/heads/main'); vi.stubEnv('GH_TOKEN', 'test-only-token');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith('https://test.actions.githubusercontent.com/oidc')) {
      expect(new URL(url).searchParams.get('audience')).toBe(`https://github.com/${policy.repository}/release/${requestDigest}`);
      return Response.json({ value: forged ? 'unsigned-identity' : jwt });
    }
    if (url.includes('/compare/')) return Response.json({ status: 'ahead', merge_base_commit: { sha: sourceSha } });
    if (url.includes('deployment-branch-policies')) return Response.json({ total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] });
    if (url.includes('/environments/')) return Response.json({ can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: Number(policy.ownerId) } }] }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
    if (url.endsWith('/branches/main')) return Response.json({ protected: true });
    if (url.includes('/jobs?')) return Response.json({ total_count: 1, jobs: [{ name: 'operate', status: 'in_progress', conclusion: null, check_run_url: `https://api.github.com/repos/${policy.repository}/check-runs/30` }] });
    if (url.includes('/runs/10/')) return Response.json({ head_sha: sourceSha, head_branch: 'main', path: '.github/workflows/image.yml', event: 'workflow_dispatch', run_attempt: 1, status: 'completed', conclusion: 'success' });
    if (url.includes('/runs/20/')) return Response.json({ head_sha: operatorSha, run_attempt: 1, status: 'in_progress', actor: { id: Number(policy.ownerId) } });
    throw new Error('Unexpected network request');
  }));
  return { root, request, requestDigest, bytes };
}
it('authenticates a protected request, preserves its files, and refuses edits before the next effect', async () => {
  const { root, request, requestDigest, bytes } = await fixture();
  const permit = await authorizeMutation({ operation: 'deploy', targetName: 'staging', target: request.target, releaseDir: root, apply: true });
  expect(permit.decision).toMatchObject({ outcome: 'authorized', requestDigest, identity: { checkRunId: '30', runAttempt: '1' } });
  await permit.saveEvidence(join(root, 'saved'));
  expect(await readFile(join(root, 'saved/release-request.json'), 'utf8')).toBe(bytes);
  await expect(permit.assertCurrent()).resolves.toBeUndefined();
  await writeFile(join(root, 'image.bundle.jsonl'), 'changed after approval');
  await expect(permit.assertCurrent()).rejects.toMatchObject({ code: 'RELEASE_ATTACHMENT_REJECTED' });
  expect(await readFile(join(root, 'saved/image.bundle.jsonl'), 'utf8')).toBe('authenticated image seam');
});
it('blocks a forged identity through execute before any provider access', async () => {
  const { root, request } = await fixture(true);
  const hosting = { assertScope: vi.fn(), updateImage: vi.fn(), deploy: vi.fn(), rollback: vi.fn() } as unknown as Hosting;
  await expect(execute({ operation: 'deploy', targetName: 'staging', target: request.target, releaseDir: root, apply: true }, hosting, join(root, 'work'))).rejects.toMatchObject({ code: 'AUTHORIZATION_REJECTED' });
  for (const method of [hosting.assertScope, hosting.updateImage, hosting.deploy, hosting.rollback]) expect(method).not.toHaveBeenCalled();
});

it('runs the recovery rehearsal through the real protected gate and reconciles without repeating a mutation', async () => {
  const { root, request } = await fixture(false, 'recovery-rehearsal');
  const deploymentId = randomUUID();
  const deployment = { id: deploymentId, ...request.target, status: 'SUCCESS', canRollback: true, image: request.image, metadataKeys: ['image'] };
  let current = { sourceImage: null as string | null, latestId: null as string | null, active: [] as (typeof deployment)[], configurationFingerprint: request.configurationFingerprint };
  const hosting: Hosting = {
    assertScope: vi.fn(async () => {}), snapshot: vi.fn(async () => current), deployment: vi.fn(async () => deployment),
    updateImage: vi.fn(async image => { current = { ...current, sourceImage: image }; }),
    deploy: vi.fn(async () => { current = { ...current, latestId: deploymentId, active: [deployment] }; return deploymentId; }), rollback: vi.fn(),
  };
  const traffic: typeof fetch = async () => Response.json({ sourceSha: request.sourceSha, deploymentId, environment: 'staging', requestId: randomUUID(), ranking: 'original', results: [{ id: 'keyboard-compact' }, { id: 'keyboard-full' }] });
  const result = await rehearseRecovery({ operation: 'deploy', purpose: 'recovery-rehearsal', targetName: 'staging', target: request.target, releaseDir: root, apply: true }, hosting, join(root, 'work'), traffic);
  expect(result.outcome).toBe('verified');
  expect(result.rehearsal).toMatchObject({ fixture: 'lost-deployment-response', simulatedFailure: true, updateCalls: 1, deployCalls: 1, rollbackCalls: 0, originalRecordUnchanged: true, lockReleased: true });
  expect(result.rehearsal.originalAttemptId).not.toBe(result.attemptId);
  expect(hosting.updateImage).toHaveBeenCalledTimes(1);
  expect(hosting.deploy).toHaveBeenCalledTimes(1);
  expect(hosting.rollback).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(result.rehearsal.reportPath, 'utf8')).outcome).toBe('verified');
}, 90000);
it.each(['live', 'preview', 'ordinary request', 'forged identity'])('refuses a recovery rehearsal with %s before provider access', async condition => {
  const { root, request } = await fixture(condition === 'forged identity', condition === 'ordinary request' ? 'release' : 'recovery-rehearsal');
  const hosting = { assertScope: vi.fn(), updateImage: vi.fn(), deploy: vi.fn(), rollback: vi.fn() } as unknown as Hosting;
  await expect(rehearseRecovery({ operation: 'deploy', purpose: 'recovery-rehearsal', targetName: condition === 'live' ? 'live' : 'staging', target: request.target, releaseDir: root, apply: condition !== 'preview' }, hosting, join(root, 'work'))).rejects.toThrow();
  expect(hosting.assertScope).not.toHaveBeenCalled();
  expect(hosting.deploy).not.toHaveBeenCalled();
});
it('does not accept a rehearsal request through the ordinary deployment command', async () => {
  const { root, request } = await fixture(false, 'recovery-rehearsal');
  await expect(authorizeMutation({ operation: 'deploy', targetName: 'staging', target: request.target, releaseDir: root, apply: true })).rejects.toMatchObject({ code: 'RELEASE_SUBJECT_MISMATCH' });
});
it('preserves a real provider failure without claiming that the simulated response loss ran', async () => {
  const { root, request } = await fixture(false, 'recovery-rehearsal');
  const hosting: Hosting = {
    assertScope: vi.fn(async () => {}), snapshot: vi.fn(async () => ({ sourceImage: null, latestId: null, active: [], configurationFingerprint: request.configurationFingerprint })),
    deployment: vi.fn(), deploy: vi.fn(), rollback: vi.fn(),
    updateImage: vi.fn(async () => { throw new LabError('PROVIDER_TRANSPORT', 'Provider response lost.', 'unknown_outcome'); }),
  };
  await expect(rehearseRecovery({ operation: 'deploy', purpose: 'recovery-rehearsal', targetName: 'staging', target: request.target, releaseDir: root, apply: true }, hosting, join(root, 'work'))).rejects.toMatchObject({ code: 'REHEARSAL_NOT_EXERCISED', outcome: 'unknown_outcome' });
  expect(hosting.updateImage).toHaveBeenCalledTimes(1);
  expect(hosting.deploy).not.toHaveBeenCalled();
  const attempts = await readdir(join(root, 'work/attempts'));
  expect(attempts).toHaveLength(1);
  expect(JSON.parse(await readFile(join(root, 'work/attempts', attempts[0]!, 'record.json'), 'utf8'))).toMatchObject({ outcome: 'unknown_outcome', reasonCodes: ['PROVIDER_TRANSPORT'] });
  expect(await readdir(join(root, 'work/locks'))).toHaveLength(1);
});
