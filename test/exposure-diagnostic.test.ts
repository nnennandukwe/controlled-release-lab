import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi, afterEach } from 'vitest';
import { featureFixture } from './helpers/feature-fixture.js';
import { policy, policyDigest, requestValidity } from '../tools/promotion.js';
import { exposureRequestSchema, serializeExposure, createExposureEnvelope } from '../tools/exposure.js';
import { exposurePolicyDigest, rosterDigest, type ExposureSample } from '../tools/exposure-observe.js';
import { desiredFlagState } from '../tools/launchdarkly.js';
import { createExposureDiagnostic, verifyExposureDiagnostic } from '../tools/exposure-diagnostic.js';
import { checkExposureEvidence } from '../tools/exposure.js';
import { assertProducer } from '../tools/promotion.js';
import { baselineQueries } from './helpers/feature-fixture.js';
import { sha256 } from '../tools/setup-verifier.js';
import { runCli } from '../tools/lab.js';

const operator = { sourceSha: 'c'.repeat(40), runId: '20', runAttempt: '1' };
export function diagnosticFixture() {
  const subject = { sourceSha: 'a'.repeat(40), deploymentId: randomUUID(), targetName: 'staging' as const, target: policy.targets.staging,
    image: `ghcr.io/${policy.repository}@sha256:${'b'.repeat(64)}`, configurationFingerprint: policy.configurationFingerprints.staging };
  const proof = featureFixture(subject, '5');
  for (const sample of (proof.measurement as { samples: ExposureSample[] }).samples) if (sample.query === 'workspace' && sample.evaluation?.value) sample.durationMs = 1000;
  const request = exposureRequestSchema.parse({ schemaVersion: 1, kind: 'exposure-request', purpose: 'release', operation: 'expose', stage: '5', ...subject,
    build: { ...operator, sourceSha: subject.sourceSha, runId: '10' }, operator, policyDigest, exposurePolicyDigest, rosterDigest,
    before: featureFixture(subject, 'internal').before, desired: desiredFlagState(featureFixture(subject, 'internal').before, '5'), changeReference: 'BUILD-4-FIXTURE', ...requestValidity(),
    observation: { internal: 120, population: 1160, maxRequests: 1200, deadlineSeconds: 180 },
    attachments: ['image.bundle.jsonl', 'deployment-evidence.json', 'deployment.bundle.jsonl'].map(name => ({ name, sha256: 'd'.repeat(64) })) });
  return { schemaVersion: 1 as const, kind: 'exposure-record' as const, attemptId: randomUUID(), operation: 'expose' as const, request,
    requestDigest: sha256(serializeExposure(request)), startedAt: new Date(Date.now() - 121000).toISOString(), finishedAt: new Date().toISOString(),
    outcome: 'blocked' as const, reasonCodes: ['EXPOSURE_HOLD'], recoveryInstruction: 'Independently authorize disable.',
    submitted: true, acknowledged: true, featureProof: proof, authorization: { fixture: 'protected test run' }, reconciles: null };
}

async function seal(options: { stale?: boolean; missingChecksum?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'exposure-seal-'));
  try {
    const record = diagnosticFixture(), bytes = JSON.stringify(record);
    const recordPath = join(directory, 'work/exposure/attempts', record.attemptId, 'exposure-record.json');
    await mkdir(join(recordPath, '..'), { recursive: true });await writeFile(recordPath, bytes);
    if (!options.missingChecksum) await writeFile(`${recordPath}.sha256`, sha256(bytes));
    await writeFile(join(directory, 'work/last-result.json'), JSON.stringify({ outcome: 'blocked', recordPath, operation: 'expose', operator: { ...operator, runId: options.stale ? '19' : '20' } }));
    const output = join(directory, 'output');
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../tools/release-workflow.ts', import.meta.url)), 'seal'], {
      cwd: directory, encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, GITHUB_SHA: operator.sourceSha, GITHUB_RUN_ID: operator.runId, GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: output, LAB_TARGET: 'staging', LAB_OPERATION: 'expose' },
    });
    return { result, output: await readFile(output, 'utf8').catch(() => ''), envelope: await readFile(join(directory, 'artifacts/observation/exposure-diagnostic.json'), 'utf8').then(JSON.parse).catch(() => null) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

it('the real seal CLI preserves a blocked observation as a diagnostic, never as eligibility', async () => {
  const sealed = await seal();
  expect(sealed.result.stderr).toBe('');expect(sealed.result.status).toBe(0);expect(sealed.output).toContain('sign=true');
  expect(sealed.output).toContain('artifact_kind=diagnostic');
  expect(sealed.envelope).toMatchObject({ kind: 'exposure-diagnostic', eligible: false, record: { outcome: 'blocked' } });
});
it.each([{ stale: true }, { missingChecksum: true }])('the seal CLI rejects stale or incomplete state: %j', async options => {
  const sealed = await seal(options);
  expect(sealed.result.status).toBe(1);expect(sealed.output).not.toContain('sign=true');expect(sealed.envelope).toBeNull();
});

vi.mock('../tools/attestation.js', () => ({ repository: 'nnennandukwe/controlled-release-lab', issuer: 'https://token.actions.githubusercontent.com', verifyArtifact: async () => ({ runId: '20', runAttempt: '1', statements: [] }) }));
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('authenticates diagnostics and retains the blocked decision independently of feature health, retentionHold=%s', async retentionHold => {
  const directory = await mkdtemp(join(tmpdir(), 'diagnostic-verify-'));
  let upload = 'success';
  try {
    const record = diagnosticFixture();
    if (retentionHold) { record.featureProof = featureFixture(record.featureProof.subject, '5');record.recoveryInstruction = 'Previously treated personas lost treatment. Independently authorize disable.'; }
    const envelope = createExposureDiagnostic(record, operator);
    await writeFile(join(directory, 'exposure-diagnostic.json'), JSON.stringify(envelope));
    await writeFile(join(directory, 'evidence.bundle.jsonl'), 'native verifier test seam');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/compare/')) return Response.json({ merge_base_commit: { sha: operator.sourceSha } });
      if (url.includes('/jobs?')) return Response.json({ total_count: 1, jobs: [{ name: 'operate', status: 'completed', steps: ['Seal observation evidence', 'Attest observation evidence', 'Upload signed observation'].map(name => ({ name, status: 'completed', conclusion: name === 'Upload signed observation' ? upload : 'success' })) }] });
      return Response.json({ head_sha: operator.sourceSha, head_branch: 'main', path: '.github/workflows/operate.yml', event: 'workflow_dispatch', run_attempt: 1, status: 'completed', conclusion: 'failure' });
    }));
    const verified = await verifyExposureDiagnostic(directory, 'staging');
    expect(verified.authorized).toBe(false);
    let stdout = '', stderr = '';
    expect(await runCli(['verify-diagnostic', '--target', 'staging', '--release-dir', directory], {}, text => { stdout += text; }, text => { stderr += text; })).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ outcome: 'diagnostic_authenticated', authorized: false, recordedOutcome: 'blocked', recordedReasonCodes: ['EXPOSURE_HOLD'], recoveryInstruction: record.recoveryInstruction, featureAssessment: { outcome: retentionHold ? 'verified' : 'blocked', reasonCodes: retentionHold ? [] : expect.arrayContaining(['QUERY_LATENCY_HOLD']) } });
    expect(result.featureAssessment.samples).toBeUndefined();expect(stderr).toContain('does not authorize mutation');
    await expect(assertProducer(operator, 'operate.yml')).rejects.toThrow('did not complete successfully');
    expect(() => checkExposureEvidence(envelope, envelope.record.featureProof!.subject, 20, true, baselineQueries)).toThrow();
    await expect(verifyExposureDiagnostic(directory, 'live')).rejects.toMatchObject({ code: 'DIAGNOSTIC_REJECTED' });
    upload = 'failure';
    await expect(verifyExposureDiagnostic(directory, 'staging')).rejects.toThrow('sealing, attestation and upload');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('the public verifier authenticates completion only for healthy signed authorized 100% exposure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'completion-verify-'));
  let conclusion = 'success';
  try {
    const record = diagnosticFixture(), subject = record.featureProof.subject;
    record.request.stage = '100';record.request.before = featureFixture(subject, '25').before;
    record.request.desired = desiredFlagState(record.request.before, '100');
    record.requestDigest = sha256(serializeExposure(record.request));record.featureProof = featureFixture(subject, '100');
    const healthy = { ...record, outcome: 'verified' as const, reasonCodes: [], recoveryInstruction: '' };
    expect(() => createExposureEnvelope({ ...healthy, featureProof: { ...healthy.featureProof, baselineQueryP95Ms: null } }, operator)).toThrow('Exposure evidence is incomplete');
    const save = async () => writeFile(join(directory, 'exposure-evidence.json'), JSON.stringify(createExposureEnvelope(healthy, operator)));
    await save();await writeFile(join(directory, 'evidence.bundle.jsonl'), 'native verifier test seam');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).includes('/compare/')
      ? Response.json({ merge_base_commit: { sha: operator.sourceSha } })
      : Response.json({ head_sha: operator.sourceSha, head_branch: 'main', path: '.github/workflows/operate.yml', event: 'workflow_dispatch', run_attempt: 1, status: 'completed', conclusion })));
    const verify = async () => {
      let output = '';
      const code = await runCli(['verify-exposure', '--target', 'staging', '--release-dir', directory], {}, text => { output += text; }, () => {});
      return { code, result: JSON.parse(output) };
    };
    expect(await verify()).toMatchObject({ code: 0, result: { outcome: 'exposure_verified', stage: '100', completionEvidence: true, authorized: false } });
    conclusion = 'failure';expect((await verify()).code).toBe(2);conclusion = 'success';
    const monitoring = { ...healthy, operation: 'observe-exposure' as const, request: { ...healthy.request, operation: 'observe-exposure' as const, before: healthy.featureProof.before, desired: healthy.featureProof.before.state } };
    monitoring.requestDigest = sha256(serializeExposure(monitoring.request));
    await writeFile(join(directory, 'exposure-evidence.json'), JSON.stringify(createExposureEnvelope(monitoring, operator)));
    expect(await verify()).toMatchObject({ code: 0, result: { completionEvidence: false, authorized: false } });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
