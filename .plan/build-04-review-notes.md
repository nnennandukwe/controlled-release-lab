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
