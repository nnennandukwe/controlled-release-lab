# Build 4: Regression, repair, and completed release

Approved implementation scope starts at main
`e0f25c84afcc45d5fbb5486d9eb2d6c2c9093c2e` and the
[Build 3 closeout](../docs/build-03-closeout.md). This is a plan, not hosted
acceptance evidence. Use two implementation PRs with hosted failure and recovery
between them. The repaired release ends at 100% of eligible synthetic personas,
with the flag retained. See the [transaction proof](build-04-transaction-proof.md)
for state, effect boundaries and failpoints.

## Scope and contracts

- Candidate F introduces a disclosed fixed asynchronous 1,000 ms source-code
  delay only when ranked search evaluates true for normalized `workspace`.
  Preserve catalog membership, ordering and response contents. No runtime switch.
- Candidate G removes that delay in a later source revision and distinct image.
  Add an HTTP performance regression test that fails on F and passes on G.
- Extend existing observer, proof, flag, exposure, promotion, CLI and workflow
  owners. Keep dependencies, credential separation, flag identity, target/config
  mappings, and exact-image promotion. No general architecture refactor.
- Version the expanded exposure policy and feature-proof contract. Keep legacy
  readers for inspection; require fresh current-policy evidence for execution.
- Tutorial/workshop authoring is Build 5. Defer flag removal, unattended monitoring,
  automatic disablement, paid rollout extensions, and ThreadLoop/GAAP adapters.
  No database writes, migrations, customer identities or adoption claims.

## Measurement

| Window | Fixed workload |
|---|---|
| Internal | 120 normal-query requests: `keyboard` and `compact` for 20 internal, 20 eligible-control and 20 excluded personas |
| Off, 5%, 25%, 100% | `workspace` for all 1,040 personas; `keyboard` and `compact` for 20 from each cohort; 1,160 total |

The challenge query enters treatment testing at 5%. Staging's initial and internal
checks must disclose their normal-workload limitation. Retain aggregate p95 and
add p95 by query and evaluated variation. Require at least 20 distinct personas
in each required query/variation group. Compare each group with
`max(500 ms, 2 × off-baseline p95 for that query)`.

At 5%/25%, require at least 20 eligible treatments and 200 eligible controls on
`workspace`. At 100%, all 1,000 eligible and 20 internal personas receive ranked
behavior and all 20 excluded personas remain original. Preserve zero-error,
functional-result, SDK initialization, identity, full-window and complete-workload
gates. Missing groups or inadequate samples hold progression.

Keep concurrency two, at most ten requests/second, 1,200-request cap, 180-second
deadline and five-second request timeout per window. Never resample, extend a
deadline or relax thresholds to obtain a pass. Proposed cumulative hosted
acceptance ceiling: 40,000 search requests, including retries; confirm it with
concrete execution authorization and maintain a request ledger.

## Release control and recovery

Allowed expansion: `off → internal → 5 → 25 → 100`. Independently authorized
disable: any stage → off. Each expansion requires fresh authenticated evidence
of its immediate predecessor on the same image, deployment, configuration, policy
and current flag snapshot. Read-only observations do not confer exposure authority.
Preserve flag identity and bucketing inputs while changing weights; validate
actual evaluated membership and retention of earlier treatments.

Bind prepared requests to attachment hashes, subject, predecessor, policy, expiry
and intended flag state. Persist intent before conditional PATCH and recheck
authority and subject immediately before mutation. Read provider state separately
and collect bounded HTTP evidence. Complete verified signed 100% exposure proof
serves as completion evidence; no separate lifecycle engine is required.

Separate health from mutation certainty. Unknown outcomes retain intent and lock
until read-only reconciliation. Reconciliation may establish that the desired
change is present while recording health as blocked; it may release only the
original attempt's owned lock after preserving a new durable result. Keep the
original attempt unchanged. A distinct signed diagnostic envelope authenticates
completed unhealthy observations, including eligible failed producer runs, without
weakening successful-producer or healthy-proof requirements for advancement.

Retain samples and reasons on holds. Signing/upload failure does not establish
signed evidence. Stale, edited, wrong-subject or wrong-predecessor evidence must
stop before PATCH and identify the fresh request required. Feature disablement
keeps F's deployment; native application rollback then restores E with external
flag off verified separately. Stop before introducing F if a retained compatible
native rollback target is unavailable. Acknowledgement alone is not recovery.

## Implementation and review sequence

PR 1, `build/04-regression-controls`, based on verified main:

1. Query-aware workload/assessment and proof compatibility.
2. Expanded stages, immediate-predecessor guards and CLI/workflow parity.
3. Unhealthy reconciliation and diagnostic preservation.
4. Disclosed fixture, behavior tests and operator instructions.

After hosted F failure, independent disable and native E rollback are verified,
PR 2, `build/04-ranking-repair`, based on then-current verified main:

1. Add failing HTTP regression test and remove the delay.
2. Update repair instructions and evidence references, without changing policy
   or workload. Record executed results in a later documentation closeout.

Use qodo-get-rules, workflow-invariants, transaction-proof, tdd-bdd,
failure-path-testing, cli-interactive-parity, dx-audit, qodo-review, and
qodo-review-resolver. Apply retrieved evidence, recovery, schema compatibility and
enum standards. Use existing TypeScript modules, pinned SDK types and repo checks.

Run focused checks and `npm run verify` before each local review. Pin the pushed
comparison base and review the whole local change set with self-contained intent,
decisions and specification links. Reproduce findings at the current revision;
fix confirmed issues, rerun affected/full checks and review after changes. Require
completed Qodo feedback for the exact final PR head before normal merge. Record
genuine repository-access skips, runtime failures and disputed findings accurately;
keep the historical Qodo label discrepancy separate.

## Automated acceptance

Start with red behavior tests in these slices: masked slow-query regression;
expanded transitions with no-PATCH refusals; known-unhealthy reconciliation;
failure diagnostics; fixture behavior; then repair only in PR 2.

Cover invalid/missing telemetry, duplicate requests, wrong results/identity,
insufficient cohorts/deadlines, every valid transition, skipped/replayed/stale or
mismatched evidence, 100% targeting/exclusion, lost responses with healthy and
unhealthy reconciliation, independent disable, partial writes/signing failures,
interrupted operations, concurrent drift, preserved historical hashes, legacy
inspection/current rejection, and actual CLI/workflow subprocess startup. Use
pure assessment tests, real SDK targeting, public operator paths and filesystem/
provider integration at the real effect boundaries. Hosted acceptance is separate.

## Hosted acceptance and completion

The [runbook](../docs/runbook.md#build-4-hosted-execution) specifies the executable
sequence: recheck E and scope/locks/budget/rollback → refresh signed E off proofs
under the new policy → publish F once → staging recovery/internal → exact F live
off/internal/5% → observed latency hold and refused 25% → separate disable on F
→ native E rollback/reconcile → implement/review G → publish G once → staging
challenge validation → exact G live off/internal/5%/25%/100% → extra signed 100%
monitoring window → staging off and live G 100%.

Done requires hosted regression/hold, separate live proof of both recoveries,
distinct repaired source/image completing all stages, required tests/DX audit/
CI/current-head reviews, and a factual closeout preserving successful, failed and
uncertain attempts with exact subjects and limitations. Passing tests, a merged
PR or published image alone does not establish completion.

Nnenna is the operating owner; delegated owner approval is not independent
multi-person review. Run one signed monitoring window daily and after deployment,
flag or configuration changes. Keep the flag through Build 5; retirement needs
seven healthy daily windows, no unresolved recovery and a separately reviewed
removal/rollback plan. Preserve 90-day artifact retention and archive before expiry.

This plan authorizes implementation, not publication, live mutations, new resources
or expanded permissions. Concrete hosted operations and budget require separate
authorization under repository rules.
