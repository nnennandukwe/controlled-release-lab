import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeState, previousOperation, workflowArguments } from '../tools/workflow.js';
const env = { GITHUB_REPOSITORY: 'owner/lab', GH_TOKEN: 'fixture-token', GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1', LAB_TARGET: 'live' };
const priorRun = (id: number, run_attempt = 1) => ({ id, run_attempt, display_title: 'live / deploy', head_branch: 'main', status: 'completed' });
const jobs = (conclusion: string, steps = [{ name: 'Execute the requested bounded operation', status: 'completed', conclusion }]) => ({ total_count: 1, jobs: [{ name: 'operate', status: 'completed', conclusion: 'failure', steps }] });
it('carries the previous failed operator state rather than starting with empty locks', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ workflow_runs: [{ id: 99, run_attempt: 1, display_title: 'live / deploy', head_branch: 'main', status: 'completed' }] })).mockResolvedValueOnce(Response.json({ artifacts: [{ name: 'lab-state-live-99-1', expired: false }] }));
  expect(await previousOperation(env, transport)).toEqual({ runId: '99', artifactName: 'lab-state-live-99-1' });
});
it('blocks if the previous mutation lost its durable evidence', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ workflow_runs: [priorRun(99)] })).mockResolvedValueOnce(Response.json({ artifacts: [] })).mockResolvedValueOnce(Response.json(jobs('failure')));
  await expect(previousOperation(env, transport)).rejects.toThrow('missing or expired');
});
it('skips proven setup failures and restores the preceding operation state', async () => {
  const transport = vi.fn()
    .mockResolvedValueOnce(Response.json({ workflow_runs: [priorRun(99), priorRun(98)] }))
    .mockResolvedValueOnce(Response.json({ artifacts: [] }))
    .mockResolvedValueOnce(Response.json(jobs('skipped')))
    .mockResolvedValueOnce(Response.json({ artifacts: [{ name: 'lab-state-live-98-1', expired: false }] }));
  expect(await previousOperation(env, transport)).toEqual({ runId: '98', artifactName: 'lab-state-live-98-1' });
  expect(transport.mock.calls[2]![0]).toContain('/99/attempts/1/jobs');
});
it('allows first use after a setup failure that never reached the operation', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ workflow_runs: [priorRun(99)] }))
    .mockResolvedValueOnce(Response.json({ artifacts: [] })).mockResolvedValueOnce(Response.json(jobs('skipped')));
  expect(await previousOperation(env, transport)).toEqual({ runId: '', artifactName: '' });
});
it('does not let a skipped rerun hide the original attempt evidence', async () => {
  const transport = vi.fn()
    .mockResolvedValueOnce(Response.json({ workflow_runs: [priorRun(99, 2)] }))
    .mockResolvedValueOnce(Response.json({ artifacts: [{ name: 'lab-state-live-99-1', expired: false }] }))
    .mockResolvedValueOnce(Response.json(jobs('skipped')));
  expect(await previousOperation(env, transport)).toEqual({ runId: '99', artifactName: 'lab-state-live-99-1' });
  expect(transport.mock.calls[2]![0]).toContain('/99/attempts/2/jobs');
});
it.each(['cancelled', 'success'])('retains the missing-evidence block after an operation was %s', async conclusion => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ workflow_runs: [priorRun(99)] }))
    .mockResolvedValueOnce(Response.json({ artifacts: [] })).mockResolvedValueOnce(Response.json(jobs(conclusion)));
  await expect(previousOperation(env, transport)).rejects.toThrow('missing or expired');
});
it('blocks ambiguous job history instead of assuming an absent operation never ran', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ workflow_runs: [priorRun(99)] }))
    .mockResolvedValueOnce(Response.json({ artifacts: [] })).mockResolvedValueOnce(Response.json(jobs('skipped', [])));
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
