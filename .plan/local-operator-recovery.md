# Local operator recovery maintenance

Scope: authorization rejection, response loss, observation interruption, and owned
lock cleanup at base `3b40267`. All new provider fixtures are synthetic and local.
Hosted acceptance, service changes, publication, and traffic aren't authorized.

## Reproduced failure

Both execution APIs write a verified terminal record before removing the owned
lock. Injecting an unlink failure at that boundary preserves the record and lock,
but a subsequent read-only reconciliation rejects the record as `NOT_UNCERTAIN`.
The deployment and exposure regression tests failed at their actual reconciliation
entry points before production edits. The CLI also loses the saved result when
that cleanup exception escapes to its general I/O error handler.

## State and commit points

| Starting state | Operation | Result | Recovery |
|---|---|---|---|
| Rejected authority | Verify request and protected identity | No provider effect or mutation lock | Resolve fresh authority |
| Prepared | Preserve intent, then submit provider effect | Effect may be pending | Read-only reconciliation |
| Unknown effect | Lose response or interrupt observation | Original intent and owned lock retained | Reconcile original UUID |
| Terminal result durable | Publish record plus checksum | Measured result committed | Remove matching owned lock |
| Terminal result, cleanup interrupted | Unlink fails or process stops | Saved result and owned lock remain | Reconcile the original owner |
| Reconciliation durable | Save new record plus checksum | Earlier record unchanged | Release only original owned lock |

The provider call and terminal record/checksum publication remain separate commit
operations. A checksum is required by the real record consumers. An incomplete
record still falls back to the durable intent under the existing contract.

## Invariants

- Only an unknown attempt or a completed attempt that still owns its lock may
  enter read-only reconciliation.
- A requested attempt UUID must match the retained record's UUID.
- A completed unsuccessful attempt may clear its owned lock after provider
  readback and a new blocked cleanup record; it supplies no release eligibility.
- Reconciliation never repeats a provider mutation or changes previous evidence.
- A different lock owner is preserved. A completed unlocked record can't become
  new reconciliation authority.
- Cleanup failure after a saved result returns its path, attempt, measured outcome,
  and a cleanup warning. CLI exit 2 signals that lock cleanup still needs action.
- Reconciliation failure names the original attempt for the next recovery command.
- Existing authorization, image/configuration identity, observation policy,
  request budgets, and separate flag/application recovery stay enforced.

## Fault matrix and lifecycle coverage

Reuse `.plan/build-04-transaction-proof.md` for unchanged filesystem and provider
operations. This maintenance adds the following boundaries and checks.

| Boundary | Fault | Expected state | Check |
|---|---|---|---|
| Terminal lock unlink | I/O failure | Saved result unchanged; matching lock retained; warning with recovery command | Execution API regressions and CLI warning mapping |
| Cleanup restart | Reconcile terminal owner | Verified results receive fresh provider/traffic checks; unsuccessful results stay blocked after readback; original bytes preserved; zero repeated writes | Deployment/exposure regressions |
| Ownership read | Missing lock or different owner | Completed record rejected; other state unchanged | Negative ownership regressions |
| Record identity | Record copied under another attempt UUID | Reject before provider access or lock removal | Deployment/exposure regressions |
| Observation/reconciliation | Failed or interrupted measurement | Lock and original evidence retained; recovery names original UUID | Failure and cancellation checks |
| Authority | Forged, expired, or changed request | No unauthorized provider effect | Real protected-gate tests |
| Provider response | Loss before/after acknowledgement | Unknown effect; restart remains read-only | Existing and added local integration checks |

Lifecycle: reject authority; submit once; preserve uncertainty; interrupt or fail
observation; restore intent; reobserve; publish a new checksummed record; fail
cleanup; restart cleanup through fresh observation; reject unowned/edited state.
Production consumers are `loadRecord`, `loadExposureRecord`, and the CLI. New
results don't establish hosted acceptance or participant outcomes.

## Additional observed recovery guards

At the original base, `loadAttempt` accepted a checksummed record whose UUID
differed from the requested directory. The reproduction returned
`mismatchAccepted: true`. Both deployment and exposure consumers now reject a
record or fallback intent copied under another UUID before provider access.

The failed-measurement regression also verifies that a subsequent recovery command
names the original lock owner rather than the new failed observation attempt.
Real protected-gate tests cover initial expiry and identity rejection immediately
before and after the source update. Only the latter retains an unknown effect.

## Sealing and drift follow-up from review

Final review at `f563cb6` identified two additional boundary cases. A verified
measurement with `cleanupWarning` must remain in local state until cleanup;
sealing must emit `sign=false` and create no new proof or diagnostic artifact.
This applies to both deployment and exposure sealing entry points.

A completed unsuccessful exposure owns no pending provider effect. After its
request and lock identities are verified, current deployment drift must remain
observable in the new blocked cleanup record rather than prevent cleanup from
starting. Unknown attempts still require the original serving-subject checks.

| Boundary | Fault | Required result | Lifecycle check |
|---|---|---|---|
| Seal public CLI | Saved verified/blocked result with cleanup warning | No eligible or diagnostic artifact; sign=false | Real seal subprocess with checksummed exposure fixture and deployment gate |
| Pre-effect flag check | Deployment drifts, then owned-lock unlink fails | Terminal blocked record retained | Real exposure execution and immutable files |
| Cleanup after drift | Original terminal owner reconciled | Provider readback recorded, blocked cleanup saved, original lock released, no proof | Exposure recovery regression |

These are local protocol changes. Native signing, provider mutation and hosted
traffic remain outside this maintenance request.

Allowing image/configuration drift for completed unsuccessful cleanup still
requires the provider adapter to match the retained project, service,
environment, and URL. The hosting scope check gains an optional expected target;
its Railway implementation rejects a mismatch before transport access. Existing
callers retain the same default behavior. Negative adapter tests cover each
identity field, and unknown-effect drift continues to retain its lock.

## Recovery-command follow-up from hosted review

The extended review at `1080891` identified two command-hint cases to reproduce
through the CLI before editing execution behavior. A provider read can fail
before terminal cleanup starts; its blocked follow-up must name the original
lock owner for another read-only attempt. Only the successful
`COMPLETED_ATTEMPT_CLEANUP` marker may omit that retry command.

An invocation with `--config` must carry that file path into its recovery hint.
The hint must quote both paths for the POSIX shell and preserve the custom target
map, without copying configuration contents or credentials into evidence. The
deployment CLI will carry this optional diagnostic context to command generation;
the exposure CLI's accepted arguments stay unchanged.

| Boundary | Fault | Required result | Lifecycle check |
|---|---|---|---|
| Completed-owner cleanup read | Provider rejects snapshot | New blocked record, original lock retained, retry names original UUID | Real CLI against loopback Railway fixture |
| Recovery command | Custom config and work-directory paths contain spaces and apostrophes | Pasted command reloads the same target map | Execute emitted command in a POSIX shell |
| Subsequent readback | Provider resumes | Completed unsuccessful owner clears its lock after blocked cleanup evidence | Original bytes preserved and zero mutations |

## Authorized hosted staging verification

On November 13 the user authorized hosted recovery testing against existing
staging resources, followed by Qodo resolution and merge after checks pass. Paid
resources and permission expansion remain excluded. The first protected doctor
run (`43520737547`) failed before effects; Railway's dashboard marked the staging
CI token invalid. Its replacement retains the same project/environment scope and
updates only the existing staging GitHub secret. A direct PR-head doctor then
verified the retained G image, deployment and configuration against Railway.

The additional check exercises the repaired completed-owner path with real
Railway requests. It deliberately submits one invalid read-only GraphQL field
to induce an actual provider rejection, retains the original owner and evidence,
then executes the CLI's emitted command against normal provider readback. The
terminal blocked record and retained lock are labeled teaching fixtures in an
isolated journal. Successful cleanup remains blocked and supplies no eligibility.

The existing protected staging doctor workflow gains an explicit opt-in input.
Main-only execution, required environment approval and job permissions stay the
same. Provider mutations and non-Railway destinations are rejected by the test
transport. The receipt binds source, provider subject, times, request counts,
original bytes, lock cleanup and before/after provider state. CI preserves failed
checks and successful receipts in the existing state artifact. Local invocation
requires explicit staging opt-in and the same scoped credential.

Final local review at `806f921` found two harness cases to reproduce. A successful
Railway read retry must remain valid while its additional request is counted.
Timeout or cancellation must stop the shell/npm/CLI process group, including a
descendant that holds output pipes after its parent exits. The new checks will
use the actual adapter retry path and real disposable process trees; retained
journals remain the recovery source when a command stops.

Hosted review at `8c0dece` identified a remaining preflight boundary: scope reads
run before the journal catch. After prior identity/ownership validation, a failed
read must preserve its reason and provide the original-owner recovery command,
including the custom config path. It must retain the lock and earlier bytes
without claiming a new record was saved. Scope checks stay before mutation locks
and effects. Exposure's corresponding provider/flag preflight reads need the
same diagnostic behavior after authenticated prior-request validation. The
hosted check will cover both scope-read and snapshot-read rejection explicitly.

## Concurrent lock cleanup model

Canonical ownership is the nonempty environment lock directory and its single
owner marker. New journal UUIDs identify acquisitions; an attempt never reacquires
its released lock. Existing plain-file locks remain readable for recovery.
Staged directories live under `lock-preparations`, outside the active namespace.
This protocol targets local macOS/Linux filesystems and process interruption;
power-loss durability and concurrent use by older operator versions aren't claimed.

| Starting state | Operation / commit point | Visible state | Retry or recovery |
|---|---|---|---|
| Missing or empty environment directory | Prepare unique directory, write/sync/close owner marker | Canonical state unchanged | Remove only unpublished preparation on failure |
| Prepared owner | Rename populated preparation over missing/empty environment path | Exactly one published owner | A nonempty directory or legacy file blocks acquisition |
| Published owner | Unlink that owner's hashed marker path | Empty directory, environment available | Replacement acquisition can replace empty directory |
| Legacy owner file | Read matching owner, unlink file | Missing path | Replacement acquisitions always publish a directory; stale unlink can't remove it |
| Cleanup permission failure | Unlink fails before removal | Original owner remains | Existing warning and read-only reconciliation apply |
| Process stops before / after publication | No owner / complete owner visible | Unpublished preparation / owned directory | Next process inspects canonical owner; retained journal supplies recovery |

The acquisition commit point is `rename(preparation, environmentPath)`. Release
commits at `unlink(environmentPath/ownerHash.lock)`; the empty outer directory
stays available, so no post-commit directory removal can fail. Legacy cleanup
may only unlink a file. A replacement directory yields EISDIR (or macOS EPERM, verified as a directory) and survives.

Invariants: exactly one owner can publish into an environment; cleanup only
removes the marker named by its original attempt; a stale release never removes
a newer UUID; unpublished preparation never blocks another operation; malformed
owner state is preserved and rejected by the inspector; original journals and
checksums aren't rewritten. All lock consumers use ownership inspection rather
than outer-path existence. Release closures and reconciliation share one remover.

| Fault boundary | Injection | Required state / next action | Lifecycle coverage |
|---|---|---|---|
| Parent mkdir / preparation mkdtemp | EACCES | Canonical unchanged, report I/O failure | Acquisition fault tests |
| Marker open / write / sync / close | I/O failure at each call | No published owner; remove owned preparation | Acquisition fault tests and inspector |
| Rename publication | Existing owner / EACCES | Existing owner preserved; preparation removed | Concurrent acquire and fault tests |
| Inspector readdir / read / validate | I/O failure or malformed marker | Preserve bytes, reject unreadable owner | Inspector negative tests |
| Owner marker unlink | EACCES / legacy-file EPERM | Keep active owner and warning | Existing operation/exposure cleanup regressions |
| Ownership observation to unlink | Another cleanup releases and new UUID acquires | New owner remains locked | Actual filesystem barrier for reconcile, release closure and legacy migration |
| Unpublished preparation cleanup | rm fails | Inactive preparation retained, explicit path for repair | Cleanup fault test |
| Before publication / after publication | Stop process | Canonical absent / complete owner | Real subprocess restart and inspector test |
| Repeated release / acquire | Old UUID releases after next owner publishes | Next owner preserved | Lifecycle test, hosted CLI check |

Six new regressions failed at `4719892`: all three stale-release schedules and
all three HTML 502/503/504 adapter retries. Hosted transport logging will record
unreadable payloads with `errorCount: null` and return the provider's original
response, allowing the production adapter to handle its HTTP status.

### Lock proof receipt

Source `8045d17` publishes ownership at populated-directory rename and releases
at owner-marker unlink. The inspector, release closure, reconciliation and both
rehearsals now share that protocol. Three stale-cleanup schedules, marker
validation, each staged-file operation's injected failure, failed preparation
cleanup, legacy-file permission refusal and two real subprocess interruption
boundaries passed. The additional legacy acquisition/refusal/migration test also
passed without changing executable behavior. Focused lock/gateway checks passed
37 cases; the final legacy suite passed 21. Typecheck and build passed.

Both actual hosted CLI phases passed at `8045d17` with thirteen measured reads,
zero provider mutation attempts and unchanged staging subject and original bytes.
Public receipts are producer output copied unchanged, with source, subject,
execution times and measured hashes. Exact-head external review and protected
post-merge execution remain gates. The full local suite's result is recorded in
the review/report receipt. Directory fsync and storage power loss aren't covered;
operators must consistently use the upgraded binary for the retained work root.

## Completed verified-result drift

Review96f2f612 identified another terminal-owner state: a saved verified result
with a retained lock, followed by external configuration, deployment, flag or
runtime drift. Four CLI/API regressions reproduce blocked cleanup in this state.
The previous verified record establishes that the earlier effect already ended.
After authenticated target/provider readback, failed fresh verification must save
a new blocked `COMPLETED_ATTEMPT_CLEANUP` record and release only that original
owner. It must preserve the earlier result and withhold fresh eligibility.

| Boundary | Failure | Required transition | Check |
|---|---|---|---|
| Scope or initial provider/flag read | Access failure | Retain original owner and retry command | Existing verified-owner CLI preflight cases |
| Completed verified readback | Configuration/deployment/flag drift | Save current readback and blocked cleanup, release only original marker | New deployment/exposure drift cases |
| Fresh runtime verification | Health or sample rejection | Preserve failure reason plus cleanup marker; blocked outcome | New deployment runtime case |
| Save blocked cleanup | Persistence failure | Original owner retained | Existing save-before-release ordering and persistence faults |
| Fresh verification succeeds | Healthy same subject | New verified evidence and original-owner release | Existing completed verified recovery cases |
| Original outcome unknown | Any drift | Retain existing uncertainty and lock | Existing unknown-effect drift cases |

The lock commit protocol stays unchanged. Empty outer directories represent
available environments; README/runbook wording will identify active owner markers
and retain the older plain-file recovery format. Historical closeout observations
keep their original wording and state.

## Readback persistence and receipt source identity

Review77e87af5 exposed a release boundary before exposure readback was durable.
The verified-owner fallback must begin only after both provider and flag journal
appends succeed. Earlier persistence failure keeps the original owner and
unknown recovery outcome; a new saved record without readback can't clear it.
Three append failpoints cover intent, provider readback and flag readback, followed
by an original-owner retry. Existing save-before-release ordering still applies.

Review87e91fef exposed local source attribution without a clean-tree guard. A
real harness invocation with an owned test edit reached the transport while
claiming unchanged HEAD. The producer will require clean tracked, index and
untracked source state before provider access, then verify cleanliness and the
same HEAD again before emitting success receipts. Tests use disposable Git
repositories for each edit mode and a changed commit. Generated artifacts belong
under ignored `work/` or outside source. This is before/after validation in the
cooperative lab, rather than isolation against a hostile concurrent source editor.

## Relative retry paths and isolated configuration fixture

Review5b8cd15b identified relative work paths being reinterpreted by npm's package
root. The CLI regressions now start from a repository subdirectory with owned
work state under the ignored project work directory, then execute the emitted
command through npm. A system-temp path can accidentally survive the wrong base
because extra parent traversals stop at filesystem root; the project-local fixture
avoids that false pass. Recovery commands will resolve work/config paths against
the original invocation before shell quoting.

Review82924701 identified a confounded verified-drift fixture: its retained
`deploymentId` was null as well as its configuration being different. The revised
fixture requires a stable single deployment/image and retains that actual ID and
image, so only the historical configuration differs. Receipts expose those prior
subject fields, and artifact inspection checks them against current provider
readback. Earlier records remain unchanged and their broader subject-change
coverage is labeled accurately.

## Unexpected files in the lock namespace

Informationaleeac67e5 identified that metadata could be mislabeled as an active
operation and lacked a supported repair procedure. Two real-filesystem cases
(held and released owner plus a seeded metadata file) reproduced that diagnostic.
A rename collision will now inspect ownership and report malformed namespace
state explicitly. The error and runbook direct an operator to preserve a backup,
relocate only identified unrelated files they own, keep every owner marker intact,
then retry read-only recovery or resolve a new authorized operation.

The operator doesn't delete or relocate unknown files automatically. Automatic
removal violates the existing ownership/preservation invariant. Tests preserve backup and
relocated bytes, prove the original owner remains while held, then demonstrate
normal release/acquisition after the identified metadata is moved. Conflicting or
unidentified owner markers remain rejected for investigation.

## Target selection across shells

Local reviewfca02556 and7caa57e5 identified two remaining configuration cases.
Empty `--config` is rejected before provider access. For recovery without an
explicit file, commands carry a shell-quoted map containing only the validated
selected target IDs and origin. Credentials stay in the operator's secret store.
This applies to deployment and exposure read-only hints and retains explicit-file
behavior. Eight real CLI cases cover file/environment selection, scope/snapshot
failure and completed/verified owners; environment retries drop the original map
before executing the emitted command. The target schema excludes credential,
path, query and fragment fields from the configured origin.

## Hosted recovery guidance and bounded failure diagnostics

Review285897a3 identified that an Actions runner's absolute work path isn't a
local recovery path after the runner ends. The CLI will attach a workflow recovery
context only for this repository's main Operate lab invocation. Its read-only
hint dispatches the same workflow on main with original operation/target/attempt
and apply=false. Local hints retain their validated map and absolute paths. Two
CLI workflow cases execute the emitted command against an owned gh capture shim,
feed its inputs through the real workflowArguments consumer, restore a separate
state copy and perform read-only recovery there. No Actions run is dispatched by
unit tests; existing protection/restoration tests retain their scope.

Review021005ef identified missing unexpected-error details. Failure output will
retain bounded error types, codes, cause codes and a source file/line, without
printing arbitrary exception messages or stacks. Provider transport errors retain
their cause in memory for that formatter. A real entry-point missing-git case
reproduces lost ENOENT, and a provider-cause test checks useful diagnostics without
exposing an error's synthetic secret text.

Review8ddfb59b requires the corrected producer receipts to be inspectable. The
latest clean-source public outputs will be copied unchanged and linked, preserving
earlier confounded observations and their documented limits.
