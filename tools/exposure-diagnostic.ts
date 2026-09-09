import { z } from 'zod';
import { exposureEvidenceSchema, exposureSubject, serializeExposure, type ExposureRecord, checkExposureRequest, matchesDesired } from './exposure.js';
import { inspectFeatureProof } from './feature-proof.js';
import { exposurePolicyDigest, rosterDigest } from './exposure-observe.js';
import { policyDigest, producerSchema, boundedFile, github } from './promotion.js';
import { fingerprint, LabError } from './evidence.js';
import { verifyArtifact } from './attestation.js';
import { sha256 } from './setup-verifier.js';

export const exposureDiagnosticSchema = exposureEvidenceSchema.extend({ kind: z.literal('exposure-diagnostic'), eligible: z.literal(false) }).strict();

export function inspectExposureDiagnostic(input: unknown) {
  const envelope = exposureDiagnosticSchema.parse(input), record = envelope.record;
  if (record.outcome !== 'blocked' || !record.finishedAt || !record.featureProof || !record.reasonCodes.length
    || envelope.context.policyDigest !== policyDigest || envelope.context.exposurePolicyDigest !== exposurePolicyDigest || envelope.context.rosterDigest !== rosterDigest
    || envelope.context.requestDigest !== record.requestDigest || record.requestDigest !== sha256(serializeExposure(record.request))) throw new LabError('DIAGNOSTIC_REJECTED', 'Diagnostic must preserve a completed blocked observation and its exact request.');
  // Historical inspection authenticates the original request but grants no new authority.
  checkExposureRequest({ ...record.request, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() });
  const proof = inspectFeatureProof(record.featureProof, exposureSubject(record.request), 'any', false);
  if (proof.after.stage !== record.request.stage || !matchesDesired(proof.after.state, record.request.desired)) throw new LabError('DIAGNOSTIC_REJECTED', 'Diagnostic flag state differs from the recorded desired state.');
  return { envelope, assessment: proof.measurement };
}

export function createExposureDiagnostic(record: ExposureRecord, operator: z.infer<typeof producerSchema>) {
  const envelope = exposureDiagnosticSchema.parse({ schemaVersion: 1, kind: 'exposure-diagnostic', eligible: false, record,
    context: { operator, policyDigest, exposurePolicyDigest, rosterDigest, requestDigest: record.requestDigest, notEvaluated: ['Release eligibility', 'Customer impact', 'Unobserved clients and in-flight effects'] } });
  inspectExposureDiagnostic(envelope);
  return envelope;
}

/** Failed runs are admissible only here, never through the eligibility producer verifier. */
export async function verifyExposureDiagnostic(directory: string, targetName: 'staging' | 'live') {
  const file = await boundedFile(directory, 'exposure-diagnostic.json'), bundle = await boundedFile(directory, 'evidence.bundle.jsonl');
  const candidate = z.object({ context: z.object({ operator: producerSchema }) }).parse(JSON.parse(file.bytes.toString()));
  const operator = candidate.context.operator;
  const signed = await verifyArtifact({ subject: file.path, bundle: bundle.path, workflow: 'operate.yml', sourceSha: operator.sourceSha });
  if (signed.runId !== operator.runId || signed.runAttempt !== operator.runAttempt) throw new LabError('PROVENANCE_REJECTED', 'Diagnostic signer differs from its exact producer attempt.');
  const run = z.object({ head_sha: z.string(), head_branch: z.string(), path: z.string(), event: z.string(), status: z.string(), conclusion: z.string(), run_attempt: z.number() })
    .parse(await github(`actions/runs/${operator.runId}/attempts/${operator.runAttempt}`));
  if (run.head_sha !== operator.sourceSha || run.head_branch !== 'main' || run.path !== '.github/workflows/operate.yml' || run.event !== 'workflow_dispatch'
    || run.run_attempt !== Number(operator.runAttempt) || run.status !== 'completed' || !['success', 'failure'].includes(run.conclusion)) throw new LabError('PROVENANCE_REJECTED', 'Diagnostic must come from a completed trusted operator run.');
  const comparison = z.object({ merge_base_commit: z.object({ sha: z.string() }) }).parse(await github(`compare/${operator.sourceSha}...main`));
  if (comparison.merge_base_commit.sha !== operator.sourceSha) throw new LabError('PROVENANCE_REJECTED', 'Diagnostic producer is not in protected main history.');
  const jobs = z.object({ total_count: z.number(), jobs: z.array(z.object({ name: z.string(), status: z.string(), steps: z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() })) })) })
    .parse(await github(`actions/runs/${operator.runId}/attempts/${operator.runAttempt}/jobs?per_page=100`));
  const operators = jobs.jobs.filter(job => job.name === 'operate');
  if (jobs.total_count !== jobs.jobs.length || operators.length !== 1 || operators[0]!.status !== 'completed'
    || ['Seal observation evidence', 'Attest observation evidence', 'Upload signed observation'].some(name => {
      const steps = operators[0]!.steps.filter(step => step.name === name);
      return steps.length !== 1 || steps[0]!.status !== 'completed' || steps[0]!.conclusion !== 'success';
    })) throw new LabError('PROVENANCE_REJECTED', 'Diagnostic sealing, attestation and upload must have succeeded in the exact operator job.');
  const checked = inspectExposureDiagnostic(JSON.parse(file.bytes.toString()));
  if (checked.envelope.record.request.targetName !== targetName) throw new LabError('DIAGNOSTIC_REJECTED', 'Diagnostic belongs to another target.');
  return { ...checked, evidenceDigest: sha256(file.bytes), authorized: false as const };
}
