# Build 5: tutorial and workshop acceptance record

**Status: teaching package implemented; independent hosted acceptance pending.**
The [Build 5 plan](../.plan/build-05-tutorial-workshop.md) implements the
[approved brief](tutorial-brief.md) through the [tutorial](tutorial/README.md) and
[90-minute workshop](workshop/README.md). This record separates author verification,
independent hosted operation, timed facilitation and durable retention.

## Subject and package

Starting base: `b670b594ee16b20e74fa5e5a91f15addc024933b`, verified against remote
main September 20, 2026. Branch: `docs/build-05-tutorial-workshop`. The application,
operator runtime, policies, schemas and dependencies remain unchanged. E/F/G are
the existing signed publications documented in the [evidence index](tutorial/evidence.md).

| Approved objective | Teaching step | Checkpoint |
|---|---|---|
| Trace approved change to image and deployment | Tutorial 1–3; original PRs and signed build/provider evidence | 1–3 |
| Verify provenance separately from correctness | Tutorial 2; positive authentication then wrong-subject refusal | 2 |
| Distinguish deployment, exposure and completion | Tutorial 3–4 and 9 | 3, 6 |
| Define audience, bounds, observations and ownership | Tutorial 1; rehearsal request/ledger | 1, 4, 6 |
| Reject stale evidence/authorization | Run procedure and recovery reference | 2, 3, transfer question |
| Verify feature/application recovery independently | Tutorial 6–7 | 4–5 |
| Complete repaired release and preserve history | Tutorial 8–9 and evidence retention | 6 |

## Executed author verification

Executed September 20, 2026, by the author on macOS arm64 with Node 24.20.0
and Docker 28.1.1. A fresh local clone at documentation revision `1573e0a`
installed dependencies and its own pinned verifier without copying local state.
Its runtime source is unchanged from the approved base. This is author verification,
not independent hosted acceptance or a fresh infrastructure installation.

| Check | Executed result |
|---|---|
| `npm ci --ignore-scripts` and `npm run lab -- --help` | Passed in the fresh clone; help matches documented commands and exit semantics. |
| Five focused test files from the plan | 46 tests passed. |
| `npm run verify` in the fresh clone | 278 tests in 23 files; typing, build, and container readiness/search/identity/non-root/read-only-filesystem/shutdown checks passed. Docker reused existing base/build layers; no cold Docker-cache claim is made. |
| Documented F regression reproduction | Separate detached F source checkout plus PR #13's regression test failed as expected: 1,010.838291 ms against the unchanged 500 ms bound. |
| Documented source repair | Exact source/test restoration from reviewed `70231ef` passed 23 focused tests and full verification: 274 tests, typing, build and container checks. Historical code lacks the later operator-only tests; counts are not comparable coverage claims. |
| Downloaded E/F/G build provenance snippets | All three exact image bundles authenticated, matched producer run/attempt and passed protected-main ancestry/producer checks. |
| Wrong-subject snippet | Expected `PROVENANCE_REJECTED` for E with F's bundle after successful positive authentication. No hosted deployment was attempted. |
| Deployment signature snippet | Authenticated historical G live deployment envelope from run 35382661097. This establishes its historical signature/producer, not current health or fresh eligibility. |
| Markdown paths/anchors and shell syntax | One-off author checks found no missing relative links/anchors or invalid Bash blocks across the changed package/navigation. No prose-mirroring test suite was added. |

Raw local checks are retained in ignored `artifacts/build5-author-checks/`.
The shell initially selected Node 26; verification explicitly selected pinned
Node 24.20.0. No new Railway/LaunchDarkly request workload or provider mutation
was executed. Only local application traffic and read-only GitHub/registry evidence
retrieval were used.

## Independent hosted acceptance

**Not executed.** Awaiting named independent operator, current-state inventory,
and owner approval of the [concrete hosted request and new budget](tutorial/rehearsal.md).
The proposed 40,000-request ceiling is not an authorization. Build 4's unused
allowance does not transfer. No Build 5 run IDs or successful observations exist yet.

Record documentation/operator SHAs, clean-checkout evidence, each actual hosted
subject/run/attempt, commands, outcomes, retained proofs, request counts, assistance,
corrections, preserved-history comparisons and final state using the rehearsal
record contract. Author assistance must remain visible and affected steps need
independent repetition before being marked reproducible.

## Timed workshop rehearsal

**Not executed.** The guide proposes a 90-minute schedule. No elapsed timings,
participant submissions, learning outcomes or attendance are claimed. Record actual
segment times, live/recorded delivery and unfinished operations separately from
proposed timing. Historical fallback cannot pass hosted acceptance.

## Operational follow-ups

| Work | Owner and state | Closure evidence |
|---|---|---|
| Daily and change-triggered signed monitoring | Nnenna; continue existing manual procedure. Last recorded signed window is September 20, run 35518027573. No September 19 window is claimed. No new monitor scheduled by Build 5. | Exact new subject, complete workload, signature/producer verification, metrics and window; gaps recorded. |
| Durable archive | Nnenna selects destination; transfer pending. Local archive checksum verified September 20 against Build 4 closeout. | Destination receipt, retrieved archive hash, internal manifest verification and access/retention record. |
| Artifact availability | Operator before every rehearsal; E build record expires December 8, 2026, 20:02:05 UTC. Inventory all referenced artifacts for earlier expiry. | Complete available build/request/state/proof chain; stop if the current workflow cannot retrieve it. |
| Approval-recovery CI | Nnenna; open recommendation from [PR #14](https://github.com/nnennandukwe/controlled-release-lab/pull/14), Qodo finding `b26dfa01-c10b-4dc4-8bc3-7e2aeac4e4d7`. | Separately reviewed recurring coverage through an appropriately authorized design; one hosted recovery does not close it. |
| Unexplained 502 | Nnenna; root cause remains unestablished for F off-state run 35375982664. | Correlated provider/application/request evidence supporting a cause, or explicit unresolved disposition; G's delay fix is not evidence of resolution. |
| Retained flag | Nnenna; no removal in Build 5. | Seven healthy daily windows, no unresolved recovery, separately reviewed removal and rollback plan. |

The archive is `artifacts/build4-hosted-evidence-2026-09-20.tar.gz`, SHA-256
`4a40e6be011d4a7f593dd44607d9d83976907a3599baaf155639108e11c59964`. Its original
receipt lists 28,872 files and says `offsiteArchive: false`. A destination has not
been invented. Full raw evidence and credentials stay out of this public repository.

## Review and remaining acceptance

The author completed a read-only surface DX audit of the changed documentation
and its direct CLI/workflow contracts: no unresolved P1 finding. The audit records
hosted setup, effect/recovery behavior and timing as unexecuted Build 5 claims.
Local execution above is separate verification, not a claim that a static audit
ran hosted commands. The audit report is retained in ignored `.qodo/`.

Final Qodo Local Review is required against the complete documentation diff and
pinned pushed base `b670b594ee16b20e74fa5e5a91f15addc024933b`. Its result, exact
reviewed head, findings and any coverage limitations will accompany the PR.
This document does not assert a review passed before that result exists.

Build 5 remains incomplete until independent hosted acceptance, timed facilitation,
and verified durable archive retention are recorded. Review/merge of the teaching
package alone does not satisfy those conditions or authorize live operations.
