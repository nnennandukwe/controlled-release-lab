import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireLock, fingerprint, Journal, LabError, readLockOwner, loadRecord, type EvidenceRecord } from './evidence.js';
import { Railway } from './railway.js';
import { requireProtectedEnvironment } from './workflow-guard.js';
import policy from '../config/release-policy.json' with { type: 'json' };

export function hostedFailure(error: unknown) {
  const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : 'UNKNOWN_ERROR';
  const names = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ZodError', 'AggregateError', 'AbortError', 'TimeoutError']);
  const errorType = error instanceof LabError ? 'LabError' : error instanceof Error && names.has(error.name) ? error.name : 'UnknownError';
  const causeCodes: string[] = [];
  let cause = error;
  for (let depth = 0; cause && typeof cause === 'object' && depth < 4; depth++) {
    if ('code' in cause) causeCodes.push(safeCode(cause.code));
    cause = 'cause' in cause ? cause.cause : undefined;
  }
  const source = error instanceof Error ? error.stack?.match(/\/(tools\/[a-z0-9-]+\.ts:\d+:\d+)/)?.[1] ?? null : null;
  return { outcome: 'failed', code: error instanceof LabError ? safeCode(error.code) : 'HOSTED_UNEXPECTED_FAILURE', errorType, causeCodes, source,
    recoveryInstruction: error instanceof LabError ? error.message : 'Inspect the reported source and required tools, plus retained stdout/stderr and attempt journals.' };
}

export function assertOperatorSource(repository: string, expectedSha?: string) {
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  const changes = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repository, encoding: 'utf8' });
  if (changes) throw new LabError('DIRTY_OPERATOR_SOURCE', 'Run the hosted check from a clean committed checkout. Preserve your edits and keep generated artifacts under ignored work/ or outside source.');
  if (expectedSha && source !== expectedSha) throw new LabError('OPERATOR_SOURCE_CHANGED', 'The operator commit changed during the check. Preserve its evidence and rerun from one clean committed source.');
  return source;
}

export type HostedReadEvent = { injected?: boolean; status?: number; errorCount?: number | null; mutationRejected?: boolean };
export function checkHostedReadEvents(events: HostedReadEvent[], failurePhase: 'scope' | 'snapshot' = 'snapshot') {
  const rejected = events.filter(event => event.injected);
  const ordinary = events.filter(event => !event.injected);
  const successful = ordinary.filter(event => event.status! >= 200 && event.status! < 300 && event.errorCount === 0);
  const retried = ordinary.filter(event => [429, 502, 503, 504].includes(event.status!));
  const requiredReads = failurePhase === 'scope' ? 2 : 3;
  if (events.some(event => event.mutationRejected) || events.length > requiredReads * 3 + 1 || rejected.length !== 1 || !(rejected[0]!.errorCount || rejected[0]!.status! >= 400) || successful.length !== requiredReads || successful.length + retried.length !== ordinary.length) throw new LabError('HOSTED_CHECK_FAILED', 'Expected one provider rejection, successful scope/readback checks and only bounded supported read retries without mutation attempts.');
}

export async function runHostedCommand(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }) {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
  const stopGroup = () => {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  const interrupt = (signal: 'SIGTERM' | 'SIGINT') => {
    stopGroup();
    process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', cancel);
    process.kill(process.pid, signal);
  };
  const terminate = () => interrupt('SIGTERM'), cancel = () => interrupt('SIGINT');
  process.once('SIGTERM', terminate); process.once('SIGINT', cancel);
  const timer = setTimeout(() => { timedOut = true; stopGroup(); }, options.timeoutMs ?? 30000); timer.unref();
  try {
    const code = await new Promise<number | null>((accept, reject) => { child.once('error', reject); child.once('close', accept); });
    return { code, stdout, stderr, timedOut };
  } finally { clearTimeout(timer); process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', cancel); }
}

export async function hostedOperatorRecovery(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.LAB_HOSTED_RECOVERY_CHECK !== 'true' || environment.LAB_TARGET !== 'staging') throw new LabError('HOSTED_STAGING_OPT_IN_REQUIRED', 'Enable the hosted check explicitly for staging.');
  const failurePhase = environment.LAB_HOSTED_RECOVERY_FAILURE_PHASE ?? 'snapshot';
  if (failurePhase !== 'scope' && failurePhase !== 'snapshot') throw new LabError('HOSTED_CHECK_PHASE_INVALID', 'Choose scope or snapshot for the hosted read failure.');
  const fixtureKind = environment.LAB_HOSTED_RECOVERY_FIXTURE ?? 'blocked';
  if (fixtureKind !== 'blocked' && fixtureKind !== 'verified-drift') throw new LabError('HOSTED_CHECK_FIXTURE_INVALID', 'Choose blocked or verified-drift for the hosted fixture.');
  if (environment.GITHUB_ACTIONS === 'true') await requireProtectedEnvironment({ ...environment, LAB_GITHUB_ENVIRONMENT: 'staging' });
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const operatorSourceSha = assertOperatorSource(repository);
  const startedAt = new Date().toISOString(), target = policy.targets.staging;
  const directProviderReads: { at: string; status: number }[] = [];
  const hosting = new Railway(environment.RAILWAY_PROJECT_TOKEN ?? '', target, async (input, options) => {
    const body = JSON.parse(String(options?.body)) as { query: string };
    if (String(input) !== 'https://backboard.railway.com/graphql/v2' || !/^query[\s(]/.test(body.query)) throw new LabError('HOSTED_CHECK_FAILED', 'Only Railway read requests are allowed.');
    const response = await fetch(input, { ...options, redirect: 'error' });
    directProviderReads.push({ at: new Date().toISOString(), status: response.status });
    return response;
  });
  await hosting.assertScope(target);
  const before = await hosting.snapshot();
  if (fixtureKind === 'verified-drift' && (!before.latestId || !before.sourceImage || before.active.length !== 1 || before.active[0]!.id !== before.latestId || before.active[0]!.image !== before.sourceImage)) throw new LabError('HOSTED_CHECK_FIXTURE_INVALID', 'The configuration-drift fixture requires one stable deployment with its configured image.');
  const parent = resolve(environment.LAB_HOSTED_RECOVERY_ROOT ?? 'work/hosted-operator-recovery');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, 'run-'));
  const root = join(directory, "operator's retained work"), config = join(directory, "operator's target map.json");
  await writeFile(config, JSON.stringify({ staging: target }), { flag: 'wx', mode: 0o600 });
  const journal = new Journal(root);
  await journal.initialize(); await acquireLock(root, target, journal.attemptId);
  const original: EvidenceRecord = { schemaVersion: 1, attemptId: journal.attemptId, operation: 'deploy', targetName: 'staging', target, requestedImage: before.sourceImage, requestedSourceSha: null, deploymentId: fixtureKind === 'verified-drift' ? before.latestId : null, rollbackTarget: null, configurationFingerprint: fixtureKind === 'verified-drift' ? fingerprint({ teachingFixture: 'earlier verified configuration before simulated drift' }) : before.configurationFingerprint, startedAt, finishedAt: startedAt, outcome: fixtureKind === 'verified-drift' ? 'verified' : 'blocked', reasonCodes: [fixtureKind === 'verified-drift' ? 'TEACHING_FIXTURE_VERIFIED_RESULT_WITH_RETAINED_LOCK' : 'TEACHING_FIXTURE_PRE_EFFECT_REJECTION'], recoveryInstruction: 'Teaching fixture: synthetic terminal result with interrupted owned-lock removal.', observations: [{ phase: 'actual-provider-before', snapshot: before }] };
  const originalPath = await journal.finish(original);
  const retained = await Promise.all([originalPath, `${originalPath}.sha256`].map(async path => [path, await readFile(path)] as const));
  const log = join(directory, 'provider-reads.ndjson');
  const preload = join(repository, 'tools/hosted-operator-transport.ts');
  const run = async (command: string, args: string[], rejectRead: boolean) => {
    const { code, stdout, stderr, timedOut } = await runHostedCommand(command, args, { cwd: repository, env: {
      PATH: environment.PATH, RAILWAY_PROJECT_TOKEN: environment.RAILWAY_PROJECT_TOKEN, LD_READ_TOKEN: 'unused-in-terminal-cleanup',
      NODE_OPTIONS: `--import tsx --import ${JSON.stringify(preload)}`, LAB_HOSTED_RECOVERY_CHECK: 'true', LAB_HOSTED_RECOVERY_LOG: log, LAB_HOSTED_REJECT_READ: String(rejectRead), LAB_HOSTED_RECOVERY_FAILURE_PHASE: failurePhase,
    } });
    const name = rejectRead ? 'failed-read' : 'recovered-read';
    await writeFile(join(directory, `${name}.stdout`), stdout, { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, `${name}.stderr`), stderr, { flag: 'wx', mode: 0o600 });
    if (timedOut) throw new LabError('HOSTED_CHECK_TIMEOUT', `The ${name} command timed out; inspect its retained output and owned journal.`);
    if (code !== 2) throw new LabError('HOSTED_CHECK_FAILED', `Expected blocked exit 2 from ${name}; inspect its retained output.`);
    return JSON.parse(stdout.trim().split('\n').at(-1)!) as { outcome: string; reasonCodes: string[]; recoveryInstruction: string; recordPath?: string };
  };
  const failed = await run(process.execPath, ['--import', 'tsx', 'tools/lab.ts', 'reconcile', '--target', 'staging', '--attempt', journal.attemptId, '--config', config, '--work-dir', root], true);
  const command = failed.recoveryInstruction.match(/ Run (npm run lab -- .+)\.$/)?.[1];
  if (failed.outcome !== 'blocked' || !failed.reasonCodes.some(code => ['PROVIDER_HTTP', 'PROVIDER_REJECTED'].includes(code)) || !command?.includes(`--attempt ${journal.attemptId}`) || !command.includes('--config ') || await readLockOwner(root, target) !== journal.attemptId) throw new LabError('HOSTED_CHECK_FAILED', 'The real provider rejection did not preserve the original owner and retry command.');
  if (failurePhase === 'snapshot') {
    if (!failed.recordPath) throw new LabError('HOSTED_CHECK_FAILED', 'The failed snapshot read did not save its record.');
    await loadRecord(failed.recordPath);
  } else if (failed.recordPath) throw new LabError('HOSTED_CHECK_FAILED', 'A rejected scope read must not claim a new saved record.');
  const recovered = await run('/bin/sh', ['-c', command], false);
  if (recovered.outcome !== 'blocked' || recovered.reasonCodes.join() !== (fixtureKind === 'verified-drift' ? 'COMPLETED_SUBJECT_CHANGED,COMPLETED_ATTEMPT_CLEANUP' : 'COMPLETED_ATTEMPT_CLEANUP') || !recovered.recordPath || await readLockOwner(root, target) !== undefined) throw new LabError('HOSTED_CHECK_FAILED', 'Read-only retry did not complete blocked owned-lock cleanup.');
  await loadRecord(recovered.recordPath);
  for (const [path, bytes] of retained) if (!bytes.equals(await readFile(path))) throw new LabError('HOSTED_CHECK_FAILED', 'Original recovery evidence changed.');
  const events = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as HostedReadEvent);
  checkHostedReadEvents(events, failurePhase);
  const after = await hosting.snapshot();
  if (fingerprint(before) !== fingerprint(after)) throw new LabError('HOSTED_CHECK_FAILED', 'Provider subject changed during the read-only recovery check.');
  assertOperatorSource(repository, operatorSourceSha);
  const receipt = { schemaVersion: 1, outcome: 'hosted_cleanup_verified', authorized: false, operatorSourceSha, failurePhase, fixtureKind, startedAt, finishedAt: new Date().toISOString(), targetName: 'staging', target, before, after, fixture: { syntheticTerminalRecord: true, priorOutcome: original.outcome, retainedDeploymentId: original.deploymentId, retainedImage: original.requestedImage, retainedConfigurationFingerprint: original.configurationFingerprint, simulatedHistoricalConfiguration: fixtureKind === 'verified-drift', simulatedFailure: 'one invalid read-only GraphQL field sent to the actual Railway endpoint' }, originalAttemptId: journal.attemptId, originalRecordUnchanged: true, lockRetainedAfterFailure: true, lockReleased: true, providerMutations: 0, providerRequests: events.length + directProviderReads.length, directProviderReads, failedOutcome: failed.outcome, failedReasonCodes: failed.reasonCodes, failedRecordPath: failed.recordPath ?? null, recoveredRecordPath: recovered.recordPath, events, directory };
  await writeFile(join(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  // Publish the safe projection in the producer; downstream copies stay byte-exact.
  const { directory: _directory, failedRecordPath, recoveredRecordPath, ...publicFields } = receipt;
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const publicReceipt = { ...publicFields, kind: 'hosted-operator-recovery-public-receipt',
    execution: environment.GITHUB_ACTIONS === 'true' ? { mode: 'github-actions', runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT, ref: environment.GITHUB_REF } : { mode: 'local' },
    originalRecordSha256: digest(retained[0]![1]), originalChecksumSha256: digest(retained[1]![1]),
    failedRecordPath: failedRecordPath ? relative(directory, failedRecordPath) : null, recoveredRecordPath: relative(directory, recoveredRecordPath) };
  await writeFile(join(directory, 'public-receipt.json'), `${JSON.stringify(publicReceipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(await hostedOperatorRecovery())}\n`); }
  catch (error) { process.stderr.write(`${JSON.stringify(hostedFailure(error))}\n`); process.exitCode = 1; }
}
