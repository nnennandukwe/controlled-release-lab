import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { LabError, targetSchema } from './evidence.js';
import { execute, type Operation } from './operations.js';
import { Railway } from './railway.js';

export const help = `Controlled Release Lab - hosted baseline and recovery

Usage: npm run lab -- <doctor|deploy|observe|rollback|reconcile> --target <staging|live> [options]

  doctor       Read provider access, source, and deployment configuration.
  deploy       Preview a digest deployment; add --apply to execute it.
  observe      Collect a bounded live sample and preserve the raw observations.
  rollback     Preview recovery; requires --deployment and --restore-record.
  reconcile    Resolve an uncertain operation from its --attempt UUID, without mutation.

Options:
  --config PATH             Target map (default config/lab.json; LAB_CONFIG_JSON also supported)
  --image IMAGE@sha256:...   Immutable GHCR image for deploy
  --source-sha SHA           Expected 40-character source SHA for deploy
  --deployment UUID          Earlier Railway deployment for rollback
  --restore-record PATH      Verified earlier record.json and its .sha256 file
  --attempt UUID             Original uncertain attempt under the work directory
  --apply                    Execute deploy/rollback (provider credentials still required)
  --duration-seconds N       Minimum observation window, 0.1-300 seconds (default 60)
  --max-duration-seconds N   Total traffic deadline, 0.1-300 seconds (default 300)
  --rate N                   Launch-rate ceiling, 1-10 requests/second (default 2)
  --max-requests N           Request cap, 1-600 (default 120)
  --work-dir PATH            Evidence and locks (default work)
  --help                    Show examples and exit

Examples:
  npm run lab -- doctor --target staging
  npm run lab -- observe --target staging --duration-seconds 60 --rate 2 --max-requests 120
  npm run lab -- deploy --target staging --image 'ghcr.io/owner/lab@sha256:replace-with-64-hex-digest' --source-sha 'replace-with-40-hex-sha'
  npm run lab -- rollback --target live --deployment 'replace-with-deployment-uuid' --restore-record 'work/attempts/replace-with-attempt-uuid/record.json'
  npm run lab -- reconcile --target live --attempt 'replace-with-attempt-uuid'

Credentials: RAILWAY_PROJECT_TOKEN, scoped to the selected environment. Never pass it as an argument.
Output: JSON on stdout, progress on stderr. Exit 0 verified/preview; 1 invalid/failed; 2 blocked/unknown.
`;

export async function runCli(args: string[], environment: NodeJS.ProcessEnv = process.env, stdout: (text: string) => void = text => process.stdout.write(text), stderr: (text: string) => void = text => process.stderr.write(text)) {
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
      help: { type: 'boolean' }, target: { type: 'string' }, config: { type: 'string' }, image: { type: 'string' }, 'source-sha': { type: 'string' }, deployment: { type: 'string' }, 'restore-record': { type: 'string' }, attempt: { type: 'string' }, apply: { type: 'boolean' }, 'duration-seconds': { type: 'string' }, 'max-duration-seconds': { type: 'string' }, rate: { type: 'string' }, 'max-requests': { type: 'string' }, 'work-dir': { type: 'string' },
    } });
    if (values.help) { stdout(help); return 0; }
    if (positionals.length !== 1) throw new LabError('COMMAND_REQUIRED', 'Choose one command. Run npm run lab -- --help.', 'failed');
    const operation = z.enum(['doctor', 'deploy', 'observe', 'rollback', 'reconcile']).parse(positionals[0]);
    const targetName = z.enum(['staging', 'live']).parse(values.target);
    const raw = values.config ? await readFile(values.config, 'utf8') : environment.LAB_CONFIG_JSON ?? await readFile('config/lab.json', 'utf8');
    const map = z.object({ staging: targetSchema.optional(), live: targetSchema.optional() }).strict().parse(JSON.parse(raw));
    if (map.staging && map.live && map.staging.environmentId === map.live.environmentId) throw new LabError('ENVIRONMENT_COLLISION', 'Staging and live must use separate Railway environments.');
    const target = targetSchema.parse(map[targetName]);
    const hosting = new Railway(environment.RAILWAY_PROJECT_TOKEN ?? '', target);
    stderr(`${operation}: checking ${targetName}\n`);
    heartbeat = setInterval(() => stderr(`${operation}: waiting for bounded checks...\n`), 10000);
    if (operation === 'doctor') {
      await hosting.assertScope();
      stdout(`${JSON.stringify({ outcome: 'verified', targetName, target, provider: await hosting.snapshot(), scope: 'read-only preflight; no hosted acceptance implied' })}\n`);
      return 0;
    }
    const request: Operation = { operation, targetName, target, apply: values.apply ?? false };
    if (values.image !== undefined) request.image = values.image;
    if (values['source-sha'] !== undefined) request.sourceSha = values['source-sha'];
    if (values.deployment !== undefined) request.deploymentId = values.deployment;
    if (values['restore-record'] !== undefined) request.restoreRecord = values['restore-record'];
    if (values.attempt !== undefined) request.attempt = values.attempt;
    if (values['duration-seconds'] !== undefined) request.durationSeconds = Number(values['duration-seconds']);
    if (values['max-duration-seconds'] !== undefined) request.maxDurationSeconds = Number(values['max-duration-seconds']);
    if (values.rate !== undefined) request.rate = Number(values.rate);
    if (values['max-requests'] !== undefined) request.maxRequests = Number(values['max-requests']);
    stderr(`${operation}: checking ${targetName}; evidence directory ${resolve(values['work-dir'] ?? 'work')}\n`);
    const result = await execute(request, hosting, values['work-dir'] ?? 'work');
    stdout(`${JSON.stringify(result)}\n`);
    return result.outcome === 'verified' || result.outcome === 'preview' ? 0 : result.outcome === 'failed' ? 1 : 2;
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.') || 'argument'}: ${issue.message}`).join('; ') : error instanceof SyntaxError ? 'Configuration is not valid JSON.' : error instanceof LabError ? error.message : 'Command could not complete. Check configuration, file paths, and evidence permissions.';
    stdout(`${JSON.stringify({ outcome: error instanceof LabError ? error.outcome : 'failed', reasonCodes: [error instanceof LabError ? error.code : 'INVALID_INPUT_OR_IO'], recoveryInstruction: `${message} Run npm run lab -- --help.` })}\n`);
    return error instanceof LabError && error.outcome !== 'failed' ? 2 : 1;
  } finally { if (heartbeat) clearInterval(heartbeat); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await runCli(process.argv.slice(2));
