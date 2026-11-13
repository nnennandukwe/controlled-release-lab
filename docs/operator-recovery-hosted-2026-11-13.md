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
