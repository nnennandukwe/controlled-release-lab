import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import configuredPolicy from '../config/release-policy.json' with { type: 'json' };
import { imageSchema, targetSchema, recordSchema, changeReferenceSchema, fingerprint, LabError, type EvidenceRecord } from './evidence.js';
import { verifyArtifact, repository, issuer } from './attestation.js';
import { sha256 } from './setup-verifier.js';
import { requireProtectedEnvironment } from './workflow-guard.js';
import type { Operation } from './operations.js';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema = z.string().regex(/^[a-f0-9]{40}$/);
const idSchema = z.string().regex(/^[1-9][0-9]*$/);
export const producerSchema = z.object({ sourceSha: sourceSchema, runId: idSchema, runAttempt: idSchema }).strict();
const policySchema = z.object({
  schemaVersion: z.literal(1), repository: z.literal(repository), repositoryId: idSchema, ownerId: idSchema, subjectPrefix: z.string().min(1),
  targets: z.object({ staging: targetSchema, live: targetSchema }).strict(),
  configurationFingerprints: z.object({ staging: digestSchema, live: digestSchema }).strict(),
  maxEvidenceAgeSeconds: z.number().int().positive(), clockSkewSeconds: z.number().int().nonnegative(),
  minRequests: z.number().int().positive(), minWindowSeconds: z.number().int().positive(), revokedImages: z.array(imageSchema),
}).strict();
export const policy = policySchema.parse(configuredPolicy);
export const policyDigest = sha256(await readFile(new URL('../config/release-policy.json', import.meta.url)));
const attachmentNames = ['image.bundle.jsonl', 'staging-evidence.json', 'staging.bundle.jsonl', 'recovery-evidence.json', 'recovery.bundle.jsonl', 'restore-record.json'] as const;
export const releaseRequestSchema = z.object({
  schemaVersion: z.literal(1), operation: z.enum(['deploy', 'rollback', 'observe']),
  targetName: z.enum(['staging', 'live']), target: targetSchema, image: imageSchema, sourceSha: sourceSchema,
  build: producerSchema, operator: producerSchema, policyDigest: digestSchema, configurationFingerprint: digestSchema,
  changeReference: changeReferenceSchema, issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  attachments: z.array(z.object({ name: z.enum(attachmentNames), sha256: digestSchema }).strict()).max(6),
  rollbackDeploymentId: z.string().uuid().nullable(),
}).strict().refine(value => new Set(value.attachments.map(item => item.name)).size === value.attachments.length, 'Duplicate attachments are not allowed.')
  .refine(value => (value.operation === 'rollback') === (value.rollbackDeploymentId !== null), 'Rollback requires its exact earlier deployment.');
export type ReleaseRequest = z.infer<typeof releaseRequestSchema>;
export function stagingObservationRequest(request: ReleaseRequest): ReleaseRequest {
  return releaseRequestSchema.parse({ ...request, operation: 'observe', targetName: 'staging', target: policy.targets.staging,
    configurationFingerprint: policy.configurationFingerprints.staging, rollbackDeploymentId: null,
    attachments: request.attachments.filter(attachment => attachment.name === 'image.bundle.jsonl') });
}
export const serializedRequest = (request: ReleaseRequest) => `${JSON.stringify(releaseRequestSchema.parse(request), null, 2)}\n`;
export const deploymentEvidenceSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('deployment-observation'), record: recordSchema,
  context: z.object({
    operator: producerSchema, build: producerSchema, policyDigest: digestSchema, requestDigest: digestSchema,
    authorization: z.enum(['protected-mutation', 'protected-observation']), audience: z.literal('synthetic-catalog-baseline'),
    notEvaluated: z.array(z.string()).min(1),
  }).strict(),
}).strict();
export type DeploymentEvidence = z.infer<typeof deploymentEvidenceSchema>;

export async function github(path: string, environment: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch): Promise<unknown> {
  const response = await transport(`https://api.github.com/repos/${repository}/${path}`, {
    headers: { ...(environment.GH_TOKEN ? { Authorization: `Bearer ${environment.GH_TOKEN}` } : {}), Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!response.ok) throw new LabError('GITHUB_EVIDENCE_UNAVAILABLE', `GitHub evidence read failed (HTTP ${response.status}). Restore access and retry verification, not deployment.`);
  return response.json();
}

export async function assertProducer(producer: z.infer<typeof producerSchema>, workflow: 'image.yml' | 'operate.yml', currentProof = false) {
  const run = z.object({ head_sha: sourceSchema, head_branch: z.string(), path: z.string(), event: z.string(), status: z.string(), conclusion: z.string().nullable(), run_attempt: z.number() })
    .parse(await github(`actions/runs/${producer.runId}/attempts/${producer.runAttempt}`));
  if (run.head_sha !== producer.sourceSha || run.head_branch !== 'main' || run.path !== `.github/workflows/${workflow}` || run.event !== 'workflow_dispatch' || run.run_attempt !== Number(producer.runAttempt)) throw new LabError('PROVENANCE_REJECTED', 'Producer run does not match the trusted workflow and exact source.');
  if (currentProof) {
    const jobs = await runJobs(producer);
    const proof = jobs.filter(job => job.name === 'staging-proof');
    if (proof.length !== 1 || proof[0]!.conclusion !== 'success' || proof[0]!.status !== 'completed') throw new LabError('PROVENANCE_REJECTED', 'The exact upstream staging proof job must finish successfully.');
  } else if (run.status !== 'completed' || run.conclusion !== 'success') throw new LabError('PROVENANCE_REJECTED', 'Producer run did not complete successfully.');
  const comparison = z.object({ status: z.enum(['ahead', 'behind', 'identical', 'diverged']) }).parse(await github(`compare/${producer.sourceSha}...main`));
  if (!['ahead', 'identical'].includes(comparison.status)) throw new LabError('PROVENANCE_REJECTED', 'Producer source is not in protected main history.');
}

const jobSchema = z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable(), check_run_url: z.string() });
async function runJobs(producer: z.infer<typeof producerSchema>) {
  const jobs: z.infer<typeof jobSchema>[] = [];
  for (let page = 1; page <= 5; page++) {
    const result = z.object({ total_count: z.number(), jobs: z.array(jobSchema) }).parse(await github(`actions/runs/${producer.runId}/attempts/${producer.runAttempt}/jobs?per_page=100&page=${page}`));
    jobs.push(...result.jobs);
    if (jobs.length === result.total_count) return jobs;
    if (!result.jobs.length) break;
  }
  throw new LabError('GITHUB_EVIDENCE_UNAVAILABLE', 'Cannot enumerate exact run jobs within the bounded lookup.');
}

async function boundedFile(directory: string, name: string) {
  const root = await realpath(directory);
  const path = join(root, name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 10 * 1024 * 1024 || await realpath(path) !== path) throw new LabError('RELEASE_ATTACHMENT_REJECTED', 'Release attachments must be bounded regular files inside the release directory.');
  return { path, bytes: await readFile(path) };
}

async function preserveFile(path: string, bytes: Buffer) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}

export function checkRequest(request: ReleaseRequest, now = Date.now()) {
  if (request.policyDigest !== policyDigest) throw new LabError('POLICY_CHANGED', 'Resolve a new request against the current release policy.');
  if (fingerprint(request.target) !== fingerprint(policy.targets[request.targetName]) || request.configurationFingerprint !== policy.configurationFingerprints[request.targetName]
    || request.sourceSha !== request.build.sourceSha || !request.image.startsWith(`ghcr.io/${repository}@`) || policy.revokedImages.includes(request.image)) throw new LabError('RELEASE_SUBJECT_MISMATCH', 'Request does not match the allowed image, target, source or configuration.');
  const issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt);
  if (issued > now + policy.clockSkewSeconds * 1000 || expires <= now || expires <= issued || expires - issued > policy.maxEvidenceAgeSeconds * 1000) throw new LabError('RELEASE_REQUEST_EXPIRED', 'Resolve a new release request and collect fresh evidence before approval.');
}

export function checkObservation(evidence: DeploymentEvidence, request: ReleaseRequest, recovery: boolean, now = Date.now()) {
  const record = evidence.record;
  const target = recovery ? request.targetName : 'staging';
  if (record.outcome !== 'verified' || !record.deploymentId || !record.finishedAt || record.requestedImage !== request.image || record.requestedSourceSha !== request.sourceSha
    || record.targetName !== target || fingerprint(record.target) !== fingerprint(policy.targets[target]) || record.configurationFingerprint !== policy.configurationFingerprints[target]
    || evidence.context.policyDigest !== policyDigest || fingerprint(evidence.context.build) !== fingerprint(request.build)
    || (recovery && record.deploymentId !== request.rollbackDeploymentId)) throw new LabError('RELEASE_SUBJECT_MISMATCH', 'Observation does not match this subject, policy, configuration or recovery target.');
  const measurements = record.observations.filter(value => !!value && typeof value === 'object' && (value as { phase?: string }).phase === 'measurement');
  if (measurements.length !== 1) throw new LabError('STAGING_EVIDENCE_INSUFFICIENT', 'A single complete observation is required.');
  const sampleSchema = z.object({ status: z.literal(200), error: z.null(), functional: z.literal(true), sourceSha: sourceSchema, deploymentId: z.string().uuid(), environment: z.enum(['staging', 'live']), requestId: z.string().uuid(), durationMs: z.number().nonnegative() });
  const measured = z.object({ outcome: z.literal('verified'), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), elapsedMs: z.number().min(policy.minWindowSeconds * 1000),
    samples: z.array(sampleSchema).min(policy.minRequests), requests: z.number().int(), expectedRequests: z.number().int().min(policy.minRequests), failures: z.literal(0), reasonCodes: z.array(z.never()),
  }).safeParse(measurements[0]);
  if (!measured.success) throw new LabError('STAGING_EVIDENCE_INSUFFICIENT', 'Collect a complete healthy observation with the required samples and window.');
  const observation = measured.data;
  const started = Date.parse(observation.startedAt), ended = Date.parse(observation.finishedAt);
  if (ended - started < policy.minWindowSeconds * 1000 || started > now + policy.clockSkewSeconds * 1000 || ended > now + policy.clockSkewSeconds * 1000
    || (!recovery && now - ended > policy.maxEvidenceAgeSeconds * 1000)) throw new LabError('STAGING_EVIDENCE_STALE', 'Collect a fresh complete staging observation; this window is stale or invalid.');
  if (observation.requests !== observation.samples.length || observation.samples.length < observation.expectedRequests || new Set(observation.samples.map(sample => sample.requestId)).size !== observation.samples.length
    || observation.samples.some(sample => sample.sourceSha !== request.sourceSha || sample.deploymentId !== record.deploymentId || sample.environment !== target)) throw new LabError('STAGING_EVIDENCE_INSUFFICIENT', 'Observation samples do not consistently identify the requested deployment.');
  return ended;
}

export async function verifyRelease(directory: string) {
  const manifest = await boundedFile(directory, 'release-request.json');
  const request = releaseRequestSchema.parse(JSON.parse(manifest.bytes.toString()));
  checkRequest(request);
  const files = new Map<string, { path: string; bytes: Buffer }>();
  for (const attachment of request.attachments) {
    const file = await boundedFile(directory, attachment.name);
    if (sha256(file.bytes) !== attachment.sha256) throw new LabError('RELEASE_ATTACHMENT_REJECTED', 'An attachment changed after request resolution. Resolve a new request.');
    files.set(attachment.name, file);
  }
  const required = (name: string) => { const file = files.get(name); if (!file) throw new LabError('PROVENANCE_REQUIRED', `Release request needs ${name}. Resolve the trusted producer artifacts.`); return file; };
  const built = await verifyArtifact({ subject: `oci://${request.image}`, bundle: required('image.bundle.jsonl').path, workflow: 'image.yml', sourceSha: request.sourceSha });
  if (built.runId !== request.build.runId || built.runAttempt !== request.build.runAttempt) throw new LabError('PROVENANCE_REJECTED', 'Image bundle belongs to a different producer run.');
  await assertProducer(request.build, 'image.yml');
  let restoreRecord: string | undefined;
  let eligibilityExpiresAt = Date.parse(request.expiresAt);
  if (request.operation === 'rollback' || (request.operation === 'deploy' && request.targetName === 'live')) {
    const recovery = request.operation === 'rollback';
    const prefix = recovery ? 'recovery' : 'staging';
    const envelope = required(`${prefix}-evidence.json`);
    // Read only a candidate source selector before signature verification. No
    // claim from this untrusted JSON is used in a policy decision yet.
    const candidate = z.object({ context: z.object({ operator: producerSchema }) }).parse(JSON.parse(envelope.bytes.toString()));
    const verified = await verifyArtifact({ subject: envelope.path, bundle: required(`${prefix}.bundle.jsonl`).path, workflow: 'operate.yml', sourceSha: candidate.context.operator.sourceSha });
    const evidence = deploymentEvidenceSchema.parse(JSON.parse(envelope.bytes.toString()));
    if (verified.runId !== evidence.context.operator.runId || verified.runAttempt !== evidence.context.operator.runAttempt) throw new LabError('PROVENANCE_REJECTED', 'Observation signer does not match its claimed run.');
    if (!recovery && (fingerprint(evidence.context.operator) !== fingerprint(request.operator)
      || evidence.context.requestDigest !== sha256(serializedRequest(stagingObservationRequest(request))))) throw new LabError('STAGING_REQUEST_MISMATCH', 'Staging proof belongs to another promotion request. Resolve and observe this exact request again.');
    await assertProducer(evidence.context.operator, 'operate.yml', !recovery && evidence.context.operator.runId === request.operator.runId && evidence.context.operator.runAttempt === request.operator.runAttempt);
    const observedUntil = checkObservation(evidence, request, recovery);
    if (!recovery) eligibilityExpiresAt = Math.min(eligibilityExpiresAt, observedUntil + policy.maxEvidenceAgeSeconds * 1000);
    if (recovery) {
      restoreRecord = required('restore-record.json').path;
      if (fingerprint(recordSchema.parse(JSON.parse(required('restore-record.json').bytes.toString()))) !== fingerprint(evidence.record)) throw new LabError('RECOVERY_EVIDENCE_REJECTED', 'Saved recovery record differs from the signed live evidence.');
    }
  }
  return { request, requestDigest: sha256(manifest.bytes), restoreRecord, eligibilityExpiresAt };
}

const keySet = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`), { timeoutDuration: 10000 });
export async function verifyRunToken(token: string, request: ReleaseRequest, requestDigest: string, keys: JWTVerifyGetKey = keySet) {
  try {
    const { payload } = await jwtVerify(token, keys, { issuer, algorithms: ['RS256'], audience: `https://github.com/${repository}/release/${requestDigest}`, clockTolerance: policy.clockSkewSeconds, maxTokenAge: '5m' });
    const claims = z.object({ repository_id: z.literal(policy.repositoryId), repository_owner_id: z.literal(policy.ownerId), repository: z.literal(repository),
      sub: z.literal(`${policy.subjectPrefix}:environment:${request.targetName}`), environment: z.literal(request.targetName),
      ref: z.literal('refs/heads/main'), event_name: z.literal('workflow_dispatch'), runner_environment: z.literal('github-hosted'),
      workflow_ref: z.literal(`${repository}/.github/workflows/operate.yml@refs/heads/main`), workflow_sha: z.literal(request.operator.sourceSha),
      run_id: z.literal(request.operator.runId), run_attempt: z.literal(request.operator.runAttempt), check_run_id: idSchema, actor_id: idSchema,
      exp: z.number(), iat: z.number(), nbf: z.number(),
    }).parse(payload);
    return { runId: claims.run_id, runAttempt: claims.run_attempt, checkRunId: claims.check_run_id, actorId: claims.actor_id, expiresAt: claims.exp * 1000 };
  } catch { throw new LabError('AUTHORIZATION_REJECTED', 'Protected-run identity, request binding or token validity failed. Dispatch a new protected workflow.'); }
}

async function protectedRun(request: ReleaseRequest, requestDigest: string) {
  checkRequest(request);
  const urlText = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!urlText || !token) throw new LabError('PROTECTED_RUN_REQUIRED', 'Apply is available only inside the protected Operate lab workflow. Local verification does not authorize a mutation.');
  const url = new URL(urlText);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com') || url.username || url.password) throw new LabError('AUTHORIZATION_REJECTED', 'Unexpected GitHub OIDC endpoint.');
  url.searchParams.set('audience', `https://github.com/${repository}/release/${requestDigest}`);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new LabError('AUTHORIZATION_REJECTED', 'GitHub did not issue protected-run identity.');
  const jwt = z.object({ value: z.string().min(1) }).parse(await response.json()).value;
  const identity = await verifyRunToken(jwt, request, requestDigest);
  const run = z.object({ head_sha: sourceSchema, run_attempt: z.number(), status: z.literal('in_progress'), actor: z.object({ id: z.number() }) }).parse(await github(`actions/runs/${request.operator.runId}/attempts/${request.operator.runAttempt}`));
  const jobs = await runJobs(request.operator);
  const matching = jobs.filter(job => job.check_run_url === `https://api.github.com/repos/${repository}/check-runs/${identity.checkRunId}`);
  if (run.head_sha !== request.operator.sourceSha || run.run_attempt !== Number(request.operator.runAttempt) || run.actor.id !== Number(identity.actorId)
    || matching.length !== 1 || matching[0]!.name !== 'operate' || matching[0]!.status !== 'in_progress') throw new LabError('AUTHORIZATION_REJECTED', 'Run/job identity differs from the authenticated mutation context.');
  await requireProtectedEnvironment({ ...process.env, LAB_GITHUB_ENVIRONMENT: request.targetName });
  return identity;
}

export async function authorizeMutation(input: Operation) {
  if (!input.releaseDir) throw new LabError('PROTECTED_RUN_REQUIRED', 'Use --release-dir in the protected Operate lab workflow; local preview does not authorize apply.');
  const verified = await verifyRelease(input.releaseDir);
  const request = verified.request;
  if (request.operation !== input.operation || request.targetName !== input.targetName || fingerprint(request.target) !== fingerprint(input.target)
    || (input.image !== undefined && input.image !== request.image) || (input.sourceSha !== undefined && input.sourceSha !== request.sourceSha)
    || (input.changeReference !== undefined && input.changeReference !== request.changeReference) || (input.deploymentId !== undefined && input.deploymentId !== request.rollbackDeploymentId)
    || input.restoreRecord !== undefined) throw new LabError('RELEASE_SUBJECT_MISMATCH', 'Command arguments conflict with the resolved release request.');
  if ((input.durationSeconds !== undefined && input.durationSeconds < 60) || (input.maxRequests !== undefined && input.maxRequests < 120)
    || (input.rate !== undefined && input.rate !== 2) || (input.maxDurationSeconds !== undefined && input.maxDurationSeconds < 90)) throw new LabError('STAGING_EVIDENCE_INSUFFICIENT', 'Apply cannot weaken the required observation window or request budget.');
  const identity = await protectedRun(request, verified.requestDigest);
  const canonical: Operation = { ...input, image: request.image, sourceSha: request.sourceSha, changeReference: request.changeReference, durationSeconds: 60, maxDurationSeconds: 90, rate: 2, maxRequests: 120 };
  if (request.operation === 'rollback') { canonical.deploymentId = request.rollbackDeploymentId!; canonical.restoreRecord = verified.restoreRecord!; }
  return {
    request: canonical, expectedConfiguration: request.configurationFingerprint,
    decision: { outcome: 'authorized', requestDigest: verified.requestDigest, policyDigest, target: request.targetName, image: request.image, identity },
    saveEvidence: async (directory: string) => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const manifest = (await boundedFile(input.releaseDir!, 'release-request.json')).bytes;
      if (sha256(manifest) !== verified.requestDigest) throw new LabError('RELEASE_ATTACHMENT_REJECTED', 'The approved request changed before journaling.');
      await preserveFile(join(directory, 'release-request.json'), manifest);
      for (const attachment of request.attachments) {
        const file = await boundedFile(input.releaseDir!, attachment.name);
        if (sha256(file.bytes) !== attachment.sha256) throw new LabError('RELEASE_ATTACHMENT_REJECTED', 'Approved evidence changed before journaling.');
        await preserveFile(join(directory, attachment.name), file.bytes);
      }
    },
    assertCurrent: async () => {
      if (sha256((await boundedFile(input.releaseDir!, 'release-request.json')).bytes) !== verified.requestDigest) throw new LabError('RELEASE_ATTACHMENT_REJECTED', 'The approved request changed before mutation.');
      for (const attachment of request.attachments) if (sha256((await boundedFile(input.releaseDir!, attachment.name)).bytes) !== attachment.sha256) throw new LabError('RELEASE_ATTACHMENT_REJECTED', 'Approved evidence changed before mutation.');
      await protectedRun(request, verified.requestDigest);
      if (Date.now() >= verified.eligibilityExpiresAt) throw new LabError('STAGING_EVIDENCE_STALE', 'Evidence expired before mutation. Resolve a fresh request.');
    },
  };
}

export function createEnvelope(record: EvidenceRecord, request: ReleaseRequest, requestDigest: string): DeploymentEvidence {
  const envelope = deploymentEvidenceSchema.parse({ schemaVersion: 1, kind: 'deployment-observation', record,
    context: { operator: request.operator, build: request.build, policyDigest, requestDigest,
      authorization: request.operation === 'observe' ? 'protected-observation' : 'protected-mutation', audience: 'synthetic-catalog-baseline',
      notEvaluated: ['Semantic correctness', 'Feature cohorts', 'Production service-level objectives'] } });
  // Use recovery semantics only to select the actual observed target, without
  // applying promotion freshness to a just-completed live observation.
  checkObservation(envelope, { ...request, rollbackDeploymentId: record.deploymentId }, true);
  return envelope;
}
