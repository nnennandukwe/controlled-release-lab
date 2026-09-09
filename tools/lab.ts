import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { LabError, targetSchema } from './evidence.js';
import { execute, type Operation } from './operations.js';
import { rehearseRecovery } from './recovery-rehearsal.js';
import { executeExposure, type ExposureOperation } from './exposure.js';
import { LaunchDarkly } from './launchdarkly.js';
import { Railway } from './railway.js';
import { checkRequest, releaseRequestSchema, verifyRelease } from './promotion.js';
import { fingerprint } from './evidence.js';

export const help = `Controlled Release Lab - authenticated promotion and recovery

Usage: npm run lab -- <doctor|verify|deploy|observe|rollback|reconcile|rehearse-recovery|expose|disable|observe-exposure|reconcile-exposure> --target <staging|live> [options]

  doctor       Read provider access, source, and deployment configuration.
  verify       Verify signed release evidence; does not authorize mutation.
  deploy       Preview a digest deployment; add --apply to execute it.
  observe      Collect a bounded live sample and preserve the raw observations.
  rollback     Preview earlier recovery, or apply an authenticated --release-dir; then reconcile.
  rehearse-recovery  Deploy in staging, discard the response, assert read-only recovery.
  reconcile    Resolve an uncertain operation from its --attempt UUID, without mutation.

  expose       Preview internal or 5% exposure; protected --apply changes the flag.
  disable      Independently authorize flag off and verify original behavior.
  observe-exposure    Measure current cohorts without changing the flag.
  reconcile-exposure Observe an uncertain flag operation without repeating PATCH.

Options:
  --stage internal|5         Exposure stage (expose only)
  --config PATH             Target map (default config/lab.json; LAB_CONFIG_JSON also supported)
  --release-dir PATH        Immutable request and signed attachments; required for protected apply
  --image IMAGE@sha256:...   Immutable GHCR image for deploy
  --source-sha SHA           Expected 40-character source SHA for deploy
  --deployment UUID          Earlier Railway deployment for rollback
  --restore-record PATH      Verified earlier record.json and its .sha256 file
  --attempt UUID             Original uncertain attempt under the work directory
  --apply                    Execute deploy/rollback/staging rehearsal inside the protected GitHub workflow
  --change-reference REF     Change identifier; protected apply uses the resolved request value
  --duration-seconds N       Minimum observation window, 0.1-300 seconds (default 60)
  --max-duration-seconds N   Total traffic deadline, 0.1-300 seconds (default 300)
  --rate N                   Deployment-observation launch-rate ceiling, 1-10 requests/second (default 2)
  --max-requests N           Request cap, 1-600 (default 120)
  --work-dir PATH            Evidence and locks (default work)
  --help                    Show examples and exit

Examples:
  npm run lab -- doctor --target staging
  npm run lab -- verify --target live --release-dir work/release/current
  npm run lab -- observe --target staging --duration-seconds 60 --rate 2 --max-requests 120
  npm run lab -- deploy --target staging --image 'ghcr.io/owner/lab@sha256:replace-with-64-hex-digest' --source-sha 'replace-with-40-hex-sha'
  npm run lab -- rollback --target live --deployment 'replace-with-deployment-uuid' --restore-record 'work/attempts/replace-with-attempt-uuid/record.json'
  npm run lab -- reconcile --target live --attempt 'replace-with-attempt-uuid'

Exposure observations use fixed policy budgets; duration/rate overrides are rejected.
Flag reads use LD_READ_TOKEN; protected flag writes also require LD_MANAGEMENT_TOKEN.
Credentials: RAILWAY_PROJECT_TOKEN, scoped to the selected environment. Never pass it as an argument.
Local deploy/rollback are previews. Apply requires authenticated GitHub OIDC and protected environment approval.
Output: JSON on stdout, progress on stderr. Exit 0 verified/preview; 1 invalid/failed; 2 blocked/unknown.
Railway rollback returns acknowledgment only: apply exits 2 and retains its lock until reconcile verifies recovery.
`;

export async function runCli(args: string[], environment: NodeJS.ProcessEnv = process.env, stdout: (text: string) => void = text => process.stdout.write(text), stderr: (text: string) => void = text => process.stderr.write(text)) {
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
      help: { type: 'boolean' }, stage: { type: 'string' }, target: { type: 'string' }, config: { type: 'string' }, image: { type: 'string' }, 'source-sha': { type: 'string' }, deployment: { type: 'string' }, 'restore-record': { type: 'string' }, attempt: { type: 'string' }, apply: { type: 'boolean' }, 'release-dir': { type: 'string' }, 'change-reference': { type: 'string' }, 'duration-seconds': { type: 'string' }, 'max-duration-seconds': { type: 'string' }, rate: { type: 'string' }, 'max-requests': { type: 'string' }, 'work-dir': { type: 'string' },
    } });
    if (values.help) { stdout(help); return 0; }
    if (positionals.length !== 1) throw new LabError('COMMAND_REQUIRED', 'Choose one command. Run npm run lab -- --help.', 'failed');
    const operation = z.enum(['doctor', 'verify', 'deploy', 'observe', 'rollback', 'reconcile', 'rehearse-recovery', 'expose', 'disable', 'observe-exposure', 'reconcile-exposure']).parse(positionals[0]);
    const targetName = z.enum(['staging', 'live']).parse(values.target);
    if (operation === 'rehearse-recovery' && (targetName !== 'staging' || !values.apply)) throw new LabError('REHEARSAL_TARGET_REJECTED', 'Recovery rehearsals require staging and --apply in the protected workflow.');
    if (operation === 'verify') {
      if (values.apply) throw new LabError('VERIFY_IS_READ_ONLY', 'Verify cannot apply changes. Dispatch the protected Operate lab workflow.');
      if (Object.keys(values).some(name => !['target', 'release-dir'].includes(name))) throw new LabError('VERIFY_IS_READ_ONLY', 'Verify accepts only --target and --release-dir.');
      stderr(`verify: authenticating ${targetName} evidence; this does not authorize mutation\n`);
      heartbeat = setInterval(() => stderr('verify: waiting for bounded provenance checks...\n'), 10000);
      const verified = await verifyRelease(z.string().min(1).parse(values['release-dir']));
      if (verified.request.targetName !== targetName) throw new LabError('RELEASE_SUBJECT_MISMATCH', 'The request belongs to another target.');
      stdout(`${JSON.stringify({ outcome: 'evidence_verified', authorized: false, requestDigest: verified.requestDigest, image: verified.request.image, target: targetName })}\n`);
      return 0;
    }
    const isExposure = ['expose', 'disable', 'observe-exposure', 'reconcile-exposure'].includes(operation);
    if (isExposure) {
      const allowed = ['target', 'work-dir', ...(operation === 'reconcile-exposure' ? ['attempt'] : ['release-dir']), ...(['expose', 'disable'].includes(operation) ? ['apply'] : []), ...(operation === 'expose' ? ['stage'] : [])];
      if (Object.keys(values).some(key => !allowed.includes(key))) throw new LabError('INVALID_EXPOSURE_ARGUMENT', 'Exposure accepts only its documented request, stage and work-directory arguments.');
    } else if (values.stage !== undefined) throw new LabError('INVALID_ARGUMENT', '--stage applies only to expose.');
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
    const flags = new LaunchDarkly(environment.LD_READ_TOKEN ?? '', isExposure && values.apply ? environment.LD_MANAGEMENT_TOKEN : undefined, targetName);
    if (isExposure) {
      const exposure: ExposureOperation = { operation: operation as ExposureOperation['operation'], targetName, apply: values.apply ?? false };
      if (values['release-dir']) exposure.releaseDir = values['release-dir'];
      if (values.attempt) exposure.attempt = values.attempt;
      if (operation === 'expose') exposure.stage = z.enum(['internal', '5']).parse(values.stage);
      const result = await executeExposure(exposure, hosting, flags, values['work-dir'] ?? 'work');
      stdout(`${JSON.stringify(result)}\n`);
      return result.outcome === 'verified' || result.outcome === 'preview' ? 0 : result.outcome === 'failed' ? 1 : 2;
    }
    const request: Operation = { operation: (operation === 'rehearse-recovery' ? 'deploy' : operation) as Operation['operation'], purpose: operation === 'rehearse-recovery' ? 'recovery-rehearsal' : 'release', targetName, target, apply: values.apply ?? false };
    if (values['release-dir'] !== undefined) request.releaseDir = values['release-dir'];
    if (request.releaseDir && operation === 'observe') {
      const { request: candidate } = await verifyRelease(request.releaseDir);
      if (candidate.operation !== 'observe' || candidate.targetName !== targetName || fingerprint(candidate.target) !== fingerprint(target)) throw new LabError('RELEASE_SUBJECT_MISMATCH', 'Observation request belongs to another operation or target.');
      if (values.image || values['source-sha'] || (values['change-reference'] && values['change-reference'] !== candidate.changeReference)) throw new LabError('RELEASE_SUBJECT_MISMATCH', 'Use the immutable observation request without conflicting arguments.');
      request.image = candidate.image; request.sourceSha = candidate.sourceSha; request.changeReference = candidate.changeReference;
    }
    if (request.releaseDir && !request.apply && ['deploy', 'rollback'].includes(operation)) {
      const candidate = releaseRequestSchema.parse(JSON.parse(await readFile(resolve(request.releaseDir, 'release-request.json'), 'utf8')));
      checkRequest(candidate);
      if (candidate.operation !== operation || candidate.targetName !== targetName || fingerprint(candidate.target) !== fingerprint(target)) throw new LabError('RELEASE_SUBJECT_MISMATCH', 'Preview request belongs to another operation or target.');
      if (values.image || values['source-sha'] || values.deployment || values['restore-record']) throw new LabError('RELEASE_SUBJECT_MISMATCH', 'Use a release directory or explicit preview arguments, not both.');
      request.image = candidate.image; request.sourceSha = candidate.sourceSha;
      if (operation === 'rollback') { request.deploymentId = candidate.rollbackDeploymentId!; request.restoreRecord = resolve(request.releaseDir, 'restore-record.json'); }
    }
    if (values['change-reference'] !== undefined) request.changeReference = values['change-reference'];
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
    const result = await (operation === 'rehearse-recovery' ? rehearseRecovery : execute)(request, hosting, values['work-dir'] ?? 'work', fetch, flags);
    stdout(`${JSON.stringify(result)}\n`);
    return result.outcome === 'verified' || result.outcome === 'preview' ? 0 : result.outcome === 'failed' ? 1 : 2;
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.') || 'argument'}: ${issue.message}`).join('; ') : error instanceof SyntaxError ? 'Configuration is not valid JSON.' : error instanceof LabError ? error.message : 'Command could not complete. Check configuration, file paths, and evidence permissions.';
    stdout(`${JSON.stringify({ outcome: error instanceof LabError ? error.outcome : 'failed', reasonCodes: [error instanceof LabError ? error.code : 'INVALID_INPUT_OR_IO'], recoveryInstruction: `${message} Run npm run lab -- --help.` })}\n`);
    return error instanceof LabError && error.outcome !== 'failed' ? 2 : 1;
  } finally { if (heartbeat) clearInterval(heartbeat); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await runCli(process.argv.slice(2));
