# Build 5 rehearsal request and record

This is a prepared execution request, **not authorization**. The owner must
confirm the actual starting subject, named independent operator, operation scope,
and new traffic budget before any hosted step. The independent operator must use
the [setup guide](setup.md) and [tutorial](README.md), not the author's private
working directory. A separate timed rehearsal evaluates facilitation.

## Concrete operation scope

| Item | Requested scope |
|---|---|
| Repository/workflow | `nnennandukwe/controlled-release-lab`, `operate.yml` on reviewed `main`; no image publication. |
| Railway project/service | `3e9cfaf4-3dec-4aa9-a8a9-ef7a8af538b6` / `a84fd6cc-c41c-4ba0-ad84-470634a51e28`. |
| Staging | `80bb920f-55eb-479c-b395-cacfb78344c3`, `https://catalog-staging-55dc.up.railway.app`. |
| Live | `b78392fc-1a1b-40a4-a209-bb2260b106e2`, `https://catalog-live.up.railway.app`. |
| Flag | `default/catalog-ranked-search`; staging `test`, live `production`; retain identity and bucketing. |
| Images | Exact E/F/G source, digest and publisher run/attempt from the [evidence index](evidence.md#retained-image-selectors). |
| Expected starting point, subject to readback | Build 4 recorded G on both targets, staging off, live 100%, no unresolved locks. This request makes no fresh provider-state claim. |
| Preparation | Inspect scope/state/rollback; independently disable existing exposure as needed; stage and promote E using fresh evidence; leave both targets E/off. |
| Exercise | Stage/promote F off; internal then 5%; retain expected failure; refuse 25%; independently disable F; native rollback/reconcile to E; disable staging. |
| Repair replay | Reproduce source red/green locally; stage G, internal and 5%; promote exact G off; live internal/5/25/100; staging disable; separate signed live monitor. |
| Recovery allowance | Read-only reconciliation, fresh observations, and independently approved disable/native rollback within the named targets and ledger. No permission to repeat an uncertain mutation. |
| Successful end | Live G at 100% eligible synthetic personas, excluded original; staging G/off; no unresolved recovery; retained images/configurations/history. |
| Excluded effects | New paid resources, account/role expansion, new images, flag deletion/recreation, unrelated services, automatic recovery, or archive publication. |

Before approval, record the exact docs SHA and operator-main SHA, current provider
readbacks and flag versions, compatible fingerprints, retained rollback deployments,
artifact availability/expiry, existing baseline selectors, operator name, approval
reference, execution window, and owner-designated archive destination. If the actual
subject differs, revise this concrete request before executing it.

Protected `doctor` itself is an operator workflow; use separately permitted provider
reads or obtain explicit approval for those preflight dispatches. Do not imply that
a read-only plan authorized workflow execution. Each later protected job remains
subject to its own request-bound approval and 30-minute expiry.

## Traffic budget and ledger

Proposed **new ceiling: 40,000 search requests**. Build 4 used 22,680 of its own
40,000 allowance; its remainder is not available to this rehearsal. Count every
search request across both environments, including probes, failed/incomplete
windows, reconciliation, manual browser searches and retries. Provider API reads,
artifact downloads, local tests and signing checks are recorded separately.

Reserve a conservative maximum for each operation before dispatch:

| Operation | Reservation in search requests |
|---|---:|
| Deployment observation/recovery/reconciliation in one target | 1,320 (120 deployment checks plus at most 1,200 feature requests) |
| Live deploy including its staging recheck | 2,640 (two bounded deployment/feature observations) |
| Internal expose, including queued flag response-loss recovery | 120 |
| Off/5/25/100 exposure, disable, exposure monitor/reconcile | 1,200 |
| Doctor, proven pre-effect refusal, native rollback acknowledgment | 0 search requests; reserve 1,320 separately for the required reconciliation |
| Manual searches | Reserve a fixed count before opening the browser; no unmetered participant traffic |

A staging `rehearse-recovery` also queues the 120-request internal flag rehearsal:
reserve and account for that child separately. Reconciliation after another kind
of uncertain operation uses its applicable full reservation. Finalize actual
counts from retained raw observations; do not assume success consumes the cap.
If effects or counts are uncertain, keep the reservation outstanding.

For this run, protect **8,000 requests for recovery/cleanup**. Do not consume that
reserve on optional teaching retries or manual exploration. The primary sequence
(including baseline preparation) must fit within 32,000; the operator must total
its row-by-row reservations before approval. If it does not, shorten optional
work or present a revised budget; never relax policy. Before any action ensure
remaining capacity covers that action and the still-required recovery path.

Use an append-preserved CSV/JSONL ledger in ignored `artifacts/build5/`. Each row
records timestamp, operation, target, subject, authorization reference, run/attempt,
reservation, actual search count, remaining balance, and whether uncertainty is
still outstanding. Preserve corrections as subsequent rows. Retain a sanitized
summary in the acceptance record. A deadline exhaustion or failed HTTP request
still spends budget.

## Independent rehearsal procedure

1. Record operator identity and separation from the author, documentation SHA,
   fresh-checkout path, runtime versions, and absence of copied local state.
2. Follow setup through the approved hosted preparation. Download durable evidence
   through documented run selectors. Preserve remote state and existing locks.
3. Complete every tutorial step using exact run/attempts, including refused
   provenance, the F failure, refused expansion, separate recoveries, G rollout,
   and separate monitoring. Authenticate completion within its freshness window.
4. Log elapsed times, unexpected outputs, assistance, author interventions and
   instruction corrections. An assisted step remains unproven for independent
   reproducibility until repeated from its required state with corrected docs.
5. Repetition requires sufficient remaining authorization and budget. Do not redo
   a mutation solely to improve a score or clean up its history.
6. Record actual final subject/flags/locks and verify preserved history. If held,
   record the safe state and remaining work instead of marking completion.

This exercise is not bounded to 90 minutes. The workshop's separate timed rehearsal
uses the facilitator guide and clearly labels any historical fallback.

## Acceptance record

Add results to [Build 5 closeout](../build-05-closeout.md), retaining full evidence
in ignored local storage and the approved durable archive. For every step record:

| Field | Required content |
|---|---|
| Subject | Source, digest, deployment, configuration, flag version/digest, audience, policy/workload and observation interval. |
| Action and authority | Exact command/input, operator, approval reference, request hash, producer run/attempt. |
| Observation | Expected versus actual outcome, exit/reason codes, request counts, coverage, latency and errors. |
| Proof | Downloaded envelope/bundle/state paths, checksums, signature/producer verification and freshness result. |
| Recovery | Original uncertain/failed record, subsequent reconciliation, original hash comparison, lock disposition. |
| Reproducibility | Assistance, corrections and repeats; independent pass, assisted, blocked, or not attempted. |

Do not mark Build 5 complete until independent hosted acceptance, timed facilitation,
review, and durable-retention checks have actual results. Automated checks alone
establish neither independent operation nor participant learning.
