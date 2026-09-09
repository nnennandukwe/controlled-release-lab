# Build 2 approval-cancellation contract check

Observed September 9, 2026. This is a read-only recovery check; it does not claim
that a deployment ran or that Build 2 hosted acceptance is complete.

The fresh request in [run 34323370430](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34323370430)
failed local policy validation before approval: separate clock reads made its
validity 1,800,001 ms instead of the allowed 1,800,000 ms. The waiting workflow
was cancelled without approving its protected job.

The actual [job response](https://api.github.com/repos/nnennandukwe/controlled-release-lab/actions/runs/34323370430/attempts/1/jobs)
is captured unchanged in
[`github-cancelled-approval.json`](../test/fixtures/github-cancelled-approval.json).
The completed `operate` job has conclusion `cancelled`, runner ID `0`, empty
runner name and no steps. The separate skipped `staging-proof` job has null
runner metadata. The regression test uses this complete provider response;
null/missing runner metadata on a cancelled operator still cannot authorize
skipping its state.

An automated read-only invocation of `previousOperation` used the real GitHub
API with history cutoff `34324004339` (the later PR Verify run), target `staging`,
and the repository's authenticated reader. It selected:

```json
{
  "runId": "34321711822",
  "artifactName": "lab-state-staging-34321711822-1"
}
```

The check downloaded that exact artifact, compared every immutable attempt and
rehearsal file against the earlier SHA-256 manifest, and inspected Railway before
and after. All 134 historical files matched; there were zero unresolved locks;
the two provider snapshots were identical. The raw check, snapshots and downloaded
state are retained locally under `artifacts/build2-acceptance/cancellation-contract/`.
Those local artifacts are not public repository files or new attestations.

This tests live history selection and recovery of the preserved state without
issuing a provider mutation. After the reviewed fix reaches trusted main, a fresh
protected staging recovery rehearsal must restore this same prior state, execute
its separately authorized deployment, reconcile, observe and sign successfully.
That end-to-end result belongs in the Build 2 closeout.
