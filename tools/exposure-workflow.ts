import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { currentOperator, download, jsonFile, attachments, output } from './release-artifacts.js';
import { policy, policyDigest, requestValidity, controlledDeploymentEvidenceSchema } from './promotion.js';
import { changeReferenceSchema, LabError } from './evidence.js';
import { LaunchDarkly, desiredFlagState } from './launchdarkly.js';
import { exposurePolicyDigest, rosterDigest } from './exposure-observe.js';
import { exposureRequestSchema, verifyExposureRelease, loadExposureRecord, createExposureEnvelope } from './exposure.js';
import { sha256 } from './setup-verifier.js';

const numeric = (input: string | undefined) => z.string().regex(/^[1-9][0-9]*$/).parse(input);
export async function resolveExposure(environment: NodeJS.ProcessEnv) {
  const operation = z.enum(['expose', 'disable', 'observe-exposure', 'reconcile-exposure']).parse(environment.LAB_OPERATION);
  const targetName = z.enum(['staging', 'live']).parse(environment.LAB_TARGET), operator = currentOperator();
  if (operator.runAttempt !== '1') throw new LabError('NEW_DISPATCH_REQUIRED', 'Use a fresh dispatch; reconcile uncertain prior effects without retrying them.');
  const rehearsal = environment.LAB_REHEARSE_RESPONSE_LOSS === 'true';
  if (rehearsal && (operation !== 'expose' || targetName !== 'staging' || environment.LAB_STAGE !== 'internal' || environment.LAB_APPLY !== 'true')) throw new LabError('REHEARSAL_TARGET_REJECTED', 'Flag recovery rehearsals require internal staging exposure and apply=true.');
  if (operation === 'reconcile-exposure') { await output('has_request', 'false'); return; }
  const run = numeric(environment.LAB_EVIDENCE_RUN), attempt = numeric(environment.LAB_EVIDENCE_ATTEMPT);
  const base = 'artifacts/release-base'; await mkdir(base, { recursive: true });
  await download(run, `lab-proof-${targetName}-${run}-${attempt}`, 'artifacts/exposure-baseline');
  const baseline = controlledDeploymentEvidenceSchema.parse(JSON.parse(await readFile('artifacts/exposure-baseline/deployment-evidence.json', 'utf8')));
  await copyFile('artifacts/exposure-baseline/deployment-evidence.json', join(base, 'deployment-evidence.json'));
  await copyFile('artifacts/exposure-baseline/evidence.bundle.jsonl', join(base, 'deployment.bundle.jsonl'));
  const build = baseline.context.build;
  await download(build.runId, `build-record-${build.runId}-${build.runAttempt}`, 'artifacts/exposure-build');
  await copyFile('artifacts/exposure-build/image.bundle.jsonl', join(base, 'image.bundle.jsonl'));
  const flags = new LaunchDarkly(environment.LD_READ_TOKEN ?? '', undefined, targetName); await flags.assertScope();
  const before = await flags.snapshot();
  const stage = operation === 'disable' ? 'off' : operation === 'expose' ? z.enum(['internal', '5']).parse(environment.LAB_STAGE) : before.stage;
  const names = ['image.bundle.jsonl', 'deployment-evidence.json', 'deployment.bundle.jsonl'];
  if (operation === 'expose' && stage === '5') {
    const priorRun = numeric(environment.LAB_EXPOSURE_RUN), priorAttempt = numeric(environment.LAB_EXPOSURE_ATTEMPT);
    await download(priorRun, `lab-proof-${targetName}-${priorRun}-${priorAttempt}`, 'artifacts/prior-exposure');
    await copyFile('artifacts/prior-exposure/exposure-evidence.json', join(base, 'prior-exposure.json'));
    await copyFile('artifacts/prior-exposure/evidence.bundle.jsonl', join(base, 'prior.bundle.jsonl'));
    names.push('prior-exposure.json', 'prior.bundle.jsonl');
  }
  const request = exposureRequestSchema.parse({ schemaVersion: 1, kind: 'exposure-request', purpose: rehearsal ? 'response-loss-rehearsal' : 'release', operation, stage, targetName, target: policy.targets[targetName],
    image: baseline.record.requestedImage, sourceSha: baseline.record.requestedSourceSha, deploymentId: baseline.record.deploymentId, configurationFingerprint: policy.configurationFingerprints[targetName],
    build, operator, policyDigest, exposurePolicyDigest, rosterDigest, before, desired: operation === 'observe-exposure' ? before.state : desiredFlagState(before, stage),
    changeReference: changeReferenceSchema.parse(environment.LAB_CHANGE_REFERENCE), ...requestValidity(), observation: { internal: 120, population: 1160, maxRequests: 1200, deadlineSeconds: 180 }, attachments: await attachments(base, names) });
  await jsonFile(join(base, 'exposure-request.json'), request);
  await verifyExposureRelease(base);
  if (environment.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(environment.GITHUB_STEP_SUMMARY, `### ${operation}: ${targetName} / ${stage}\n\nPurpose: ${request.purpose}\n\nImage: \`${request.image}\`\n\nDeployment: \`${request.deploymentId}\`\n\nFlag: default/catalog-ranked-search/${before.environmentKey} at version ${before.version}\n\nRequest: \`${sha256(await readFile(join(base, 'exposure-request.json')))}\`\n\nChange: ${request.changeReference}\n\nExpires: ${request.expiresAt}\n\nAudience: fixed public synthetic roster. PATCH acknowledgement alone cannot verify recovery.\n`);
  }
  await output('has_request', 'true'); await output('needs_staging', 'false');
}
export async function finalizeExposure() {
  const directory = 'artifacts/release-final'; await mkdir(directory, { recursive: true });
  for (const name of await readdir('artifacts/release-base')) await copyFile(join('artifacts/release-base', name), join(directory, name));
  await verifyExposureRelease(directory);
}
export async function sealExposure() {
  const result = z.object({ outcome: z.string(), recordPath: z.string().optional() }).parse(JSON.parse(await readFile('work/last-result.json', 'utf8')));
  if (result.outcome !== 'verified' || !result.recordPath) { await output('sign', 'false'); return; }
  const record = await loadExposureRecord(result.recordPath);
  // Reconciliation proves a new observation of the original desired state. Its
  // producer is this signing run; it does not relabel the original authorization.
  const envelope = createExposureEnvelope(record, currentOperator());
  await jsonFile('artifacts/observation/exposure-evidence.json', envelope);
  await output('subject_path', 'artifacts/observation/exposure-evidence.json'); await output('sign', 'true');
}
