import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fingerprint, Journal, LabError } from './evidence.js';
import { executeExposure, loadExposureRecord, type ExposureOperation } from './exposure.js';
import type { FlagProvider } from './launchdarkly.js';
import type { Hosting } from './railway.js';

/** Discard one real staging flag response; require ordinary read-only recovery. */
export async function rehearseExposureRecovery(input: ExposureOperation, hosting: Hosting, flags: FlagProvider, root: string, transport: typeof fetch = fetch) {
  if (input.operation !== 'expose' || input.targetName !== 'staging' || input.stage !== 'internal' || !input.apply || !input.rehearseResponseLoss) throw new LabError('REHEARSAL_TARGET_REJECTED', 'Use an explicitly approved internal staging exposure response-loss rehearsal.');
  const fixture = new Journal(join(root, 'flag-rehearsals'));
  let updateCalls = 0;
  const wrapped: FlagProvider = {
    assertScope: () => flags.assertScope(), snapshot: () => flags.snapshot(),
    update: async (before, stage) => {
      updateCalls++;
      if (updateCalls !== 1) throw new LabError('REHEARSAL_REPEATED_EFFECT', 'Recovery attempted another flag mutation.', 'unknown_outcome');
      const acknowledged = await flags.update(before, stage);
      await fixture.initialize();
      await fixture.append('injected-response-loss', { fixture: 'lost-flag-response', simulatedFailure: true, acknowledged });
      throw new LabError('REHEARSAL_RESPONSE_LOST', 'Teaching fixture: the real flag response was deliberately discarded. Reconcile without retrying PATCH.', 'unknown_outcome');
    },
  };
  const original = await executeExposure(input, hosting, wrapped, root, transport);
  if (original.outcome !== 'unknown_outcome' || !original.attemptId || !original.reasonCodes.includes('REHEARSAL_RESPONSE_LOST')) throw new LabError('REHEARSAL_NOT_EXERCISED', `The fixture did not execute as expected. Inspect ${original.recordPath} and reconcile any uncertain effect.`, original.outcome === 'unknown_outcome' ? 'unknown_outcome' : 'blocked');
  const originalBytes = await readFile(original.recordPath), originalRecord = await loadExposureRecord(original.recordPath);
  const target = originalRecord.request.target;
  const lock = join(root, 'locks', `${fingerprint([target.projectId, target.serviceId, target.environmentId])}.lock`);
  const intentFiles = await readdir(join(root, 'exposure', 'attempts', original.attemptId));
  if (originalRecord.acknowledged || !originalRecord.submitted || await readFile(lock, 'utf8') !== original.attemptId || !intentFiles.some(name => name.endsWith('-intent.json'))) throw new LabError('REHEARSAL_STATE_FAILED', 'The uncertain flag attempt must preserve its intent and lock without adopting the discarded response.', 'unknown_outcome');
  await fixture.append('unknown-outcome-preserved', { originalAttemptId: original.attemptId, originalRecordDigest: fingerprint(originalBytes.toString()), updateCalls });
  // No hidden provider response is passed into recovery, and no write is allowed.
  const recovered = await executeExposure({ operation: 'reconcile-exposure', targetName: 'staging', attempt: original.attemptId }, hosting, wrapped, root, transport);
  const originalRecordUnchanged = originalBytes.equals(await readFile(original.recordPath));
  let lockReleased = false;
  try { await readFile(lock); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; lockReleased = true; }
  if (!originalRecordUnchanged || updateCalls !== 1 || (recovered.outcome === 'verified' && !lockReleased)) throw new LabError('REHEARSAL_STATE_FAILED', 'Recovery changed history, repeated a flag effect, or left a verified operation locked.', 'unknown_outcome');
  const result = { ...recovered, rehearsal: { fixture: 'lost-flag-response', simulatedFailure: true, originalAttemptId: original.attemptId, updateCalls, originalRecordUnchanged, lockReleased } };
  await fixture.append('result', result);
  return result;
}
