# From AI-Generated Code to a Controlled Release

A catalog search change can pass functional tests and still become too slow for
some users. This exercise follows that change into a hosted application: verify
what was built, deploy the same image, expose it to a defined audience, measure
it, recover, and finish releasing the repaired version. Each decision needs
evidence about the actual running subject.

The application is a small read-only product catalog. Original search and ranked
search live behind a LaunchDarkly server-side flag. Railway hosts staging and
live, GitHub Actions controls authorized operations, and GHCR holds immutable
images. Traffic and user personas are synthetic. No production-customer outcome
is claimed.

Complete [setup](setup.md) first. The lesson starts with E running original
behavior in the prepared hosted lab. It replays reviewed E/F/G images rather
than publishing new candidates; source implementation and original publication
are inspected through their recorded history. F contains an **intentional teaching
fixture**: a 1,000 ms delay on ranked `workspace` searches. G removes that delay.
The [evidence index](evidence.md) separates historical observations from the fresh
records you must collect. [Build 5 acceptance](../build-05-closeout.md) states
which parts of these instructions have actually been rehearsed.

## How to run and record an operation

Only the designated release operator runs hosted commands, after approval of the
[concrete rehearsal request](rehearsal.md). Participants use the
[worksheet](../workshop/participant-worksheet.md). Keep one provider writer and
one shell session in the current operator checkout. All examples use:

```bash
export GH_REPO=nnennandukwe/controlled-release-lab
CHANGE_REF='<owner-approved-Build-5-reference>'
```

Replace that placeholder with the recorded approval reference. It is an audit
reference, not authorization by itself. Reserve the next operation's request
budget before dispatch. Commands using a `*_OFF`, `*_INTERNAL`, `*_FIVE`, or
`*_TWENTYFIVE` variable require the fresh run ID you saved at the preceding step.
All new operations use attempt 1; use a new dispatch, never **Re-run jobs**.

For every `gh workflow run` below:

1. A zero exit means dispatch was accepted; it does not mean the operation passed.
   Capture the returned run URL/ID. If none is returned, list candidates with
   `gh run list --workflow operate.yml --event workflow_dispatch --limit 20`,
   then inspect the target, operation, creation time and exact request reference.
   Do not choose a run solely because it is newest. If the dispatch response is
   lost, inspect history before issuing another dispatch.
2. Set `RUN` to that exact numeric run ID and `TARGET` to `staging` or `live`.
   Open `gh run view "$RUN" --web`. Before approval inspect the request summary:
   source/digest, target, deployment/configuration, policy, audience, flag snapshot,
   request hash, change reference and expiry. For live deploy, approve and inspect
   the staging proof first; only then inspect the finalized live request.
3. Approve only that matching protected environment action through GitHub's normal
   review UI. An expired request must be rejected and replaced by a fresh request.
   Wait with `gh run watch "$RUN" --exit-status`. Exit 0 means workflow success;
   a nonzero exit needs the operation result, not an automatic retry.
4. Download retained state, the resolved request when present, and proof or
   diagnostic. Save the run ID under the step's variable name and update the ledger.

For a successful operation with a request and proof, the download shape is:

```bash
: "${RUN:?Set the exact completed run ID}" "${TARGET:?Set staging or live}"
gh run download "$RUN" --name "release-request-$RUN-1" \
  --dir "artifacts/build5/$RUN/request"
gh run download "$RUN" --name "lab-state-$TARGET-$RUN-1" \
  --dir "artifacts/build5/$RUN/state"
gh run download "$RUN" --name "lab-proof-$TARGET-$RUN-1" \
  --dir "artifacts/build5/$RUN/proof"
```

These exit 0 when the named artifacts are downloaded. Reconcile and doctor have
no resolved request artifact; doctor produces no signed proof. A refused resolution
may produce neither state nor proof. A blocked exposure may produce a diagnostic
instead of a healthy proof. Check the run artifact list before downloading; retain
logs when an expected artifact is absent. Use a new destination for each run.

Inspect `state/last-result.json` and the record it points to, not only the workflow
badge. CLI exits mean: **0** verified/preview/authenticated diagnostic, **1** invalid
or failed, **2** blocked or unknown. Verification always grants no mutation authority.
For fresh exposure proof, authenticate promptly (within the 30-minute window):

```bash
npm run lab -- verify-exposure --target "$TARGET" \
  --release-dir "artifacts/build5/$RUN/proof"
```

Expected: exit 0, `outcome: exposure_verified`, `authorized: false`, the intended
subject, stage and recomputed measurements. It is not the verifier for a deployment
envelope. Deployment request authentication uses `npm run lab -- verify --target
"$TARGET" --release-dir "artifacts/build5/$RUN/request"`; inspect the signed
provider and feature evidence retained by its successful protected producer.
For a downloaded deployment envelope, authenticate its file bundle and exact
producer with this read-only check (after setting `RUN` to that completed run):

```bash
node --import tsx --input-type=module - "$RUN" <<'JS'
import { readFile } from 'node:fs/promises';
import { verifyArtifact } from './tools/attestation.ts';
import { assertProducer, controlledDeploymentEvidenceSchema } from './tools/promotion.ts';
const run = process.argv[2];
const dir = `artifacts/build5/${run}/proof`;
const file = `${dir}/deployment-evidence.json`;
const proof = controlledDeploymentEvidenceSchema.parse(JSON.parse(await readFile(file, 'utf8')));
const producer = proof.context.operator;
const signed = await verifyArtifact({ subject: file, bundle: `${dir}/evidence.bundle.jsonl`,
  workflow: 'operate.yml', sourceSha: producer.sourceSha });
if (producer.runId !== run || producer.runAttempt !== '1' ||
    signed.runId !== run || signed.runAttempt !== '1') throw Error('Producer mismatch');
await assertProducer(producer, 'operate.yml');
console.log(JSON.stringify({ outcome: 'deployment_signature_verified', authorized: false,
  record: proof.record, featureProof: proof.featureProof }));
JS
```

Expected: exit 0 and the exact authenticated producer/record. Compare the record's
image, deployment and configuration, feature snapshots, complete raw measurements
and timestamps with the intended subject and policy. This signature check does not
recompute health or grant permission; the protected consumer must still perform
its normal semantic/freshness checks before the next action. No proof edits are allowed.

## 1. Establish the baseline and policy

You should already have `E_LIVE_OFF` and `E_STAGING_OFF` from setup. Confirm E's
exact image/deployment, original results, compatible configuration, flags off,
complete samples, and native rollback availability. Preserve E's live proof and
provider deployment as the recovery target before F is introduced.

If an initial off proof becomes stale, refresh it without redeployment:

```bash
gh workflow run operate.yml --ref main \
  -f operation=observe -f target=live \
  -f build_run=34398598619 -f build_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Expected: a fresh signed E deployment proof after 120 deployment checks and the
1,160-request off feature workload; record its ID as `E_LIVE_OFF`. A different
serving subject, failed window or unresolved recovery blocks continuation.
Repeat for staging only if its baseline needs refreshing. Every window consumes
budget. Open the catalog's HTTPS URL from the protected target configuration only
within the reserved manual-request allowance; browser searches also count.

Before exposing anything, agree on the fixed policy:

| Stage | Workload | Required observation |
|---|---|---|
| Internal | 120 requests, at least 60 seconds | `keyboard` and `compact`; both variations with real SDK evaluation. |
| Off, 5%, 25%, 100% | 1,160 requests, at least 120 seconds | `workspace` across all 1,040 personas plus 120 normal-query requests. |
| Every window | Concurrency 2; at most 10/sec, 1,200 requests, 180 seconds; 5-second request timeout | Complete identities, correct results/evaluations, zero errors, and sufficient query/variation coverage. |

Exposure p95 must be at most `max(500 ms, 2 × the corresponding off-baseline p95)`
for aggregate and each query/variation. Deployment checks use an absolute 500 ms
per-query limit. Each required query/variation needs at least 20 distinct personas;
5%/25% challenge measurements need 20 eligible treatments and 200 eligible controls.
Missing telemetry or insufficient coverage means hold. These are tutorial limits,
not production SLOs. Never change thresholds or resample to obtain a pass.

**Checkpoint 1:** identify the source, image, deployment, configuration, audience,
and observation window. Explain which facts `/readyz` alone cannot establish.

## 2. Inspect the change and authenticate the build

The original bounded coding task was to improve catalog ranking while preserving
original search, behind a flag. Inspect the actual diff and recorded review before
following its release. Functional tests check results; provenance checks who built
which artifact; runtime observations measure behavior after deployment.

```bash
git show 68a01714700eb57ae47390fbab611b2abe1dd590:src/search-teaching-fixture.ts
git diff 58b0fe899446cec0d916fcaca31025972e6eea24 \
  68a01714700eb57ae47390fbab611b2abe1dd590 -- src test
```

These are local reads, expected exit 0. They expose the fixture explicitly.
Read [PR #12](https://github.com/nnennandukwe/controlled-release-lab/pull/12) and
its [review dispositions](../../.plan/build-04-review-notes.md); do not turn
historical review limitations into a claim of complete specification validation.

The original publisher built each candidate once on protected main, tested the
image, published its digest and attested it. Download its records through setup;
this replay never dispatches `image.yml`. Authenticate all three before deployment:

```bash
node --import tsx --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { verifyArtifact } from './tools/attestation.ts';
import { assertProducer } from './tools/promotion.ts';
for (const run of ['34398598619', '35374672780', '35380922988']) {
  const dir = `artifacts/build5/builds/${run}`;
  const build = JSON.parse(await readFile(`${dir}/build-record.json`, 'utf8'));
  const signed = await verifyArtifact({ subject: `oci://${build.image}`,
    bundle: `${dir}/image.bundle.jsonl`, workflow: 'image.yml', sourceSha: build.sourceSha });
  if (signed.runId !== run || signed.runAttempt !== '1' ||
      build.buildRunId !== run || build.buildRunAttempt !== '1') throw Error('Producer mismatch');
  await assertProducer({ sourceSha: build.sourceSha, runId: run, runAttempt: '1' }, 'image.yml');
  console.log(JSON.stringify({ run, sourceSha: build.sourceSha, image: build.image, provenance: 'verified' }));
}
JS
```

Expected: exit 0 and three verified exact subjects matching the evidence index.
A verifier/network failure blocks this step; restore access and diagnose it.
It is not permission to trust the unsigned record.

Exercise wrong-subject rejection without deploying or altering original records:

```bash
node --import tsx --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { verifyArtifact } from './tools/attestation.ts';
const e = JSON.parse(await readFile('artifacts/build5/builds/34398598619/build-record.json', 'utf8'));
const f = JSON.parse(await readFile('artifacts/build5/builds/35374672780/build-record.json', 'utf8'));
try {
  await verifyArtifact({ subject: `oci://${e.image}`, sourceSha: f.sourceSha,
    bundle: 'artifacts/build5/builds/35374672780/image.bundle.jsonl', workflow: 'image.yml' });
  throw Error('Unexpected acceptance of E with F provenance');
} catch (error) {
  if (error.code !== 'PROVENANCE_REJECTED') throw error;
  console.log('Expected wrong-subject refusal: PROVENANCE_REJECTED');
}
JS
```

This assertion exits 0 only for the expected rejection. Establish successful
verification first: the generic provenance error also covers transport failures,
so an isolated error is not proof of subject-check behavior.

**Checkpoint 2:** explain why an authentic build can still have a latency regression,
and why E cannot borrow F's provenance.

## 3. Deploy F without exposing live users

With both flags off and E retained, dispatch F's staging response-loss rehearsal:

```bash
gh workflow run operate.yml --ref main \
  -f operation=rehearse-recovery -f target=staging -f apply=true \
  -f build_run=35374672780 -f build_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

After the protected operation succeeds, save `F_STAGING_OFF`. Inspect one actual
deployment effect, the deliberately lost response, unchanged original record,
read-only reconciliation, and released owned lock. Approve the **automatically
queued** staging internal flag-recovery run; do not duplicate it. Save its run and
check normal-query success and targeting. This deliberate response-loss exercise
is separate from the application's intentional latency fixture.

Now promote that same F digest to live:

```bash
gh workflow run operate.yml --ref main \
  -f operation=deploy -f target=live -f apply=true \
  -f build_run=35374672780 -f build_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

The workflow remeasures F in staging with both variations, then creates the live
request. Approve the exact request while live is off. Save the successful live
off proof as `F_LIVE_OFF`. Confirm F's provider digest, source, deployment and
original live responses. There is no rebuild between environments. If the
operation is uncertain, reconcile it before continuing; if health failed, keep
the failure and follow recovery rather than claiming successful deployment.

**Checkpoint 3:** F is deployed. Show the evidence that ranked behavior has not
yet been released to live users.

## 4. Expose internal users, then 5%

The internal stage checks normal queries. It is intentionally insufficient to
establish ranked `workspace` performance.

```bash
: "${F_LIVE_OFF:?Set the fresh F live off proof run}"
gh workflow run operate.yml --ref main \
  -f operation=expose -f target=live -f stage=internal -f apply=true \
  -f evidence_run="$F_LIVE_OFF" -f evidence_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Save the healthy authorized proof as `F_INTERNAL`. Verify the signed exposure
promptly. Then use it as the exact immediate predecessor:

```bash
: "${F_INTERNAL:?Set the successful F internal run}"
gh workflow run operate.yml --ref main \
  -f operation=expose -f target=live -f stage=5 -f apply=true \
  -f evidence_run="$F_LIVE_OFF" -f evidence_attempt=1 \
  -f exposure_run="$F_INTERNAL" -f exposure_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Save this run as `F_FIVE`, including its failed/blocked result. The expected full
window reveals slow ranked `workspace`, returns blocked (CLI exit 2), and publishes
an unhealthy diagnostic, not healthy expansion evidence. Count the actual evaluated
personas; do not assume exactly 50 eligible treatments. An incomplete workload or
unrelated error is a different failure and must not be relabeled the expected fixture.

## 5. Detect the regression and refuse expansion

Download the complete diagnostic and retained state for `F_FIVE`:

```bash
: "${F_FIVE:?Set the failed F 5-percent run}"
gh run download "$F_FIVE" --name "lab-diagnostic-live-$F_FIVE-1" \
  --dir "artifacts/build5/$F_FIVE/diagnostic"
gh run download "$F_FIVE" --name "lab-state-live-$F_FIVE-1" \
  --dir "artifacts/build5/$F_FIVE/state"
npm run lab -- verify-diagnostic --target live \
  --release-dir "artifacts/build5/$F_FIVE/diagnostic"
```

Expected: verifier exit 0, `diagnostic_authenticated`, `authorized: false`, recorded
blocked outcome/reasons and independently recomputed feature measurements. Compare
ranked `workspace` p95 with its threshold and inspect coverage, errors, and response
identity. Authentication of failure is not authorization to expand.

The approved rehearsal includes one deliberate refused 25% request:

```bash
gh workflow run operate.yml --ref main \
  -f operation=expose -f target=live -f stage=25 -f apply=true \
  -f evidence_run="$F_LIVE_OFF" -f evidence_attempt=1 \
  -f exposure_run="$F_FIVE" -f exposure_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Expected: request resolution fails with `ARTIFACT_UNAVAILABLE` because the failed
5% run has no healthy proof, and the mutation job is skipped. Inspect logs/jobs to
establish no PATCH or search traffic; a generic workflow failure is insufficient.
Do not supply another run to bypass the hold.

**Checkpoint 4:** identify the failed gate and the evidence that stopped expansion.
The historical F window failed aggregate and subgroup gates; aggregate masking
is a separate automated-test result.

## 6. Disable the feature and verify recovery on F

An independently approved disable can use F's retained compatible off baseline;
it does not require a healthy treatment predecessor.

```bash
gh workflow run operate.yml --ref main \
  -f operation=disable -f target=live -f apply=true \
  -f evidence_run="$F_LIVE_OFF" -f evidence_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Expected: successful signed off exposure, unchanged F image/deployment, provider
flag off, all 1,160 observations original with non-fallback false evaluations and
healthy measurements. Compare the same personas that previously received treatment.
A PATCH acknowledgment or cached true responses cannot establish recovery.
Preserve F's failed window; this new observation does not rewrite it.

## 7. Roll back the application independently

Keep the external flag off. Select E's prepared live proof, not an arbitrary older
image or the F disable proof:

```bash
: "${E_LIVE_OFF:?Set the prepared E live deployment proof}"
gh workflow run operate.yml --ref main \
  -f operation=rollback -f target=live -f apply=true \
  -f evidence_run="$E_LIVE_OFF" -f evidence_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Inspect the request's E deployment and compatible configuration before approval.
Railway acknowledges native rollback without returning the new deployment ID.
Expected: CLI exit 2, `ROLLBACK_REQUIRES_RECONCILIATION`, original `unknown_outcome`
record and owned lock retained. Download its state and take `ATTEMPT` from
`last-result.json`/the original record, not from the GitHub run ID.

```bash
: "${ATTEMPT:?Set the original uncertain operation UUID}"
gh workflow run operate.yml --ref main \
  -f operation=reconcile -f target=live -f attempt="$ATTEMPT" \
  -f change_reference="$CHANGE_REF"
```

Expected: read-only recovery verification, E's exact image and compatible
configuration on the actual serving deployment, healthy requests, the external
flag still off, and only the original owned lock released. Retain both original
and new records and compare the original hash. Reconciliation observes desired
state; it does not prove which prior request caused that state.

Reset F staging with a separate protected `disable`, using `F_STAGING_OFF`,
before deploying G. Use the same disable command above with `target=staging` and
that baseline. Verify staging off and preserve its history.

**Checkpoint 5:** distinguish feature recovery on unchanged F from application
recovery to E. A flag cannot undo writes, migrations, or in-flight effects; this
catalog is deliberately read-only.

## 8. Reproduce the source repair locally

Do this only after both recoveries are verified in the hosted rehearsal. Work in
a separate local source checkout without release credentials. This demonstrates
the reviewed fix, not a new publication. The original repair is PR #13.

From the current operator checkout, create an isolated historical checkout and
copy the actual repaired regression test before applying the source fix:

```bash
git worktree add --detach ../controlled-release-build5-repair \
  68a01714700eb57ae47390fbab611b2abe1dd590
git show 70231ef4f81aaa691ab5ccd41df6dbf254d43ac5:test/server.test.ts \
  > ../controlled-release-build5-repair/test/server.test.ts
cd ../controlled-release-build5-repair
unset GH_TOKEN
npm ci --ignore-scripts
npm test -- test/server.test.ts -t 'ranked workspace completes below 500 ms'
```

Expected: the named HTTP latency test fails (nonzero exit) against F's intentional
delay while checking the unchanged ranked products. Capture the actual failing
assertion and elapsed time. A dependency, port, or network error does not count as
reproducing the latency defect. Do not relax the 500 ms assertion.

Apply the original source repair to this disposable checkout, then rerun it:

```bash
git restore --source=70231ef4f81aaa691ab5ccd41df6dbf254d43ac5 -- \
  src/server.ts src/search-teaching-fixture.ts test/search-admission.test.ts
npm test -- test/server.test.ts test/search-admission.test.ts
npm run verify
```

Expected: exit 0; the source delay/module is gone, the HTTP latency test passes,
and admission/SDK-capacity protections remain. Record the local diff and results.
This reproduces the repair; it does not fix the unrelated 502 or create a new G
build. Return to the current operator checkout, restore normal GitHub verification
authentication, and continue using the retained signed G artifact.

## 9. Release G with fresh evidence and hand it over

Repeat the staging rehearsal and live promotion commands from section 3 with
`build_run=35380922988`. Save the staging off proof as `G_STAGING_OFF` and inspect
its automatically queued internal response-loss rehearsal. Save that authorized
internal proof as `G_STAGING_INTERNAL`.

Before live promotion, test the repaired challenge in staging treatment:

```bash
: "${G_STAGING_OFF:?Set G staging off proof}" "${G_STAGING_INTERNAL:?Set G staging internal proof}"
gh workflow run operate.yml --ref main \
  -f operation=expose -f target=staging -f stage=5 -f apply=true \
  -f evidence_run="$G_STAGING_OFF" -f evidence_attempt=1 \
  -f exposure_run="$G_STAGING_INTERNAL" -f exposure_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Require healthy complete challenge measurements, then promote G's exact digest to
live with live off. The workflow rechecks staging in that same promotion request.
Save its fresh off deployment proof as `G_LIVE_OFF`.

For G live, use section 4's internal command with `G_LIVE_OFF`; save `G_INTERNAL`.
Then use the 5% command with `G_LIVE_OFF` and `G_INTERNAL`; save `G_FIVE`. After
verifying each fresh authorized predecessor, expand:

```bash
: "${G_LIVE_OFF:?Set G live off proof}" "${G_FIVE:?Set healthy G live 5-percent proof}"
gh workflow run operate.yml --ref main \
  -f operation=expose -f target=live -f stage=25 -f apply=true \
  -f evidence_run="$G_LIVE_OFF" -f evidence_attempt=1 \
  -f exposure_run="$G_FIVE" -f exposure_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Save and verify `G_TWENTYFIVE` before the final stage:

```bash
: "${G_TWENTYFIVE:?Set healthy G live 25-percent proof}"
gh workflow run operate.yml --ref main \
  -f operation=expose -f target=live -f stage=100 -f apply=true \
  -f evidence_run="$G_LIVE_OFF" -f evidence_attempt=1 \
  -f exposure_run="$G_TWENTYFIVE" -f exposure_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Authenticate the complete signed 100% artifact immediately with `verify-exposure`.
Expected: `completionEvidence: true`, `authorized: false`, zero errors, adequate
coverage, all 1,000 eligible and 20 internal personas ranked, all 20 excluded
original, and prior treatment membership retained. Completion proves that window,
not uninterrupted future health.

Independently disable staging using `G_STAGING_OFF`. Leave live G at 100% and run
a separate signed monitoring window:

```bash
gh workflow run operate.yml --ref main \
  -f operation=observe-exposure -f target=live \
  -f evidence_run="$G_LIVE_OFF" -f evidence_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Expected after protected approval and verification: healthy unchanged G subject,
`authorized: false`, `completionEvidence: false`. Preserve the monitoring and
completion records separately. Nnenna owns signed daily windows and checks after
deployment, flag or configuration changes; a changed subject needs a compatible
new baseline. No background monitor or automatic disablement is implied.

Retain the flag through Build 5, the known-good images/configurations and native
rollback targets. Flag retirement needs seven healthy daily windows, no unresolved
recovery, and a separately reviewed removal/rollback plan. Archive original records
before expiry. Close with the [rehearsal record](rehearsal.md#acceptance-record)
and [operational follow-ups](../build-05-closeout.md#operational-follow-ups).

**Checkpoint 6:** present completion, monitoring and recovery evidence separately,
name the operating owner, and explain what still prevents flag retirement.

## Recovery reference

| Observation | Preserve and do next |
|---|---|
| Wrong subject, expired approval, stale proof | Hold; retain the rejection. Correct selectors or obtain a new request/fresh observation. No mutation retry or timestamp edit. |
| Missing telemetry, samples, 429, 503, unexpected 502 | Hold; keep failed samples in the denominator. Investigate provider/SDK/application state; separately authorize recovery. |
| Lost mutation response | Keep the attempt and lock. Use `reconcile` or `reconcile-exposure` with its original UUID. No second deployment/PATCH or force unlock. |
| Lost approval response | Inspect GitHub approval/run history first. Do not repeat an approval or dispatch while its outcome is unknown. |
| No healthy predecessor after signing failure | Keep state and samples; diagnose signer/upload failure. Monitoring cannot replace an authorized predecessor. Restart through independently authorized disable and fresh off/internal evidence. |
| Missing artifact, ambiguous history, unavailable rollback | Stop and retain diagnostics. Do not initialize empty state or substitute an unverified image. |
| Budget cannot cover next operation and recovery | Stop before dispatch; report remaining requests and current state for owner direction. |

These commands enact the lab's controls. ThreadLoop's proposed outer-lifecycle
role and GAAP's proposed bounded-agent governance role help explain responsibility,
but neither has a runtime adapter in this repository.
