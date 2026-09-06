# Controlled Release Lab

This repository contains the approved tutorial requirements and platform plan
for **From AI-Generated Code to a Controlled Release**. The planned lab follows
one search feature through verification, deployment, staged user exposure,
runtime regression, rollback, repair, and a completed release.

**Current state:** repository foundation only. The application, CI workflows,
container images, hosted environments, and release controls are not implemented
or deployed yet.

## Start here

| Document | Purpose |
|---|---|
| [Tutorial brief](docs/tutorial-brief.md) | Approved learning objectives, narrative, and completion requirements. |
| [Platform plan](docs/platform-plan.md) | Railway and LaunchDarkly direction, access findings, compatibility questions, and first engineering milestone. |
| [Agent instructions](AGENTS.md) | Scope and evidence requirements for implementation. |

The intended readers are engineers who already understand Git and basic CI and
want to practice releasing AI-assisted changes to a running application.

The implementation will use a small TypeScript/Node search application,
GitHub Actions, a container registry, Railway hosting, and LaunchDarkly feature
flags. Railway replaces the brief's earlier Cloud Run proposal, subject to
verification of exact-image promotion. Google Cloud is not a prerequisite.

## Required release outcome

The completed tutorial must demonstrate:

1. A reachable HTTPS application with identifiable deployed code and a baseline.
2. Verified artifact provenance and rejection of evidence for a different subject.
3. Staging validation and live deployment of the same verified image.
4. Authorized exposure to defined cohorts, followed by measured rollout stages.
5. Detection of a disclosed runtime regression and verified feature rollback.
6. Restoration of a previous application deployment and verification of recovery.
7. A repaired build, fresh evidence, and release to the full intended audience.

Committing, reviewing, or merging code does not complete these requirements.

## Current first use

Read the brief and platform plan before implementation. There are no application
installation or deployment commands yet. The next engineering milestone is to
prove Railway can run the exact verified image and restore it reliably, then
build the deployed baseline.

The core release exercise must remain usable after the LaunchDarkly trial.
Native approval workflows and automated guarded rollouts are optional exercises
whose availability and behavior require separate verification.

The general workshop-design skill lives in the separate `workshop-platform`
project. This repository will provide its runnable tutorial example; it does
not currently integrate with that project, ThreadLoop, or GAAP.
