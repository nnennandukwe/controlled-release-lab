# Tutorial brief

**Title:** From AI-Generated Code to a Controlled Release

**Subtitle:** Build, attest, deploy, release gradually, observe, and recover —
following one change all the way to a running application.

Nnenna approved this tutorial direction in the originating conversation on
September 6, 2026. This document captures those requirements. The subsequent
platform direction is documented in [the platform plan](platform-plan.md).

## Learning promise

Readers release a feature to users of a deployed application, detect a regression
during rollout, restore healthy behavior, and successfully release the repaired
version. They can explain which evidence supported each decision.

The existing attestation article supplies the conceptual foundation: attestation
records evidence, ThreadLoop governs the outer lifecycle, and GAAP governs a
bounded agent run and its protected effects. This tutorial makes evidence and
authority observable in an operating delivery pipeline.

## Audience and starting point

Software and platform engineers who understand Git, PRs, and basic CI and use
coding assistants. Start the main lesson with an application already running
its original behavior. Keep infrastructure setup in a separate prerequisite
section. Provide a working baseline and repeatable traffic generation.

## Controlled release

A specific verified build reaches a live environment. An authorized process
makes new behavior available to a defined audience. Runtime evidence determines
whether exposure expands, pauses, or reverses. Recovery is demonstrated against
the running service.

Use a dedicated hosted demo application with an HTTPS endpoint participants can
use. Identify synthetic traffic explicitly. This is a real hosted release
exercise; it is not evidence of production customer adoption.

## Running story

A team improves product catalog search ranking. An AI coding agent implements
the change behind a flag while preserving the existing search behavior.
Functional tests pass. Review identifies no blocking issue. During limited
exposure, a particular query pattern reveals a latency regression. Readers
detect the degradation, stop exposure, restore service behavior, repair the
implementation, and repeat the release with fresh evidence.

Disclose the regression as a deliberately introduced teaching fixture. The
exercise must not depend on an agent spontaneously producing that bug.

Search remains read-only. Explain that disabling a feature cannot undo writes
or database migrations; those require additional recovery design.

## Objectives

- Trace an approved change to its image and deployed version.
- Verify build provenance and distinguish it from functional correctness.
- Observe deployment, feature exposure, and release completion separately.
- Define audiences, runtime limits, observations, and decision ownership.
- Reject stale evidence or authorization after relevant subject changes.
- Stop a rollout and verify feature and application recovery independently.
- Complete a repaired release and preserve its history.

## Narrative and proof

| Stage | Reader action | Required observation |
|---|---|---|
| Baseline | Use the live service and measure original behavior. | Reachable endpoint, baseline deployment identity, successful requests, metrics. |
| Change | Specify intent and bounded work; implement and review. | Diff, checks, review findings, evaluation limits. |
| Build | Produce an immutable image and verify provenance; exercise a mismatch. | Commit, digest, trusted producer identity, rejected wrong-subject evidence. |
| Deploy | Validate both variations in staging; promote the same image into the live environment with the feature disabled. | Staging results, deployment identity, original behavior still working. |
| Expose | Authorize an internal cohort and then limited eligible-user exposure. | Targeting configuration, actual evaluated variations, observed requests. |
| Contain | Exercise the slow path, stop expansion, disable the feature. | Degradation, intervention, and measured recovery. |
| Roll back | Restore a previous known-good application deployment. | Previous image/configuration serving requests and passing recovery checks. |
| Repair and release | Fix, rebuild, re-verify, and repeat staged exposure. | Fresh evidence, successful observation windows, completed rollout. |

At least half the practical walkthrough covers deployment, exposure, observation,
recovery, and release completion.

## Release policy

Define the policy before exposure:

- Artifact, environment, configuration, and audience covered by authorization.
- Who may deploy and who may change exposure.
- Provisional stages: internal users, 5%, 25%, and 100% of eligible users.
- Error-rate and latency limits plus functional search checks.
- Minimum observation time, request volume, and distinct-user coverage.
- Conditions for hold, rollback, or escalation.
- Recovery target and checks confirming recovery.

Establish tutorial-specific thresholds during baseline rehearsal. Missing
telemetry or inadequate observations prevent advancement. Audience percentage
does not establish sample sufficiency. Evaluate relevant conditions immediately
before action; approval for one subject must not silently carry to another.

## Evidence and authority

Use verified build provenance plus linked records of checks, approval, deployment,
configuration, exposure, observation, and recovery. Add new evidence as the
release evolves. Do not overwrite an earlier successful check when a later
runtime regression establishes a different result.

The coding agent does not receive production release credentials. Identify and
exercise the actual mechanism enforcing release authorization. Native provider
features and custom checks must be distinguished clearly.

## Publication readiness

A clean run must reach the hosted service, expose the feature, reproduce the
regression, demonstrate both recovery mechanisms, and complete the repaired
release using the documented instructions. Significant commands need expected
results and recovery guidance.

End with a functioning released feature, inspectable release history, ongoing
monitoring, an operating owner, and criteria for retiring the flag. The later
workshop uses this same tested example with facilitation and participant checks.
