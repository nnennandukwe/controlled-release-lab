import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Hosting, Snapshot } from './railway.js';
import { acquireLock, fingerprint, imageSchema, Journal, LabError, loadAttempt, loadRecord, releaseReconciledLock, targetSchema, type EvidenceRecord, type Target } from './evidence.js';
import { observe, observationOptionsSchema } from './observe.js';
export type Operation = { operation: 'deploy' | 'rollback' | 'observe' | 'reconcile'; targetName: 'staging' | 'live'; target: Target; image?: string; sourceSha?: string; deploymentId?: string; restoreRecord?: string; attempt?: string; apply?: boolean; durationSeconds?: number; rate?: number; maxRequests?: number };
export async function execute(request: Operation, hosting: Hosting, root: string, transport: typeof fetch = fetch) {
  targetSchema.parse(request.target);
  const mutating = request.operation === 'deploy' || request.operation === 'rollback';
  if (request.operation === 'deploy') { imageSchema.parse(request.image); z.string().regex(/^[a-f0-9]{40}$/).parse(request.sourceSha); }
  if (request.operation === 'rollback') z.string().uuid().parse(request.deploymentId);
  const options = observationOptionsSchema.parse({ durationSeconds: request.durationSeconds, rate: request.rate, maxRequests: request.maxRequests });
  let prior: EvidenceRecord | undefined;
  if (request.operation === 'rollback') {
    if (!request.restoreRecord) throw new LabError('RESTORE_RECORD_REQUIRED', 'Supply --restore-record for a verified earlier deployment and its compatible configuration.');
    prior = await loadRecord(request.restoreRecord);
    if (prior.outcome !== 'verified' || prior.deploymentId !== request.deploymentId || !prior.requestedImage || !prior.requestedSourceSha || !prior.configurationFingerprint) throw new LabError('INVALID_RESTORE_RECORD', 'Use a verified deployment record matching the rollback target.');
  }
  if (request.operation === 'reconcile') {
    if (!request.attempt) throw new LabError('ATTEMPT_REQUIRED', 'Supply the original --attempt UUID to reconcile.');
    prior = await loadAttempt(root, request.attempt);
    if (prior.outcome !== 'unknown_outcome') throw new LabError('NOT_UNCERTAIN', 'Only an unknown outcome can be reconciled; inspect the completed record.');
  }
  if (prior && (fingerprint(prior.target) !== fingerprint(request.target) || prior.targetName !== request.targetName)) throw new LabError('RESTORE_TARGET_MISMATCH', 'The evidence belongs to a different target. Use evidence for this exact environment.');
  await hosting.assertScope();
  if (mutating && !request.apply) {
    await hosting.snapshot();
    return { outcome: 'preview', reasonCodes: ['APPLY_REQUIRED'], recordPath: '', image: request.image ?? prior?.requestedImage, target: request.targetName };
  }
  const journal = new Journal(root);
  const release = mutating ? await acquireLock(root, request.target, journal.attemptId) : undefined;
  let mutationStarted = false;
  let recordSaved = false;
  const record: EvidenceRecord = {
    schemaVersion: 1, attemptId: journal.attemptId, operation: request.operation, targetName: request.targetName, target: request.target,
    requestedImage: request.operation === 'deploy' ? request.image! : prior?.requestedImage ?? null, requestedSourceSha: request.operation === 'deploy' ? request.sourceSha! : prior?.requestedSourceSha ?? null,
    rollbackTarget: request.deploymentId ?? prior?.rollbackTarget ?? null, deploymentId: request.operation === 'reconcile' ? prior?.deploymentId ?? null : null,
    configurationFingerprint: prior?.configurationFingerprint ?? null, startedAt: new Date().toISOString(), finishedAt: null,
    outcome: 'unknown_outcome', reasonCodes: [], recoveryInstruction: '', observations: [],
  };
  try {
    await journal.initialize();
    const before = await hosting.snapshot();
    record.observations.push({ phase: 'before', snapshot: before });
    if (before.active.length > 1 || (before.latestId && before.active.length && !before.active.some(item => item.id === before.latestId))) throw new LabError('UNSTABLE_DEPLOYMENT', 'Wait for the active deployment to settle before operating.');
    if (!record.configurationFingerprint) record.configurationFingerprint = before.configurationFingerprint;
    if (request.operation === 'rollback') {
      const target = await hosting.deployment(request.deploymentId!);
      if (!target.canRollback) throw new LabError('ROLLBACK_UNAVAILABLE', 'The provider cannot roll back to this deployment. Select a retained eligible deployment or authorize a separate digest restoration.');
      if (target.image !== record.requestedImage) throw new LabError('ROLLBACK_IMAGE_MISMATCH', 'Rollback target metadata does not match the saved image.');
    }
    await journal.append('intent', record);
    if (mutating) {
      const fresh = await hosting.snapshot();
      if (fingerprint(fresh) !== fingerprint(before)) throw new LabError('STATE_CHANGED', 'Provider state changed after preflight. Inspect it before creating a new attempt.');
      mutationStarted = true;
      if (request.operation === 'deploy') {
        await hosting.updateImage(record.requestedImage!);
        const configured = await hosting.snapshot();
        await journal.append('image-source', configured);
        if (configured.sourceImage !== record.requestedImage) throw new LabError('IMAGE_REFERENCE_NOT_PRESERVED', 'Railway did not preserve the immutable reference. Reconcile this change and reassess host compatibility.');
        // A source change may already have created a deployment. Do not issue a
        // second trigger when the provider reports that deployment.
        record.deploymentId = configured.latestId && configured.latestId !== before.latestId ? configured.latestId : await hosting.deploy();
      } else record.deploymentId = await hosting.rollback(request.deploymentId!);
      await journal.append('accepted', { deploymentId: record.deploymentId });
    }
    if (request.operation === 'observe' || (request.operation === 'reconcile' && !record.deploymentId)) {
      if (before.active.length !== 1) throw new LabError('NO_SINGLE_ACTIVE_DEPLOYMENT', 'Observe or reconcile after one deployment is actively serving.');
      record.deploymentId = before.active[0]!.id;
    }
    const deadline = performance.now() + 120000;
    let serving: Snapshot;
    while (true) {
      const deployment = await hosting.deployment(record.deploymentId!);
      await journal.append('deployment', deployment);
      if (['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'].includes(deployment.status)) throw new LabError('DEPLOYMENT_FAILED', 'Deployment failed. Inspect Railway and authorize recovery to a known-good image.', 'failed');
      if (deployment.status === 'SUCCESS') {
        if (!deployment.image) throw new LabError('IMAGE_EVIDENCE_UNAVAILABLE', 'Deployment metadata has no digest-qualified meta.image. Capture the provider contract before claiming image verification.');
        if (record.requestedImage && deployment.image !== record.requestedImage) throw new LabError('DEPLOYED_IMAGE_MISMATCH', 'The deployment is running a different image. Reconcile before promotion.');
        if (!record.requestedImage) record.requestedImage = deployment.image;
        serving = await hosting.snapshot();
        if (serving.active.length === 1 && serving.active[0]!.id === deployment.id) break;
      }
      if (performance.now() >= deadline) throw new LabError('DEPLOYMENT_TIMEOUT', 'Deployment observation timed out. Reconcile this attempt before retrying.');
      await delay(2000);
    }
    if (serving.sourceImage !== record.requestedImage) throw new LabError('CONFIGURED_IMAGE_MISMATCH', 'The configured image differs from the active image. Keep this operation unresolved until both match the intended digest.');
    if (serving.configurationFingerprint !== record.configurationFingerprint) throw new LabError('CONFIGURATION_MISMATCH', 'The serving configuration differs from the expected baseline. Inspect restored variables and service settings.');
    const measured = await observe(request.target.url, options, sample => journal.append('request', sample), transport);
    record.observations.push({ phase: 'measurement', ...measured });
    const after = await hosting.snapshot();
    record.observations.push({ phase: 'after', snapshot: after });
    if (fingerprint(after) !== fingerprint(serving)) throw new LabError('STATE_CHANGED_DURING_OBSERVATION', 'The deployment or configuration changed during observation. Collect a new stable window.');
    if (measured.outcome !== 'verified') throw new LabError(measured.reasonCodes.join(','), 'The observation failed or was incomplete. Inspect raw requests before repeating the window.', measured.outcome as 'failed' | 'blocked');
    if (measured.samples.some(sample => sample.deploymentId !== record.deploymentId || sample.environment !== request.targetName || (record.requestedSourceSha && sample.sourceSha !== record.requestedSourceSha))) throw new LabError('LIVE_IDENTITY_MISMATCH', 'Live responses do not match the selected source, environment, and deployment. Check the target URL and active service.');
    record.outcome = 'verified';
    record.recoveryInstruction = request.operation === 'reconcile' ? 'Desired provider state and live behavior observed; this does not prove which earlier request caused it.' : '';
  } catch (error) {
    const failure = error instanceof LabError ? error : new LabError('EXECUTION_ERROR', 'Execution or evidence persistence failed. Inspect the retained attempt files and reconcile any mutation.');
    record.outcome = mutationStarted && failure.outcome !== 'failed' ? 'unknown_outcome' : failure.outcome;
    record.reasonCodes = [failure.code];
    record.recoveryInstruction = `${failure.message}${record.outcome === 'unknown_outcome' ? ` Reconcile attempt ${journal.attemptId}.` : ''}`;
  }
  try {
    record.finishedAt = new Date().toISOString();
    const recordPath = await journal.finish(record);
    recordSaved = true;
    if (record.outcome === 'verified' && request.operation === 'reconcile') await releaseReconciledLock(root, request.target, request.attempt!);
    return { outcome: record.outcome, reasonCodes: record.reasonCodes, recoveryInstruction: record.recoveryInstruction, recordPath, attemptId: journal.attemptId };
  } finally {
    if (release && (!mutationStarted || (recordSaved && record.outcome !== 'unknown_outcome'))) await release();
  }
}
