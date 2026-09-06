import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { buildInfoSchema } from '../src/build-info.js';

await rm('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
await mkdir('dist', { recursive: true });
await cp('public', 'dist/public', { recursive: true });
const metadata = buildInfoSchema.parse({ sourceSha: process.env.SOURCE_SHA ?? 'local', buildRunId: process.env.BUILD_RUN_ID ?? 'local', catalogVersion: '1' });
await writeFile('dist/build-info.json', `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
process.stderr.write(`Built application with source identity ${metadata.sourceSha}\n`);
