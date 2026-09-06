import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const image = process.env.CONTAINER_TEST_IMAGE ?? `controlled-release-lab-test:${randomUUID()}`;
const container = `controlled-release-lab-test-${randomUUID()}`;
const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
try {
  if (!process.env.CONTAINER_TEST_IMAGE) docker(['build', '--tag', image, '.']);
  docker(['run', '--detach', '--name', container, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '-p', '127.0.0.1::3000', image]);
  const port = docker(['port', container, '3000/tcp']).split(':').at(-1);
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { ready = (await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Wait for the container listener. */ }
    if (ready) break;
    await delay(250);
  }
  assert(ready, 'Container did not become ready');
  assert.equal((await (await fetch(`${base}/version`)).json()).sourceSha, process.env.CONTAINER_EXPECTED_SOURCE_SHA ?? 'local');
  assert.deepEqual((await (await fetch(`${base}/api/search?q=keyboard`)).json()).results.map((product: { id: string }) => product.id), ['keyboard-compact', 'keyboard-full']);
  assert.equal(docker(['exec', container, 'id', '-u']), '1000');
  assert.match(await (await fetch(base)).text(), /<label for="query">/);
  docker(['stop', '--time', '7', container]);
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', container]), '0');
  process.stdout.write('Container passed readiness, search, source identity, non-root, read-only filesystem, and shutdown checks.\n');
} finally {
  try { docker(['rm', '--force', container]); } catch { /* Container may not have been created. */ }
  if (!process.env.CONTAINER_TEST_IMAGE) try { docker(['image', 'rm', image]); } catch { /* Build may not have completed. */ }
}
