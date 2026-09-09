# Build 4 transaction proof

This is the pre-implementation model for the accepted Build 4 plan. Execution
results will be recorded separately. The two implementation PRs are separated by
hosted F failure, feature disablement, and native rollback to E. Repair G must not
be implemented before those observations.

## State and commit points

| State | Transition or commit operation | Consumer-visible result | Recovery |
|---|---|---|---|
| Prepared | Verify native signatures, subjects, policy, predecessor, expiry | Preview only | Resolve a fresh request |
| Authorized | Request-bound protected OIDC and exclusive environment lock | No provider change | Abort, retaining owned evidence |
| Intent durable | Preserve request/attachments; append and sync intent and submitted event | Possible pending effect | Reconcile after interruption |
| Provider submitted | Conditional LaunchDarkly PATCH against exact version | Provider may already expose behavior | Never repeat PATCH automatically |
| State observed | Matching before/after flag and hosting snapshots | Known desired state; health separate | Diagnose/disable if unhealthy |
| Result durable | Exclusively preserve record and checksum | Verified, blocked, or unknown attempt | Preserve original; append reconciliation |
| Evidence published | Attest exact envelope and upload envelope plus bundle as one artifact | Authenticated eligibility or diagnostic, never interchangeable | Missing bundle/upload gives no eligibility |
| Reconciled | Append new result, then unlink only matching owned lock | Healthy or unhealthy known result | Old unknown record remains unchanged |

The provider effect, local journal, and GitHub artifact publication are separate
commit operations. There is no cross-provider atomic transaction. Application
rollback keeps its existing source-update/native-rollback/reconciliation protocol.

## Invariants

- Only fresh, authenticated, current-subject healthy predecessor evidence permits expansion.
- Diagnostic evidence and read-only observations never supply exposure authority.
- Every required query/variation population has enough distinct personas; missing telemetry holds.
- Stable desired provider state can be known while runtime health is blocked.
- Unknown provider effects retain the owned lock; no automatic second mutation occurs.
- Reconciliation may release only its original owned lock after its new result is durable.
- Earlier evidence is never edited; schema migration adds current records and keeps legacy inspection.
- Signed eligibility requires a complete healthy record and trusted successful producer.
- A failed workflow may publish a diagnostic envelope through a separate verification path only.
- Partial records, checksum/bundle failures, stale outputs and upload failures never become eligibility.
- Flag disablement and native application rollback remain separate authorized effects.

## Fault injection and lifecycle coverage

| Boundary | Failure | Required durable state and next action | Test seam |
|---|---|---|---|
| Read/parse/hash/signature | Missing, edited, legacy, wrong-subject attachment | No PATCH; preserve input and resolve fresh evidence | Release verifier |
| Authorization reads | Expiry, policy/version/hosting drift, wrong OIDC | No PATCH; fresh request | Protected execute |
| Lock create/read | Concurrent owner or write error | Never remove another owner; no PATCH | Filesystem integration |
| mkdir/preserve attachment | Failed directory creation, exclusive write or sync | No PATCH; original files unchanged | Journal integration |
| Intent/submitted append | Failed open/write/sync/close | No PATCH before durable submission intent | Journal integration |
| Conditional PATCH | Conflict or response lost after effect | Conflict blocked; response loss unknown and locked | Real adapter with injected transport |
| Acknowledgement append | Persistence failure after effect | Unknown; reconcile without second PATCH | Protected execute |
| Hosting/flag readback | Unavailable, drift, wrong desired state | Unknown and locked; reconcile | Protected execute |
| Sampling append | Persistence failure, timeout, incomplete samples | No advancement; retained samples and effect state | Observer/execute |
| Terminal record create | Record/checksum write or sync failure | No signed result; lock retained after possible effect | Filesystem integration |
| Reconciled lock removal | Other owner or unlink failure | Other owner untouched; durable new result retained | Filesystem integration |
| Seal | Missing result, stale path, unhealthy/unknown input | No eligibility; diagnostic only for validated blocked result | CLI seal subprocess |
| Attestation/upload | Signing or publication failure | Local state artifact retained; no claim of signed proof | Workflow conditions and hosted acceptance |
| Artifact consumption | Edited bytes, wrong producer, missing bundle, failed eligibility producer | Reject before authority/effect | Native-verifier seam |
| Restart/retry | Interrupt before/after PATCH or after record publication | Use original intent and append separate reconciliation | Execute/reconcile integration |

Implement deterministic tests at the relevant existing I/O seams. For unchanged
Journal/lock behavior, retain repository coverage rather than introducing a new
filesystem abstraction. Hosted signing/upload and actual provider recovery require
the protected acceptance runs; local tests do not establish those outcomes.

## Execution boundaries

F: fixed asynchronous 1,000 ms delay on ranked normalized `workspace` only.
G: subsequent source repair removes the delay and retains an HTTP regression test.
Keep the 1,200 request/180 second per-window cap; propose 40,000 search requests
for the complete acceptance, including retries, subject to hosted authorization.
No paid resources, expanded roles, runtime fixture switch, or unattended monitor.
