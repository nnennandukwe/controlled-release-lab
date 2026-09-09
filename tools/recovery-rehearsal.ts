import { open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { fingerprint, Journal, LabError, loadRecord } from './evidence.js';
import { execute, type Operation } from './operations.js';
import type { Hosting } from './railway.js';

// A real staging deployment with one deliberately discarded successful response.
// The fixture is outside the operator: execute must discover recovery through
// its ordinary durable intent, provider reads and live observation path.
export async function rehearseRecovery(request: Operation, hosting: Hosting, root: string, transport: typeof fetch = fetch) {
  if (request.targetName !== 'staging' || request.operation !== 'deploy' || request.purpose !== 'recovery-rehearsal' || !request.apply) throw new LabError('REHEARSAL_TARGET_REJECTED', 'Use rehearse-recovery with staging, --apply and its approved rehearsal request.');
  const fixture = new Journal(join(root, 'rehearsals'));
  let receivedDeployment: string | undefined;
  const calls = { updateCalls: 0, deployCalls: 0, rollbackCalls: 0 };
  const wrapped: Hosting = {
    assertScope: () => hosting.assertScope(), snapshot: () => hosting.snapshot(), deployment: id => hosting.deployment(id),
    updateImage: async image => { calls.updateCalls++; await hosting.updateImage(image); },
    deploy: async () => {
      calls.deployCalls++;
      receivedDeployment = await hosting.deploy();
      await fixture.initialize();
      await fixture.append('injected-response-loss', { fixture: 'lost-deployment-response', simulatedFailure: true, deploymentId: receivedDeployment });
      throw new LabError('REHEARSAL_RESPONSE_LOST', 'Teaching fixture: a real successful deployment response was deliberately discarded. No mutation will be retried.', 'unknown_outcome');
    },
    rollback: async id => { calls.rollbackCalls++; await hosting.rollback(id); },
  };
  const original = await execute(request, wrapped, root, transport);
  if (original.outcome !== 'unknown_outcome' || !original.attemptId || !original.reasonCodes.includes('REHEARSAL_RESPONSE_LOST')) throw new LabError('REHEARSAL_NOT_EXERCISED', `The response-loss fixture did not execute as expected. Inspect ${original.recordPath}; reconcile any unknown outcome before another mutation.`, original.outcome === 'unknown_outcome' ? 'unknown_outcome' : 'blocked');
  const deploymentId = z.string().uuid().parse(receivedDeployment);
  const originalBytes = await readFile(original.recordPath);
  const originalRecord = await loadRecord(original.recordPath);
  const lock = join(root, 'locks', `${fingerprint([request.target.projectId, request.target.serviceId, request.target.environmentId])}.lock`);
  const intentFiles = await readdir(join(root, 'attempts', original.attemptId));
  if (originalRecord.deploymentId !== null || await readFile(lock, 'utf8') !== original.attemptId || !intentFiles.some(name => name.endsWith('-intent.json'))) throw new LabError('REHEARSAL_STATE_FAILED', 'The uncertain operation did not preserve its intent and lock without adopting the discarded response.');
  await fixture.append('unknown-outcome-preserved', { originalAttemptId: original.attemptId, originalRecordDigest: fingerprint(originalBytes.toString()), calls });

  // Wait only by reading. Reconcile itself receives no hidden deployment ID.
  const deadline = performance.now() + 120000;
  while (true) {
    const deployment = await hosting.deployment(deploymentId);
    const state = await hosting.snapshot();
    if (['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'].includes(deployment.status)) throw new LabError('REHEARSAL_DEPLOYMENT_FAILED', `Real deployment failed; reconcile attempt ${original.attemptId} and inspect Railway.`, 'unknown_outcome');
    if (deployment.status === 'SUCCESS' && state.latestId === deploymentId && state.active.length === 1 && state.active[0]!.id === deploymentId) break;
    if (performance.now() >= deadline) throw new LabError('REHEARSAL_SETTLE_TIMEOUT', `Real deployment did not settle; reconcile attempt ${original.attemptId}.`, 'unknown_outcome');
    await delay(2000);
  }
  const callsBeforeRecovery = fingerprint(calls);
  const recovered = await execute({ operation: 'reconcile', targetName: 'staging', target: request.target, attempt: original.attemptId, durationSeconds: 60, maxDurationSeconds: 90, rate: 2, maxRequests: 120 }, wrapped, root, transport);
  const originalRecordUnchanged = originalBytes.equals(await readFile(original.recordPath));
  let lockReleased = false;
  try { await readFile(lock); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; lockReleased = true; }
  if (!originalRecordUnchanged || fingerprint(calls) !== callsBeforeRecovery || calls.updateCalls !== 1 || calls.deployCalls !== 1 || calls.rollbackCalls !== 0) throw new LabError('REHEARSAL_STATE_FAILED', 'Recovery changed prior evidence or repeated a provider mutation.');
  const record = await loadRecord(recovered.recordPath);
  if (recovered.outcome === 'verified' && (!lockReleased || record.deploymentId !== deploymentId || record.requestedImage !== originalRecord.requestedImage || record.requestedSourceSha !== originalRecord.requestedSourceSha || record.configurationFingerprint !== originalRecord.configurationFingerprint)) throw new LabError('REHEARSAL_STATE_FAILED', 'Recovery did not establish the expected deployment, source, configuration and released lock.');
  const reportPath = join(fixture.directory, 'result.json');
  const result = { ...recovered, rehearsal: { fixture: 'lost-deployment-response', simulatedFailure: true, originalAttemptId: original.attemptId, deploymentId, ...calls, originalRecordUnchanged, lockReleased, reportPath } };
  const file = await open(reportPath, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(result, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
  return result;
}
