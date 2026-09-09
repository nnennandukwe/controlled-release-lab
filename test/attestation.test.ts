import { expect, it } from 'vitest';
import { verifyArtifact } from '../tools/attestation.js';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkedVerifier } from '../tools/setup-verifier.js';

it('rejects an unsigned image before invoking the verifier', async () => {
  await expect(verifyArtifact({ subject: `oci://ghcr.io/nnennandukwe/controlled-release-lab@sha256:${'a'.repeat(64)}`, bundle: '/missing/bundle.jsonl', workflow: 'image.yml', sourceSha: 'b'.repeat(40) }))
    .rejects.toMatchObject({ code: 'PROVENANCE_REQUIRED' });
});

it('checks a real GitHub-signed fixture and rejects edited bytes and a different signer', async () => {
  const file = 'test/fixtures/attestation/github_provenance_demo-0.0.12-py3-none-any.whl';
  const args = ['--bundle', 'test/fixtures/attestation/github_provenance_demo-0.0.12-py3-none-any-bundle.jsonl', '--repo', 'actions/attest-demo', '--cert-identity', 'https://github.com/actions/attest-demo/.github/workflows/build-python.yml@refs/heads/main', '--source-ref', 'refs/heads/main', '--source-digest', 'a6c23b9806c593664f68637c8f9d45dfcf98b2db', '--deny-self-hosted-runners', '--format', 'json'];
  const gh = await checkedVerifier();
  const invoke = promisify(execFile);
  const result = await invoke(gh, ['attestation', 'verify', file, ...args], { timeout: 60000 });
  expect(JSON.parse(result.stdout)[0].verificationResult.statement.subject[0].digest.sha256).toBe('ae57936def59bc4c75edd3a837d89bcefc6d3a5e31d55a6fa7a71624f92c3c3b');
  const directory = await mkdtemp(join(tmpdir(), 'attestation-negative-'));
  try {
    const changed = join(directory, 'changed.whl');
    await writeFile(changed, Buffer.concat([await readFile(file), Buffer.from('edited')]));
    await expect(invoke(gh, ['attestation', 'verify', changed, ...args], { timeout: 60000 })).rejects.toThrow();
    await expect(invoke(gh, ['attestation', 'verify', file, ...args, '--cert-identity', 'https://github.com/untrusted/other/.github/workflows/build.yml@refs/heads/main'], { timeout: 60000 })).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120000);

it('refuses conflicting certificate-backed producers and wrong verified digests', async () => {
  const { verifiedStatements, repository, issuer } = await import('../tools/attestation.js');
  const { default: policy } = await import('../config/release-policy.json', { with: { type: 'json' } });
  const invocation = `https://github.com/${repository}/actions/runs/123/attempts/1`;
  const entry = { verificationResult: {
    signature: { certificate: { issuer, sourceRepositoryIdentifier: policy.repositoryId, sourceRepositoryOwnerIdentifier: policy.ownerId, runInvocationURI: invocation, buildTrigger: 'workflow_dispatch' } },
    statement: { predicateType: 'https://slsa.dev/provenance/v1', subject: [{ name: 'fixture', digest: { sha256: 'a'.repeat(64) } }], predicate: { runDetails: { metadata: { invocationId: invocation } } } },
  } };
  expect(verifiedStatements(JSON.stringify([entry]), 'a'.repeat(64))).toMatchObject({ runId: '123', runAttempt: '1' });
  expect(() => verifiedStatements(JSON.stringify([entry]), 'b'.repeat(64))).toThrow();
  const conflict = structuredClone(entry);
  conflict.verificationResult.signature.certificate.runInvocationURI = invocation.replace('/123/', '/124/');
  expect(() => verifiedStatements(JSON.stringify([conflict]), 'a'.repeat(64))).toThrow();
  conflict.verificationResult.statement.predicate.runDetails.metadata.invocationId = conflict.verificationResult.signature.certificate.runInvocationURI;
  expect(() => verifiedStatements(JSON.stringify([entry, conflict]), 'a'.repeat(64))).toThrow();
  conflict.verificationResult.signature.certificate.sourceRepositoryIdentifier = '999';
  expect(() => verifiedStatements(JSON.stringify([conflict]), 'a'.repeat(64))).toThrow();
});
