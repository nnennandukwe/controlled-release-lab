# PR 1 review resolution

These changes address the completed Qodo review of
`70bc98485dbe5d3077fe8bed347364f62697df8c`. This document records code behavior;
the current Qodo review status must still be checked against the pushed PR head.

| Finding | Resolution and regression coverage |
|---|---|
| `2e03e88d-f614-4995-abfa-7faa6ed34d3c`: unrelated deployment attribution | `tools/operations.ts` rejects a changed latest deployment after the source update, preserves an unknown outcome and lock, and does not send a second deployment request. `test/operations.test.ts` reproduces this race even when the other deployment has the intended image, then verifies read-only reconciliation with explicit causality limits. |
| `ba8f45ee-6f03-48d3-8952-2d4c434bb8f0`: setup failures block later operations | `tools/workflow.ts` checks attempt-specific GitHub job/step history before skipping absent artifacts. Tests cover setup-only failure, first-use recovery, older evidence, skipped reruns, cancellation, and ambiguous history. A possibly executed operation still requires its evidence. |
| `e89afd43-9d43-4421-bdbf-e0de5ab5ea96`: slow targets lose samples | `tools/observe.ts` waits for capacity while preserving the request count, launch-rate ceiling, concurrency limit, and an explicit total traffic deadline. Slow-response and deadline tests exercise the real scheduler and cancellation. Actual elapsed time is recorded; the runbook distinguishes minimum duration from maximum traffic duration. |
| `a5a471e1-fbd8-4e8e-82d5-65756a7c50f1`: claimed preflight lock leak | The reviewed code already set its mutation flag after the fresh snapshot and comparison. The marker is now named `providerMutationAttempted` and placed immediately before each first mutation call. The existing state-drift and failed-read regressions prove a blocked result, no mutation, lock release, and successful subsequent execution. This was not a reproduced lock leak. |
| `e13c544a-ee31-4d1c-8cb3-d03fc4161113`: non-ASCII help | Already implemented in `70bc984`; the structured review reports it as implemented. No additional change is needed. |

The observer's explicit time budget refines Build 1's original fixed-slot
measurement proposal in response to this review. It does not establish rollout
thresholds or relax sample sufficiency. Hosted acceptance remains pending.

The completed follow-up review of `3e4a1c3` marked all five findings above as
implemented and raised two additional recommendations:

- `120163f6-cd93-4ed1-a966-343cbe46cfe7`: the Operate workflow now exposes
  `max_duration_seconds`, passes it through `LAB_MAX_DURATION_SECONDS`, and
  validates and forwards it to the CLI. Tests cover forwarding and invalid bounds.
- `45a6ac35-e252-4fde-9076-8e42722b0b5b`: real Railway recovery is not yet verified.
  This is an outstanding hosted acceptance requirement, not a claim that local
  fixtures establish provider behavior. The runbook's A-to-B-to-A rehearsal and
  uncertain-outcome reconciliation require authorized resources and release
  credentials. This recommendation remains open until that evidence exists.
