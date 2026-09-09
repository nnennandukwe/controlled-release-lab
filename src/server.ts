import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { search } from './search.js';
import { loadBuildInfo } from './build-info.js';

export async function createApplication(environment: NodeJS.ProcessEnv): Promise<Server> {
  const config = z.object({
    LAB_ENVIRONMENT: z.enum(['local', 'staging', 'live']).default('local'),
    PORT: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)).default(3000),
    RAILWAY_DEPLOYMENT_ID: z.string().uuid().optional(),
  }).parse(environment);
  const build = await loadBuildInfo();
  if (config.LAB_ENVIRONMENT !== 'local' && (build.sourceSha === 'local' || !config.RAILWAY_DEPLOYMENT_ID)) {
    throw new Error('Hosted startup requires embedded source identity and RAILWAY_DEPLOYMENT_ID. Build the image in CI and configure its Railway environment.');
  }
  const identity = { ...build, environment: config.LAB_ENVIRONMENT, deploymentId: config.RAILWAY_DEPLOYMENT_ID ?? null };
  const publicRoot = new URL('../public/', import.meta.url);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ].map(async ([path, file, type]) => [path!, { content: await readFile(new URL(file!, publicRoot)), type: type! }] as const)));
  return createServer((request, response) => {
    const requestId = randomUUID();
    response.setHeader('X-Request-ID', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for this read-only service.' }, requestId });
      return;
    }
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); }
    catch { json(400, { error: { code: 'INVALID_URL', message: 'Use a valid request URL.' }, requestId }); return; }
    if (url.pathname === '/healthz' || url.pathname === '/readyz') { json(200, { status: 'ok' }); return; }
    if (url.pathname === '/version') { json(200, identity); return; }
    if (url.pathname === '/api/search') {
      const query = url.searchParams.get('q')?.trim() ?? '';
      if (query.length < 1 || query.length > 100 || url.searchParams.getAll('q').length !== 1) {
        json(400, { error: { code: 'INVALID_QUERY', message: 'Provide one query containing 1-100 characters.' }, requestId });
        return;
      }
      json(200, { query, results: search(query), ranking: 'original', requestId, ...identity });
      return;
    }
    const asset = assets.get(url.pathname);
    if (asset) { response.writeHead(200, { 'Content-Type': asset.type }); response.end(asset.content); return; }
    json(404, { error: { code: 'NOT_FOUND', message: 'Open / to search the catalog.' }, requestId });
  });
}
