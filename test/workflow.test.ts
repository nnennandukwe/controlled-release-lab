import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeState, previousOperation, workflowArguments } from '../tools/workflow.js';
const env = { GITHUB_REPOSITORY: 'owner/lab', GH_TOKEN: 'fixture-token', GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1', LAB_TARGET: 'live' };
it('carries the previous failed operator state rather than starting with empty locks', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ workflow_runs: [{ id: 99, run_attempt: 1, display_title: 'live / deploy', head_branch: 'main', status: 'completed' }] })).mockResolvedValueOnce(Response.json({ artifacts: [{ name: 'lab-state-live-99-1', expired: false }] }));
  expect(await previousOperation(env, transport)).toEqual({ runId: '99', artifactName: 'lab-state-live-99-1' });
});
it('blocks if the previous mutation lost its durable evidence', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ workflow_runs: [{ id: 99, run_attempt: 1, display_title: 'live / deploy', head_branch: 'main', status: 'completed' }] })).mockResolvedValueOnce(Response.json({ artifacts: [] }));
  await expect(previousOperation(env, transport)).rejects.toThrow('missing or expired');
});
it('refuses mutation workflow reruns that might replay a previous effect', async () => {
  await expect(previousOperation({ ...env, GITHUB_RUN_ATTEMPT: '2' })).rejects.toThrow();
});
it('does not construct file paths from unchecked restoration input', () => {
  expect(() => workflowArguments({ LAB_OPERATION: 'rollback', LAB_TARGET: 'live', LAB_DEPLOYMENT: '44444444-4444-4444-8444-444444444444', LAB_RESTORE_ATTEMPT: '../../secret' })).toThrow();
});
it('retains a state artifact even for the initial preview with no operation journal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-preview-'));
  try {
    await initializeState(root);
    await initializeState(root);
    expect(JSON.parse(await readFile(join(root, 'state-format.json'), 'utf8'))).toEqual({ schemaVersion: 1 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
