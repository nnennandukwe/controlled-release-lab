import { execFile } from 'node:child_process';
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { checkedVerifier, sha256 } from './setup-verifier.js';
import { changeReferenceSchema, loadRecord, LabError } from './evidence.js';
import { policy, policyDigest, requestValidity, producerSchema, releaseRequestSchema, deploymentEvidenceSchema, verifyRelease, github, assertProducer, createEnvelope, stagingObservationRequest } from './promotion.js';
import { execute } from './operations.js';
import { Railway } from './railway.js';
import { requireProtectedEnvironment } from './workflow-guard.js';

const releaseDir = 'work/release/current';
const invoke = promisify(execFile);
const numeric = (value: string | undefined) => z.string().regex(/^[1-9][0-9]*$/).parse(value);
export function currentOperator() {
  return producerSchema.parse({ sourceSha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
}
async function output(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
async function jsonFile(path: string, value: unknown) {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
async function download(runId: string, name: string, directory: string) {
  numeric(runId);
  // The exact artifact name includes its run attempt; never select a latest artifact.
  const artifacts = z.object({ total_count: z.number(), artifacts: z.array(z.object({ id: z.number(), name: z.string(), expired: z.boolean(), digest: z.string() })) }).parse(await github(`actions/runs/${runId}/artifacts?per_page=100`));
  if (artifacts.total_count !== artifacts.artifacts.length) throw new LabError('ARTIFACT_LOOKUP_INCOMPLETE', 'Artifact listing exceeded the bounded page; choose a run with an unambiguous artifact.');
  const matches = artifacts.artifacts.filter(artifact => artifact.name === name && !artifact.expired);
  if (matches.length !== 1) throw new LabError('ARTIFACT_UNAVAILABLE', `The exact ${name} artifact is missing, expired or ambiguous.`);
  await mkdir(directory, { recursive: true });
  try {
    await invoke(await checkedVerifier(), ['run', 'download', runId, '--repo', policy.repository, '--name', name, '--dir', directory], {
      timeout: 60000, maxBuffer: 1024 * 1024,
      env: { HOME: process.env.HOME, PATH: process.env.PATH, GH_TOKEN: process.env.GH_TOKEN, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' },
    });
  } catch { throw new LabError('ARTIFACT_UNAVAILABLE', 'Could not download the exact producer artifact. Restore access; no deployment was attempted.'); }
  return matches[0]!;
}
async function attachments(directory: string, names: string[]) {
  return Promise.all(names.map(async name => ({ name, sha256: sha256(await readFile(join(directory, name))) })));
}
async function writeRequest(directory: string, value: unknown) {
  const request = releaseRequestSchema.parse(value);
  await jsonFile(join(directory, 'release-request.json'), request);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Resolved ${request.operation}: ${request.targetName}\n\nPurpose: ${request.purpose}\n\nImage: \`${request.image}\`\n\nSource: \`${request.sourceSha}\`\n\nTarget: \`${request.target.environmentId}\`\n\nConfiguration: \`${request.configurationFingerprint}\`\n\nPolicy: \`${request.policyDigest}\`\n\nRequest: \`${sha256(await readFile(join(directory, 'release-request.json')))}\`\n\nChange: ${request.changeReference}\n\nRecovery deployment: ${request.rollbackDeploymentId ?? 'none'}\n\nExpires: ${request.expiresAt}\n`);
  return request;
}

export async function resolveRelease(environment: NodeJS.ProcessEnv = process.env) {
  const operation = z.enum(['doctor', 'deploy', 'observe', 'rollback', 'reconcile', 'rehearse-recovery']).parse(environment.LAB_OPERATION);
  const targetName = z.enum(['staging', 'live']).parse(environment.LAB_TARGET);
  if (operation === 'rehearse-recovery' && (targetName !== 'staging' || environment.LAB_APPLY !== 'true')) throw new LabError('REHEARSAL_TARGET_REJECTED', 'Recovery rehearsals require staging and apply=true.');
  const operator = currentOperator();
  // A fresh dispatch is required. Re-running a prior mutation must not replay it.
  if (operator.runAttempt !== '1') throw new LabError('NEW_DISPATCH_REQUIRED', 'Start a new workflow dispatch; reconcile an uncertain earlier attempt before another mutation.');
  if (operation === 'doctor' || operation === 'reconcile') { await output('has_request', 'false'); return; }
  const changeReference = changeReferenceSchema.parse(environment.LAB_CHANGE_REFERENCE);
  const base = 'artifacts/release-base';
  await mkdir(base, { recursive: true });
  const names = ['image.bundle.jsonl'];
  let restore: z.infer<typeof deploymentEvidenceSchema> | undefined;
  if (operation === 'rollback') {
    const run = numeric(environment.LAB_EVIDENCE_RUN), attempt = numeric(environment.LAB_EVIDENCE_ATTEMPT);
    await download(run, `lab-proof-${targetName}-${run}-${attempt}`, 'artifacts/recovery');
    await copyFile('artifacts/recovery/deployment-evidence.json', join(base, 'recovery-evidence.json'));
    await copyFile('artifacts/recovery/evidence.bundle.jsonl', join(base, 'recovery.bundle.jsonl'));
    // Candidate selectors only; verification of the envelope happens before apply.
    restore = deploymentEvidenceSchema.parse(JSON.parse(await readFile(join(base, 'recovery-evidence.json'), 'utf8')));
    if (environment.LAB_DEPLOYMENT && environment.LAB_DEPLOYMENT !== restore.record.deploymentId) throw new LabError('RECOVERY_EVIDENCE_REJECTED', 'Selected deployment differs from the saved observation.');
    if (environment.LAB_RESTORE_ATTEMPT && environment.LAB_RESTORE_ATTEMPT !== restore.record.attemptId) throw new LabError('RECOVERY_EVIDENCE_REJECTED', 'Selected attempt differs from the saved observation.');
    await jsonFile(join(base, 'restore-record.json'), restore.record);
    await writeFile(join(base, 'restore-record.json.sha256'), `${sha256(await readFile(join(base, 'restore-record.json')))}\n`, { flag: 'wx' });
    names.push('recovery-evidence.json', 'recovery.bundle.jsonl', 'restore-record.json');
  }
  const buildRun = restore?.context.build.runId ?? numeric(environment.LAB_BUILD_RUN);
  const buildAttempt = restore?.context.build.runAttempt ?? numeric(environment.LAB_BUILD_ATTEMPT);
  await download(buildRun, `build-record-${buildRun}-${buildAttempt}`, 'artifacts/build');
  const buildRecord = z.object({ schemaVersion: z.literal(2), image: z.string(), sourceSha: z.string(), buildRunId: z.string(), buildRunAttempt: z.string(), platform: z.literal('linux/amd64'), provenance: z.literal('github-attestation'), changeReference: changeReferenceSchema }).strict().parse(JSON.parse(await readFile('artifacts/build/build-record.json', 'utf8')));
  if (buildRecord.buildRunId !== buildRun || buildRecord.buildRunAttempt !== buildAttempt || (environment.LAB_IMAGE && environment.LAB_IMAGE !== buildRecord.image) || (environment.LAB_SOURCE_SHA && environment.LAB_SOURCE_SHA !== buildRecord.sourceSha)) throw new LabError('RELEASE_SUBJECT_MISMATCH', 'Image/source inputs differ from the selected producer record.');
  const build = producerSchema.parse({ sourceSha: buildRecord.sourceSha, runId: buildRun, runAttempt: buildAttempt });
  await assertProducer(build, 'image.yml');
  await copyFile('artifacts/build/image.bundle.jsonl', join(base, 'image.bundle.jsonl'));
  const request = await writeRequest(base, { schemaVersion: 1, purpose: operation === 'rehearse-recovery' ? 'recovery-rehearsal' : 'release', operation: operation === 'rehearse-recovery' ? 'deploy' : operation, targetName, target: policy.targets[targetName], image: buildRecord.image, sourceSha: build.sourceSha,
    build, operator, policyDigest, configurationFingerprint: policy.configurationFingerprints[targetName], changeReference,
    ...requestValidity(),
    attachments: await attachments(base, names), rollbackDeploymentId: restore?.record.deploymentId ?? null });
  await output('has_request', 'true');
  await output('needs_staging', String(operation === 'deploy' && targetName === 'live' && environment.LAB_APPLY === 'true'));
  await output('request_digest', sha256(await readFile(join(base, 'release-request.json'))));
}

export async function stagingProof() {
  await requireProtectedEnvironment({ ...process.env, LAB_GITHUB_ENVIRONMENT: 'staging' });
  const base = releaseRequestSchema.parse(JSON.parse(await readFile('artifacts/release-base/release-request.json', 'utf8')));
  const directory = 'artifacts/staging-request';
  await mkdir(directory, { recursive: true });
  await copyFile('artifacts/release-base/image.bundle.jsonl', join(directory, 'image.bundle.jsonl'));
  const request = await writeRequest(directory, stagingObservationRequest(base));
  const verified = await verifyRelease(directory);
  const result = await execute({ operation: 'observe', targetName: 'staging', target: request.target, image: request.image, sourceSha: request.sourceSha, changeReference: request.changeReference, durationSeconds: 60, maxDurationSeconds: 90, rate: 2, maxRequests: 120 }, new Railway(process.env.RAILWAY_PROJECT_TOKEN ?? '', request.target), 'work/staging-proof');
  if (result.outcome !== 'verified') throw new LabError('STAGING_EVIDENCE_INSUFFICIENT', `Staging proof failed: ${result.reasonCodes.join(',')}. Inspect the preserved observation.`);
  await jsonFile('artifacts/staging-proof/deployment-evidence.json', createEnvelope(await loadRecord(result.recordPath), request, verified.requestDigest));
}

export async function finalizeRelease() {
  const directory = 'artifacts/release-final';
  await mkdir(directory, { recursive: true });
  const base = releaseRequestSchema.parse(JSON.parse(await readFile('artifacts/release-base/release-request.json', 'utf8')));
  for (const name of await readdir('artifacts/release-base')) if (name !== 'release-request.json') await copyFile(join('artifacts/release-base', name), join(directory, name));
  const names = base.attachments.map(attachment => attachment.name);
  if (process.env.LAB_NEEDS_STAGING === 'true') {
    await copyFile('artifacts/staging-proof/deployment-evidence.json', join(directory, 'staging-evidence.json'));
    await copyFile('artifacts/staging-proof/evidence.bundle.jsonl', join(directory, 'staging.bundle.jsonl'));
    names.push('staging-evidence.json', 'staging.bundle.jsonl');
  }
  await writeRequest(directory, { ...base, attachments: await attachments(directory, names) });
}

export async function sealObservation() {
  const result = z.object({ outcome: z.string(), recordPath: z.string().optional() }).parse(JSON.parse(await readFile('work/last-result.json', 'utf8')));
  if (result.outcome !== 'verified' || !result.recordPath) { await output('sign', 'false'); return; }
  const record = await loadRecord(result.recordPath);
  const sourceDirectory = process.env.LAB_OPERATION === 'reconcile'
    ? join('work/attempts', z.string().uuid().parse(process.env.LAB_ATTEMPT), 'release') : releaseDir;
  let request = releaseRequestSchema.parse(JSON.parse(await readFile(join(sourceDirectory, 'release-request.json'), 'utf8')));
  if (process.env.LAB_OPERATION === 'reconcile') {
    // Reconciliation observes a previous effect; it does not borrow its expired
    // authorization. Authenticate the image again under a new observation request.
    request = releaseRequestSchema.parse({ ...request, purpose: 'release', operation: 'observe', operator: currentOperator(), rollbackDeploymentId: null,
      ...requestValidity(),
      attachments: request.attachments.filter(attachment => attachment.name === 'image.bundle.jsonl') });
    const directory = 'artifacts/reconcile-request';
    await mkdir(directory, { recursive: true });
    await copyFile(join(sourceDirectory, 'image.bundle.jsonl'), join(directory, 'image.bundle.jsonl'));
    await writeRequest(directory, request);
    await verifyRelease(directory);
  } else {
    await verifyRelease(sourceDirectory);
  }
  const bytes = `${JSON.stringify(request, null, 2)}\n`;
  await jsonFile('artifacts/observation/deployment-evidence.json', createEnvelope(record, request, sha256(bytes)));
  await output('sign', 'true');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    switch (process.argv[2]) {
      case 'resolve': await resolveRelease(); break;
      case 'proof': await stagingProof(); break;
      case 'finalize': await finalizeRelease(); break;
      case 'seal': await sealObservation(); break;
      default: throw new Error('Use resolve, proof, finalize or seal.');
    }
  } catch (error) {
    process.stderr.write(`${error instanceof LabError ? `${error.code}: ${error.message}` : 'Release preparation failed. Check validated inputs, artifact availability and protected workflow configuration.'}\n`);
    process.exitCode = 1;
  }
}
