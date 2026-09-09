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
thresholds or relax sample sufficiency. Hosted acceptance was pending at that review;
the later execution is recorded below.

The completed follow-up review of `3e4a1c3` marked all five findings above as
implemented and raised two additional recommendations:

- `120163f6-cd93-4ed1-a966-343cbe46cfe7`: the Operate workflow now exposes
  `max_duration_seconds`, passes it through `LAB_MAX_DURATION_SECONDS`, and
  validates and forwards it to the CLI. Tests cover forwarding and invalid bounds.
- `45a6ac35-e252-4fde-9076-8e42722b0b5b`: real Railway recovery was unverified.
  The subsequent authorized execution and provider fixes are recorded below.

Review of `de43214` confirmed the deadline fix and added
`7e68ccb6-205c-4abb-9adf-9588938f8173`: live changes need an audit reference.
The workflow now accepts `change_reference`, the CLI accepts `--change-reference`,
and the operation rejects live apply without a valid reference before provider
access. Intent/final records carry the reference and reconciliation preserves
the original one. This is traceability metadata, not substituted approval.

## Railway connection follow-up

The completed review of `92b2a4c1bb3c7aaa193ae19295994bd7f8c6281d` reported seven
findings as implemented and `45a6ac35-e252-4fde-9076-8e42722b0b5b` as pending.
The [Railway connection record](railway-connection.md) now makes the subsequent
real staging/live setup and successful scoped-token preflights visible in this PR.
The linked JSON records the checked source SHA, timestamps, target identities,
provider snapshots, and configuration fingerprints, without credential values.

That connection update established local operator connectivity only. The later
execution below supplies deployment/recovery evidence. GitHub Actions deployment
credentials remain unconfigured; local Keychain access is not protected CI access.

## Hosted recovery and provider fixes

The [rehearsal report](hosted-rehearsal.md) and linked original records address
`45a6ac35-e252-4fde-9076-8e42722b0b5b` with actual Railway execution. A staging
deployment response was deliberately lost, a duplicate apply was blocked, and
ordinary reconciliation verified the live service while preserving the unknown
record. The A-to-B-to-A exercise found two real provider-contract defects:

- Native rollback returns `Boolean!`, not the object shown in the documentation
  example. The adapter now accepts the scalar acknowledgment, retains uncertainty,
  and requires read-only reconciliation instead of inventing a deployment ID.
- Native rollback leaves the service source on the newer image. The operator now
  aligns that source to the saved recovery digest and retains the existing guard
  against unexplained deployments during the update.

The original HTTP 400, blocked source mismatch, authorized repair, and subsequent
clean normal-command replays are all retained. Captured schema/response fixtures
and failure-first regressions cover both bugs. Neither a synthetic provider nor
an application-only version check substitutes for this hosted evidence.

## Concurrent-writer boundary

Review of `782b749` added `2d1f49ae-605d-4e13-a3ac-6f07d339cfcf`, **Rollback can
erase a newer deployment**. A final provider snapshot now runs after source
journaling, immediately before native rollback. Observed drift produces
`ROLLBACK_STATE_CHANGED`, sends no native rollback, and preserves the lock.
A regression exercises another deployment appearing at that boundary.

Review of `e15c5b3` reported that mitigation as implemented and added
`24477126-2a4f-482e-bc8d-dd029cafae4b`, **Operators lose rollback drift evidence**.
The refused provider snapshot is now preserved in both the final record and a
durable `rollback-drift` journal event before returning the blocked result.
The regression asserts the competing deployment identity survives in both places.

This mitigates observable drift; it does not provide atomic compare-and-swap.
Railway exposes no conditional version argument on this mutation. The runbook
now explicitly limits this lab to one deployment writer, using one shared local
work directory or the serialized Actions path. Trusted administrators must not
deploy through the dashboard or another API client concurrently. Supporting
independent competing writers would require a stronger provider/authority boundary.
The current Qodo attribution must be read separately; this document does not
claim the residual provider limitation disappeared.
