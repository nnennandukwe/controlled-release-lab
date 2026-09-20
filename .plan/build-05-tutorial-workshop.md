# Build 5: Tutorial and Workshop Build Plan

## Summary

Implement the [approved tutorial brief](../docs/tutorial-brief.md) as a reproducible
tutorial and 90-minute facilitated shared-lab workshop, using the executed
[Build 4 evidence](../docs/build-04-closeout.md). The approved starting base is
`b670b594ee16b20e74fa5e5a91f15addc024933b`. Deliver one documentation PR; keep its
implementation, review and hosted acceptance states separate.

## Skills To Use

- `voice-canon` and `curiosity-gap`: apply the local editorial system, establish
  reader context, explain decisions before commands and preserve evidence limits.
- `qodo-get-rules`: apply the retrieved repository rules on identity, history,
  independent recoveries, credential separation and executable authorization.
- `dx-audit --focus surface`: assess setup, commands, outputs and recovery; expose
  runtime verification gaps instead of treating source inspection as execution.
- `qodo-review`: review the complete local diff against the pinned pushed base.
  Git/remote/base are available; confirm repository access and coverage at execution.

## Scope

Include the tutorial, separate setup, evidence index, facilitator guide, worksheet,
answer key, independent hosted rehearsal record and timed facilitation record.
Track monitoring, retention, approval-recovery CI and the unexplained 502 alongside
this work. Exclude runtime changes, new publication/provisioning, flag removal,
unattended monitoring, integrations and claims of learning/adoption from rehearsal.

## Package Layout / File-to-Task Mapping

- New `docs/tutorial/`: narrative, setup, evidence and concrete rehearsal request.
- New `docs/workshop/`: facilitator guide, participant worksheet and answer key.
- New `docs/build-05-closeout.md`: observed verification, limitations and follow-ups.
- Update README/runbook/platform-plan/build-index navigation and stale status links;
  preserve historical plans and records.

## Dependencies And Settings

No new dependencies, APIs, commands, workflow inputs, schemas or policies. Use
Node 24.20.0, the lockfile, Docker and the pinned verifier on macOS arm64/Linux x64.
Keep release credentials in protected jobs and existing provider secret stores.
Retain the core after LaunchDarkly trial expiry without trial-only automation.

## Canonical Contracts

Follow baseline → change/provenance → deploy → expose → detect → disable →
rollback → repair → complete. At least half the practical lesson covers deployment
through completion. Each significant command identifies actor, prerequisite,
inputs, expected output/exit/artifact, next decision and failure recovery.

Replay retained verified E/F/G images; disclose F's intentional delay. Reproduce
PR #13's failing/passing source repair locally without calling it a new G build.
Use current operator code separately from historical source checkouts. Collect
fresh hosted evidence for every new run and preserve all older records.

Use one authorized shared-lab operator. Allocate 0–10 minutes to baseline, 10–20
to change/provenance, 20–35 to deployment/exposure, 35–55 to detection/disable,
55–65 to rollback, 65–80 to repair/completion, and 80–90 to handoff. Use labeled
historical fallback for delays without claiming hosted acceptance.

## TDD And BDD Implementation Strategy

Use verification-first authoring, not tests that inspect prose. Map brief objectives
to steps/proofs/checkpoints; verify commands; independently rehearse; record help
and defects; correct and repeat affected steps within authorization. Scope any
runtime blocker separately.

## Component Design

The runbook owns operational contracts; the tutorial explains decisions; workshop
materials govern participation and timing. An independent operator starts from a
fresh checkout with no copied local evidence/cache, against a prepared E/off lab.
Preserve remote histories/locks. Preparing E from existing G is an authorized hosted
operation. Finish live G/100%, excluded personas original, staging G/off, no unresolved
recovery. Participant answers identify subject, observation, decision and gaps.

## Failure And Recovery Rules

Hold on wrong subjects, stale/absent proof, inadequate samples or expired approval.
Preserve uncertain effects and reconcile before retry. Demonstrate refused expansion,
independent disablement and native rollback. Investigate unseeded failures separately.
Stop for missing artifacts/rollback targets or insufficient budget. Never shorten
policy windows to fit the workshop.

## Commit Plan

1. `docs(build5): define setup and evidence-backed tutorial`
2. `docs(build5): add facilitated workshop and checkpoints`
3. `docs(build5): record rehearsal and operational handoff`

## Branch And PR Flow

Use `docs/build-05-tutorial-workshop` from verified main. Complete local checks and
surface DX audit, then context-bearing Qodo Local Review against the pinned base.
Reproduce/remediate findings, rerun affected checks and review the final diff. An
access eligibility failure is an explicit skip; transport/auth/incomplete review is
not a pass. Open one documentation PR through the authorized workflow; use draft
status while independent acceptance remains outstanding.

## Test Plan

From a clean checkout, run `npm ci --ignore-scripts`, `npm run lab -- --help`,
`npm test -- test/cli.test.ts test/release-workflow-cli.test.ts test/workflow-guard.test.ts test/exposure-budget.test.ts test/server.test.ts`,
and `npm run verify`. Check links, placeholders, exits, artifact paths and secrets.
Reproduce the local F-to-G latency test. Another operator must separately complete
the full hosted path and record assistance; conduct a separate timed workshop rehearsal.

Prepare exact targets/images/actions and a row-by-row traffic ledger before requesting
hosted approval. Proposed new cap: 40,000 search requests, including preparation,
failures, retries, manual searches and recovery. No Build 4 allowance carries over.

## Definition Of Done

Every objective has usable instructions, expected observations, recovery and a
checkpoint. Independent hosted acceptance and timed facilitation have actual results;
recorded fallback is not acceptance. Verification/DX/Qodo outcomes are accurate.
Nnenna owns signed daily/change-triggered checks. Copy the verified archive to
owner-designated durable storage and verify retrieval before the earliest required
artifact expiry. Track PR #14 finding `b26dfa01-c10b-4dc4-8bc3-7e2aeac4e4d7` and the
unexplained 502 separately. Retain the flag until seven healthy daily windows, no
unresolved recovery and a separately reviewed removal/rollback plan.

## Assumptions And Defaults

Audience knows Git/PRs/basic CI and coding assistants. Setup precedes the session.
Clean rehearsal means a fresh checkout against a prepared lab, replaying verified
images. The owner supplies operator identity, concrete hosted authorization and
storage destination. Off-site evidence is not a workflow artifact-input fallback;
stop on expiry and separately plan any longer-term replay change.
