import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import { LabError } from './evidence.js';
import { checkedVerifier, sha256 } from './setup-verifier.js';
import policy from '../config/release-policy.json' with { type: 'json' };

export const repository = 'nnennandukwe/controlled-release-lab';
export const issuer = 'https://token.actions.githubusercontent.com';
const executeFile = promisify(execFile);
const requestSchema = z.object({ subject: z.string().min(1), bundle: z.string().min(1), workflow: z.enum(['image.yml', 'operate.yml']), sourceSha: z.string().regex(/^[a-f0-9]{40}$/) }).strict();
export type ArtifactRequest = z.infer<typeof requestSchema>;
const resultsSchema = z.array(z.object({ verificationResult: z.object({
  signature: z.object({ certificate: z.object({ issuer: z.literal(issuer), sourceRepositoryIdentifier: z.literal(policy.repositoryId), sourceRepositoryOwnerIdentifier: z.literal(policy.ownerId), runInvocationURI: z.string(), buildTrigger: z.literal('workflow_dispatch') }) }),
  statement: z.object({
    predicateType: z.literal('https://slsa.dev/provenance/v1'),
    subject: z.array(z.object({ name: z.string(), digest: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }) })).length(1),
    predicate: z.object({ runDetails: z.object({ metadata: z.object({ invocationId: z.string() }) }) }),
  }),
}) })).min(1).max(10);

export function verifiedStatements(output: string, digest: string) {
  const results = resultsSchema.parse(JSON.parse(output));
  if (results.some(result => result.verificationResult.statement.subject[0]!.digest.sha256 !== digest)) throw new LabError('PROVENANCE_REJECTED', 'Verified subject differs from the requested artifact.');
  if (results.some(result => result.verificationResult.statement.predicate.runDetails.metadata.invocationId !== result.verificationResult.signature.certificate.runInvocationURI)) throw new LabError('PROVENANCE_REJECTED', 'Producer claim differs from its certificate identity.');
  const invocations = new Set(results.map(result => result.verificationResult.signature.certificate.runInvocationURI));
  if (invocations.size !== 1) throw new LabError('PROVENANCE_REJECTED', 'Conflicting provenance producers. Select an unambiguous bundle.');
  const invocation = [...invocations][0]!;
  const match = invocation.match(new RegExp(`^https://github.com/${repository}/actions/runs/([0-9]+)/attempts/([0-9]+)$`));
  if (!match) throw new LabError('PROVENANCE_REJECTED', 'Provenance has no exact producer run and attempt.');
  return { runId: match[1]!, runAttempt: match[2]!, statements: results.map(result => result.verificationResult.statement) };
}

export async function verifyArtifact(input: ArtifactRequest) {
  const request = requestSchema.parse(input);
  try { if ((await stat(request.bundle)).size > 10 * 1024 * 1024) throw new Error(); }
  catch { throw new LabError('PROVENANCE_REQUIRED', 'Supply an intact attestation bundle (maximum 10 MiB) from the trusted publisher.'); }
  const digest = request.subject.startsWith('oci://')
    ? z.string().regex(/^[a-f0-9]{64}$/).parse(request.subject.split('@sha256:')[1])
    : sha256(await readFile(request.subject));
  try {
    const { stdout } = await executeFile(await checkedVerifier(), ['attestation', 'verify', request.subject,
      '--bundle', request.bundle, '--repo', repository,
      '--cert-identity', `https://github.com/${repository}/.github/workflows/${request.workflow}@refs/heads/main`,
      '--cert-oidc-issuer', issuer, '--source-ref', 'refs/heads/main', '--source-digest', request.sourceSha,
      '--deny-self-hosted-runners', '--format', 'json'], {
      timeout: 60000, maxBuffer: 10 * 1024 * 1024,
      env: { HOME: process.env.HOME, PATH: process.env.PATH, GH_TOKEN: process.env.GH_TOKEN, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
    });
    return verifiedStatements(stdout, digest);
  } catch {
    // Subprocess diagnostics can contain credentials supplied by the environment.
    throw new LabError('PROVENANCE_REJECTED', 'Signature, subject, producer or verifier failed. Run npm run setup:verifier and select a trusted publisher bundle.');
  }
}
