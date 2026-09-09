import { expect, it, vi } from 'vitest';
import { Railway } from '../tools/railway.js';
import captured from './fixtures/railway-staging-deployment.json' with { type: 'json' };
import rollbackContract from './fixtures/railway-rollback-contract.json' with { type: 'json' };
const target = { projectId: '11111111-1111-4111-8111-111111111111', serviceId: '22222222-2222-4222-8222-222222222222', environmentId: '33333333-3333-4333-8333-333333333333', url: 'https://example.up.railway.app' };
it('rejects an HTTP-success GraphQL failure before treating credentials as usable', async () => {
  const transport = vi.fn(async () => Response.json({ errors: [{ message: 'Forbidden' }] })) as typeof fetch;
  await expect(new Railway('test-token', target, transport).assertScope()).rejects.toThrow('PROVIDER_REJECTED');
});
it('rejects a token bound to a different project or environment', async () => {
  const transport = vi.fn(async () => Response.json({ data: { projectToken: { projectId: target.projectId, environmentId: 'wrong' } } })) as typeof fetch;
  await expect(new Railway('test-token', target, transport).assertScope()).rejects.toThrow('TOKEN_SCOPE_MISMATCH');
});
it('uses deployment-owned image metadata and keeps unrelated provider values out of evidence', async () => {
  const image = `ghcr.io/owner/lab@sha256:${'a'.repeat(64)}`;
  const response = { id: '44444444-4444-4444-8444-444444444444', projectId: target.projectId, serviceId: target.serviceId, environmentId: target.environmentId, status: 'SUCCESS', canRollback: true, meta: { image, secretFixture: 'never-retain-this-value' } };
  const transport = vi.fn(async () => Response.json({ data: { deployment: response } })) as typeof fetch;
  const deployment = await new Railway('test-token', target, transport).deployment(response.id);
  expect(deployment.image).toBe(image);
  expect(JSON.stringify(deployment)).not.toContain('never-retain-this-value');
});
it('does not promote a mutable metadata image into immutable provider proof', async () => {
  const response = { id: '44444444-4444-4444-8444-444444444444', projectId: target.projectId, serviceId: target.serviceId, environmentId: target.environmentId, status: 'SUCCESS', canRollback: true, meta: { image: 'ghcr.io/owner/lab:latest' } };
  const transport = (async () => Response.json({ data: { deployment: response } })) as typeof fetch;
  expect((await new Railway('test-token', target, transport).deployment(response.id)).image).toBeNull();
});

it('accepts the captured Railway snapshot and correlates its deployment-owned digest', async () => {
  const transport = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(captured.snapshotResponse))
    .mockResolvedValueOnce(Response.json(captured.deploymentResponse));
  const hosting = new Railway('fixture-token', captured.target, transport);
  const snapshot = await hosting.snapshot();
  const deployment = await hosting.deployment(snapshot.latestId!);
  expect(snapshot.active).toHaveLength(1);
  expect(snapshot.active[0]).toEqual(deployment);
  expect(deployment.image).toBe(captured.deploymentResponse.data.deployment.meta.image);
  expect(snapshot.sourceImage).toBe(deployment.image);
  expect(snapshot.configurationFingerprint).toMatch(/^[a-f0-9]{64}$/);
});

it('does not substitute the captured service source when provider deployment metadata drifts', async () => {
  const drifted = structuredClone(captured.deploymentResponse);
  Reflect.deleteProperty(drifted.data.deployment.meta, 'image');
  const transport = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(captured.snapshotResponse))
    .mockResolvedValueOnce(Response.json(drifted));
  const hosting = new Railway('fixture-token', captured.target, transport);
  const snapshot = await hosting.snapshot();
  expect(snapshot.sourceImage).not.toBeNull();
  // The independent imageDigest field and configured source cannot silently
  // stand in for the deployment-owned meta.image compatibility contract.
  expect((await hosting.deployment(snapshot.latestId!)).image).toBeNull();
});

it('rejects a captured deployment moved to a different environment', async () => {
  const drifted = structuredClone(captured.deploymentResponse);
  drifted.data.deployment.environmentId = target.environmentId;
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(drifted));
  await expect(new Railway('fixture-token', captured.target, transport)
    .deployment(drifted.data.deployment.id)).rejects.toThrow('this exact project');
});

it('uses the live Railway scalar rollback contract without inventing a deployment ID', async () => {
  expect(rollbackContract.field.type.ofType).toEqual({ kind: 'SCALAR', name: 'Boolean' });
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const { query } = JSON.parse(String(init?.body));
    if (/deploymentRollback\(id:\$id\)\s*\{/.test(query)) return Response.json({ errors: [{ message: 'Boolean cannot have a selection set' }] }, { status: 400 });
    return Response.json(rollbackContract.acknowledgment.body);
  });
  await expect(new Railway('fixture-token', captured.target, transport)
    .rollback(captured.deploymentResponse.data.deployment.id)).resolves.toBeUndefined();
  expect(transport).toHaveBeenCalledOnce();
});

it('keeps a false rollback acknowledgment unresolved without retrying it', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { deploymentRollback: false } }));
  await expect(new Railway('fixture-token', captured.target, transport)
    .rollback(captured.deploymentResponse.data.deployment.id)).rejects.toMatchObject({ code: 'ROLLBACK_UNCONFIRMED', outcome: 'unknown_outcome' });
  expect(transport).toHaveBeenCalledOnce();
});
