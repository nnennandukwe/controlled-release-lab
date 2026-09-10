# Controlled release runbook

Build 2 publishes signed image provenance and signs measured deployment evidence.
Live promotion consumes a fresh staging observation and a request-bound GitHub
OIDC identity inside the protected execution path. A signature establishes origin
and integrity; the policy still decides whether its evidence is sufficient. Build 3
added version 2 deployment evidence containing managed flag state and actual
variation samples. Build 4 requires deployment schema 3, feature-proof schema 2,
and exposure policy 2 with query-specific latency assessment. Legacy deployment
schemas 1/2 and unversioned feature proofs remain readable for historical
inspection; they cannot satisfy current-policy execution gates.

The [Build 1 rehearsal](hosted-rehearsal.md) remains a historical record of the
local A → B → A exercise. Its unsigned images and receipts are not eligible for
Build 2 promotion. The [Build 2 closeout](build-02-closeout.md) records the passed
hosted acceptance and completed CI-only credential handoff.

## Prerequisites and trust configuration

Use Node 24.20.0, Docker for container verification, GitHub Actions, public GHCR,
and the dedicated Railway project with separate staging/live environments. Run:

```bash
npm ci --ignore-scripts
npm run setup:verifier
npm run verify
```

The verifier is GitHub CLI 2.100.0, downloaded from its official release and
checked against committed archive and executable hashes in
`config/toolchain.json`. It is installed under ignored `artifacts/bin/`; it does
not replace the system CLI. Supported platforms are Linux x64 and macOS arm64.
Verification needs network access to GitHub/Sigstore and the public registry.

Use the approved public-source/public-image distribution route after inspecting
reachable source history for secrets and private material. Source visibility and
package visibility are separate settings. Do not purchase a tier to bypass an
unsupported private-repository environment or registry setting.

Configure these GitHub environments:

| Environment | Access | Required controls |
|---|---|---|
| `image-publication` | Publisher's scoped GitHub package/attestation token | Owner reviewer; selected branch `main`; administrator bypass disabled |
| `staging` | Staging-only `RAILWAY_PROJECT_TOKEN` secret | Same controls |
| `live` | Live-only `RAILWAY_PROJECT_TOKEN` secret | Same controls |

Allow self-review for this solo-owner lab. An owner-authorized automated approval
is not independent human review. Main must require a PR and the `verify` check,
dismiss stale approvals, prohibit force pushes/deletion, and enforce protection
for administrators. The runtime checks exact environment reviewer identity,
selected main-only branch rule, bypass prohibition, and protected main metadata.
Administrative setup verifies the detailed branch-protection settings separately.
GitHub enforces access before releasing environment credentials.

Put each environment's target map in the variable `LAB_CONFIG_JSON`, using the
shape in `config/lab.example.json`. Keep tokens in Railway's normal project-token
settings and GitHub environment secrets; never pass them in CLI arguments. Verify,
request resolution, and finalization jobs receive no Railway credentials. Coding
agents and the deployed application receive no operator token.

`config/release-policy.json` pins this lab's repository and numeric owner/repository
identities, actual OIDC subject prefix, target identities, configuration fingerprints,
and evidence limits. Forks must review and replace these values and establish their
own protected publisher. Changing the policy invalidates earlier evidence; collect
new proof before promotion. Do not add an allow-all fallback for a fork.

## Railway configuration

Use one replica per environment, no database/volume, no GitHub source, and no image
auto-updates. The service runs `node dist/src/main.js` with `/readyz` health checks.
Set `PORT=3000`, `NODE_ENV=production`, and the selected `LAB_ENVIRONMENT`.
Railway supplies `RAILWAY_DEPLOYMENT_ID`; source SHA is baked into the image.

The expected fingerprint covers start/readiness/region/replica settings plus those
three variables, the three LD mapping settings below, and the SHA-256 identity
of `LD_SDK_KEY`. The raw key is never retained in the fingerprint record. This
is not a full infrastructure snapshot. Doctor shows
the observed fingerprint. A legitimate configuration change needs a reviewed policy
update and fresh evidence; do not paste whatever the provider returned into policy
without inspecting the change.

Local read-only inspection uses the selected environment-scoped token. Flag-aware
observation also requires `LD_READ_TOKEN`. This lab keeps release tokens only in
GitHub environment secrets; use the protected workflow for ordinary hosted work:

```bash
npm run lab -- doctor --target staging
npm run lab -- observe --target staging --duration-seconds 60 --rate 2 --max-requests 120
```

Target-map precedence is `--config PATH`, then `LAB_CONFIG_JSON`, then ignored
`config/lab.json`. `.env.example` documents variables but is not automatically loaded.
The CLI never falls back to Railway desktop OAuth or a remembered linked project.

## Publish a candidate

After review and merge, dispatch **Publish image** on main with a `change_reference`
(existing PR URL or change ID). Review and approve the `image-publication` job.
It builds one linux/amd64 image, tests that exact image, pushes it, and issues
native GitHub SLSA provenance for the pushed digest. BuildKit's extra provenance
manifest is disabled to preserve a single-platform deployment subject; GitHub
attestation is a separate signed provenance record.

Retain `build-record-RUN_ID-RUN_ATTEMPT`. It contains:

- `build-record.json`: schema version 2, exact image/source, producer run and attempt.
- `image.bundle.jsonl`: the native provenance bundle.

The build record is an unsigned selector. Consumers authenticate the image bundle
and compare its certificate-backed producer to the successful publisher run and
protected-main source history. Tags are never a promotion input. Retain the image
and artifacts for at least 90 days, subject to Railway rollback retention.

## Deploy to staging, then promote to live

Dispatch **Operate lab** from main. Inputs:

| Operation | Required inputs beyond `operation`, `target` |
|---|---|
| `doctor` | None; read-only preflight |
| `deploy` | `build_run`, `build_attempt` (default 1), `change_reference`; `apply=true` for mutation |
| `observe` | Same build selectors and reference; collects and signs evidence without mutation |
| `rollback` | `evidence_run`, `evidence_attempt` (default 1), `change_reference`; `apply=true` for mutation |
| `rehearse-recovery` | Staging only, `apply=true`, exact build selectors and reference; automatically queued after publication |
| `reconcile` | Original uncertain `attempt` UUID; reads retained state without repeating the mutation |

Optional `image`/`source_sha` inputs assert the selected build identity. Optional
`deployment`/`restore_attempt` assert the selected rollback record. A mismatch
blocks resolution. Fresh dispatches are required; workflow re-runs are refused.

For staging, resolve the candidate, inspect the immutable release-request artifact
and job summary, then approve the protected staging operation. `apply=false` is a
preview; it does not issue authority or produce deployment proof.

For live apply, the workflow first obtains staging approval and re-observes that
exact candidate currently deployed to staging. It signs the resulting evidence.
Staging must already have verified internal targeting: the fresh proof exercises
both rankings with real SDK evaluations. Live targeting must be off, and its
version/state is bound to the request and checked again before deployment.
Only after the staging-proof job succeeds can the workflow finalize the immutable
live request and ask for live approval. Inspect the resolved digest, source, target,
configuration, policy, change reference, expiry, and request hash in that run.
An approval for a different run or request cannot authorize this mutation.
The signed staging proof must also match the same operator run and the canonical
staging-observation projection of that request, including its change reference,
issuance/expiry, build, policy and image-bundle hash. A fresh proof transplanted
from another request is refused even when the image is identical.

The request expires after 30 minutes. Evidence must contain at least 120 distinct
successful requests over at least 60 seconds, with consistent source, deployment,
environment, and catalog behavior. Apply uses rate 2/sec, concurrency 2, a 5-second
request timeout, and a 90-second total traffic deadline. Clock skew tolerance is
30 seconds. Missing, stale, failed, mixed-subject, or edited evidence blocks live
promotion. These are synthetic baseline criteria, not production SLOs.

All operator runs share one Actions concurrency group across both environments.
It remains held across proof, approval, mutation, and observation. Approval delays
can expire a request; start a fresh dispatch. The lab requires one provider writer:
Railway dashboard actions, other API clients, and image auto-updates must not race
this workflow. Neither local locks nor Actions concurrency can exclude a trusted
Railway administrator, and Railway has no compare-and-set rollback primitive.

`execute()` checks signed provenance and policy, obtains a cryptographically
verified request-bound OIDC token, checks exact run/attempt/job metadata and current
environment protection, and preserves authorization before provider effects.
It checks evidence again before each mutation. The local CLI's `--apply` flag does
not bypass this boundary, even when supplied with a Railway token and GitHub-looking
environment variables. Preview and evidence verification are separate operations:

```bash
npm run lab -- verify --target live --release-dir work/release/current
npm run lab -- deploy --target staging --release-dir work/release/current
```

Download a resolved request artifact into that directory first. `verify` requires
only `--target` and `--release-dir`, uses no Railway credential, and returns
`authorized: false`. A live apply request is available only after staging proof.
A live preview checks selectors/provider readiness; it is not promotion eligibility.

## Evidence and failure handling

Successful deployment requires exact configured image, deployment `meta.image`,
source identity, active deployment, expected configuration, healthy live requests,
and stable provider state across the observation. Absent digest-qualified provider
identity blocks with `IMAGE_EVIDENCE_UNAVAILABLE`.

| Artifact | What it records |
|---|---|
| `release-request-RUN-ATTEMPT` | Immutable manifest and hashed signed attachments |
| `staging-proof-RUN-ATTEMPT` | Fresh staging evidence plus native file provenance |
| `staging-observations-RUN-ATTEMPT` | Raw staging observations, including failures |
| `lab-state-TARGET-RUN-ATTEMPT` | Append-preserved records, per-attempt requests, unresolved locks |
| `lab-proof-TARGET-RUN-ATTEMPT` | Verified deployment observation plus native file provenance |

State upload precedes final evidence signing. Failed signing cannot erase a real
provider mutation; it leaves no eligible signed observation. Start a new protected
`observe` run for the same build after investigating the signer failure.

CLI exit 0 means verified/preview, 1 failed/invalid, and 2 blocked/unknown. A refused
request is not a deployment. A lost response after a mutation is not a retry cue.
The work directory keeps intent, authorization, observations, checksummed records,
and locks. Raw samples preserve failures in the denominator; missing responses
produce a null p95 instead of claiming a complete latency measurement.

## Automated hosted recovery test

Each successful **Publish image** run on main triggers **Queue hosted recovery
test**, which dispatches **Operate lab** with `rehearse-recovery`, staging and
that exact build run/attempt. The queue does not run producer code or receive
Railway credentials. Inspect the resolved request and approve staging to run it.
A successful queue or publication does not establish recovery: the separate
**staging / rehearse-recovery** run must finish successfully, including signing.

The request explicitly binds `purpose: recovery-rehearsal`. Ordinary deployment
cannot consume it, and the rehearsal rejects live targets or preview mode. The
real protected execution path updates the staging image and deploys it once.
A labeled teaching fixture then discards the successful deployment response.
This simulates response loss after a real Railway mutation; it does not simulate
a Railway outage or introduce a broken catalog implementation.

Automated assertions require an unknown outcome, retained lock and durable intent,
then wait for the provider using reads only. Ordinary reconciliation receives the
original attempt UUID, verifies provider/source/configuration identity and collects
120 live requests over 60 seconds. The test requires unchanged original evidence,
no repeated mutation, and a released lock before declaring verified recovery.
Its signed observation carries the rehearsal purpose. Fixture and assertion
records remain under `work/rehearsals/attempts/` in the `lab-state` artifact.
With Build 3 the recovered candidate also runs the feature observation window
before signing version 2 evidence; an off baseline does not prove both variations.

A real failure before injection produces `REHEARSAL_NOT_EXERCISED`; an unresolved
provider state or failed measurement leaves the test incomplete and retains its
underlying evidence. Inspect the original attempt and use a new read-only
`reconcile` dispatch where needed. Do not retry the mutation or delete its lock.
Local tests exercise the same assertions with controlled external seams; only the
protected hosted run establishes actual Railway behavior. Native rollback remains
a distinct acceptance case below.

## Native rollback and separate reconciliation

Retain a successful earlier **live** `lab-proof` run and its image publisher
artifact. After deploying another candidate, select the earlier proof with
`evidence_run` and `evidence_attempt`, target live, operation rollback, and a new
change reference. Inspect the resolved recovery image/deployment before approval.

Rollback verifies the signed earlier observation, exact source/image, current policy,
compatible configuration, provider rollback eligibility, and restored record identity.
A known-good recovery observation does not expire under the staging freshness limit;
the new rollback request and authorization still expire after 30 minutes. Missing
images, expired artifacts, revoked images, or changed policy/configuration block.

Railway native rollback returns a Boolean acknowledgment, not a deployment ID.
The apply run intentionally exits 2 with `ROLLBACK_REQUIRES_RECONCILIATION` and retains
its lock. Start a new **Operate lab** run with `reconcile` and the original attempt
UUID. It restores the failed run's state, observes recovery, writes a new record,
and releases the lock only after provider and live-request evidence agree.
It then signs a new observation under that reconciliation run's identity. The earlier
unknown outcome remains unchanged. Reconciliation proves observed desired state,
not which previous request caused it. No mutation is repeated.

Source alignment precedes deployment/rollback. If that update coincides with a new
latest deployment, `UNATTRIBUTED_DEPLOYMENT` retains the lock for reconciliation.
Final rollback state checks reject observed drift with `ROLLBACK_STATE_CHANGED`.
There is no force-unlock command. Missing/expired state or ambiguous execution history
requires recovery of the evidence, not deletion of locks. History lookup is bounded
to 10 pages of workflow runs and 20 operation attempts; incomplete job/artifact
lookups fail closed. State is retained 90 days and carried into later operations.

Railway rollback restores retained application image/configuration, not external
flags, writes, or migrations. LaunchDarkly feature disablement is a separate
operation described below. Full repaired feature release and completion remain later milestones.

## Controlled feature exposure

Use one server-only boolean flag, `default/catalog-ranked-search`. False is
variation 0 (Original); true is variation 1 (Ranked). Both default and off variation
are 0. Railway staging uses LD `test`; Railway live uses LD `production`. Keep both
environments off during initial setup. Use no prerequisites, segments, experiments,
individual targets, client-side availability, or mobile availability for this flag.

In each environment configure these ordered rules while leaving targeting off:

1. Context kind `user`, attribute `eligible`, is one of `false`: variation 0.
2. Context kind `user`, attribute `cohort`, is one of `internal`: variation 1.

The default serves variation 0. Turn off event tracking on rules and fallthrough.
The operator adds its third rule at 5%: `cohort=eligible`, context kind `user`,
bucket by `key`, 5,000/100,000 weight to variation 1 and 95,000 to variation 0.
The 25% and 100% transitions change only those weights to 25,000/75,000 and
100,000/0. Rule identity, salt, context kind and bucketing inputs stay fixed;
observations must also confirm retention of earlier treatment personas.
Other definitions fail closed. The provider's
rule IDs, salt, variation IDs/order, environment version and managed fields are
included in evidence. The captured wrong-version rejection is in
`test/fixtures/launchdarkly-version-refusal.json` (HTTP 409, unchanged off state).

Install settings through provider secret management, never through source or
container build arguments:

| Location | Setting | Scope |
|---|---|---|
| Railway staging/live | `LD_SDK_KEY` | SDK key from its mapped LD environment |
| Railway staging/live | `LD_PROJECT_KEY=default` | Fixed project |
| Railway staging/live | `LD_ENVIRONMENT_KEY=test` / `production` | Exact target mapping |
| Railway staging/live | `LD_FLAG_KEY=catalog-ranked-search` | Fixed flag |
| GitHub repository secret | `LD_READ_TOKEN` | Reader service token, API version 20240415 |
| GitHub staging/live secrets | `LD_MANAGEMENT_TOKEN` | Writer service token, API version 20240415 |

The Reader is passed to main-only preparation and protected observation steps.
Writer is passed only to the protected exposure/disable step when apply is true.
Developer's ordinary Writer is account-wide; it is not native per-flag/environment
isolation. The adapter requires the dedicated single-project account and permits
only this flag and the five existing `ld-example-*` onboarding flags. Unrelated
resources require revisiting isolation. Do not make paid custom roles or Guardian
an unstated prerequisite. Keep one SDK client per service and verify usage remains
within the selected plan's service-connection allowance after deploy overlap.

Missing hosted keys or incorrect mapping prevent startup. An initialization failure
serves original behavior with `fallbackUsed: true`; that cannot pass release
measurement. An initialized SDK can keep serving cached values during disconnection.
`/readyz` and `sdkInitialized` do not assert control-plane freshness.

The HTTP selector accepts `internal-001` through `internal-020`,
`eligible-0001` through `eligible-1000`, `excluded-001` through `excluded-020`,
and `anonymous`. Omission means excluded anonymous. Attributes are server-derived;
query attempts to override cohort/eligibility are rejected. These are publicly
selectable demonstration identities, not employee authentication.

### Deployment and audience sequence

Publish each candidate once and finish its staging recovery rehearsal while the
flag is off. Retain its signed staging `lab-proof` run as the off baseline.
Publication requires separate authorization. Allowed transitions are
`off → internal → 5 → 25 → 100`; independent disable is allowed from any stage.

| Operation | Inputs in addition to target and change reference |
|---|---|
| `expose`, stage `internal` | `evidence_run`/`evidence_attempt`: signed off deployment baseline; `apply=true` |
| `expose`, stage `5` | Same off baseline, plus `exposure_run`/`exposure_attempt`: successful internal exposure; `apply=true` |
| `expose`, stage `25` | Same off baseline, plus `exposure_run`/`exposure_attempt`: successful 5% exposure; `apply=true` |
| `expose`, stage `100` | Same off baseline, plus `exposure_run`/`exposure_attempt`: successful 25% exposure; `apply=true` |
| `disable` | Same retained off deployment baseline; `apply=true`; no healthy prior treatment required |
| `observe-exposure` | Off deployment baseline; measures current state without PATCH |
| `reconcile-exposure` | Original uncertain exposure `attempt` UUID; no apply |

A successful **staging / rehearse-recovery** run automatically queues the
staging internal exposure with `rehearse_response_loss=true` in **Operate lab**
from its dependent dispatch job, after signed proof has been uploaded. The
dispatch does not depend on a second `workflow_run` event, which a workflow-token
producer may suppress. The child receives the parent's validated change reference
unchanged, keeping the approved audit trail continuous.
Review and approve that queued request; do not dispatch a duplicate. For a fresh
manual rehearsal, the same inputs are available in the workflow form. The resolved request names `purpose=response-loss-rehearsal`, which must
match the command before any effect. This uses the same protected staging
approval and Writer scope. The rehearsal sends one real conditional flag update,
discards the successful response as a labeled teaching fixture, verifies the
original unknown outcome and retained lock, then runs read-only reconciliation.
It asserts one update call, unchanged original evidence, and a released lock only
after real cohort observation verifies recovery. It does not simulate a natural
LaunchDarkly outage. The raw fixture and original record remain in `lab-state`;
the recovered exposure receives the ordinary signed `lab-proof` artifact.

The CLI equivalent adds `--rehearse-response-loss` to an applied internal staging
`expose` command. Live, percentage stages, disable and preview rehearsals are rejected before
provider access. If interrupted, restore the retained state and use ordinary
`reconcile-exposure`; never rerun the original mutation. This protected hosted
check follows the main-branch implementation merge; PR tests use REST seams and
must not be described as hosted acceptance.

Build 3 performed staging internal exposure, promoted E's exact digest through
the both-variation staging proof and live-off guard, then performed internal,
5%, and disable in live. Its closeout records E off in both targets. Build 4's
sequence is below; those historical observations cannot authorize its operations.
A request expires after 30 minutes; an expired initial off baseline needs a new
protected `observe` run before internal exposure. The retained off baseline remains
usable for disable and the paired latency comparison after expansion.

Local equivalents, after downloading the resolved artifact into the named directory:

```bash
npm run lab -- expose --target live --stage internal --release-dir work/release/current
npm run lab -- expose --target live --stage 5 --release-dir work/release/current
npm run lab -- expose --target live --stage 25 --release-dir work/release/current
npm run lab -- expose --target live --stage 100 --release-dir work/release/current
npm run lab -- disable --target live --release-dir work/release/current
npm run lab -- observe-exposure --target live --release-dir work/release/current
npm run lab -- reconcile-exposure --target live --attempt 'replace-with-attempt-uuid'
```

Only the matching protected job can add `--apply`. Exposure accepts no raw flag
JSON, target override, sampling override or skip-check switch. Preview reads and
verifies evidence but sends no PATCH. A new request binds image, source, deployment,
configuration, policy, roster, intended audience, provider version and operator run.

Legacy deployment evidence remains historical. Establish a compatible schema 3
off baseline under the current exposure policy before replacing a rollback target.
Keeping old records does not authorize their old policy or configuration. Current
exposure envelopes still use schema 1, but their embedded feature proof is schema 2.

### Measurement and recovery

The workload is fixed before measurement:

| Stage | Requests and minimum window | Workload |
|---|---|---|
| Internal | 120 over 60 seconds | 20 personas from each cohort, each with `keyboard` and `compact` |
| Off, 5%, 25%, 100% | 1,160 over 120 seconds | `workspace` for all 1,040 personas, plus `keyboard` and `compact` for 20 personas from each cohort |

Internal and the initial staging checks cover normal queries only in treatment;
they do not evaluate ranked `workspace`. At 5% the challenge query enters treatment
testing. Every required query/variation group needs at least 20 distinct personas.
At 5% and 25%, `workspace` needs at least 20 eligible treatments and 200 eligible
controls; internal traffic cannot fill that denominator. At 100%, all 1,000 eligible
and 20 internal personas must receive ranked behavior, while all 20 excluded
personas remain original. Stable hashing does not promise exactly a percentage
of this finite roster. Each expansion consumes its fresh immediate predecessor's
authorized exposure proof; a read-only `observe-exposure` is never a replacement.

Launches are limited to 10/sec, concurrency 2, five-second request timeouts,
1,200 requests and a 180-second deadline. No resampling, deadline extension or
threshold relaxation is permitted to obtain a pass.

The public application separately admits at most 16 pending searches per process,
with a 20-request burst replenished at 20/second. Each network client is also
limited to four pending requests and a 12-request burst replenished at 12/second.
Excess traffic receives HTTP 429
and `Retry-After: 1`; it is never queued. Client disconnect cancels the teaching
timer, and permits release on success, failure or cancellation. The server caps
connections at 64, requests per socket at 100, headers/requests/socket inactivity
at five seconds, and keep-alive at one second. These fixed source settings require
no runtime switches and remain above the declared operator workload. A 429 during
acceptance is a failed sample, never permission to retry until green.

Flag evaluation has a one-second deadline independent of the teaching delay.
Disconnect or deadline ends the HTTP wait and restores admission. At most 16
underlying SDK evaluations may remain outstanding, with at most four per client;
if they stall, new admitted
requests return controlled 503 responses until evaluation recovers, rather than
accumulating abandoned SDK work. Readiness remains a process check, not proof of
healthy flag evaluation.

If evaluation never settles, the bounded SDK capacity intentionally stays
unavailable; a timeout cannot cancel arbitrary SDK work. Retain the 503 samples
and hold the release. Inspect SDK/provider health and separately authorize an
application restart or native rollback, then verify provider state and a fresh
complete workload. Do not reset counters while the underlying work remains alive,
or interpret responsive readiness as recovery. No automatic evaluator replacement
or restart is implemented by this lab.

The existing hosted targets use Railway's public HTTP proxy. Client quotas use
its `X-Real-IP` header; Railway documents that header and its staff confirms that
the edge always overwrites it and public clients cannot reach the app directly.
See [the header documentation](https://docs.railway.com/networking/public-networking/specs-and-limits)
and [the proxy trust contract](https://station.railway.com/questions/need-authoritative-railway-client-ip-p-b7a7b4bd).
Local mode ignores forwarding headers and uses the socket address. A missing,
invalid or ambiguous hosted address returns 503 `CLIENT_ADDRESS_UNAVAILABLE`:
check ingress through the configured Railway HTTP domain. Do not add a direct TCP
proxy or place an unverified proxy in front of this contract. Recheck the ingress
mapping before hosted acceptance; local header tests do not verify the provider.
At most 1,024 client quota entries are retained in memory; released idle entries
expire on the next admitted-capacity check after 60 seconds. Active entries are
never evicted. Addresses are not added to evidence or application responses.
Shared egress/NAT clients share a quota; this is bounded demo admission, not a
general guarantee against distributed denial of service.

The policy query roles and stage order are fixed contracts. Startup rejects edits
that disagree with `keyboard, compact, workspace` or `off, internal, 5, 25, 100`,
instead of hashing a new declaration while silently running old gates. A future
change must update collection, result expectations, baseline schemas and stage
consumers together, and collect new evidence under its revised policy.

Every sample retains actual value/index/reason, context, latency, response identity
and result ordering. The operator requires zero functional/identity/evaluation
errors. Exposure operations compare aggregate p95 with max(500 ms, twice aggregate
off p95), and each query/variation p95 with max(500 ms, twice that query's off p95).
Deployment observations,
including initial off and staging rechecks, have no paired off proof and use an
absolute 500 ms per-query bound; their `baselineQueryP95Ms` is explicitly null.
Their raw query metrics record the actual measurements. Every exposure operation
requires non-null baselines recomputed from its authenticated off window, never
keyboard latency substituted for another query. These baselines remain bound to the same image,
deployment, configuration and policy.
These are tutorial thresholds, not production SLOs. Missing responses and missing
cohorts hold; the operator never discards failures or resamples until green.
A passing p95 alone cannot establish coverage: at a sustained 500 ms per request,
1,160 requests cannot fit into 180 seconds with two concurrent requests. That
window holds with `OBSERVATION_BUDGET_EXHAUSTED` and retains its samples. Any change
to the bounded policy requires review and a fresh request; no automatic expansion
is allowed. Provider and flag snapshots must stay consistent throughout the window.

Before PATCH, the operator preserves the exact request and verifies its native
GitHub signature chain and request-bound protected identity again. The same PATCH
tests the environment version and managed fields before replacing targeting.
The generated variation IDs and environment salt/selector are pinned in
`config/exposure-policy.json` when creating the lab flag. Reads and writes must
match that identity, so two matching tokens for a different account cannot select
a different flag with the same key. Recreating the flag requires a reviewed policy
update and fresh evidence. Both Reader and Writer must identify the same account through the provider
caller-identity API. The Writer independently checks project/flag scope and the
current managed state before PATCH. All management reads use one bounded attempt;
a throttled or failed read blocks without retrying. A definite 409 conflict sends
no effective update and requires a new request.
A lost response or uncertain effect retains a shared deployment/exposure lock.
`reconcile-exposure` reads the original attempt, verifies the desired state and
collects a new window without repeating PATCH or rewriting the original record.
If stable provider readback establishes the desired state but the new measurement
is unhealthy, reconciliation records `blocked` and releases only the original
attempt's owned lock. The original `unknown_outcome` record remains unchanged;
known application of the flag is separate from measured health.

A confirmed exposure with an unhealthy measured hold records `blocked` and permits
a separately authorized disable. Disable changes only this flag to off; it does
not redeploy. Recovery needs off provider state, false non-fallback evaluations,
original ordering for the full roster, and the same serving image/deployment.
Cached true responses leave recovery unverified. If observation signing or upload
fails, state and samples remain in `lab-state`; no signed evidence is claimed.
A fresh `observe-exposure` can measure current health after signing is repaired,
but cannot replace the missing authorized predecessor. To restart an expansion
chain, independently disable and obtain fresh off/internal evidence.
Neither a green workflow nor a 2xx response alone means the feature recovered.

Exposure files live under `work/exposure/attempts/UUID/`; `exposure-record.json`
and its SHA-256 sidecar are immutable. `lab-proof` contains
`exposure-evidence.json` plus `evidence.bundle.jsonl` for exposure operations,
or `deployment-evidence.json` plus the bundle for deployment operations.
Historical records are preserved. New deployment proof is schema version 3;
feature proofs use schema 2; exposure requests, records and envelopes use schema 1.

Completed unhealthy observations publish a separate `lab-diagnostic-<target>-<run>-<attempt>`
artifact with `exposure-diagnostic.json` and `evidence.bundle.jsonl`. Its verifier
allows a failed operator run only when that exact job successfully sealed,
attested and uploaded the diagnostic. Ordinary eligibility verification still
rejects failed runs and blocked records. After downloading the whole artifact:

```bash
npm run lab -- verify-diagnostic --target live --release-dir artifacts/failed-exposure
```

This needs GitHub/Sigstore access and `GH_TOKEN`, but no Railway or LD credentials.
The result is `diagnostic_authenticated` with `authorized: false`. Its
`recordedOutcome`, `recordedReasonCodes` and `recoveryInstruction` preserve the
authenticated operation decision. `featureAssessment` separately recomputes the
standalone feature window from raw samples. That assessment can be healthy while
the operation is blocked by a cross-stage treatment-retention check; the verifier
does not have the predecessor attachment to recompute that check. Neither result
authorizes expansion. A missing bundle or failed signing/upload is not
a verified diagnostic. `work/last-result.json` is only a derived pointer for the
current workflow run and operation; a new invocation removes a stale pointer.

### Build 4 hosted execution

The [approved plan](../.plan/build-04-regression-repair-release.md) separates two
implementation PRs with hosted failure and recovery between them. Before any
publication or live change, obtain authorization for the concrete source/digest,
operations, and cumulative request budget. The proposed ceiling is 40,000 search
requests including retries across both candidates. Keep a ledger of every
deployment probe, feature window, recovery window, failed/incomplete attempt and
manual search. Stop before the next window would exceed the remaining budget.

1. Recheck provider scope, serving E image/deployments, compatible configuration,
   flag identity/state, unresolved locks, and E's native rollback eligibility.
   Use the source/image/run identities in the Build 3 closeout only as selectors;
   provider reads must confirm them. Do not introduce F without a retained E
   rollback target. Collect fresh signed `observe` off deployment proofs of E in
   both environments with the new operator policy, selecting E's original image
   publication. This refreshes evidence without rebuilding E.
2. Publish F once after PR 1 merges. Complete staging response-loss deployment
   recovery and its queued normal-query internal flag rehearsal. The declared
    fixture adds an asynchronous 1,000 ms delay only when ranked search evaluates
   true for normalized `workspace`. It changes no result membership or ranking,
   and has no runtime switch. These checks make no ranked challenge-latency claim.
3. Promote F's exact digest with live off, retaining its live off baseline. Run
   protected internal then 5% exposure, each with the required fresh evidence.
   Retain the signed unhealthy diagnostic and raw samples. Attempt to resolve
   25% using the failed 5% run: it must refuse before any PATCH because no healthy
   predecessor proof exists. Do not bypass the hold or repeat favorable windows.
4. Independently authorize `disable` using F's retained live off baseline. Verify
   all 1,160 requests return original behavior on the same F deployment, with
   the provider flag off. Then independently perform native rollback using E's
   fresh schema 3 proof. Retain the acknowledged unknown outcome, run `reconcile`,
   and verify E's digest, compatible variables, live identity/behavior, unchanged
   external off flag, and resolved owned locks. Reset staging with its own
   separately protected disable.
5. Only after both recoveries are verified, implement PR 2: add a failing HTTP
   latency regression test against F, remove the source delay to produce G, and
   retain that passing regression test without changing workload or thresholds.
   Run full verification and the complete local/current-head PR review loop.
6. Publish G once. Complete staging recovery and internal checks, then staging 5%
   to verify the challenge workload in treatment. Promote that same digest to
   live with exposure off and retain a fresh off baseline. Complete live internal
   → 5% → 25% → 100%, using separate protected actions and fresh immediate
   predecessor evidence. Independently disable staging after promotion.
7. Run an additional signed live 100% `observe-exposure` window. Verify the signed
   authorized 100% exposure proof as release-completion evidence; the extra window
   is monitoring evidence. Leave live G at 100% of eligible synthetic personas,
   excluded controls original, and staging off. Write a factual Build 4 closeout
   linking F's failure, both recoveries, G's repair/source/image, every rollout
   stage, and the first monitoring observation, including uncertain attempts.

Each operation above uses **Operate lab** inputs in the table. Evidence selectors
always identify exact producer run/attempts; never rerun an old mutation job.
The automated image-to-staging and staging-to-internal queues still require their
protected owner approvals; inspect existing queued requests before dispatching.

### Operator monitoring and retained recovery

After downloading the entire signed 100% exposure artifact, authenticate it with:

```bash
npm run lab -- verify-exposure --target live --release-dir artifacts/completed-exposure
```

This verifies the exact signature and successful producer, current policy, subject,
and raw measurements. `completionEvidence: true` requires a fresh healthy 100%
authorized exposure (or its verified reconciliation); a read-only monitoring
record returns false. `authorized: false` means this verification grants no new
mutation permission. It proves the recorded window, not continuing service health.
Run it promptly: current proof freshness is 30 minutes.

Nnenna runs one signed live `observe-exposure` window daily and after any deployment,
flag or configuration change. Build 4 includes the first additional 100% window.
Use G's off deployment baseline for the unchanged subject; a changed deployment
or configuration needs a fresh compatible baseline. Read the recomputed aggregate
and query/variation metrics, zero-error/identity gates, complete roster and full
window before recording healthy status. Missing telemetry or inadequate coverage
is a hold. Investigate and separately authorize disable or rollback when needed.
There is no unattended monitor or automatic disablement.

Retain the flag through the Build 5 rehearsal. Removal requires seven healthy
daily windows, no unresolved recovery, and a separately reviewed removal and
rollback plan. Retain images, compatible configuration and native rollback
targets; a flag cannot undo writes, migrations or in-flight effects. Before the
existing 90-day GitHub artifact retention expires, archive original state,
requests, envelopes, bundles and referenced artifacts with their hashes and run
identities. Preserve failed and uncertain history alongside successful proofs.

## Acceptance and cleanup

Build 2 hosted acceptance requires a protected CI baseline C, candidate D promoted
through staging to live, native rollback to C, and separately verified recovery.
The [recorded rehearsal](build-02-closeout.md) passed this sequence and its credential
handoff is complete. Preserve failed attempts as well as successful signed records. Local tests, merged
code, public images, and green CI alone do not establish that outcome.

After rehearsal, inspect usage. Stop/delete only the dedicated lab's resources with
cleanup authorization. Do not touch unrelated projects or discard retained recovery
artifacts. A rehearsed system proves behavior, not participant learning or adoption.

## References

- [GitHub artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations)
- [GitHub workflow inputs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Railway deployment API](https://docs.railway.com/integrations/api/manage-deployments)
- [Railway rollback](https://docs.railway.com/deployments/deployment-actions)
