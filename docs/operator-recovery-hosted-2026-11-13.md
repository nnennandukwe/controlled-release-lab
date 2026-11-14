# Hosted staging operator recovery check

The completed-owner recovery check passed against Railway staging on November 13,
2026, from 14:50:59 to 14:51:01 Pacific. The [receipt](evidence/operator-recovery-2026-11-13-premerge.json)
binds the execution to operator source `7f2241305e40eb54411ad6322d82ee6470833ce6`.
This was an explicitly authorized local invocation of the public CLI with real
provider requests and the staging-scoped project credential.

## Subject and starting state

The target is the existing staging environment
`80bb920f-55eb-479c-b395-cacfb78344c3`, in project
`3e9cfaf4-3dec-4aa9-a8a9-ef7a8af538b6`, service
`a84fd6cc-c41c-4ba0-ad84-470634a51e28`. Railway reported deployment
`ccf563b3-8dd2-4f3d-af4f-ed65196f8b77`, with G's retained image:

```text
ghcr.io/nnennandukwe/controlled-release-lab@sha256:1f38ac2ff7292d873a2162f91631a3dbc810b31f5a83b9e702c6f621f6ada8f4
```

The retained [publisher run](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35380922988)
names application source `fb9aaaea83a80cecfd63c30ed2de81ae68a0f99c`.
A separate [runtime identity read](evidence/operator-recovery-2026-11-13-identity.json)
confirmed that source and deployment at the staging endpoint. The configuration
fingerprint was `d174192d79e0d2f36ddbff6a7c8ba587fa9771db6c10b427a51970531375bbad`.

The first protected [preflight](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/43520737547)
stopped at `PROVIDER_REJECTED`. Railway's dashboard marked the existing staging
CI token invalid. Its replacement has the same project/environment scope and was
stored in the existing staging GitHub secret. The fresh protected
[preflight](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/43522261016)
passed. Existing account roles, workflow permissions and environment approval
rules were retained.

## Failure and recovery exercised

An isolated journal models a completed pre-effect rejection whose owned lock
survived interrupted cleanup. This terminal record is a labeled teaching fixture.
The first CLI reconciliation sends an intentionally invalid read-only GraphQL
field to Railway itself. Railway returned HTTP 400 with one validation error.
The CLI saved a new blocked record, retained the original owner's lock, and
emitted a retry command with the original UUID and custom configuration path.

The check executed that command through the shell. Paths included spaces and an
apostrophe. Normal Railway readback then produced `COMPLETED_ATTEMPT_CLEANUP`,
saved a new checksummed blocked record and removed only the owned lock. The
original record and checksum stayed byte-for-byte unchanged. All seven provider
requests were reads; no mutation was attempted, and before/after provider
snapshots matched. This verifies blocked cleanup against actual provider error
and readback behavior. Feature-cohort measurements and release eligibility
aren't part of this receipt.

## Repeatable protected execution

On main, dispatch **Operate lab** with `operation=doctor`, `target=staging`, and
`rehearse_operator_recovery=true`, then approve the normal staging job. The new
step uses the existing job's credentials and permissions, rejects other targets
and operations before resolution, and preserves its receipt and failure files in
the ordinary `lab-state` artifact. The test transport rejects provider mutations
and any destination outside Railway's GraphQL endpoint.

The new protected CI input's execution follows merge. The pre-merge receipt above
records the local invocation separately. Original evidence remains available in
the isolated journal, and the local and hosted checks retain their own revisions
and observation times.

## Direct request accounting

A later [instrumented receipt](evidence/operator-recovery-2026-11-13-measured.json)
records source `c21c539469160665bee62dbb1f81311ea41bee9e`, from 14:56:35 to
14:56:37 Pacific. It records each direct preflight/readback request as well as
the subprocess requests, so provider retries are counted from execution. The
check again observed seven provider reads, the induced HTTP 400, unchanged
provider state and original bytes, and successful blocked owned-lock cleanup.
The earlier receipt retains its original observations and call-site accounting.

## Harness review fixes

Local review of `806f921` found that successful provider retries were rejected
and a timed-out shell could leave descendants holding output pipes. Before the
fixes, the real adapter's 429-to-success retry failed the audit check; disposable
process-tree tests reproduced both the timeout hang and surviving descendants
after SIGTERM. Those regressions passed after the harness accepted bounded
supported read retries and terminated its owned POSIX process group on timeout
or cancellation. Unexpected errors, missing reads and mutation attempts still
fail the audit.

The [subsequent hosted receipt](evidence/operator-recovery-2026-11-13-review-fixes.json)
binds source `82bdb9b80b04da1df82992ab725a4a16fe0e6487`, from 15:06:54 to
15:06:55 Pacific. Its seven measured reads again produced the intended HTTP 400,
preserved original bytes and provider state, and completed blocked owned-lock
cleanup with zero mutation attempts. The retry and process-tree regressions are
local checks; this hosted receipt records the actual Railway requests separately.

## Scope-read recovery

Hosted review of `8c0dece` identified an earlier boundary: Railway scope
verification ran before the deployment journal catch. If that read failed, the
CLI retained the original lock but returned help without the recovery UUID and
custom config. The corresponding exposure provider/flag preflight paths had the
same diagnostic gap. Six new cases failed before the fix. Typed preflight errors
now carry the original-owner command after prior identity and request checks;
scope enforcement still precedes mutation locks and effects.

The [two-phase hosted receipt](evidence/operator-recovery-2026-11-13-preflight.json)
records source `e81a70ad1f2857506ced660c7f4a923a3e57809e`, from 15:31:17 to
15:31:21 Pacific. Snapshot rejection used seven measured provider reads; scope
rejection used six. Both actual Railway HTTP 400 responses preserved the original
owner and executable recovery command. Each retry saved blocked cleanup evidence,
released only its owned lock, preserved earlier bytes and observed unchanged
provider state. Scope rejection correctly claimed no newly saved failure record.
The protected opt-in job now runs both phases separately and retains both
receipts. No application mutation was attempted in either check.


## Receipt format and operations authority

The dated JSON files above are sanitized historical summaries assembled from
local receipts. They omit machine-local artifact paths and add derived checksums
or configured pipeline details. Their pipeline fields describe the intended
main-only workflow, rather than an executed CI run. Earlier files retain their
original observations. New runs emit `public-receipt.json` directly from the
producer, including measured file hashes, relative paths and actual local or
GitHub Actions execution metadata. Copies of that producer output must preserve
its bytes.

The opt-in rehearsal belongs to the protected release-operations job, alongside
its staging doctor. It uses the same environment-scoped operations credential
after main/ref and owner-approval checks. Generic Verify CI and coding tasks
receive no Railway credential. The provider-read allowlist also rejects writes
inside this rehearsal. Existing credential scope and account permissions stay
unchanged.

## Concurrent cleanup and gateway retries

Three real-filesystem schedules reproduced stale cleanup deleting a newer
owner's lock. Locks now publish a populated owner directory through POSIX rename;
release removes only the original UUID's marker. An empty outer directory means
the environment's available. Existing plain-file locks can still be reconciled;
all subsequent acquisitions use directories, which a stale legacy unlink can't
remove. Operators must use the upgraded version consistently for a retained work
directory. This covers process interruption on local macOS/Linux filesystems.

The hosted preload also used to parse every HTTP response as JSON before the
Railway adapter could inspect it. HTML 502/503/504 responses reproduced aborted
retries. The logger now records their unknown error count as null and returns
the original response to the adapter's bounded retry path.

The updated check passed from operator source
`8045d171c5561121b9c37934498904742bb4bf35` at 15:55:48–15:55:51 Pacific.
The producer's [snapshot receipt](evidence/operator-recovery-2026-11-13-lock-snapshot.json)
and [scope receipt](evidence/operator-recovery-2026-11-13-lock-scope.json) are copied
byte-for-byte from their emitted files. They record seven and six provider reads,
respectively, with zero mutation attempts, unchanged provider state and original
record/checksum bytes, retained ownership after the error and successful blocked
cleanup through the emitted CLI retry command.


## Previously verified owners after drift

Review96f2f612 found that a completed verified owner could remain locked if fresh
verification later found drift or unhealthy behavior. Four new regressions failed
before edits. After valid target/provider readback, these cases now save a blocked
cleanup record with the observed failure and `COMPLETED_ATTEMPT_CLEANUP`, then
release only the retained owner. Earlier verified bytes remain unchanged. Initial
scope/readback failure still retains ownership; unknown effects keep their full
reconciliation requirements.

The protected opt-in step now runs both read-rejection phases for two terminal
fixtures. The verified-drift fixture uses an explicitly synthetic historical
configuration to exercise the new cleanup branch. The actual hosted configuration
stays unchanged. Each receipt identifies its fixture and actual provider subject.

All four actual hosted cases passed from source
`438c329cb1b9f4ce101c33665053a8ab46fb8fc8`. The producer receipts are preserved
unchanged: blocked-result [snapshot](evidence/operator-recovery-2026-11-13-final-blocked-snapshot.json)
and [scope](evidence/operator-recovery-2026-11-13-final-blocked-scope.json), plus
verified-drift [snapshot](evidence/operator-recovery-2026-11-13-final-verified-drift-snapshot.json)
and [scope](evidence/operator-recovery-2026-11-13-final-verified-drift-scope.json).
Together they recorded 26 provider reads, zero mutation attempts, preserved
original records/checksums and unchanged hosted deployment/configuration. Both
verified-drift retries saved blocked `COMPLETED_SUBJECT_CHANGED` cleanup with
`COMPLETED_ATTEMPT_CLEANUP`, then released only their retained owner markers.

## Source and durable-readback guards

Review87e91fef found that the local producer recorded HEAD without checking source
edits. A runtime reproduction reached the provider transport with an owned source
edit. The producer now requires a clean committed checkout before provider access
and checks cleanliness plus the same commit again before writing success receipts.
Disposable Git checks cover working-tree, index and untracked edits, plus a changed
commit. A dirty runtime invocation now stops before any provider request.

Review77e87af5 found an earlier exposure persistence boundary. A previously verified
owner now enters blocked cleanup only after both initial provider and flag
readbacks are durably journaled. Intent/provider/flag append failures retain the
original owner and unknown recovery state; retrying the original owner completes
normal fresh verification. All three failure/recovery regressions pass. Earlier
records and receipts retain their original source revisions and observations.


## Isolating configuration drift

Review82924701 identified that the earlier verified-drift receipts also used a
null retained deployment ID. Those checks demonstrated subject-change cleanup
with both deployment identity and configuration differences. The revised fixture
requires one stable deployment/image and retains that actual identity, while
simulating only the earlier configuration. New receipts include the retained
subject fields so an inspector can compare them with actual provider readback.
The earlier observations remain unchanged.

Recovery hints now resolve work and configuration paths before shell quoting.
The CLI tests start from a package subdirectory with relative paths and execute
the emitted npm command, checking that it finds the original attempt and owner.
