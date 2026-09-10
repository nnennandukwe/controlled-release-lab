# Build 4 PR 1 review dispositions

These notes describe implementation review, not hosted acceptance.

The first Qodo deep local review compared the submitted working-tree diff with
pushed main `e0f25c84afcc45d5fbb5486d9eb2d6c2c9093c2e`. It completed with
`coverage.complete=true`, issue/compliance/skills reviewers, and three findings.
Explicit specification refs were unresolved and the spec reviewer was skipped;
the self-contained context supplied the approved contracts. This is not a claim
of independent specification-review coverage. The final local review must include
subsequent completion-verifier and admission changes before opening the PR.

| Finding | Assessment and disposition |
|---|---|
| `2faab1ea-89bd-48b5-978b-3cb66bee276c`, Attackers can exhaust search capacity, action required | Confirmed: the HTTP regression test admitted all 24 pending requests before the fix. Added fixed per-process admission before evaluation/delay: 16 pending, 20/second with burst 20, no queue; excess gets 429. Added socket/header/request bounds and cancellation of the timer on disconnect. Tests exercise actual HTTP overload, continued readiness, capacity recovery, cancellation, and rate replenishment. The intentional 1,000 ms delay remains for admitted ranked workspace requests. |
| `066054df-245a-4f1e-bcd4-e2bfee8be0be`, Public searches can exhaust capacity, remediation recommended | Same unbounded-admission problem, addressed by the same fix. The alternative suggestion to remove or make the fixture test-only conflicts with the approved hosted teaching-fixture requirement and is not adopted. |
| `d0b8c876-3f33-4a12-882a-bc72e869acbe`, Provider recovery remains unverified, remediation recommended | Correct acceptance limitation. Local REST seams and filesystem tests do not establish hosted recovery. The existing protected staging response-loss rehearsal and separately authorized Build 4 hosted failure/disable/native-rollback sequence run after PR 1 merges. Keep hosted acceptance pending until that evidence exists; do not add provider credentials to untrusted PR tests or present the local tests as hosted proof. |

The request limits are a bounded review remediation, not the repair candidate G.
G still requires a subsequent source revision after observed F failure and both
recoveries. Preserve these application bounds in G; do not alter the observation
policy or workload. No dependency, resource, account role or configuration switch
was added by the remediation. The Build 3 Qodo label discrepancy stays separate.

## Second review and additional remediation

The next deep review reported `coverage.complete=false`. The CLI's 1% Git copy
detection classified the new HTTP fixture test as copied from `.env.example` and
excluded it. Inspection confirmed no real credential in that test. Its unchanged
HTTP scenario now lives in the existing `test/server.test.ts`, which Git reports
as modified rather than copied from a secret-like path. Full verification still
passes; final review must include that test.

| Finding | Assessment and disposition |
|---|---|
| `1852c1cd-fd9f-4d90-8992-6829b7c5d63a` and `cae5acd4-5783-4b86-904c-fc2be6d79ec5`, disconnected searches retain slots | Confirmed by 16 stalled evaluations followed by disconnect: another request incorrectly received 429. Evaluation now has a one-second deadline and request cancellation ends its HTTP wait. Admission releases idempotently on close and in finally. A separate cap retains at most 16 outstanding SDK calls, preventing cancellation from creating unlimited abandoned work; callers receive controlled 503 until those SDK calls recover. Tests cover disconnect, deadline, eventual recovery, and safe late rejection. |
| `93792902-b4b1-4f50-991d-a140905e045c`, unrelated latency baselines | Initial deployment proofs copied the keyboard probe into every baseline field. Corrected to an explicit null paired baseline and an absolute 500 ms per-query guard for deployment observations. Their raw query metrics retain independently measured p95 values. Authorized exposure operations require non-null values derived from each actual off query, as their verification path already did; a bootstrap-only proof cannot become exposure completion evidence. Tests use distinct query latencies and reject a slow bootstrap query. |

The second review marked the two original unbounded-admission findings resolved.
Hosted recovery remains an acceptance gap and specification refs remain unresolved.
Neither the incomplete review nor local HTTP checks establish hosted acceptance.

## Third review and client fairness

The third full deep review at `92c3db82436450aa465621dd1b1352abcef26a80`
reported complete file coverage with no skipped files. Specification refs remained
unresolved. It marked the query-baseline finding resolved, but retained the two
stalled-evaluator findings with descriptions/snippets from `a1ae426`. Those
descriptions no longer match the cancellation/deadline implementation and passing
disconnect, timeout and late-settlement tests. Preserve that attribution discrepancy;
do not claim the tool closed those findings.

New duplicate action-required findings `1d26f391-8a1e-400e-a27a-406fd9eeddc1`
and `705d761f-487f-475c-a861-f40727e001dd` correctly identified that a single
client could consume all global permits. A new HTTP test reproduced 16 admitted
delayed requests from one client. The fix adds a four-request per-client cap and
12/second burst/refill quota beneath the existing global limits, plus a per-client
cap on abandoned SDK calls. Another client can still search while the first has
delayed or abandoned work. Client quota storage is capped at 1,024 entries and
expires idle entries; active entries cannot be evicted. Actual HTTP tests cover
distinct clients and invalid hosted identity; pure tests cover rate/storage bounds
and local refusal to trust forwarded identity.

Hosted identity follows the existing Railway HTTP ingress: `X-Real-IP` is always
overwritten by the edge according to [Railway's staff confirmation](https://station.railway.com/questions/need-authoritative-railway-client-ip-p-b7a7b4bd).
Local mode uses only the socket address. Missing/invalid hosted identity fails
closed. This adds no resource, credential, dependency or runtime setting. Hosted
ingress verification and the original failure/recovery acceptance remain pending.

## Fourth review and policy declarations

The fourth full deep review at `f8ce07ed27c99d6b0c6ef9fa5ca29e0739940517`
reported complete file coverage with no skipped files; specification refs remained
unresolved. It retained the earlier evaluator/client-quota finding statuses with
their pre-fix descriptions. The current HTTP tests verify those fixes; these notes
do not represent a Qodo dismissal or a clean tool verdict.

| Finding | Assessment and disposition |
|---|---|
| `58dd18e3-ab34-4694-96bf-b588151c0db8`, Query policy edits leave gates unchanged, remediation recommended | Confirmed: changing the declared queries did not stop module startup. Added startup validation of the fixed query roles and derived the enum from that validated tuple. Added equivalent validation for the fixed stage order. Import tests first reproduced acceptance of incompatible declarations, then verify rejection. Changing the contract requires coordinated code/policy changes, rather than silently hashing ignored declarations. |
| `1cf808d8-4323-42c5-a56f-21aee46e23d1`, Blocked rollout evidence expires, remediation recommended | Accepted retention limitation, explicitly specified by the approved plan: retain existing 90-day GitHub artifacts and document archival before expiry. The runbook requires operator archival of signed envelopes, bundles, state and referenced artifacts. Permanent storage and automated archival are not implemented or claimed. No new resource or unattended automation is authorized by this PR. |
| `84a8ba14-9e0d-4dff-b974-b141afe91882`, Searches stay unavailable after stalls, action required | Deliberate failure boundary: if underlying SDK work never settles, safe evaluation capacity remains unavailable. Releasing counters while uncancellable work remains would allow unbounded abandoned work; discarding the unresolved work requires process isolation/replacement beyond this bounded fixture change. The pinned default SDK uses an in-memory feature store; permanent stall is exercised with an injected evaluator, not presented as observed hosted behavior. HTTP waits end within one second; per-client/global outstanding work stays bounded, and tests verify capacity recovers when work actually settles. The runbook now explicitly requires retained error evidence and separately authorized restart or rollback followed by fresh verification for a persistent stall. No self-healing or continued healthy service is claimed. |

Retain the tool's open statuses and the code/behavior evidence for these assessed
disagreements. Do not add new infrastructure, silently recycle unresolved work,
or remove the disclosed fixture to obtain a nominally clean review.

## Fifth review and diagnostic output

The fifth full deep review at `69a6bdbcdc783b5cabed5f915905172c34d02653`
reported complete file coverage, unresolved specification refs, and two new
remediation-recommended findings. The earlier tool statuses remained open.

- `ea44fee0-0165-464a-ac47-d963b28a2438`: clarified the workflow predecessor
  selector to say internal for 5%, 5% for 25%, and 25% for 100%. Guards were already
  enforcing that mapping; the input description was ambiguous.
- `41fc4ebb-b762-48e0-956f-4079b0993f76`: the diagnostic CLI omitted the signed
  record's reason codes and recovery instruction. Tests first reproduced those
  missing fields for both unhealthy measurement and healthy measurement plus
  blocked exposure. The verifier now returns the authenticated recorded decision
  separately from the recomputed `featureAssessment`. The latter does not claim
  to recompute cross-stage retention without predecessor attachments, and neither
  can authorize expansion. Raw samples remain in the retained artifact.

## Final local review and first PR review

A local review at `7df212d98edff22ab4798fffa85f5d2f1e9d7652` lost its WebSocket
connection and failed with `getaddrinfo ENOTFOUND sdk.qodo.ai`. That attempt is a
runtime failure, not an eligibility skip or passing review. DNS recovered; the
unchanged revision's full deep retry completed with complete file coverage, no
new findings and unresolved specification references. Prior open statuses persisted.

The carried-forward advisory `ece2a816-abab-40b9-a2ee-ecf443f6b513` recommends a
project-owned wrapper for Node request types. No wrapper was added: the identity
helper is an HTTP adapter with a structural parameter that accepts plain test
objects, and the public Node type import is erased at runtime. A server framework
migration is outside this fixed-Node change. This is a recorded assessment, not a
tool dismissal.

PR 12's completed review `1076759` covered that exact head and marked the earlier
capacity, cancellation, query-baseline and diagnostic-output findings implemented.
It retained the documented hosted-recovery and permanent-SDK-stall findings, and
added `24fcc419-19e7-4367-888c-1f3b36157841`, New clients lose search access.
Confirmed: with 60-second retention, 1,024 distinct clients could fill the quota
table at the permitted global rate. A test first reproduced rejection, then verifies
2,500 distinct arrivals at 20/second after shortening idle retention to 30 seconds.
The bounded arrival rate, burst, active clients and briefly throttled clients
fit below the unchanged 1,024-entry cap. Active entries still cannot expire; rate, concurrency and SDK limits
are unchanged. No hosted traffic or additional resource was needed for this test.
