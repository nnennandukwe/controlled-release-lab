import { afterEach, describe, expect, it } from 'vitest';
import { createApplication } from '../src/server.js';
import type { Server } from 'node:http';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  servers.length = 0;
});

async function app() {
  const server = await createApplication({ LAB_ENVIRONMENT: 'local' });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing TCP listener');
  return `http://127.0.0.1:${address.port}`;
}

describe('catalog HTTP interface', () => {
  it('finds the independently specified original search results', async () => {
    const base = await app();
    const response = await fetch(`${base}/api/search?q=keyboard`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results.map((product: { id: string }) => product.id)).toEqual(['keyboard-compact', 'keyboard-full']);
    expect(body.ranking).toBe('original');
    expect(body.requestId).toEqual(expect.any(String));
    expect(body.evaluation).toMatchObject({ contextKey: 'anonymous', cohort: 'excluded', eligible: false, value: false, fallbackUsed: true, sdkInitialized: false });
  });
  it.each(['context=internal-000', 'context=eligible-1001', 'context=internal-001&context=internal-002', 'context=internal-001&eligible=true', 'cohort=internal'])('rejects invalid or spoofed synthetic context: %s', async params => {
    const response = await fetch(`${await app()}/api/search?q=keyboard&${params}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_CONTEXT', message: expect.stringContaining('synthetic') } });
  });
  it.each(['', ' '.repeat(3), 'x'.repeat(101)])('rejects invalid queries with corrective text', async query => {
    const response = await fetch(`${await app()}/api/search?q=${encodeURIComponent(query)}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_QUERY', message: expect.stringContaining('1-100') } });
  });
  it('exposes readiness and local identity without claiming a deployed digest', async () => {
    const base = await app();
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    expect(await (await fetch(`${base}/version`)).json()).toMatchObject({ sourceSha: 'local', environment: 'local', deploymentId: null });
  });
  it('rejects bad configuration before exposing a listener', async () => {
    await expect(createApplication({ LAB_ENVIRONMENT: 'oops' })).rejects.toThrow('LAB_ENVIRONMENT');
    await expect(createApplication({ LAB_ENVIRONMENT: 'live' })).rejects.toThrow();
    await expect(createApplication({ PORT: 'abc' })).rejects.toThrow('PORT');
  });
  it('serves an accessible search form and rejects unknown paths and methods', async () => {
    const base = await app();
    expect(await (await fetch(base)).text()).toContain('<label for="query">');
    expect((await fetch(`${base}/not-found`)).status).toBe(404);
    expect((await fetch(`${base}/api/search?q=keyboard`, { method: 'POST' })).status).toBe(405);
  });
});
