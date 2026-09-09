import { expect, it, vi } from 'vitest';
import { execute } from '../tools/operations.js';
import type { Hosting } from '../tools/railway.js';
import policy from '../config/release-policy.json' with { type: 'json' };

it('blocks direct mutation without a protected request before provider access', async () => {
  const hosting = { assertScope: vi.fn(async () => { throw new Error('Provider was reached'); }), updateImage: vi.fn(), deploy: vi.fn(), rollback: vi.fn() } as unknown as Hosting;
  await expect(execute({ operation: 'deploy', targetName: 'staging', target: policy.targets.staging, image: `ghcr.io/nnennandukwe/controlled-release-lab@sha256:${'a'.repeat(64)}`, sourceSha: 'b'.repeat(40), apply: true }, hosting, 'unused'))
    .rejects.toMatchObject({ code: 'PROTECTED_RUN_REQUIRED' });
  expect(hosting.assertScope).not.toHaveBeenCalled();
  expect(hosting.updateImage).not.toHaveBeenCalled();
});

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { stagingObservationRequest, serializedRequest, assertProducer, authorizeMutation, checkObservation, checkRequest, deploymentEvidenceSchema, policyDigest, releaseRequestSchema, verifyRelease, verifyRunToken, type ReleaseRequest } from '../tools/promotion.js';
import { verifyArtifact } from '../tools/attestation.js';
import { sha256 } from '../tools/setup-verifier.js';

// Policy tests use an authenticated-artifact seam; attestation.test.ts separately
// invokes the real pinned verifier against a genuine signed fixture and tampering.
vi.mock('../tools/attestation.js', () => ({ repository: 'nnennandukwe/controlled-release-lab', issuer: 'https://token.actions.githubusercontent.com', verifyArtifact: vi.fn() }));
const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const image = `ghcr.io/nnennandukwe/controlled-release-lab@sha256:${'a'.repeat(64)}`;
const source = 'b'.repeat(40), operatorSource = 'c'.repeat(40);
const build = { sourceSha: source, runId: '10', runAttempt: '1' };
const operator = { sourceSha: operatorSource, runId: '20', runAttempt: '1' };
function request(targetName: 'staging' | 'live' = 'live'): ReleaseRequest {
  return releaseRequestSchema.parse({ schemaVersion: 1, operation: 'deploy', targetName, target: policy.targets[targetName], image, sourceSha: source, build, operator, policyDigest,
    configurationFingerprint: policy.configurationFingerprints[targetName], changeReference: 'BUILD-2-TEST', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), attachments: [], rollbackDeploymentId: null });
}
function evidence(targetName: 'staging' | 'live' = 'staging') {
  const deploymentId = '44444444-4444-4444-8444-444444444444';
  const startedAt = new Date(Date.now() - 70000).toISOString(), finishedAt = new Date(Date.now() - 1000).toISOString();
  return deploymentEvidenceSchema.parse({ schemaVersion: 1, kind: 'deployment-observation',
    record: { schemaVersion: 1, attemptId: randomUUID(), operation: 'observe', changeReference: 'BUILD-2-TEST', targetName, target: policy.targets[targetName], requestedImage: image, requestedSourceSha: source, rollbackTarget: null, deploymentId, configurationFingerprint: policy.configurationFingerprints[targetName], startedAt, finishedAt, outcome: 'verified', reasonCodes: [], recoveryInstruction: '',
      observations: [{ phase: 'measurement', outcome: 'verified', startedAt, finishedAt, elapsedMs: 69000, requests: 120, expectedRequests: 120, failures: 0, reasonCodes: [],
        samples: Array.from({ length: 120 }, () => ({ requestId: randomUUID(), durationMs: 20, status: 200, error: null, functional: true, sourceSha: source, deploymentId, environment: targetName })) }] },
    context: { operator: { ...operator, runId: '15' }, build, policyDigest, requestDigest: 'd'.repeat(64), authorization: 'protected-observation', audience: 'synthetic-catalog-baseline', notEvaluated: ['Feature cohorts'] } });
}
function githubFixture(url: string) {
  if (url.includes('/compare/')) return { status: 'ahead', merge_base_commit: { sha: url.includes(operatorSource) ? operatorSource : source } };
  if (url.includes('deployment-branch-policies')) return { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
  if (url.endsWith('/branches/main')) return { protected: true };
  if (url.includes('/environments/')) return { can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: Number(policy.ownerId) } }] }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
  if (url.includes('/jobs?')) return { total_count: 2, jobs: [{ name: 'staging-proof', status: 'completed', conclusion: 'success', check_run_url: `https://api.github.com/repos/${policy.repository}/check-runs/29` }, { name: 'operate', status: 'in_progress', conclusion: null, check_run_url: `https://api.github.com/repos/${policy.repository}/check-runs/30` }] };
  const isBuild = url.includes('/runs/10/');
  return { head_sha: isBuild ? source : operatorSource, head_branch: 'main', path: `.github/workflows/${isBuild ? 'image' : 'operate'}.yml`, event: 'workflow_dispatch', run_attempt: 1,
    status: url.includes('/runs/20/') ? 'in_progress' : 'completed', conclusion: url.includes('/runs/20/') ? null : 'success', actor: { id: Number(policy.ownerId) } };
}
async function fixture(target: 'staging' | 'live' = 'live') {
  const root = await mkdtemp(join(tmpdir(), 'release-policy-')); roots.push(root);
  const manifest = request(target);
  const files: Record<string, string> = { 'image.bundle.jsonl': 'authenticated image fixture' };
  if (target === 'live') {
    const proof = evidence(); proof.context.operator = operator;
    proof.context.requestDigest = sha256(serializedRequest(stagingObservationRequest({ ...manifest, attachments: [{ name: 'image.bundle.jsonl', sha256: sha256(files['image.bundle.jsonl']!) }] })));
    files['staging-evidence.json'] = JSON.stringify(proof); files['staging.bundle.jsonl'] = 'authenticated observation fixture';
  }
  for (const [name, bytes] of Object.entries(files)) { await writeFile(join(root, name), bytes); manifest.attachments.push({ name: name as ReleaseRequest['attachments'][number]['name'], sha256: sha256(bytes) }); }
  await writeFile(join(root, 'release-request.json'), JSON.stringify(manifest));
  vi.mocked(verifyArtifact).mockImplementation(async input => ({ runId: input.workflow === 'image.yml' ? '10' : '20', runAttempt: '1', statements: [] }));
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => Response.json(githubFixture(String(url)))));
  return { root, manifest };
}
it('accepts sufficient authenticated staging evidence while keeping image and operator source separate', async () => {
  const { root } = await fixture();
  const result = await verifyRelease(root);
  expect(result.request.sourceSha).toBe(source);
  expect(result.request.operator.sourceSha).toBe(operatorSource);
  expect(result).not.toHaveProperty('authorized');
});
it.each(['digest', 'policy', 'configuration', 'target', 'expired'])('rejects a request with mismatched %s', condition => {
  const value = request();
  if (condition === 'digest') value.image = 'ghcr.io/other/app@sha256:' + 'a'.repeat(64);
  if (condition === 'policy') value.policyDigest = '0'.repeat(64);
  if (condition === 'configuration') value.configurationFingerprint = '0'.repeat(64);
  if (condition === 'target') value.target = policy.targets.staging;
  if (condition === 'expired') value.expiresAt = new Date(Date.now() - 1).toISOString();
  expect(() => checkRequest(value)).toThrow();
});
it.each(['no-samples', 'mixed-source', 'stale', 'future', 'duplicate-requests', 'wrong-image'])('rejects observation %s', condition => {
  const value = evidence();
  const measurement = value.record.observations[0] as { samples: { sourceSha: string; requestId: string }[]; startedAt: string; finishedAt: string };
  if (condition === 'no-samples') measurement.samples = [];
  if (condition === 'mixed-source') measurement.samples[0]!.sourceSha = 'a'.repeat(40);
  if (condition === 'duplicate-requests') measurement.samples[1]!.requestId = measurement.samples[0]!.requestId;
  if (condition === 'stale') { measurement.startedAt = new Date(Date.now() - 3700000).toISOString(); measurement.finishedAt = new Date(Date.now() - 3600000).toISOString(); }
  if (condition === 'future') measurement.finishedAt = new Date(Date.now() + 120000).toISOString();
  if (condition === 'wrong-image') value.record.requestedImage = image.replace('a'.repeat(64), 'e'.repeat(64));
  expect(() => checkObservation(value, request(), false)).toThrow();
});
it('does not expire an authenticated known-good rollback with the staging freshness limit', () => {
  const value = evidence('live');
  const measurement = value.record.observations[0] as { startedAt: string; finishedAt: string };
  measurement.startedAt = new Date(Date.now() - 3700000).toISOString(); measurement.finishedAt = new Date(Date.now() - 3600000).toISOString();
  expect(() => checkObservation(value, { ...request(), operation: 'rollback', rollbackDeploymentId: value.record.deploymentId }, true)).not.toThrow();
});
it.each(['edited', 'symlink', 'missing'])('rejects %s attachment bytes', async condition => {
  const { root } = await fixture();
  const path = join(root, 'image.bundle.jsonl');
  if (condition === 'edited') await writeFile(path, 'changed');
  else { await rm(path); if (condition === 'symlink') await symlink(join(root, 'release-request.json'), path); }
  await expect(verifyRelease(root)).rejects.toThrow();
  expect(verifyArtifact).not.toHaveBeenCalled();
});
it('does not accept a forged verifier result or failed producer', async () => {
  const { root } = await fixture();
  vi.mocked(verifyArtifact).mockRejectedValueOnce(new Error('Invalid signature'));
  await expect(verifyRelease(root)).rejects.toThrow();
  vi.stubGlobal('fetch', async (url: string) => Response.json({ ...githubFixture(url), conclusion: 'failure' }));
  await expect(verifyRelease(root)).rejects.toThrow('Producer run did not complete');
});

const keys = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
function claims(value: ReleaseRequest) { return { repository_id: policy.repositoryId, repository_owner_id: policy.ownerId, repository: policy.repository,
  sub: `${policy.subjectPrefix}:environment:${value.targetName}`, environment: value.targetName, ref: 'refs/heads/main', event_name: 'workflow_dispatch', runner_environment: 'github-hosted',
  workflow_ref: `${policy.repository}/.github/workflows/operate.yml@refs/heads/main`, workflow_sha: value.operator.sourceSha, run_id: value.operator.runId, run_attempt: value.operator.runAttempt, check_run_id: '30', actor_id: policy.ownerId }; }
async function token(value: ReleaseRequest, hash: string, overrides: Record<string, unknown> = {}) {
  return new SignJWT({ ...claims(value), ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://token.actions.githubusercontent.com')
    .setAudience(`https://github.com/${policy.repository}/release/${hash}`).setIssuedAt().setNotBefore('0s').setExpirationTime('5m').sign(keys.privateKey);
}
it('verifies an authentic test-key signature and exact request-bound claims', async () => {
  const value = request();
  await expect(verifyRunToken(await token(value, 'f'.repeat(64)), value, 'f'.repeat(64), createLocalJWKSet({ keys: [publicJwk] }))).resolves.toMatchObject({ runId: '20', runAttempt: '1' });
});
it.each([{ environment: 'staging' }, { run_attempt: '2' }, { ref: 'refs/heads/feature' }, { repository_id: '999' }, { runner_environment: 'self-hosted' }, { workflow_sha: 'f'.repeat(40) }])('rejects a correctly signed token with wrong claims', async overrides => {
  const value = request();
  await expect(verifyRunToken(await token(value, 'f'.repeat(64), overrides), value, 'f'.repeat(64), createLocalJWKSet({ keys: [publicJwk] }))).rejects.toMatchObject({ code: 'AUTHORIZATION_REJECTED' });
});
it('rejects a different request audience and an unsigned identity', async () => {
  const value = request();
  await expect(verifyRunToken(await token(value, 'f'.repeat(64)), value, 'e'.repeat(64), createLocalJWKSet({ keys: [publicJwk] }))).rejects.toThrow();
  await expect(verifyRunToken('forged-token', value, 'f'.repeat(64), createLocalJWKSet({ keys: [publicJwk] }))).rejects.toThrow();
});
it('GitHub-looking environment variables cannot authorize ordinary local apply', async () => {
  const { root } = await fixture('staging');
  vi.stubEnv('GITHUB_ACTIONS', 'true'); vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', ''); vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '');
  await expect(authorizeMutation({ operation: 'deploy', targetName: 'staging', target: policy.targets.staging, releaseDir: root, apply: true })).rejects.toMatchObject({ code: 'PROTECTED_RUN_REQUIRED' });
});

it.each(['change-reference', 'operator-run', 'issued-at'])('refuses fresh signed staging proof transplanted to another %s', async condition => {
  const { root, manifest } = await fixture();
  if (condition === 'change-reference') manifest.changeReference = 'DIFFERENT-CHANGE';
  if (condition === 'operator-run') manifest.operator.runId = '21';
  if (condition === 'issued-at') manifest.issuedAt = new Date(Date.parse(manifest.issuedAt) - 1000).toISOString();
  await writeFile(join(root, 'release-request.json'), JSON.stringify(manifest));
  await expect(verifyRelease(root)).rejects.toMatchObject({ code: 'STAGING_REQUEST_MISMATCH' });
});
it('accepts an older main ancestor and rejects a source outside main history by merge-base identity', async () => {
  await fixture('staging');
  await expect(assertProducer(build, 'image.yml')).resolves.toBeUndefined();
  vi.stubGlobal('fetch', async (url: string) => Response.json(url.includes('/compare/') ? { status: 'diverged', merge_base_commit: { sha: 'f'.repeat(40) } } : githubFixture(url)));
  await expect(assertProducer(build, 'image.yml')).rejects.toMatchObject({ code: 'PROVENANCE_REJECTED' });
});
