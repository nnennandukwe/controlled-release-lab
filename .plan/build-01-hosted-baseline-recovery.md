# Controlled Release Lab: Hosted Baseline and Recovery Build Plan

## Summary

**Outcome:** A working catalog-search application, an immutable container image, isolated Railway staging and live environments, repeatable baseline measurements, and an observed application rollback.

**Authority:** The approved [tutorial brief](../docs/tutorial-brief.md), [platform direction](../docs/platform-plan.md), and [repository instructions](../AGENTS.md).

**Starting baseline:** Private GitHub repository on `main`, clean working tree, local and remote commit `aac5e03d9d8132a0bee6dd797354aa1cd626996c`. Application code and deployment workflows do not exist yet. Railway CLI authentication works.

**Review unit:** One PR for the hosted baseline and recovery capability. Hosted acceptance is a separate recorded execution against that code.

**Primary boundary:** Application-reported version information must agree with independent provider evidence. A successful build or deployment response alone cannot establish what is serving traffic.

The complete build sequence is:

| Build | Deliverable | Required acceptance evidence |
|---|---|---|
| **1. Hosted baseline and recovery** | Search application, container pipeline, Railway deployment and recovery tools | Same image reaches staging and live; a subsequent deployment is restored to the earlier image; live requests confirm recovery |
| **2. Attestation and authorized promotion** | Verified provenance, evidence contracts, enforcement before deployment | Wrong digest, untrusted producer, stale evidence, and unauthorized promotion are rejected |
| **3. Controlled feature exposure** | LaunchDarkly ranking flag, cohorts, observation windows, advancement policy | Internal → 5% → 25% → 100% exposure; actual variations observed; missing or insufficient evidence blocks expansion |
| **4. Regression, repair, and completed release** | Disclosed latency fixture, feature disablement, application rollback, repaired build | Both recovery mechanisms demonstrated separately; repaired artifact completes rollout with fresh evidence |
| **5. Tutorial and workshop companion** | Rehearsed tutorial, participant exercises, instructor recovery guide | A clean run reproduces the entire hosted story; publication follows that rehearsal |

At least half the eventual walkthrough will cover deployment, exposure, observation, recovery, and completion.

## Skills To Use

| Execution stage | Skill | Responsibility and evidence |
|---|---|---|
| Before implementation | `qodo-get-rules` | Apply the relevant rules already retrieved; preserve artifact metadata, synchronize consumers, and pin dependencies |
| Module design | `codebase-design` | Keep search, measurement, and deployment operations behind small interfaces; inject external I/O at test seams |
| Implementation | `tdd-bdd` | Implement one observable behavior at a time through meaningful failing tests |
| Deployment hardening | `failure-path-testing` | Prove that identity mismatch, incomplete evidence, failed readiness, and ambiguous mutation outcomes prevent progression |
| Before review | `dx-audit` | Audit setup, command behavior, errors, output, and documentation agreement; resolve P1 findings and record runtime verification gaps |
| Final local review | `qodo-review` | Review the complete change set against the pinned pushed base, assess findings, remediate, and review the final verified diff |

**Qodo Local Review eligibility:** Eligible to attempt. Git remote and pushed base are verified, and Qodo’s repository discovery returns this repository. Actual base retrieval and review success must still be established by the review run.

Rules that materially shape this build include:

- **WARNING, rule 1:** “Pin dependency versions in manifests and lockfiles.”
- **ERROR, rules 1060852 and 1060881:** Preserve artifact names and image metadata consumed by deployment workflows.
- **ERROR, rule 1060877:** Update consumer validation alongside producer schemas.
- **WARNING, rules 613754 and 699152:** Use descriptive identifiers.

Python/Pydantic and Swift-specific results do not apply. No dedicated TypeScript or Railway implementation skill is available; official documentation, strict typing, provider contract tests, and hosted acceptance will cover those surfaces. `tdd-bdd` supplies the behavior loop without duplicating `tdd`. The first interface is a simple search page, so a visual-design skill is unnecessary.

## Scope

**In scope for Build 1**

- Read-only product catalog with deterministic original search behavior.
- Browser search interface and HTTP endpoints.
- Containerized application with embedded source identity.
- GitHub Actions verification and explicitly invoked image publication.
- Railway deployment by an immutable image reference.
- Independent deployment observation and bounded HTTPS probes.
- Repeatable synthetic traffic and baseline summaries.
- Restoration of an earlier application deployment.
- Structured, preserved execution evidence.
- Setup, recovery, resource limits, and cleanup instructions.

**Owned by later builds**

- Cryptographic provenance verification and release authorization policy: Build 2.
- LaunchDarkly SDK integration, targeting, and rollout decisions: Build 3.
- Seeded regression, feature disablement, repair, and completed feature rollout: Build 4.
- Publication-ready narrative and workshop materials: Build 5.

Database writes, migrations, authentication systems, customer integrations, and general workshop-platform development remain outside this lab. ThreadLoop and GAAP supply architectural concepts; this plan introduces no assumed runtime integration with either.

## Package Layout / File-to-Task Mapping

All proposed paths below are relative to `/Users/nnennandukwe/Code/controlled-release-lab`. Only the existing documentation and root instructions currently exist.

| Path | Status | Responsibility |
|---|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `.nvmrc` | New | Reproducible toolchain and commands |
| `src/server.ts` | New | HTTP composition, readiness, shutdown, static assets |
| `src/search.ts`, `src/catalog.json` | New | Original search behavior and synthetic catalog |
| `public/index.html`, `public/app.js`, `public/styles.css` | New | Accessible search interface |
| `src/build-info.ts` | New | Read embedded source identity and runtime deployment identity |
| `tools/lab.ts` | New | Operator command interface |
| `tools/railway.ts` | New | Provider requests, deployment observation, rollback |
| `tools/observe.ts` | New | Bounded traffic, raw observations, metric summaries |
| `tools/evidence.ts` | New | Runtime validation and safe evidence persistence |
| `test/` | New | HTTP, operator, provider-contract, and recovery tests |
| `Dockerfile`, `.dockerignore` | New | Reproducible application image |
| `.github/workflows/verify.yml` | New | Credential-free verification |
| `.github/workflows/image.yml` | New | Explicit image publication with digest output |
| `.github/workflows/operate.yml` | New | Authorized hosted deployment and recovery execution |
| `.env.example`, `config/lab.example.json` | New | Document configuration without credentials |
| `docs/runbook.md` | New | Setup, expected results, failure recovery, cleanup |
| `README.md`, `docs/platform-plan.md` | Existing; update | Executable entry points and observed platform findings |

Do not create a generic workflow engine, plugin system, or multi-provider abstraction in this build.

## Dependencies And Settings

**Runtime**

- Node.js 24 LTS, with an exact patch pinned consistently across local development, CI, and the container. The machine currently defaults to Node 26, so the project must select its runtime explicitly. [Node release schedule](https://nodejs.org/en/about/previous-releases)
- Native Node HTTP, filesystem, crypto, and fetch APIs.
- One runtime schema validator for external configuration and evidence records.

**Development**

- TypeScript, Node type definitions, Vitest, and a TypeScript development runner.
- Exact package versions and committed lockfile.
- Container base image pinned by digest.
- GitHub Actions pinned to reviewed commit SHAs.

**Storage**

- Static catalog; no database or persistent application volume.
- Evidence schema version `1`.
- One distinct directory and artifact name per execution attempt.
- Raw observations retained alongside summaries.
- Checksums detect alteration; local files are not described as signed attestations.

**Configuration**

| Setting | Purpose |
|---|---|
| `PORT` | Application listener; local default `3000` |
| `LAB_ENVIRONMENT` | Explicit `local`, `staging`, or `live` |
| Embedded build metadata | Source SHA, build run identity, catalog version |
| `config/lab.json` | Explicit project, service, environment, and HTTPS target mapping |
| Railway project token | Provider access for the selected environment; secret store only |
| Observation arguments | Duration, rate, request limit, concurrency, timeout, seed |

Command arguments override non-secret configuration. Invalid or missing hosted identifiers fail before any mutation. Never infer a hosted target from the CLI’s previously linked project.

Railway documents project tokens scoped to one environment. Use that scope for operational automation; the application container receives no deployment credentials. [Railway API authentication](https://docs.railway.com/integrations/api)

**Platform choices**

- Recommended publication path: public tutorial repository and public GHCR images when ready. The user selected this distribution model after reviewing the plan. Publication remains a separate authorized operation.
- GitHub’s native attestations require Enterprise Cloud for private/internal repositories on current plans. [GitHub attestation requirements](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- Railway requires Pro for private registry deployments. [Railway registry support](https://docs.railway.com/services)
- Railway subscription, available credit, retention, and the authorized spending ceiling remain prerequisites to hosted execution.
- The lasting LaunchDarkly path will use one project and server-side flags; native approvals and guarded-rollout automation remain optional extensions. [LaunchDarkly plans](https://launchdarkly.com/pricing/)

## Canonical Contracts

**Application**

| Request | Behavior |
|---|---|
| `GET /` | Usable search interface |
| `GET /healthz` | Process liveness |
| `GET /readyz` | `200` only after configuration and catalog initialization succeed |
| `GET /version` | Source SHA, catalog version, environment, deployment ID when available |
| `GET /api/search?q=…` | Deterministic results, request ID, original ranking identity |
| Invalid search input | `400` with stable error code and corrective message |

Search accepts a trimmed query of 1–100 characters and returns at most 20 results. Use fixed fixture expectations for ordering and matching. Render query and product text safely.

`/version` is correlation evidence. It must never label a supplied environment variable as independently verified image identity.

**Proposed operator interface**

These commands will be added by this build; they do not exist yet.

```text
npm run lab -- doctor --target staging

npm run lab -- deploy --target staging \
  --image ghcr.io/nnennandukwe/controlled-release-lab@sha256:<digest>

npm run lab -- deploy --target staging \
  --image ghcr.io/nnennandukwe/controlled-release-lab@sha256:<digest> \
  --apply

npm run lab -- observe --target staging \
  --duration-seconds 60 --rate 2 --max-requests 120

npm run lab -- rollback --target live \
  --deployment <previous-deployment-id> --apply

npm run lab -- reconcile --target live --attempt <attempt-id>
```

- Deployment and rollback default to a read-only preview.
- `--apply` expresses operator intent; actual provider credentials enforce access.
- Deployment accepts a digest-qualified image, not a floating tag.
- Target selection is mandatory for every hosted operation.
- JSON results go to stdout; progress and diagnostics go to stderr.
- Exit `0`: requested outcome verified.
- Exit `1`: invalid input or known failure.
- Exit `2`: blocked, insufficient evidence, or unresolved provider outcome.

**Evidence record**

Every attempt records:

```text
schema_version
attempt_id
operation
requested_target
requested_image_or_rollback_target
source_sha
provider_deployment_ids
provider_observations
live_request_observations
configuration_fingerprint
started_at / finished_at
outcome
reason_codes
recovery_instruction
```

Provider-observed image identity must be stored separately from the requested image and application-reported source SHA.

Outcome vocabulary:

```text
verified
failed
blocked
unknown_outcome
```

**Railway compatibility gate**

Before treating Railway as established:

1. Request deployment using `image@sha256:…`.
2. Confirm provider configuration preserves the immutable reference.
3. Capture deployment evidence tying that reference to the running deployment.
4. Correlate live responses with that deployment.
5. Repeat in live using the same digest.
6. Restore the previous deployment and verify its identity and behavior.

The live GraphQL schema exposes image source configuration, deployment metadata, active deployments, and rollback eligibility. It does **not** itself prove how a running image’s digest is represented. The acceptance run must establish that contract. Unsupported or ambiguous readback blocks the milestone.

**Contract reserved for Builds 2–4**

The later release subject must bind:

```text
artifact digest
source SHA
intent/spec digest
policy version
environment and deployment
application configuration
flag configuration and audience
observation window
authorization
```

Changing any relevant subject element invalidates the corresponding evidence.

Release progression will require observed behavior:

```text
verified artifact
→ staging validated
→ live deployed with feature off
→ internal exposure
→ 5%
→ 25%
→ 100%
→ completion observation satisfied
→ release complete
```

Each exposure stage may hold, roll back, or require a human decision. No stage advances solely because its configured percentage changed.

## TDD And BDD Implementation Strategy

Use `tdd-bdd` at these public seams:

1. HTTP requests and responses.
2. Operator commands and exit codes.
3. Railway request/response contracts.
4. Persisted execution records and observation summaries.

Implement vertical slices in this order:

| Slice | Failing behavior to establish first | Passing implementation |
|---|---|---|
| Search | Known query does not return expected products | Catalog and original ranking |
| Startup | Invalid configuration appears healthy | Validation and readiness failure |
| Identity | Running image cannot report its embedded source | Build metadata and version response |
| Observation | Timeouts or missing results appear healthy | Complete attempt accounting and bounded collection |
| Deployment | Wrong target or mutable image reaches mutation | Preflight validation and explicit target mapping |
| Verification | Provider success is accepted despite identity mismatch | Independent identity and live-response checks |
| Recovery | Rollback is reported complete before recovery | Provider observation followed by recovery probes |
| Interrupted operation | Retry blindly repeats an uncertain mutation | `unknown_outcome` and read-only reconciliation |

Use `failure-path-testing` for blocked commands, recovery messages, and persistence failures. Mock provider transport in deterministic contract tests; keep serializers, validators, and the operator flow real. Hosted acceptance remains necessary.

## Component Design

**Search module:** Own matching and ranking. HTTP handlers validate requests and format responses.

**Observation module:** Own request scheduling, deadlines, attempt accounting, and summary calculations. It will collect:

- Started, completed, failed, and timed-out requests.
- HTTP errors and functional mismatches.
- End-to-end latency distributions.
- Source and deployment identities observed.
- Measurement window and load configuration.

Transport failures count as failures. Timed-out requests cannot disappear from the denominator or make latency results look healthy.

**Railway operations module:** Own provider calls and observation until the requested state is verified or the deadline expires. Use explicit project, service, and environment identifiers.

**Evidence module:** Validate and preserve each attempt independently. Write completed records atomically. Preserve partial observations from interrupted attempts; never replace an earlier record with a new result.

**Operational authority:** Credential-free verification runs separately from privileged operation jobs. The eventual coding-agent demonstration must use an isolated execution environment without the user’s home directory, cloud credentials, or keychain access. A worktree alone does not provide that separation.

Privileged operations run from trusted workflow code with environment-bound secrets. Human acknowledgment must identify the digest and target. A solo operator’s acknowledgment must not be described as independent two-person approval.

**Concurrency:** Serialize operations per environment, with cancellation of an in-flight mutation disabled. Re-read provider state immediately before mutation. An unexpected deployment change blocks the operation.

**Rollback:** Restore both the prior application image and its compatible custom configuration. Railway documents that native rollback restores the image and custom variables, subject to retention. External LaunchDarkly configuration will require separate handling in later builds. [Railway rollback behavior](https://docs.railway.com/deployments/deployment-actions)

## Failure And Recovery Rules

| Failure | Required behavior | Recovery |
|---|---|---|
| Missing target or credentials | No provider mutation; actionable preflight error | Correct configuration in the appropriate secret store |
| Mutable image reference | Reject before deployment | Supply a registry digest |
| Digest preservation/readback unsupported | Block hosting acceptance | Reassess Railway suitability before building further release automation |
| Provider accepts mutation but response is lost | Record `unknown_outcome`; no automatic mutation retry | Reconcile provider history and live state |
| Deployment becomes healthy with wrong identity | Do not record verified deployment or promote | Inspect deployment evidence; restore known-good target if authorized |
| Insufficient observations | Preserve partial data; block acceptance | Run a new bounded observation window |
| Provider deployment changes during measurement | Mark the window mixed or stale | Observe a stable deployment in a new window |
| Previous deployment is no longer rollback-eligible | Block rollback | Explicitly restore a retained digest and compatible configuration; record this as redeployment |
| Evidence write fails | Return failure; do not report successful completion | Preserve diagnostics and reconcile provider state |
| Resource or request budget reached | Stop traffic and further automated operations | Review usage and authorize any extension |

Read-only provider retries will be bounded and respect rate limits. Mutation retries require proof of what happened first.

## Commit Plan

1. `feat(app): add catalog search and readiness contracts`  
   Application, minimal interface, configuration, and HTTP tests.

2. `feat(image): build identifiable containers with pinned inputs`  
   Container definition, build metadata, verification workflow, and explicit publication workflow.

3. `feat(observe): collect bounded hosted baseline evidence`  
   Traffic runner, summaries, attempt records, timeout and incomplete-sample tests.

4. `feat(operations): verify deployment identity and recovery`  
   Railway operations, operator commands, workflow authorization wiring, and failure/reconciliation tests.

5. `docs(lab): document hosted acceptance and recovery`  
   Runbook, configuration examples, expected output, account prerequisites, cleanup, and updated README.

Tests stay with the behavior they prove.

## Branch And PR Flow

1. Recheck `origin/main` before implementation.
2. Create proposed branch `feat/hosted-baseline-recovery`.
3. Pin the pushed comparison base. Current candidate:  
   `aac5e03d9d8132a0bee6dd797354aa1cd626996c`.
4. Implement the vertical slices and run the corresponding checks.
5. Run the full verification suite.
6. Run `dx-audit`; resolve P1 findings and execute the commands needed to settle material verification gaps.
7. Prepare Qodo context explaining the hosted-release purpose, identity requirements, ambiguous-outcome handling, and deferred attestation scope.
8. Run Qodo Local Review against the complete local change set, including new files:

```bash
qodo review \
  --base aac5e03d9d8132a0bee6dd797354aa1cd626996c \
  --context-file .qodo/session-context.json \
  --deep --json --progress
```

9. Reproduce every finding against the current code. Resolve supported findings; retain evidence for dismissals.
10. After remediation or any later code change, rerun affected checks, full verification, and Qodo review.
11. Open one PR linking the tutorial brief. No issue number or closing reference is currently established.

If Qodo reports repository/base inaccessibility, record the specific eligibility skip. Authentication, transport, cancellation, or runtime failures are failed reviews, not passing results or eligibility skips.

## Test Plan

**Automated behavior**

- Known catalog queries, result ordering, invalid input, and empty results.
- Startup failure, readiness, and graceful shutdown.
- Build metadata included in the container and returned accurately.
- Mutable image and incorrect target rejected before mutation.
- GraphQL errors handled even when HTTP status is successful.
- Deployment identity mismatch and mixed deployment observations.
- Timeout/error accounting and incomplete observation windows.
- Rollback eligibility, configuration restoration expectations, and recovery verification.
- Lost mutation response followed by reconciliation.
- Concurrent operation exclusion.
- Evidence persistence failure without false completion.

**Proposed repository verification commands**

These scripts will be created as part of Build 1:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:container
npm run verify
```

`verify` will compose the required local checks. Default tests will not deploy resources, publish images, or generate hosted traffic.

**Hosted acceptance**

After concrete resource, visibility, and usage approval:

1. Publish baseline image **A** and record its digest and build run.
2. Deploy **A** to staging and verify provider identity plus live responses.
3. Deploy that exact digest to live.
4. Measure the original behavior.
5. Build a harmless, distinguishable image **B** from another source revision.
6. Validate **B** in staging, then deploy it to live.
7. Restore **A** using Railway rollback.
8. Confirm provider identity, compatible configuration, successful searches, and recovery measurements.
9. Export the evidence before provider retention expires.

Initial proposed measurement budget: **60 seconds, 2 requests/second, 120 requests, concurrency at most 2, five-second request timeout** per window. These are bounded rehearsal inputs, not approved spending or validated release thresholds.

## Definition Of Done

Build 1 is complete when:

- A reader can start the application locally from documented commands.
- The hosted application is reachable over HTTPS.
- The image deployed to live matches the one validated in staging.
- Provider evidence and live responses agree about the deployment.
- A previous image and compatible configuration have been restored and observed serving healthy requests.
- Invalid targets, identity mismatches, incomplete observations, and ambiguous outcomes cannot produce a verified result.
- Raw observations and summaries remain inspectable.
- Required tests pass.
- DX P1 findings are resolved and material verification gaps are settled.
- Qodo review covers the final verified change set, or a specific supported eligibility skip is recorded.
- Documentation clearly distinguishes artifact identity from provenance verification deferred to Build 2.

**The full tutorial will be complete only after** the repaired feature reaches its intended audience through measured rollout stages, satisfies its final observation window, and has a named operating owner, ongoing monitoring, and flag-retirement criteria.

## Assumptions And Defaults

- Railway remains the preferred host, conditional on the digest and recovery acceptance test.
- Google Cloud is a fallback requiring a separate hosting decision.
- Use one dedicated Railway project with staging and live environments, one application replica per environment, and no database.
- Use synthetic catalog data and clearly identified synthetic traffic.
- Keep baseline measurements separate from release thresholds. Build 3 will freeze thresholds and sample requirements before exposure.
- The user selected public repository and public images when ready. This decision sets the distribution model and does not authorize immediate publication.
- Hosting spend, resource creation, publication, and new operational credentials require their concrete configuration to be reviewed before execution.
- Native LaunchDarkly guarded rollouts will enhance the workshop if available; the core exercise must remain runnable after the trial.
- The immediate implementation starts with the search/readiness slice, then image identity and the Railway compatibility test.
