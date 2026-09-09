import { z } from 'zod';
import { fingerprint, imageSchema, targetSchema, LabError } from './evidence.js';
import { flagSnapshotSchema, validateFlagSnapshot, type FlagProvider } from './launchdarkly.js';
import { exposureSubjectSchema, exposurePolicyDigest, rosterDigest, observeExposure, checkExposureMeasurement, type ExposureSample } from './exposure-observe.js';
import type { Hosting, Snapshot } from './railway.js';

export const featureSubjectSchema = exposureSubjectSchema.extend({ image: imageSchema, configurationFingerprint: z.string().regex(/^[a-f0-9]{64}$/), target: targetSchema }).strict();
export type FeatureSubject = z.infer<typeof featureSubjectSchema>;
export const featureProofSchema = z.object({ policyDigest: z.string(), rosterDigest: z.string(), subject: featureSubjectSchema, before: flagSnapshotSchema, after: flagSnapshotSchema, baselineP95Ms: z.number().finite().nonnegative(), measurement: z.unknown(), providerBefore: z.unknown(), providerAfter: z.unknown() }).strict();
export type FeatureProof = z.infer<typeof featureProofSchema>;
export function assertServing(snapshot: Snapshot, subject: FeatureSubject) {
  if (snapshot.configurationFingerprint !== subject.configurationFingerprint || snapshot.sourceImage !== subject.image || snapshot.latestId !== subject.deploymentId || snapshot.active.length !== 1 || snapshot.active[0]?.id !== subject.deploymentId || snapshot.active[0]?.image !== subject.image || snapshot.active[0]?.status !== 'SUCCESS'
    || snapshot.active[0]?.projectId !== subject.target.projectId || snapshot.active[0]?.serviceId !== subject.target.serviceId || snapshot.active[0]?.environmentId !== subject.target.environmentId) throw new LabError('EXPOSURE_SUBJECT_CHANGED', 'The current deployment, image or configuration differs from the approved exposure subject.');
}
export function checkFeatureProof(input: unknown, subject: FeatureSubject, requirement: 'off' | 'both' | 'any', fresh = true) {
  const proof = featureProofSchema.parse(input);
  const before = validateFlagSnapshot(proof.before, subject.targetName), after = validateFlagSnapshot(proof.after, subject.targetName);
  if (proof.policyDigest !== exposurePolicyDigest || proof.rosterDigest !== rosterDigest || fingerprint(proof.subject) !== fingerprint(subject) || before.digest !== after.digest
    || (requirement === 'off' && before.stage !== 'off') || (requirement === 'both' && before.stage === 'off')) throw new LabError('FEATURE_PROOF_REJECTED', 'Feature evidence has a different policy, subject, targeting state or variation coverage.');
  if (fingerprint(proof.providerBefore) !== fingerprint(proof.providerAfter)) throw new LabError('FEATURE_PROOF_REJECTED', 'Provider identity changed during the feature observation.');
  // Parse provider evidence instead of trusting its serialized type assertion.
  const deployment = z.object({ id: z.string().uuid(), projectId: z.string(), serviceId: z.string(), environmentId: z.string(), status: z.string(), image: z.string().nullable(), canRollback: z.boolean(), metadataKeys: z.array(z.string()) });
  const provider = z.object({ sourceImage: z.string().nullable(), latestId: z.string().uuid().nullable(), active: z.array(deployment), configurationFingerprint: z.string() });
  assertServing(provider.parse(proof.providerBefore), subject); assertServing(provider.parse(proof.providerAfter), subject);
  const measurement = checkExposureMeasurement(proof.measurement, before, subject, proof.baselineP95Ms, fresh);
  return { ...proof, measurement };
}
export async function measureFeatureProof(hosting: Hosting, flags: FlagProvider, subject: FeatureSubject, baselineP95Ms: number, onSample: (sample: ExposureSample) => Promise<void>, transport: typeof fetch = fetch): Promise<FeatureProof> {
  const providerBefore = await hosting.snapshot(); assertServing(providerBefore, subject);
  const before = await flags.snapshot();
  const measurement = await observeExposure(subject.target.url, before, subject, baselineP95Ms, onSample, transport);
  const after = await flags.snapshot(), providerAfter = await hosting.snapshot();
  // Preserve failed evidence too; the caller must check it before signing eligibility.
  return { policyDigest: exposurePolicyDigest, rosterDigest, subject, before, after, baselineP95Ms, measurement, providerBefore, providerAfter };
}
