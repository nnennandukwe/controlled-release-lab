# Local operator recovery maintenance

Scope: authorization rejection, response loss, observation interruption, and owned
lock cleanup at base `3b40267`. All new provider fixtures are synthetic and local.
Hosted acceptance, service changes, publication, and traffic aren't authorized.

## Reproduced failure

Both execution APIs write a verified terminal record before removing the owned
lock. Injecting an unlink failure at that boundary preserves the record and lock,
but a subsequent read-only reconciliation rejects the record as `NOT_UNCERTAIN`.
The deployment and exposure regression tests failed at their actual reconciliation
entry points before production edits. The CLI also loses the saved result when
that cleanup exception escapes to its general I/O error handler.

## State and commit points

| Starting state | Operation | Result | Recovery |
|---|---|---|---|
| Rejected authority | Verify request and protected identity | No provider effect or mutation lock | Resolve fresh authority |
| Prepared | Preserve intent, then submit provider effect | Effect may be pending | Read-only reconciliation |
| Unknown effect | Lose response or interrupt observation | Original intent and owned lock retained | Reconcile original UUID |
| Terminal result durable | Publish record plus checksum | Measured result committed | Remove matching owned lock |
| Terminal result, cleanup interrupted | Unlink fails or process stops | Saved result and owned lock remain | Reconcile the original owner |
| Reconciliation durable | Save new record plus checksum | Earlier record unchanged | Release only original owned lock |

The provider call and terminal record/checksum publication remain separate commit
operations. A checksum is required by the real record consumers. An incomplete
record still falls back to the durable intent under the existing contract.

## Invariants

- Only an unknown attempt or a completed attempt that still owns its lock may
  enter read-only reconciliation.
- A requested attempt UUID must match the retained record's UUID.
- A completed unsuccessful attempt may clear its owned lock after provider
  readback and a new blocked cleanup record; it supplies no release eligibility.
- Reconciliation never repeats a provider mutation or changes previous evidence.
- A different lock owner is preserved. A completed unlocked record can't become
  new reconciliation authority.
- Cleanup failure after a saved result returns its path, attempt, measured outcome,
  and a cleanup warning. CLI exit 2 signals that lock cleanup still needs action.
- Reconciliation failure names the original attempt for the next recovery command.
- Existing authorization, image/configuration identity, observation policy,
  request budgets, and separate flag/application recovery stay enforced.

## Fault matrix and lifecycle coverage

Reuse `.plan/build-04-transaction-proof.md` for unchanged filesystem and provider
operations. This maintenance adds the following boundaries and checks.

| Boundary | Fault | Expected state | Check |
|---|---|---|---|
| Terminal lock unlink | I/O failure | Saved result unchanged; matching lock retained; warning with recovery command | Execution API regressions and CLI warning mapping |
| Cleanup restart | Reconcile terminal owner | Verified results receive fresh provider/traffic checks; unsuccessful results stay blocked after readback; original bytes preserved; zero repeated writes | Deployment/exposure regressions |
| Ownership read | Missing lock or different owner | Completed record rejected; other state unchanged | Negative ownership regressions |
| Record identity | Record copied under another attempt UUID | Reject before provider access or lock removal | Deployment/exposure regressions |
| Observation/reconciliation | Failed or interrupted measurement | Lock and original evidence retained; recovery names original UUID | Failure and cancellation checks |
| Authority | Forged, expired, or changed request | No unauthorized provider effect | Real protected-gate tests |
| Provider response | Loss before/after acknowledgement | Unknown effect; restart remains read-only | Existing and added local integration checks |

Lifecycle: reject authority; submit once; preserve uncertainty; interrupt or fail
observation; restore intent; reobserve; publish a new checksummed record; fail
cleanup; restart cleanup through fresh observation; reject unowned/edited state.
Production consumers are `loadRecord`, `loadExposureRecord`, and the CLI. New
results don't establish hosted acceptance or participant outcomes.

## Additional observed recovery guards

At the original base, `loadAttempt` accepted a checksummed record whose UUID
differed from the requested directory. The reproduction returned
`mismatchAccepted: true`. Both deployment and exposure consumers now reject a
record or fallback intent copied under another UUID before provider access.

The failed-measurement regression also verifies that a subsequent recovery command
names the original lock owner rather than the new failed observation attempt.
Real protected-gate tests cover initial expiry and identity rejection immediately
before and after the source update. Only the latter retains an unknown effect.

## Sealing and drift follow-up from review

Final review at `f563cb6` identified two additional boundary cases. A verified
measurement with `cleanupWarning` must remain in local state until cleanup;
sealing must emit `sign=false` and create no new proof or diagnostic artifact.
This applies to both deployment and exposure sealing entry points.

A completed unsuccessful exposure owns no pending provider effect. After its
request and lock identities are verified, current deployment drift must remain
observable in the new blocked cleanup record rather than prevent cleanup from
starting. Unknown attempts still require the original serving-subject checks.

| Boundary | Fault | Required result | Lifecycle check |
|---|---|---|---|
| Seal public CLI | Saved verified/blocked result with cleanup warning | No eligible or diagnostic artifact; sign=false | Real seal subprocess with checksummed exposure fixture and deployment gate |
| Pre-effect flag check | Deployment drifts, then owned-lock unlink fails | Terminal blocked record retained | Real exposure execution and immutable files |
| Cleanup after drift | Original terminal owner reconciled | Provider readback recorded, blocked cleanup saved, original lock released, no proof | Exposure recovery regression |

These are local protocol changes. Native signing, provider mutation and hosted
traffic remain outside this maintenance request.

Allowing image/configuration drift for completed unsuccessful cleanup still
requires the provider adapter to match the retained project, service,
environment, and URL. The hosting scope check gains an optional expected target;
its Railway implementation rejects a mismatch before transport access. Existing
callers retain the same default behavior. Negative adapter tests cover each
identity field, and unknown-effect drift continues to retain its lock.
