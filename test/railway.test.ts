import { expect, it, vi } from 'vitest';
import { Railway } from '../tools/railway.js';
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
