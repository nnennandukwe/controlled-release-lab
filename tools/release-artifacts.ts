import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { checkedVerifier, sha256 } from './setup-verifier.js';
import { LabError } from './evidence.js';
import { policy, producerSchema, github } from './promotion.js';

const invoke = promisify(execFile);
export function currentOperator() {
  return producerSchema.parse({ sourceSha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
}
export async function output(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
export async function jsonFile(path: string, value: unknown) {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
export async function download(runId: string, name: string, directory: string) {
  z.string().regex(/^[1-9][0-9]*$/).parse(runId);
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
export async function attachments(directory: string, names: string[]) {
  return Promise.all(names.map(async name => ({ name, sha256: sha256(await readFile(join(directory, name))) })));
}
