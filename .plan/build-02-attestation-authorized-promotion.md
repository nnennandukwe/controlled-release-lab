# Build 2: Attestation and Authorized Promotion Build Plan

## Summary

Make deployment consume authenticated evidence and enforce permission at the
mutation. A candidate image must come from the trusted GitHub publisher. Live
promotion must use that exact digest, a fresh signed staging observation, the
current policy, and a protected workflow authorization. Demonstrate rejection
before Railway changes, then perform a real staging-to-live promotion and
recovery through the authorized path.

Authority: the owner's five-build sequence, [tutorial brief](../docs/tutorial-brief.md),
[platform plan](../docs/platform-plan.md), [Build 1](build-01-hosted-baseline-recovery.md),
and September 9 instruction to proceed, fix reviews, merge working code, handle
deployments, and plan the next build without repeated routine confirmation.
The approved destination is public source and images when ready. This plan
does not claim that publication or Build 2 execution has occurred.

Starting baseline: merged `main` at
`2e2bc8dc4c9583b80c1e58effaed0993e766ba90`, PR #1. See the
[closeout](../docs/build-01-closeout.md) for current checks and hosted identities.
Build 1's locally produced images and checksummed records remain historical
evidence; they do not satisfy this build's signed-producer policy.

Review unit: one implementation PR on `feat/attested-promotion`, including
contracts, verifier, runtime gate, workflows, failure tests, and operator docs.
Post-merge hosted execution will produce a separate factual acceptance record.
An attestation supplies evidence. Protected execution and policy determine
what that evidence permits. Neither is a claim that the feature release is
complete; actual cohort exposure, runtime regression, and repaired rollout
remain later builds.

## Skills To Use

| Stage | Skill | Responsibility and required evidence |
|---|---|---|
| Rules | `qodo-get-rules` | Apply the already retrieved repository rules below before implementation; preserve their identifiers and requirements. Refresh only if scope changes materially. |
| Design | `codebase-design` | Keep trust verification and promotion decisions behind small interfaces; test through those interfaces instead of introducing a general workflow engine. |
| Behavior | `tdd-bdd` | Implement each vertical slice below red, green, then refactor; keep the failing assertion and its resulting regression together. |
| State and risk | `workflow-invariants` | Encode candidate, eligible evidence, authorized mutation, unknown outcome, and recovery transitions; invalidate eligibility without deleting historical evidence. |
| Failure proof | `failure-path-testing` | Exercise tampering, stale subjects, forged authorization, provider failure, and cross-job recovery with real process/filesystem seams. |
| Operator interface | `cli-interactive-parity` | Keep CLI arguments, workflow inputs, JSON results, help, and runbook synchronized; there is no interactive slash-command surface here. |
| Focused audit | `dx-audit` | Audit changed release commands, errors, setup, and docs before review; resolve P1 findings and execute the material verification gaps separately. |
| Pre-PR review | `qodo-review` | Review the complete final diff against a pushed fixed base, with self-contained rationale and source references; reproduce findings and rerun verification/review after fixes. |
| PR follow-through | `qodo-review-resolver` | Inspect completed review at the exact PR head, fix confirmed issues, push, and check freshness before merge. Preserve any disposition/tooling discrepancy honestly. |

Qodo Local Review: eligible Git worktree with accessible remote and pushed
base `2e2bc8dc4c9583b80c1e58effaed0993e766ba90`; previous local and PR reviews
worked. Execution will recheck access. A tool failure is not a passing review
or an eligibility skip. The user has already authorized fixes and pushes;
skill defaults will not introduce repeat permission requests for that scope.

No dedicated TypeScript, GitHub attestation, or Railway skill is available.
Use pinned dependencies, primary documentation, captured contracts, and native
tests. The selected invariant and failure skills cover the concrete trust and
state risks; a second generic architecture audit or transaction framework
would duplicate them. No UI, LaunchDarkly SDK, content-draft, or ThreadLoop/GAAP
implementation is part of this build. Generic `code-review` is replaced by
eligible Qodo Local Review in this planning method.

Rules loaded through Qodo on September 9 (names abbreviated here; requirements
are carried into the contracts/tests below):

| Reference | Severity | Application |
|---|---|---|
| 1060881, Preserve image metadata consumed downstream | error | Keep digest, source revision, build run identity, registry name, and labels; migrate publisher and consumer together. |
| 3136572, Verify release evidence provenance and subject identity | warning | Verify signatures and approved producer before parsing evidence for a decision; bind the exact image/source. |
| 3136565, Bind immutable artifacts and context | warning | Signed observations carry source, image, deployment, configuration, audience, and actual window. |
| 3136612 / 3136608, Separate credentials / runtime authorization | warning | Release secrets remain in protected jobs; every mutation checks authenticated run identity and policy in code. |
| 3136589, Preserve rollback artifacts | warning | Retain at least the current and previous image, authenticated observation, and compatible configuration. |
| 3136629, Document authorization for live/publishing effects | warning | Require a validated change reference in publication and mutation requests; record it with the effect. |
| 3136579, Missing/low-volume telemetry is insufficient | warning | Require a complete bounded sample and reject stale or missing observations. |
| 1, Pin dependency versions | warning | Exact npm versions and lockfile, action commit pins, pinned verifier binary/checksum. |
| 3136634 / 3136623, Secret handling / synthetic data | warning | Standard secret stores only; no token output, prompt collection, customer data, or secret-bearing test fixtures. |
| 8184 / 7205 / 576985, English identifiers/comments and ASCII literals | warning | Use English and ASCII in added code/config/help; retain explicitly marked protocol fixtures faithfully. |
| 613754 / 699152 / 2119918, Meaningful identifiers and complete config | warning | Use domain names and validated configuration; generated runtime config cannot contain unresolved values. Examples are explicitly non-executable until configured. |

Rules 3136583 and 3136593 concern independent feature-disable/rollback behavior
and irreversible writes. Preserve app rollback; defer feature flag execution
to Builds 3–4. This read-only catalog introduces neither migrations nor writes.

## Scope

In scope:

- Publish build provenance for the exact container that was tested and pushed.
- Authenticate structured staging/live observation files, including raw samples.
- Bind approval to a resolved immutable operation request, not a mutable tag or
  an editable path supplied after approval.
- Enforce provenance, freshness, target/configuration, policy, and protected-run
  identity before source update, deployment, or native rollback.
- Move ordinary mutations to protected Actions jobs; keep local inspection and
  verification usable. Preserve unknown-outcome reconciliation and rollback.
- Configure the approved public-repository path, branch/environment protection,
  and scoped credentials as a sequenced rollout after readiness checks.
- Prove the real publisher/verifier and Railway promotion/recovery contracts.

Out of scope:

- Flagged ranking, percentage cohorts, metrics by flag variation: Build 3.
- Seeded latency regression, feature disablement, repair, 100% rollout and human
  release completion: Build 4.
- Tutorial publication, workshop packaging, learner/commercial measurement: Build 5.
- SBOM/vulnerability programs, semantic-agent confidence scoring, custom PKI,
  multiple cloud hosts, databases, a hosted controller, or additional accounts.
- Protection against a malicious repository/Railway administrator or a compromised
  trusted runner. No claim of SLSA level certification or independent human review.

## Package Layout / File-to-Task Mapping

| File | Change and ownership |
|---|---|
| `tools/attestation.ts` (new) | Bounded invocation of the pinned `gh attestation verify`; validate verified output. Keep raw bundle parsing outside policy decisions. |
| `tools/promotion.ts` (new) | Strict release request/evidence/policy contracts, eligibility decision, GitHub OIDC authorization verification, and request-bound decision receipt. |
| `tools/operations.ts` | Call the mandatory gate from `execute` before mutations; retain existing drift checks, journals, locks and native-rollback reconciliation. |
| `tools/evidence.ts` | Preserve v1 operation-record readers; add durable decision/link events without rewriting archived records or pretending checksums authenticate them. |
| `tools/lab.ts` | Add `verify` and `--release-dir`; reject ambiguous apply inputs and ordinary local apply without protected-run authorization. |
| `tools/workflow.ts` | Resolve requests and evidence by exact run/attempt/artifact identity; adapt previous-operation restoration to the new job graph. |
| `tools/workflow-guard.ts` | Verify actual selected-main branch policy, reviewer identity, bypass configuration, and active target; reject generic nonempty protection settings. |
| `.github/workflows/image.yml` | Build/test once, push, attest digest, verify emitted provenance, preserve signed build record and change reference. |
| `.github/workflows/operate.yml` | Resolve request, refresh staging evidence for live deploy, approve target job, reverify and execute; sign eligible observation and retain all operation state. |
| `config/release-policy.json` (new) | Versioned trusted identities, exact target map/fingerprints, time/sample limits and revoked digests; reviewed policy, never supplied by a downloaded bundle. |
| `config/toolchain.json`, `tools/setup-verifier.ts` (new) | Pin/install the repository-local GitHub CLI with official per-platform checksums; do not replace the user's global CLI. |
| `package.json`, `package-lock.json` | Add the exact JWT verification dependency and setup script; preserve existing test/build scripts. |
| `test/attestation.test.ts`, `test/promotion.test.ts` (new) | Verified-output contracts, signature failures, current policy, freshness, and authenticated permission cases. |
| Existing CLI, operation, evidence, workflow and guard tests | Prove integration, no-mutation failures, compatible recovery, changed job-history interpretation, and command parity. |
| `test/fixtures/attestation/` (new) | Public, authentic bundles and sanitized verified output with producing run/source references; label synthetic negative fixtures. |
| `docs/runbook.md`, `README.md`, `.env.example`, `docs/railway-connection.md` | Current setup, exact commands, credential transition, limitations, and recovery instructions. |
| `docs/build-02-acceptance.md`, `docs/evidence/build-02/` (new, execution only) | Actual run IDs, subjects, refusals, before/after provider snapshots, signed evidence and observed recovery. |

## Dependencies And Settings

- Keep Node 24.20.0, TypeScript, Vitest, tsx, zod and the pinned container base.
- Add `jose` **6.2.12**, resolved from npm during planning, as an exact development
  dependency for operator-side JWT/JWKS verification; the catalog runtime will not
  import it. Update the lockfile. Use library verification, never a custom JWT
  signature implementation. [Library](https://github.com/panva/jose).
- Pin the repository-local verifier to GitHub CLI **2.100.0**. The global CLI is
  currently 2.74.0; do not depend on whichever version happens to be on a runner.
  Resolve official Linux amd64 and macOS arm64 asset checksums into the toolchain
  config during implementation before executing downloads; validate that the
  binary reports the expected version. [Release](https://github.com/cli/cli/releases/tag/v2.100.0).
- Pin `actions/attest` to `1e69f48acb82d1966a394da916b4c1698aa569d6`
  (v4 reference resolved September 9). Preserve other existing action pins.
- Keep v1 operation records. Add a separate v1 release-request schema, v1
  deployment-evidence envelope and v1 release-policy schema, all strict. Authenticity
  comes from the signed envelope file, not a new field in an old record.
- Maintain `config/lab.json` or `LAB_CONFIG_JSON` target setup precedence for
  read-only operations. Applied requests must exactly match the reviewed policy
  target. Never accept a caller-selected policy file or verification-root override.
- Ordinary developer credentials: GitHub read/push as needed, no Railway release
  secret in build/test jobs. Environment secrets: one `RAILWAY_PROJECT_TOKEN` per
  staging/live target. No repository-level deployment secret or account-wide OAuth.
- Use Actions' ephemeral `GH_TOKEN`, OIDC request URL/token and verified OIDC JWT
  only in the expected jobs. No JWT/token in receipts, artifacts, CLI arguments,
  debug output, or process errors. Persist only validated public claim summaries.
- Publisher gets `contents: read`, `packages: write`, `attestations: write`,
  `id-token: write`, plus existing protection-read access. Observation signing
  gets `contents: read`, `actions: read`, `attestations: write`, `id-token: write`;
  it signs file artifacts and does not need registry write. Add no artifact-metadata
  or cloud permissions unless an exercised API explicitly requires them.
- Policy defaults: staging proof age <= 1,800 seconds; clock skew <= 30 seconds;
  observation >= 60 seconds, >= 120 requests, zero failed requests, all identities
  matching; rate 2/sec, concurrency 2, timeout 5 seconds, total deadline 90 seconds.
  Apply cannot weaken these through CLI measurement flags. They are lab acceptance
  thresholds, not a production SLO or feature-rollout policy.
- Bound verifier subprocesses to 60 seconds and 10 MiB output; network reads to
  10 seconds with finite retries only for read failures already classified transient.
  No retry of a possibly submitted mutation. Artifact retention remains 90 days,
  with no cleanup of the currently deployed or immediately previous recovery image.

GitHub's public-repository path supports the selected artifact-attestation and
required-reviewer features on the current non-enterprise plans. Private-repository
attestations require Enterprise Cloud; required reviewers are likewise restricted
on the lower plans. This build will use the previously selected public route and
will not purchase an upgrade. [Attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations),
[environment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Canonical Contracts

### Identity and evidence

Treat these as distinct subjects:

1. **Image**: exact `ghcr.io/nnennandukwe/controlled-release-lab@sha256:...`,
   source SHA and producer run/attempt. Publish native SLSA build provenance for
   this digest only after the same image passes the existing container checks.
2. **Deployment evidence file**: sign the bytes of `deployment-evidence.json`
   using native build provenance with `subject-path`. Its strict JSON envelope
   contains `schemaVersion`, `kind: deployment-observation`, the complete original
   operation record, and context: image/source/build run, operator SHA/run/attempt,
   target, configuration fingerprint, audience `synthetic-catalog-baseline`, actual
   window/samples, policy digest, request digest, authorization decision reference,
   and `notEvaluated` including semantic correctness and feature cohorts.
   Verify the file signature before consuming the JSON. The record contains its
   raw samples; auxiliary files are linked by byte hashes and verified on read.
3. **Release request**: schemaVersion 1, operation `deploy|rollback`, target name
   and full target identity, exact image/source, policy byte digest, expected target
   configuration fingerprint, change reference, workflow run/attempt and operator
   SHA, issue/expiry times, attachment hashes, plus rollback deployment and saved
   record identity when applicable. Missing/unknown fields fail schema validation.

Use ordinary provenance for both images and files. No custom predicate or signing
service is required for this slice: the signed file contains the richer evidence
schema. Preserve build metadata for consumers and retain the downloaded bundles
with the bytes they authenticate. [Attestation action](https://github.com/actions/attest).

Trusted image signer: this repository's `.github/workflows/image.yml` at
`refs/heads/main`. Trusted evidence signer: `.github/workflows/operate.yml` at
`refs/heads/main`. Both must use GitHub-hosted runners and GitHub's OIDC issuer.
Verify exact repository, certificate identity, source ref and source digest with
the CLI, then parse only its successful `verificationResult`. Reject empty,
malformed, oversized, unexpected or contradictory verified results. Bind image
source to the image producer; bind evidence-file source to the **operator** SHA.
Those SHAs need not match. Signatures authenticate the producer's claim; they do
not independently prove a test was adequate. [Verifier contract](https://cli.github.com/manual/gh_attestation_verify).

Require producer/operator commits to be reachable from the protected main
history and their workflow paths to match current trusted policy. Use exact run
and attempt metadata, not latest-run selection. Exclude fork/PR/tag producers,
failed producer jobs, revoked digests, and self-hosted runners. A historical
successful job may issue evidence; a still-running parent workflow is acceptable
only for the specific completed upstream staging-proof job in the **same**
promotion run. A downstream `needs` success and exact artifact ID are required.

### Authorization and mutation

The policy will pin repository ID `1359427592`, owner ID `22972707`, names,
workflow paths, target UUIDs, expected configuration fingerprints, and limits.
The code and policy checked out from protected main are trusted configuration.
A receipt, downloaded policy, environment boolean, or change-reference string
cannot manufacture authorization.

For apply, `execute` will obtain and cryptographically verify a short-lived
GitHub OIDC JWT using `jose`, the fixed issuer/JWKS URL, allowed algorithm, expiry,
issued/not-before bounds, and an audience containing the release-request SHA-256.
Require the fixed repository/owner IDs, main ref, workflow ref/SHA, expected
environment, `workflow_dispatch` event, GitHub-hosted runner, run and attempt.
Compare against server-returned run/job metadata and the resolved request. Never
trust `GITHUB_ACTIONS=true` as identity. Determine the exact `sub` from this
repository's configured OIDC format and record it in policy during setup: GitHub
now supports immutable subjects containing numeric repository/owner IDs. Verify
the supported claims from an actual protected job without logging the JWT.
[OIDC claims](https://docs.github.com/en/actions/reference/security/oidc).

Environment approval controls job start and secret access. The protected job
will load the already resolved request, compare attachment hashes and current
policy, verify its own identity, and evaluate evidence again immediately before
the first mutation. Recheck expiry and identity before subsequent mutations;
an expired authorization after a source update leaves an unknown outcome for
reconciliation, never a retry. Persist the decision and request hash before
the first effect. No public `approved: true` or `skip-verification` option.

This gate constrains the shipped operator and ordinary coding path. A trusted
administrator holding Railway credentials can still call Railway directly or
change repository policy. Document that boundary, retain the Build 1 single-writer
assumption, and never claim this local check removes administrator authority.

### CLI and workflow surfaces

New forms (the directory is generated by the workflow; names below are stable):

```sh
npm run lab -- verify --target live --release-dir work/release/current
npm run lab -- deploy --target live --release-dir work/release/current --apply
npm run lab -- rollback --target live --release-dir work/release/current --apply
npm run lab -- reconcile --target live --attempt <original-attempt-uuid>
```

`verify` is read-only, requires no Railway mutation token and produces
`evidence_verified` or a blocked/failed result. It explicitly reports
`authorized: false`; it does not mint a reusable permission token. Applied
deploy/rollback require `release-request.json` and the exact hashed attachments
in `--release-dir`. Reject traversal, symlinks escaping the directory, duplicate
paths, missing bytes and flags conflicting with the request. Existing
`--image`, `--source-sha`, `--deployment`, `--restore-record` remain usable for
read-only preview; apply through the old ungoverned form becomes a clear blocked
result with instructions to dispatch the protected workflow.

JSON on stdout and progress on stderr remain. Exit 0 means preview, verified
evidence, or verified observed operation as explicitly named in `outcome`;
exit 1 means invalid input/deterministic failure; exit 2 means blocked/unknown.
All refusals identify the reason, request/policy identities when available, and
the exact recovery action. A read-only evidence check never claims live safety.

Retain workflow inputs for target/operation/image/source/change reference and
recovery identifiers. Add an exact producer run/attempt selector and bounded
evidence identifiers, resolving artifact IDs and byte hashes before approval.
Do not accept arbitrary URLs or caller-supplied paths as trusted artifacts.
The job summary will display the complete image digest, source, target, expected
configuration, policy/request digests, staging window, and recovery target.

### Transitions

| Starting condition | Allowed next action | Required guard |
|---|---|---|
| Published candidate | staging deploy | Trusted image provenance, protected staging identity, current target/policy |
| Verified staging operation | eligible signed evidence | Complete samples, exact subject/config, successful observation job and signed file |
| Candidate + staging evidence | live deploy | Fresh refreshed staging proof, matching image/source/policy, protected live authorization, current live config |
| Invalid/stale/ambiguous evidence | blocked | No provider mutation; retain refusal and actionable reason |
| Possibly submitted mutation | unknown outcome | Preserve original intent/decision/lock; only read-only reconcile next |
| Unknown outcome | observed desired state | Existing provider/live verification; record causality limit, never rewrite original |
| Eligible prior live deployment | native rollback | Trusted prior image and signed live record, current recovery request, compatible config, provider eligibility |

Rollback does not require a newly healthy staging window for a failing candidate.
It requires authenticated previously verified live evidence and a currently
authorized recovery request; the staging freshness limit does not expire the
known-good recovery record. Revocation, unavailable bytes, incompatible config
or provider ineligibility still block. Native rollback acknowledgment remains
unknown until a separate reconcile observes recovery.

## TDD And BDD Implementation Strategy

Use `tdd-bdd`, `workflow-invariants` and `failure-path-testing` together. Test
the public verifier/promotion interfaces, actual CLI process, temporary journals,
and provider request counters; use captured provider/attestation contracts at
external seams. Default tests use no real release credentials or mutations.

1. **Reject unauthenticated evidence.** Given a valid-looking JSON build record
   without a trusted bundle, `verify` returns `PROVENANCE_REQUIRED`. Add a genuine
   signed public fixture, then wrong digest, wrong signer, tampered file and
   subprocess failure cases. Reach green with the bounded verifier adapter.
2. **Require complete current subjects.** Given authentic staging bytes for a
   different image, source, target, policy, configuration or expired window,
   promotion blocks before `updateImage`. Add a sufficient matching success
   fixture, zero/missing samples, future timestamps and expiry-boundary cases.
3. **Require authenticated execution.** Call `execute` directly and via CLI with
   missing/forged/wrong-environment OIDC, not merely a wrapper. Assert zero Railway
   mutation calls and no leaked token. Add a local test JWKS with real test-key
   signatures, wrong issuer/audience/algorithm/run/attempt and expired tokens.
   Test dependencies may inject transport/time; production cannot select roots.
4. **Publish and authenticate the actual artifacts.** Modify publisher and
   workflow consumption together. Test image metadata compatibility and fail
   before signing on container-test failure. Exercise the real pinned verifier
   against public bundles; capture actual new publisher output at hosted acceptance.
5. **Preserve workflow recovery.** Add the multi-job history, signing/upload
   failure, rerun-attempt, missing-artifact and source-update-before-expiry cases.
   Prove original unknown records stay unchanged and duplicate mutations remain
   blocked. Preserve existing captured Railway contract regressions.
6. **Complete operator flow.** Run command parity/DX checks, then the opt-in real
   acceptance below. A mocked success never substitutes for hosted completion.

Each slice will include the smallest failing assertion before production code,
targeted green tests, and any refactor. Do not create a BDD framework or tests
that merely mirror private helper implementation.

## Component Design

Apply `codebase-design`: `tools/promotion.ts` will own the policy decision and
authorization interface; it will hide attachment loading, clock checks and
claim comparison. `tools/attestation.ts` will own the external verifier contract.
The existing `execute` function remains the sole normal provider-mutation path.
Workflow and CLI callers cannot pass a precomputed boolean to skip the gate.
`tools/railway.ts` remains the provider adapter, not an attestation interpreter.

The existing `recordSchema` remains readable. A successful current operation
will produce a separate envelope from its actual returned/journaled record.
The signer will not accept an arbitrary uploaded `verified` JSON file. Sign
only records from the just-completed operation or fresh observation in the
trusted job, after validating every required measurement/context field.

Use one shared Actions concurrency group for **all staging/live operations**,
with `cancel-in-progress: false`. A live-deploy run will:

1. Resolve the exact image producer and a staging-observation request, with no
   Railway secret. This request binds the candidate and policy, not its future
   observation output.
2. In a protected staging job, verify image provenance, read the current provider,
   collect a fresh bounded staging observation and sign its evidence file.
3. Require that job's successful output, then finalize a separate immutable live
   release request containing the staging artifact/hash before presenting live
   environment approval. The staging envelope refers to its own earlier request,
   never to the later live request that contains its hash. Display the final live
   request digest in the approval summary; only that request can authorize live.
4. In the protected live job, verify all bytes/claims/policy and freshness again,
   compare current live configuration, authorize and execute the exact request.
5. Preserve all state on every exit, sign only eligible observations, and publish
   the final run summary with separate operation/signing outcomes.

The staging credential stays in its staging job; the live credential stays in
its live job. Global serialization holds through the staging-check/approval/live
sequence, avoiding a second authorized workflow replacing staging mid-promotion.
Approval delay beyond proof expiry blocks with a new observation required. Trusted
dashboard/API writers must remain inactive during the run. Serialization cannot
provide a Railway compare-and-swap guarantee against administrators.

`previousOperation` currently assumes one job named `operate`; the new graph
must identify that exact mutation job and its attempt-specific operation step,
paginate job history, and preserve the distinction between setup-only failure
and possible execution. Preserve a reader for Build 1 artifacts. Workflow reruns
create new request/authorization identities and cannot borrow a prior attempt's
approval or silently drop an unresolved lock. Read-only reconciliation has no
new mutation authorization requirement.

Avoid circular proof: evidence files do not contain their own hash or claim the
parent run finished before it has. Sign the finalized file, then attach its bundle
and immutable upload identity externally. A parent run's failed upload/sign step
must not turn a verified provider operation into a fabricated failure or produce
promotion eligibility. Keep those outcomes separate and recover by observation.

## Failure And Recovery Rules

| Failure | Must not happen | Retained evidence and next action |
|---|---|---|
| Missing/invalid signature or untrusted producer | No source update/deploy/rollback | `PROVENANCE_REQUIRED` / `PROVENANCE_REJECTED`; exact rejected subject, verifier exit and sanitized diagnostic; use a trusted publisher run. |
| Wrong image/source/target/config/policy | No mutation or substitute latest artifact | `RELEASE_SUBJECT_MISMATCH` / `POLICY_CHANGED`; expected vs actual public identities; resolve a new request and proof. |
| Missing/low-volume/stale/future observation | No eligibility from zero failures | `STAGING_EVIDENCE_INSUFFICIENT` / `STAGING_EVIDENCE_STALE`; window/count/reason; collect a fresh complete staging window. |
| Missing/forged/expired run authorization | No mutation, no reusable approval receipt | `PROTECTED_RUN_REQUIRED` / `AUTHORIZATION_REJECTED`; sanitized claims/reason only; dispatch the protected job. |
| Protection or main-policy read fails | No fallback to local credentials | `PROTECTION_UNVERIFIABLE`; API status and required setting; fix access/protection then rerun. |
| Bundle/record write fails before effect | No effect, no completed envelope | Preserve partial diagnostic files; release a safely unmutated lock; fix storage and create a new request. |
| Mutation may have reached Railway | No automatic retry or optimistic success | Existing unknown outcome, durable request/decision, snapshot and lock; reconcile the original attempt. |
| Signing/upload fails after observed deployment | No fabricated signed evidence or replayed deploy | Preserve verified operation separately from unavailable attestation; read-only observe/sign again in a protected job; missing workflow state remains blocking. |
| Drift during native rollback | No further destructive call on observed drift | Preserve refused snapshot and unknown lock if source already changed; reconcile before deciding repair. |
| Wrong/unsigned/unavailable rollback evidence | No automatic use of legacy owner-editable records | `RECOVERY_EVIDENCE_REJECTED`; choose retained authenticated recovery evidence; otherwise explicit administrator recovery outside the ordinary path. |
| Ambiguous workflow history/expired artifact | No inference that no operation happened | Existing fail-closed restoration; retrieve preserved state and inspect provider before recovery. |

Archive statements and prior records unchanged. When `workflow-invariants`
calls for clearing stale artifacts, clear only derived eligibility/pointers;
the repository's evidence-preservation rule forbids deleting history.

## Commit Plan

The saved plan and Build 1 closeout form the initial planning commit. Follow
with behavior-closed implementation commits, each carrying its tests:

1. Add pinned verifier setup and authenticated image/file verification contract.
2. Add release request/evidence policy and protected-run authorization at `execute`.
3. Attest the tested published image; preserve producer metadata and consumer parity.
4. Wire protected staged promotion, signed observations and multi-job state recovery.
5. Complete authenticated rollback, operator docs, failure regressions and DX fixes.

Keep unrelated app changes out. Do not add a fake hosted acceptance report to
the implementation PR. Record actual execution after the code is merged and
eligible protected main workflows can run; record follow-up fixes separately
and rerun affected acceptance if those fixes change the trust/effect boundary.

## Branch And PR Flow

Use `feat/attested-promotion`, based on the Build 1 merge above. Reopen main and
the plan before execution; if main moves, incorporate it and pin the new reviewed
base rather than claiming checks on the old subject cover the new diff.

Before opening the implementation PR:

1. Run targeted tests and `npm run verify`; run the DX audit on the complete
   change set and resolve material interface verification gaps separately.
2. Recheck Qodo runtime/auth and remote-base accessibility. Run `qodo-review`
   against the entire change set, including committed/uncommitted/untracked files,
   with `--base <pushed-base-sha> --deep --context-file <context> --json --progress`.
   Keep the process alive, inspect findings and coverage, and attach rationale
   plus fetchable plan/brief links. Use `--fast` for focused remediation rounds.
3. Reproduce every actionable finding at the actual head, fix confirmed issues,
   rerun affected tests and full verification, then rerun final Local Review.
   Preserve false-positive evidence and explicit tool failures; do not call a
   failed review a clean result. No deliberate unfixed exception is implied.
4. Push, open one implementation PR linking this plan, and run the exact-head
   Qodo resolver/CI loop. Merge normally when the reviewed code works and checks
   pass, using the current head as the match condition, without admin bypass.

After merge, perform this setup and rollout in order:

1. Review tracked files **and reachable history** for public-readiness: no secrets,
   customer data or private working files; check actual GitGuardian/secret-scan
   evidence and document what was inspected. Under the approved public-source
   choice, publish the repository when ready. A concrete leak blocks publication
   until repaired; it does not authorize rewriting unrelated history.
2. Configure main protection with required Verify, no force pushes/deletion, and
   admin enforcement. Configure `image-publication`, `staging`, and `live` with
   the owner as required reviewer, selected branch `main` only, and disabled
   environment bypass. Allow self-review for this solo-owned lab; record that
   this is an explicit owner gate, not two-person review. Verify actual API readback.
3. Capture policy target/configuration and exact OIDC subject metadata. The new
   default immutable subject format must not be guessed from older examples.
   Validate the actual job claims and pinned verifier output before live mutation.
4. Install separate environment-scoped Railway tokens through GitHub's secret API,
   sourced from the existing Keychain without displaying them. Keep ordinary local
   mutation disabled by the new runtime gate. Once the CI recovery path is proven,
   rotate the old local release tokens and keep any emergency administrator access
   outside the ordinary coding process. Do not remove the working fallback first.
5. Execute the actual acceptance sequence below and archive evidence. Keep the
   service limits from Build 1; create no database, extra host or paid upgrade.

GitHub environment review is an execution requirement of the lab. Existing user
authorization covers these scoped deployments; never invent an independent human
review or an approval event that the platform did not record. If a platform requires
an action that cannot be performed with current authorized access, preserve that
specific block and continue the independent verification work.

## Test Plan

Repository commands (Node from `.nvmrc`):

```sh
npm ci --ignore-scripts
npm run typecheck
npx vitest run test/attestation.test.ts test/promotion.test.ts
npx vitest run test/operations.test.ts test/workflow.test.ts test/workflow-guard.test.ts test/cli.test.ts
npm run verify
npm run lab -- --help
```

The new test paths become runnable as their slices land. `npm run verify`
already includes typecheck, Vitest, build and container verification. Verify
the final compiled image and default CLI behavior without release credentials.
Run the real `gh` binary against an authentic public bundle and a tampered copy;
synthetic `verificationResult` objects alone cannot prove cryptographic verification.

Required automated refusal matrix:

- Local unsigned image/receipt, wrong digest, wrong repo/workflow/ref/issuer,
  wrong image source versus operator source, revoked artifact, forged signature.
- Valid JSON edited after signing, attachment hash mismatch, path escape,
  duplicate/conflicting attestations, malformed/truncated/oversized output.
- Zero/insufficient samples, mixed identities, expired/future windows, changed
  policy/config, staging overwritten before proof, approval delayed past expiry.
- Missing/forged OIDC even with GitHub-like env vars; wrong environment, actor
  context, run attempt, audience/request hash, algorithm or expired claims.
- Direct `execute` call and every CLI/workflow mutation entry point cannot bypass
  verification; invalid cases assert **zero provider mutation calls**.
- Fake broad branch policy, missing reviewer, administrator bypass enabled,
  failed protection read, credentials present in the wrong job.
- Concurrent target operations serialize; uncertain operation prevents a duplicate;
  multi-job setup failure differs from a possibly executed mutation.
- Post-effect signing failure, missing state artifact, signing rerun, native rollback
  acknowledgment, preserved refused-drift snapshots and read-only reconciliation.

Actual hosted acceptance, using the same staging/live services:

1. Publish CI baseline C through protected `image.yml`; retain provenance,
   container checks, registry digest and build run. Verify it independently.
2. Deploy C to staging with the protected operator, collect/sign its observation,
   then promote that exact image to live through the gate. This creates the first
   authenticated live recovery baseline; legacy A/B are not silently grandfathered.
   Retain A as an administrator fallback until C is verified; the first governed
   promotion does not require a nonexistent signed previous deployment.
3. Publish candidate D once, stage it and verify it. C and D may use the same
   application source with different recorded build-run metadata; label that
   deliberate fixture. They must be distinct retained digests, each built once.
4. Invoke real verification/gating with a wrong digest, tampered evidence and
   unauthorized local apply; retain refusal JSON and before/after provider state.
   Also run a protected live refusal with incompatible evidence. Prove no provider
   change from those attempts. Keep all tokens out of fixture artifacts.
5. Refresh/sign D's staging proof, approve the resolved live request, deploy D,
   and verify provider metadata plus live responses and a complete sample.
6. Use the protected native rollback path to C with its signed saved live record;
   preserve the acknowledged unknown result, then separately reconcile and observe
   healthy C. Prove the previous records remain byte-identical and locks resolve.
7. Archive evidence, verifier version/output, workflow/source identities, approval
   event references, policy/config fingerprints, raw samples, failures and repairs.
   Read back final staging/live state; do not equate deployment with cohort release.

Local Review will use the fixed pushed base and complete diff described above;
affected tests, full verification and review repeat after remediation. Manual or
delegated platform approval is recorded as it occurred. No test may claim customer
reliability, learning, feature adoption or revenue from this synthetic rehearsal.

## Definition Of Done

- A protected publisher produces the tested container and verifiable provenance
  for the exact digest; an independent invocation verifies its trusted identity.
- Live promotion consumes a signed, fresh, sufficient staging observation bound
  to the image/source, target/configuration, audience, window and current policy.
- Ordinary mutation requires a cryptographically authenticated, request-bound
  protected run. Local JSON, flags and GitHub-looking env vars cannot bypass it.
- Invalid evidence/permission cases refuse before mutation and explain recovery.
- CI credentials remain separated by job/environment; public readiness and actual
  protection settings are recorded, with no paid-plan workaround or bypass claim.
- A real C-to-D promotion and D-to-C native rollback/reconciliation pass; original
  uncertainty/failure records survive and deployment identity agrees with live traffic.
- Prior recovery bytes/images remain retrievable; unknown/signing-failure cases
  cannot generate false eligibility, silently retry or strand a resolvable lock.
- Required tests, exact-image checks, DX P1 fixes and material runtime checks pass.
  Local Qodo review and exact-head PR review are recorded with honest coverage.
- Working code is merged; the actual hosted acceptance record exists separately.
  The next build may begin planning once these outcomes are observed.

## Assumptions And Defaults

- One synthetic read-only catalog, one owner and one deployment writer. No database,
  schema migration or irreversible customer effect is introduced.
- The approved destination remains public source/images. Source publication is a
  setup step after readiness work, not a completed fact in this plan.
- Signing standard structured files is sufficient here; custom attestation
  predicates, a separate policy service and general graph runtime are deferred.
- Trusted protected-main workflow/code changes remain administrator authority.
  Build 2 prevents ordinary-path bypass and untrusted evidence reuse; it does not
  defend against that administrator deliberately rewriting the verifier.
- Staging/live configuration fingerprints are intentionally distinct and compared
  against their own reviewed expected values. The Build 1 fingerprint remains a
  documented subset of configuration, not a full secret/infrastructure snapshot.
- SHA/current-policy binding controls staleness; newer unrelated source commits
  do not retroactively invalidate a correctly bound image. Policy revocation or
  changed deployment/configuration does invalidate its eligibility.
- User authorization covers routine fixes, normal merges and these scoped lab
  deployments. Only a concrete access restriction, conflicting requirement, or
  new cost/resource/scope decision warrants an additional user decision.
- Builds 3–5 will each receive their own `.plan` file before implementation;
  this plan deliberately leaves their design decisions for those builds.
