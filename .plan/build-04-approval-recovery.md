# Build 4: rejected approval recovery

Hosted cleanup uncovered an operator-only recovery gap after the G application
release. Rejected expired approvals produced GitHub `operate` jobs with
`conclusion: failure`, explicit `runner_id: 0`, empty `runner_name`, and no steps.
The existing state-restoration code recognized that same unallocated-job evidence
only for `cancelled`, so run 35515591301 stopped before its execution step.
The projected provider fixture comes from run 35513302938; both failed runs and
the earlier cancelled request remain preserved. No provider effect occurred.

The added transition is read-only history selection: a completed failed job with
explicitly unallocated runner and zero steps may be skipped to locate the previous
durable state. It does not initialize empty state when previous durable state exists,
grant approval, remove a lock, refresh an expired request, or repeat an effect.
The effect boundary stays behind the existing protected workflow and request checks.

Before production edits, the captured rejection failed through `previousOperation`
with the missing-evidence diagnostic. Negative tests retain the block for missing,
null or allocated runner metadata, any contradictory steps, incomplete job lists,
and unsupported conclusions. Existing tests cover a failed execution, cancellation
after execution, skipped reruns, artifact absence and restoration of owned locks.

This is a narrow additional operator fix required by observed hosted behavior,
beyond the two planned application implementation PRs. It must pass focused/full
verification, local and exact-head PR review, and normal merge. G's published image
and application source remain unchanged; do not rebuild G for this operator fix.
After merge, use a fresh protected staging disable request and read-only live
monitoring, preserving the existing policy, request budget and historical evidence.
