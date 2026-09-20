# Build plans

Keep each build plan in this hidden, version-controlled directory.

1. [Hosted baseline and recovery](build-01-hosted-baseline-recovery.md) — complete and [merged as PR #1](https://github.com/nnennandukwe/controlled-release-lab/pull/1); [hosted execution](../docs/hosted-rehearsal.md) and [closeout](../docs/build-01-closeout.md) record the evidence and remaining Qodo label discrepancy.
2. [Attestation and authorized promotion](build-02-attestation-authorized-promotion.md) — complete and merged; [signed hosted promotion/recovery and CI-only credential handoff verified](../docs/build-02-closeout.md).
3. [Controlled feature exposure](build-03-controlled-feature-exposure.md) — implemented and merged; [signed hosted promotion, internal/5% exposure, and same-deployment disablement verified](../docs/build-03-closeout.md). Both environments end off. The closeout records the remaining Qodo sampling-policy label discrepancy.
4. [Regression, repair, and completed release](build-04-regression-repair-release.md) — approved two-PR sequence; [transaction proof](build-04-transaction-proof.md). [Hosted failure, both recoveries, repair and complete rollout are recorded](../docs/build-04-closeout.md).
5. [Tutorial and workshop companion](build-05-tutorial-workshop.md) — [teaching package and acceptance record](../docs/build-05-closeout.md); independent hosted and timed rehearsals remain separate gates.

Build 5 has its own approved plan; Build 1's earlier scope summary remains historical.
Execution results belong in separate records; a plan is not proof of completion.
