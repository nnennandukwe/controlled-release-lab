# Controlled Release Lab

## Purpose

Build the runnable companion to *From AI-Generated Code to a Controlled Release*.
Read `docs/tutorial-brief.md` and `docs/platform-plan.md` before planning changes.

This project must demonstrate actual hosted deployment, user exposure, runtime
measurement, rollback, repair, and completion of a release. A local simulation,
passing CI run, merged PR, or published container alone does not meet that scope.

## Working rules

- Preserve the distinction between approved requirements, proposed architecture,
  implemented behavior, executed verification, and observed hosted results.
- Keep the first application small: a read-only product catalog search with an
  original implementation and a flagged ranking change.
- Identify intentionally introduced failures as teaching fixtures. Do not claim
  a seeded regression occurred naturally during agent generation.
- Bind evidence to the relevant source commit, container digest, deployment,
  configuration, audience, and observation window.
- Verify provenance and subject identity before acting on release evidence.
- Preserve previous records; subsequent observations must not rewrite history.
- Treat absent telemetry and inadequate samples as insufficient evidence.
- Demonstrate feature disablement and application rollback separately. Verify
  the recovery through live requests and provider state.
- Keep rollback targets and their compatible configuration available. A feature
  flag cannot undo writes, schema migrations, or in-flight effects.
- Keep the release exercise functional after the LaunchDarkly trial. Label
  trial-only product extensions explicitly.
- Implement authorization in the execution path. Documentation and agent
  confidence do not enforce permissions. Separate coding and release credentials.
- Do not silently replace exact-image promotion with rebuilding each environment.
- Keep real customer information and credentials outside version control.
- Do not create paid resources, expand account permissions, publish artifacts,
  or change live services without authorization for the specific operation.
- Use the account's ordinary secret-management mechanism; do not ask for tokens
  to be pasted into chat or print their values in command output.
- Keep implementation independent of unbuilt ThreadLoop/GAAP adapters. Explain
  their architectural roles without presenting proposed integration as shipped.

## Verification

For each milestone, record the subject and the behavior actually exercised.
An automated rehearsal establishes system behavior, not participant learning,
customer adoption, or revenue impact. Run checks appropriate to the change.

For tutorial prose, apply Nnenna's editorial system when available at
`/Users/nnennandukwe/Documents/Engineering Enablement AI/NNENNA_EDITORIAL_VOICE_SYSTEM.md`.
That local path is authoring guidance, not a prerequisite for a public reader.
