import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { acquireLock, changeReferenceSchema, fingerprint, imageSchema, Journal, LabError, releaseReconciledLock, targetSchema } from './evidence.js';
import { flagSnapshotSchema, desiredFlagState, flagStateSchema, validateFlagSnapshot, type FlagProvider } from './launchdarkly.js';
import { predecessor, stageSchema, type ExposureStage } from './launchdarkly.js';
import { exposurePolicyDigest, rosterDigest, originalQueryBaselines, type QueryBaseline, exposurePolicy } from './exposure-observe.js';
import { featureProofSchema, legacyFeatureProofSchema, assertServing, checkFeatureProof, measureFeatureProof, type FeatureSubject } from './feature-proof.js';
import { boundedFile, preserveFile, policy, policyDigest, producerSchema, protectedRun, assertProducer, controlledDeploymentEvidenceSchema } from './promotion.js';
import { verifyArtifact, repository } from './attestation.js';
import { sha256 } from './setup-verifier.js';
import type { Hosting } from './railway.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const attachments = ['image.bundle.jsonl', 'deployment-evidence.json', 'deployment.bundle.jsonl', 'prior-exposure.json', 'prior.bundle.jsonl'] as const;
export const exposureRequestSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('exposure-request'), purpose: z.enum(['release', 'response-loss-rehearsal']).default('release'), operation: z.enum(['expose', 'disable', 'observe-exposure']), stage: stageSchema,
  targetName: z.enum(['staging', 'live']), target: targetSchema, image: imageSchema, sourceSha: z.string().regex(/^[a-f0-9]{40}$/), deploymentId: z.string().uuid(),
  configurationFingerprint: digest, policyDigest: digest, exposurePolicyDigest: digest, rosterDigest: digest,
  build: producerSchema, operator: producerSchema, before: flagSnapshotSchema, desired: flagStateSchema,
  changeReference: changeReferenceSchema, issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  observation: z.object({ internal: z.literal(120), population: z.literal(1160), maxRequests: z.literal(1200), deadlineSeconds: z.literal(180) }).strict(),
  attachments: z.array(z.object({ name: z.enum(attachments), sha256: digest }).strict()).min(3).max(5),
}).strict().refine(request => new Set(request.attachments.map(file => file.name)).size === request.attachments.length, 'Duplicate attachments are forbidden.');
export type ExposureRequest = z.infer<typeof exposureRequestSchema>;
export const exposureRecordSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('exposure-record'), attemptId: z.string().uuid(), operation: z.enum(['expose', 'disable', 'observe-exposure', 'reconcile-exposure']), request: exposureRequestSchema, requestDigest: digest,
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(), outcome: z.enum(['verified', 'blocked', 'failed', 'unknown_outcome']), reasonCodes: z.array(z.string()), recoveryInstruction: z.string(),
  submitted: z.boolean(), acknowledged: z.boolean(), featureProof: featureProofSchema.nullable(), authorization: z.unknown().nullable(), reconciles: z.string().uuid().nullable(),
}).strict();
export type ExposureRecord = z.infer<typeof exposureRecordSchema>;
export const exposureEvidenceSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('exposure-evidence'), record: exposureRecordSchema,
  context: z.object({ operator: producerSchema, policyDigest: digest, exposurePolicyDigest: digest, rosterDigest: digest, requestDigest: digest, notEvaluated: z.array(z.string()).min(1) }).strict(),
}).strict();
export const legacyExposureEvidenceSchema = exposureEvidenceSchema.extend({ record: exposureRecordSchema.extend({ featureProof: legacyFeatureProofSchema.nullable() }) }).strict();
/** Inspection only. Current eligibility still requires the current feature proof and policy. */
export const exposureHistorySchema = z.union([exposureEvidenceSchema, legacyExposureEvidenceSchema]);
export const serializeExposure = (input: ExposureRequest) => `${JSON.stringify(exposureRequestSchema.parse(input), null, 2)}\n`;
export const exposureSubject = (request: ExposureRequest): FeatureSubject => ({ targetName: request.targetName, target: request.target, image: request.image, sourceSha: request.sourceSha, deploymentId: request.deploymentId, configurationFingerprint: request.configurationFingerprint });

export function checkExposureRequest(request: ExposureRequest, now = Date.now()) {
  if (request.purpose === 'response-loss-rehearsal' && (request.operation !== 'expose' || request.targetName !== 'staging' || request.stage !== 'internal')) throw new LabError('REHEARSAL_TARGET_REJECTED', 'Flag recovery rehearsals require an internal staging exposure.');
  const before = validateFlagSnapshot(request.before, request.targetName);
  const issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt);
  if (issued > now + policy.clockSkewSeconds * 1000 || expires <= now || expires <= issued || expires - issued > policy.maxEvidenceAgeSeconds * 1000) throw new LabError('EXPOSURE_REQUEST_EXPIRED', 'Resolve a new exposure request before approval.');
  if (request.policyDigest !== policyDigest || request.exposurePolicyDigest !== exposurePolicyDigest || request.rosterDigest !== rosterDigest) throw new LabError('EXPOSURE_POLICY_CHANGED', 'Resolve against the current release, exposure and roster policies.');
  if (fingerprint(request.target) !== fingerprint(policy.targets[request.targetName]) || request.configurationFingerprint !== policy.configurationFingerprints[request.targetName] || request.build.sourceSha !== request.sourceSha || !request.image.startsWith(`ghcr.io/${repository}@`) || policy.revokedImages.includes(request.image)) throw new LabError('EXPOSURE_SUBJECT_CHANGED', 'Request does not identify the allowed current release subject.');
  if ((request.operation === 'disable' && request.stage !== 'off') || (request.operation === 'expose' && request.stage === 'off')) throw new LabError('EXPOSURE_TRANSITION', 'Operation and requested stage disagree.');
  const desired = request.operation === 'observe-exposure' ? before.state : desiredFlagState(before, request.stage);
  if (fingerprint(desired) !== fingerprint(request.desired) || (request.operation === 'observe-exposure' && request.stage !== before.stage)) throw new LabError('EXPOSURE_TRANSITION', 'The intended flag definition is not the permitted transition.');
  if (request.observation.internal !== exposurePolicy.internal.requests || request.observation.population !== exposurePolicy.population.requests) throw new LabError('EXPOSURE_POLICY_CHANGED', 'Request observation bounds do not match policy.');
}

/** Authenticate every attachment before using its claims; a hash alone is not provenance. */
export async function verifyExposureRelease(directory: string, allowExpired = false) {
  const manifest = await boundedFile(directory, 'exposure-request.json');
  const request = exposureRequestSchema.parse(JSON.parse(manifest.bytes.toString()));
  if (!allowExpired) checkExposureRequest(request);
  else checkExposureRequest({ ...request, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() });
  const files = new Map<string, Awaited<ReturnType<typeof boundedFile>>>();
  for (const attachment of request.attachments) {
    const file = await boundedFile(directory, attachment.name);
    if (sha256(file.bytes) !== attachment.sha256) throw new LabError('EXPOSURE_ATTACHMENT_CHANGED', 'Restore the exact signed evidence or resolve a new request.');
    files.set(attachment.name, file);
  }
  const required = (name: string) => { const file = files.get(name); if (!file) throw new LabError('EXPOSURE_PROOF_REQUIRED', `The request requires ${name}.`); return file; };
  const image = await verifyArtifact({ subject: `oci://${request.image}`, bundle: required('image.bundle.jsonl').path, workflow: 'image.yml', sourceSha: request.sourceSha });
  if (image.runId !== request.build.runId || image.runAttempt !== request.build.runAttempt) throw new LabError('PROVENANCE_REJECTED', 'Image evidence belongs to another producer.');
  await assertProducer(request.build, 'image.yml');
  const baselineFile = required('deployment-evidence.json');
  const candidate = z.object({ context: z.object({ operator: producerSchema }) }).parse(JSON.parse(baselineFile.bytes.toString()));
  const signed = await verifyArtifact({ subject: baselineFile.path, bundle: required('deployment.bundle.jsonl').path, workflow: 'operate.yml', sourceSha: candidate.context.operator.sourceSha });
  const baseline = controlledDeploymentEvidenceSchema.parse(JSON.parse(baselineFile.bytes.toString()));
  if (signed.runId !== baseline.context.operator.runId || signed.runAttempt !== baseline.context.operator.runAttempt) throw new LabError('PROVENANCE_REJECTED', 'Deployment evidence signer differs from its producer.');
  await assertProducer(baseline.context.operator, 'operate.yml');
  if (baseline.context.policyDigest !== policyDigest || fingerprint(baseline.context.build) !== fingerprint(request.build) || baseline.record.outcome !== 'verified' || baseline.record.deploymentId !== request.deploymentId || baseline.record.requestedImage !== request.image || baseline.record.requestedSourceSha !== request.sourceSha) throw new LabError('EXPOSURE_SUBJECT_CHANGED', 'Signed deployment baseline belongs to another release.');
  // A retained off baseline permits stopping an unhealthy exposure. Expansion uses
  // a separate fresh predecessor proof; disable does not require healthy treatment.
  const checkedBaseline = checkFeatureProof(baseline.featureProof, exposureSubject(request), 'off', !allowExpired && request.operation === 'expose' && request.stage === 'internal');
  const baselineP95Ms = checkedBaseline.measurement.p95Ms!;
  const baselineQueryP95Ms = originalQueryBaselines(checkedBaseline.measurement);
  let priorProof: ReturnType<typeof checkExposureEvidence> | undefined;
  if (request.operation === 'expose' && request.stage !== 'internal' && request.stage !== 'off') {
    const priorFile = required('prior-exposure.json');
    const priorCandidate = z.object({ context: z.object({ operator: producerSchema }) }).parse(JSON.parse(priorFile.bytes.toString()));
    const priorSigned = await verifyArtifact({ subject: priorFile.path, bundle: required('prior.bundle.jsonl').path, workflow: 'operate.yml', sourceSha: priorCandidate.context.operator.sourceSha });
    const prior = exposureEvidenceSchema.parse(JSON.parse(priorFile.bytes.toString()));
    if (priorSigned.runId !== prior.context.operator.runId || priorSigned.runAttempt !== prior.context.operator.runAttempt) throw new LabError('PROVENANCE_REJECTED', 'Exposure evidence signer differs from its producer.');
    await assertProducer(prior.context.operator, 'operate.yml');
    priorProof = checkExposureEvidence(prior, exposureSubject(request), baselineP95Ms, !allowExpired, baselineQueryP95Ms);
    if (prior.record.request.operation !== 'expose' || !['expose', 'reconcile-exposure'].includes(prior.record.operation)) throw new LabError('EXPOSURE_AUTHORITY_REQUIRED', 'Expansion requires evidence of an authorized predecessor exposure, not a read-only observation.');
    if (prior.record.featureProof?.after.stage !== predecessor[request.stage] || prior.record.featureProof.after.digest !== request.before.digest) throw new LabError('EXPOSURE_PROOF_STALE', 'Expansion requires current verified immediate predecessor exposure evidence.');
  }
  return { request, requestDigest: sha256(manifest.bytes), baselineP95Ms, baselineQueryP95Ms, priorProof, manifest, files };
}
export function checkExposureEvidence(input: unknown, subject: FeatureSubject, baselineP95Ms: number, fresh = true, baselineQueryP95Ms?: QueryBaseline) {
  const evidence = exposureEvidenceSchema.parse(input), record = evidence.record;
  if (record.outcome !== 'verified' || !record.finishedAt || !record.featureProof || evidence.context.policyDigest !== policyDigest || evidence.context.exposurePolicyDigest !== exposurePolicyDigest || evidence.context.rosterDigest !== rosterDigest
    || evidence.context.requestDigest !== record.requestDigest || record.requestDigest !== sha256(serializeExposure(record.request)) || fingerprint(record.featureProof.subject) !== fingerprint(subject)
    || record.featureProof.baselineP95Ms !== baselineP95Ms || (baselineQueryP95Ms && fingerprint(record.featureProof.baselineQueryP95Ms) !== fingerprint(baselineQueryP95Ms))) throw new LabError('EXPOSURE_PROOF_REJECTED', 'Exposure evidence is incomplete or belongs to another request, policy or baseline.');
  if (fingerprint(exposureSubject(record.request)) !== fingerprint(subject) || record.featureProof.after.stage !== record.request.stage || !matchesDesired(record.featureProof.after.state, record.request.desired)) throw new LabError('EXPOSURE_PROOF_REJECTED', 'Observed flag state differs from the evidence request.');
  return checkFeatureProof(record.featureProof, subject, 'any', fresh);
}

/** Authenticate the terminal proof even when no later stage will consume it. */
export async function verifyExposureObservation(directory: string, targetName: 'staging' | 'live') {
  const file = await boundedFile(directory, 'exposure-evidence.json'), bundle = await boundedFile(directory, 'evidence.bundle.jsonl');
  const candidate = z.object({ context: z.object({ operator: producerSchema }) }).parse(JSON.parse(file.bytes.toString()));
  const signed = await verifyArtifact({ subject: file.path, bundle: bundle.path, workflow: 'operate.yml', sourceSha: candidate.context.operator.sourceSha });
  if (signed.runId !== candidate.context.operator.runId || signed.runAttempt !== candidate.context.operator.runAttempt) throw new LabError('PROVENANCE_REJECTED', 'Exposure signer differs from its exact producer attempt.');
  await assertProducer(candidate.context.operator, 'operate.yml');
  const envelope = exposureEvidenceSchema.parse(JSON.parse(file.bytes.toString())), record = envelope.record;
  if (record.request.targetName !== targetName || !record.featureProof) throw new LabError('EXPOSURE_SUBJECT_CHANGED', 'Choose the complete signed exposure proof for this target.');
  // The original request authorized its earlier effect. Verification does not
  // reuse that authority; the completed measurement itself must still be fresh.
  checkExposureRequest({ ...record.request, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() });
  const proof = checkExposureEvidence(envelope, exposureSubject(record.request), record.featureProof.baselineP95Ms);
  const completionEvidence = proof.after.stage === '100' && record.request.operation === 'expose' && ['expose', 'reconcile-exposure'].includes(record.operation);
  return { envelope, proof, completionEvidence, evidenceDigest: sha256(file.bytes), authorized: false as const };
}
async function preserveRelease(directory: string, verified: Awaited<ReturnType<typeof verifyExposureRelease>>) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await preserveFile(join(directory, 'exposure-request.json'), verified.manifest.bytes);
  for (const [name, file] of verified.files) await preserveFile(join(directory, name), file.bytes);
}
async function saveExposureRecord(journal: Journal, record: ExposureRecord) {
  const path = join(journal.directory, 'exposure-record.json');
  const bytes = Buffer.from(`${JSON.stringify(exposureRecordSchema.parse(record), null, 2)}\n`);
  await preserveFile(path, bytes); await preserveFile(`${path}.sha256`, Buffer.from(`${sha256(bytes)}\n`));
  return path;
}
export async function loadExposureRecord(path: string) {
  const bytes = await readFile(path);
  if ((await readFile(`${path}.sha256`, 'utf8')).trim() !== sha256(bytes)) throw new LabError('EXPOSURE_RECORD_CHANGED', 'Restore intact exposure state before continuing.');
  return exposureRecordSchema.parse(JSON.parse(bytes.toString()));
}
async function loadExposureAttempt(root: string, attempt: string) {
  z.string().uuid().parse(attempt); const directory = join(root, 'exposure', 'attempts', attempt);
  try { return { directory, record: await loadExposureRecord(join(directory, 'exposure-record.json')) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const intent = (await readdir(directory)).sort().find(name => name.endsWith('-intent.json'));
  if (!intent) throw new LabError('MISSING_EXPOSURE_INTENT', 'Restore the original durable exposure intent before reconciliation.');
  return { directory, record: exposureRecordSchema.parse(JSON.parse(await readFile(join(directory, intent), 'utf8')).observation) };
}
export type ExposureOperation = { operation: 'expose' | 'disable' | 'observe-exposure' | 'reconcile-exposure'; targetName: 'staging' | 'live'; releaseDir?: string; stage?: Exclude<ExposureStage, 'off'>; apply?: boolean; attempt?: string; rehearseResponseLoss?: boolean };
export async function executeExposure(input: ExposureOperation, hosting: Hosting, flags: FlagProvider, root: string, transport: typeof fetch = fetch) {
  const mutating = input.operation === 'expose' || input.operation === 'disable';
  if (input.apply && !mutating) throw new LabError('INVALID_EXPOSURE_ARGUMENT', 'Observation and reconciliation are read-only.');
  let prior: Awaited<ReturnType<typeof loadExposureAttempt>> | undefined;
  if (input.operation === 'reconcile-exposure') {
    prior = await loadExposureAttempt(root, z.string().uuid().parse(input.attempt));
    if (prior.record.outcome !== 'unknown_outcome' || prior.record.request.targetName !== input.targetName) throw new LabError('NOT_UNCERTAIN', 'Reconcile an unknown exposure attempt for this exact target.');
  }
  const directory = prior ? join(prior.directory, 'release') : input.releaseDir;
  if (!directory) throw new LabError('EXPOSURE_PROOF_REQUIRED', 'Use --release-dir with an exact authenticated exposure request.');
  const verified = await verifyExposureRelease(directory, !!prior), request = verified.request;
  if (request.targetName !== input.targetName || (!prior && request.operation !== input.operation) || (input.operation === 'expose' && request.stage !== input.stage)) throw new LabError('EXPOSURE_SUBJECT_CHANGED', 'Command and resolved exposure request disagree.');
  if (!prior && (request.purpose === 'response-loss-rehearsal') !== (input.rehearseResponseLoss === true)) throw new LabError('EXPOSURE_SUBJECT_CHANGED', 'The approved request and command must agree on the response-loss rehearsal.');
  if (prior && (verified.requestDigest !== prior.record.requestDigest || fingerprint(request) !== fingerprint(prior.record.request))) throw new LabError('EXPOSURE_RECORD_CHANGED', 'The prior intent and retained request disagree.');
  await hosting.assertScope(); await flags.assertScope();
  const subject = exposureSubject(request);
  const beforeProvider = await hosting.snapshot(); assertServing(beforeProvider, subject);
  const before = await flags.snapshot();
  if (!prior && before.digest !== request.before.digest) throw new LabError('FLAG_STATE_CHANGED', 'The flag changed since request resolution. No PATCH was sent.');
  if (mutating && !input.apply) return { outcome: 'preview', reasonCodes: ['APPLY_REQUIRED'], target: request.targetName, stage: request.stage, requestDigest: verified.requestDigest, recordPath: '' };
  // Authenticate the actual protected job before obtaining a mutation lock.
  const identity = mutating ? await protectedRun(request, verified.requestDigest) : null;
  const journal = new Journal(join(root, 'exposure'));
  const release = mutating ? await acquireLock(root, request.target, journal.attemptId) : undefined;
  let effectAttempted = false, saved = false, measuredStableState = false;
  const record: ExposureRecord = { schemaVersion: 1, kind: 'exposure-record', attemptId: journal.attemptId, operation: input.operation, request, requestDigest: verified.requestDigest, startedAt: new Date().toISOString(), finishedAt: null, outcome: 'unknown_outcome', reasonCodes: [], recoveryInstruction: '', submitted: false, acknowledged: false, featureProof: null, authorization: identity, reconciles: input.attempt ?? null };
  try {
    await journal.initialize(); await preserveRelease(join(journal.directory, 'release'), verified);
    await journal.append('intent', record); await journal.append('before-provider', beforeProvider); await journal.append('before-flag', before);
    if (mutating) {
      const fresh = await verifyExposureRelease(directory);
      if (fresh.requestDigest !== verified.requestDigest) throw new LabError('EXPOSURE_ATTACHMENT_CHANGED', 'Approved request changed before PATCH.');
      await protectedRun(request, verified.requestDigest); checkExposureRequest(request);
      assertServing(await hosting.snapshot(), subject);
      const current = await flags.snapshot(); if (current.digest !== before.digest) throw new LabError('FLAG_STATE_CHANGED', 'Flag changed before PATCH; resolve a new request.');
      // Persist the pending effect before crossing the provider boundary. A lost
      // response or journal write cannot lead to an automatic second PATCH.
      record.submitted = true; await journal.append('submitted', { requestDigest: verified.requestDigest }); effectAttempted = true;
      let acknowledged;
      try { acknowledged = await flags.update(before, request.stage); }
      catch (error) { if (error instanceof LabError && error.outcome === 'blocked') effectAttempted = false; throw error; }
      record.acknowledged = true;
      await journal.append('acknowledged', acknowledged);
    }
    const actual = await flags.snapshot();
    if (!matchesDesired(actual.state, request.desired) || actual.stage !== request.stage) throw new LabError('FLAG_NOT_CONVERGED', 'Provider state has not reached the requested definition. Reconcile without repeating PATCH.', 'unknown_outcome');
    record.featureProof = await measureFeatureProof(hosting, flags, subject, verified.baselineP95Ms, sample => journal.append('request', sample), transport, verified.baselineQueryP95Ms);
    await journal.append('feature-proof', record.featureProof);
    if (record.featureProof.before.digest !== actual.digest) throw new LabError('FLAG_STATE_CHANGED', 'Flag changed before the observation began.');
    assertServing(record.featureProof.providerAfter as Awaited<ReturnType<Hosting['snapshot']>>, subject);
    measuredStableState = record.featureProof.before.digest === record.featureProof.after.digest && fingerprint(record.featureProof.providerBefore) === fingerprint(record.featureProof.providerAfter);
    const checked = checkFeatureProof(record.featureProof, subject, 'any');
    if (verified.priorProof && request.stage !== 'internal') assertTreatmentRetained(verified.priorProof, checked);
    record.outcome = 'verified';
    record.recoveryInstruction = prior ? 'Desired provider state and sampled behavior observed. This does not attribute the change to the original PATCH.' : '';
  } catch (error) {
    const failure = error instanceof LabError ? error : new LabError('EXPOSURE_EXECUTION_ERROR', 'Exposure execution or persistence failed. Inspect retained evidence.');
    record.outcome = (effectAttempted || prior) && !(measuredStableState && ['EXPOSURE_HOLD', 'EXPOSURE_WINDOW'].includes(failure.code)) ? 'unknown_outcome' : failure.outcome;
    record.reasonCodes = [failure.code]; record.recoveryInstruction = `${failure.message}${record.outcome === 'blocked' && measuredStableState ? ' Desired flag state is known but health is not verified. Independently authorize disable; no expansion evidence was issued.' : ''}${record.outcome === 'unknown_outcome' ? ` Reconcile exposure attempt ${prior?.record.attemptId ?? journal.attemptId}.` : ''}`;
  }
  try {
    record.finishedAt = new Date().toISOString(); const recordPath = await saveExposureRecord(journal, record); saved = true;
    if (prior && (record.outcome === 'verified' || record.outcome === 'blocked' && measuredStableState)) await releaseReconciledLock(root, request.target, prior.record.attemptId);
    return { outcome: record.outcome, reasonCodes: record.reasonCodes, recoveryInstruction: record.recoveryInstruction, attemptId: journal.attemptId, recordPath };
  } finally { if (release && (!effectAttempted || saved && record.outcome !== 'unknown_outcome')) await release(); }
}
/** Provider-assigned rule/clause IDs may be new; all behavioral fields must agree. */
export function matchesDesired(actual: z.infer<typeof flagStateSchema>, desired: z.infer<typeof flagStateSchema>) {
  const withoutIds = (state: z.infer<typeof flagStateSchema>) => ({ ...state, rules: state.rules.map(({ _id, ...rule }) => ({ ...rule, clauses: rule.clauses.map(({ _id, ...clause }) => clause), ...(rule.rollout ? { rollout: { ...rule.rollout, bucketBy: rule.rollout.bucketBy ?? 'key', kind: 'rollout' } } : {}) })) });
  return fingerprint(withoutIds(actual)) === fingerprint(withoutIds(desired));
}
export function createExposureEnvelope(record: ExposureRecord, operator: z.infer<typeof producerSchema>) {
  if (record.outcome !== 'verified' || !record.featureProof) throw new LabError('EXPOSURE_HOLD', 'Only a complete verified observation can become signed eligibility evidence.');
  const envelope = exposureEvidenceSchema.parse({ schemaVersion: 1, kind: 'exposure-evidence', record, context: { operator, policyDigest, exposurePolicyDigest, rosterDigest, requestDigest: record.requestDigest, notEvaluated: ['Production identities', 'Customer impact', 'Unobserved clients and in-flight effects', ...(record.featureProof.after.stage === 'internal' ? ['Ranked workspace latency: internal covers keyboard and compact only'] : [])] } });
  checkExposureEvidence(envelope, exposureSubject(record.request), record.featureProof.baselineP95Ms);
  return envelope;
}

function assertTreatmentRetained(prior: ReturnType<typeof checkFeatureProof>, current: ReturnType<typeof checkFeatureProof>) {
  const treatment = new Set(current.measurement.samples.filter(sample => sample.evaluation?.value).map(sample => sample.contextKey));
  if (prior.measurement.samples.some(sample => sample.evaluation?.value && !treatment.has(sample.contextKey))) throw new LabError('EXPOSURE_HOLD', 'Previously treated personas lost treatment. Hold expansion and inspect targeting identity.');
}
