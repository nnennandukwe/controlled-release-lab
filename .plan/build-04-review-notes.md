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
