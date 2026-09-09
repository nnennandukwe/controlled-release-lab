# Build 3: Controlled Feature Exposure Build Plan

## Summary

Design prepared September 9, 2026. The [Build 2 hosted closeout](../docs/build-02-closeout.md)
and final CI-only Railway credential handoff were verified complete at 18:22 UTC
that day. Recheck the baseline at execution start. No Build 3 code or LaunchDarkly
resource has been created by this plan.

- Outcome: deploy a healthy ranking change with live exposure off, expose it to
  internal and 5% eligible synthetic cohorts, measure both variations, disable
  it through LaunchDarkly, and verify original behavior on the running service.
- Authority: the approved [tutorial brief](../docs/tutorial-brief.md), the
  user's request to plan Build 3 after implementing/reviewing Build 2, and
  [repository instructions](../AGENTS.md). The companion tutorial is *From
  AI-Generated Code to a Controlled Release*. This is the practical progression
  from the attestation article and the reusable workshop/DevRel demonstration.
- Starting baseline: Build 2's [observed C-to-D-to-C acceptance](../docs/build-02-closeout.md), authenticated image publisher, protected `operate`
  job, durable provider state and signed observations. Pin the final Build 2
  main SHA and its hosted closeout at execution start. Existing historical
  evidence remains immutable; a merge alone is not the hosted prerequisite.
- Review unit: one feature PR, followed by the necessary hosted acceptance and
  factual closeout. This plan authorizes no implementation by itself.
- Primary boundary: deploying an image, changing a flag, and proving recovery
  are separate operations with separate evidence. A successful PATCH or a
  requested audience percentage does not prove effective exposure.

## Skills To Use

| Execution stage | Skill | Responsibility and evidence |
|---|---|---|
| Context/rules | `qodo-get-rules` | Reuse the loaded release provenance/context/recovery and dependency rules; retrieve updated rules only if not available in the execution session. Preserve rule IDs and applicable requirements. |
| Architecture | `codebase-design` | Keep SDK lifecycle, flag provider access and exposure decisions behind small interfaces. Produce ownership/data-flow decisions in the PR; avoid a general orchestration framework. |
| Behavior | `tdd-bdd` | Write failing behavior assertions at search, HTTP, CLI and durable-effect seams before implementation. |
| Authorization and state | `workflow-invariants` | Define allowed exposure transitions, current-subject guards, independent disable eligibility, and unknown-outcome recovery. |
| Failure testing | `failure-path-testing` | Exercise stale configuration, mixed variations, low samples, lost PATCH responses, signing failures and retained locks through real entry points. |
| Developer surfaces | `cli-interactive-parity` | Keep CLI, workflow inputs, machine records, help and runbook consistent; run public command examples and refusal cases. |
| Audit | `dx-audit` | Inspect changed setup, lifecycle, diagnostics and output contracts; resolve actionable findings, recording hosted-only verification gaps. |
| Before PR | `qodo-review` | Review the complete verified change set against a pinned pushed base with self-contained context. |
| PR remediation | `qodo-review-resolver` | Consume structured completed reviews of the exact PR head; reproduce/fix findings and repeat checks before normal merge. |

Coverage notes:

- Qodo Local Review is eligible: this is a connected Git worktree with public
  remote `nnennandukwe/controlled-release-lab` and a pushed main base. Verify
  access again at execution; do not turn a transient review failure into a skip.
- No TypeScript/LaunchDarkly-specific implementation skill is available. Use
  pinned vendor SDK/types, repository TypeScript checks and provider contracts.
- Existing UI needs a small persona selector and visible variation, not a new
  visual design. A frontend redesign skill would widen this build unnecessarily.
- Workflow/failure skills cover drift and partial effects. No database transaction,
  generic graph engine, ThreadLoop adapter or GAAP runtime is being introduced.

## Scope

In scope:

- One real server-side LaunchDarkly boolean flag and a healthy ranking variation.
- Existing project `default`: Railway staging maps to LD `test`; Railway live
  maps to LD `production`. Reuse both existing environments and both services.
- Server-owned synthetic cohort definitions, reproducible requests and a small
  browser persona selector clearly labeled as a public demonstration.
- Protected, request-bound internal -> 5% exposure; measured hold/refusal; disable
  and read-only reconciliation. Preserve native Railway rollback separately.
- Signed evidence including actual variation/reason/context, managed flag state,
  deployment/image/source/configuration, sampling bounds and recovery outcome.
- Fresh staging proof for both variations; live deployment starts with flag off.
- A clean real hosted rehearsal, a reset-to-off procedure, and updated runbook.

Out of scope:

- Seeded latency regression, repair, 25%/100% repaired release and flag retirement:
  Build 4. Build 3 ends with the healthy candidate deployed and exposure off after
  demonstrated recovery, with its earlier exposure evidence retained.
- Tutorial prose, participant exercises, workshop platform templates, customer
  account customization and enablement/adoption metrics: Build 5 or the separate
  workshop-platform project. Synthetic requests do not establish customer impact.
- Paid upgrades, native Guardian dependency, production identity/authentication,
  database writes/migrations, multi-region hosting, generic policy engines.

## Package Layout / File-to-Task Mapping

Existing files to change:

- `src/search.ts`: preserve original search and add a pure, specified ranked path.
- `src/server.ts`: select one variation per request, resolve synthetic context,
  expose bounded diagnostic fields and preserve GET-only/query validation.
- `src/main.ts`: initialize one SDK client and close/flush it during shutdown.
- `public/index.html`, `public/app.js`, `public/styles.css`: small accessible
  persona/variation display; no flag-management control or SDK key in the browser.
- `tools/lab.ts`, `tools/workflow.ts`, `.github/workflows/operate.yml`: expose the
  new commands through the existing protected `operate` job and shared state.
- `tools/promotion.ts`, `tools/release-workflow.ts`: stronger staging proof for
  both variations, off-before-live deployment checks, and exposure sealing.
  Reuse the fixed `operate.yml` identity; do not introduce an arbitrary signer.
- `tools/observe.ts`: retain existing baseline observation; reuse probe mechanics
  where useful without interpreting original-only results as cohort evidence.
- `tools/railway.ts`, `config/release-policy.json`: include the reviewed LD mapping
  and SDK-key identity in configuration binding; preserve historical records.
- `package.json`, `package-lock.json`, `.env.example`, `README.md`,
  `docs/runbook.md`: exact dependency/settings and executable operator guidance.
- Existing `test/server.test.ts`, `test/observe.test.ts`, `test/promotion.test.ts`,
  `test/protected-execution.test.ts`, `test/workflow.test.ts`: compatibility and
  integration regressions at the interfaces actually changed.

New files:

- `src/flags.ts`: SDK initialization/evaluation/shutdown behind one small interface.
- `config/exposure-policy.json`: flag/target mapping, allowed stages, fixed
  synthetic roster specification, thresholds, versions and request budget.
- `tools/launchdarkly.ts`: bounded authenticated REST reads and conditional PATCH
  for the one configured project/flag/environment; no generic request endpoint.
- `tools/exposure.ts`: subject verification, transition decisions, durable
  mutation/reconciliation, cohort observation and final exposure evidence.
- `test/flags.test.ts`, `test/exposure.test.ts`, `test/launchdarkly.test.ts`:
  actual SDK test-data source, provider contract and failure-first effect tests.
- `docs/build-03-closeout.md`: actual observed results after execution, not a
  prewritten success report. Keep large raw artifacts outside the source tree.

## Dependencies And Settings

- Add runtime `@launchdarkly/node-server-sdk` **9.13.2**, verified in the registry
  on September 9, 2026; pin exactly and regenerate the lockfile. Recheck vendor
  support/security at execution rather than upgrading unrelated packages.
- Keep Node 24.20.0, the existing pinned Docker base, TypeScript, Vitest, jose and
  attestation verifier. No browser SDK, analytics UI, database or web framework.
- Local/test default is offline original behavior. Hosted mode requires its real
  environment-specific `LD_SDK_KEY` plus explicit project/environment/flag mapping.
  Never permit hosted test-data sources, environment-selected arbitrary endpoints,
  or an environment variable that forces the new variation.
- App settings: `LD_SDK_KEY`, `LD_PROJECT_KEY=default`, `LD_ENVIRONMENT_KEY`
  (`test` or `production`), `LD_FLAG_KEY=catalog-ranked-search`, and existing
  `LAB_ENVIRONMENT`. The runtime SDK key cannot change flags.
- Operator settings: separate `LD_READ_TOKEN` and `LD_MANAGEMENT_TOKEN`, never
  app/container build inputs. Read-only preparation may use a repository Reader
  secret in main-only workflow code. Writer is passed only to the protected
  exposure/disable step, never the publisher, PR tests or ordinary app process.
- Developer does not provide custom/inline token roles. The durable baseline uses
  the ordinary Writer role in this dedicated single-project lab account, stored
  only in protected GitHub environments. This is account-wide provider permission,
  not native per-flag/per-environment scoping. Fixed execution checks and protected
  secret access constrain its use. If the account gains unrelated resources or
  requires stronger native isolation, stop to revisit this credential design.
  A trial custom role is optional and must not become a post-trial prerequisite.
- Pin REST `LD-API-Version: 20240415` (current documented version). Use the fixed
  commercial host; bound timeouts, read pagination, response sizes and retries.
- One project, two existing environments, one process/SDK client per service;
  target two steady service connections. No SDK connection in ordinary CI tests.
  Verify actual usage after redeploy overlap and keep within Developer's five
  included service connections; no overages or plan changes are authorized.
- Introduce separate `ExposureRequest`/`ExposureEvidence` schema version 1.
  Version stronger deployment evidence explicitly rather than editing/relabeling
  signed Build 2 JSON. Old records remain readable for history, but cannot satisfy
  the new both-variation/current-flag promotion policy.

## Canonical Contracts

Flag and search:

```text
project default / flag catalog-ranked-search
false -> original substring match, then ascending ID
true  -> same matching membership, then name match before description/category
         match, then ascending priceCents, then ascending ID; limit 20
fallback false; off variation false; no prerequisites, experiments or segments
```

Independent fixtures must include `keyboard`: original compact/full; ranked
full/compact. For `compact`, the keyboard's name match ranks ahead of headphones'
description match. Query validation and catalog membership remain unchanged.

Context contract:

- Context kind `user`; fixed server-derived attributes `cohort` and `eligible`.
  Roster: internal-001..020, eligible-0001..1000, excluded-001..020. Store ranges
  and a roster version, not a thousand manually maintained records. Derive
  `cohort=internal, eligible=true` for internal keys; `cohort=eligible,
  eligible=true` for eligible keys; and `cohort=excluded, eligible=false` for
  excluded or anonymous keys. This keeps the ineligible-first exclusion rule
  from accidentally suppressing the intended internal test cohort.
- Public requests may select one valid `context` key; an omitted key uses an
  excluded anonymous demonstration context. Reject duplicate/invalid keys and
  caller-supplied cohort/eligibility overrides. The server derives attributes.
- Personas are synthetic public identities, not employee authentication or access
  entitlements. State that next to the selector and in the workshop prerequisite.
- Rules always exclude ineligible contexts, target internal users when enabled,
  and apply the specified 5% rule only to eligible users using kind `user` and key.
  Default rule and off variation remain false. Bind the full relevant definition,
  variation IDs/order, rules, salt, prerequisites and environment version to evidence.

HTTP search keeps existing fields and adds one bounded `evaluation` object:

```text
flagKey, contextKey, cohort, eligible,
value, variationIndex, reason.kind, optional reason.ruleId/errorKind,
fallbackUsed, sdkInitialized
```

Do not invent a flag version or healthy connection status in that object.
`variationDetail()` provides value/index/reason, not a promise of current control
plane state. Management configuration/version readbacks are separate evidence.
Application readiness may remain healthy while the SDK is unavailable and original
behavior serves safely; promotion/exposure acceptance must still reject fallback
evidence. Missing hosted credentials are a configuration failure, not offline mode.
After initialization an SDK may continue serving cached values during disconnection;
that must not be described as immediate fallback-off or verified flag disablement.

Command additions, all through `npm run lab --` and **Operate lab**:

```text
expose --target staging|live --stage internal|5 --release-dir PATH [--apply]
disable --target staging|live --release-dir PATH [--apply]
observe-exposure --target staging|live --release-dir PATH
reconcile-exposure --target staging|live --attempt UUID
```

Preview remains read-only. `--apply` requires the exact request-bound protected
GitHub identity at the effect call. Accept no raw flag JSON, arbitrary patch,
project/environment/flag override, unsigned evidence selector or skip-check flag.
Existing deploy/rollback/reconcile commands retain their provider meanings.

The immutable exposure request names:

- Kind/schema, operation, allowed next stage, change reference, issue/expiry.
- Image digest/source/build run; current deployment and signed deployment proof.
- Exact target, configuration fingerprint, policy/roster digest and operator run.
- Project/flag/environment, current managed version and state digest; complete
  intended next state; prior authenticated exposure proof when expanding.
- Observation specification and attachment names/hashes. Approval expires after
  30 minutes; evidence/current-state checks repeat immediately before PATCH.

Managed flag mutation uses a JSON Patch precondition on the actual environment
`version`, plus tests of the relevant existing fields, in the same request as the
change. Capture the real provider response shape and prove an intentionally wrong
version refuses mutation before relying on this. Do not substitute a read-then-
write claim of atomicity if the API rejects the chosen precondition contract.

Exposure result states: `preview`, `verified`, `blocked`, `failed`,
`unknown_outcome`. JSON stdout/progress stderr and existing exit 0/1/2 meanings.
A 2xx PATCH is an acknowledgement, not verified recovery/exposure. Persist an
immutable intent before PATCH, then read provider state and collect live evidence.
A lost response is never automatically retried. Subsequent read-only reconciliation
observes desired state without attributing it to the earlier call.

## TDD And BDD Implementation Strategy

Test seams:

1. Pure original/ranked search on the fixed independent fixture expectations.
2. Actual SDK test-data source and HTTP application over ephemeral TCP listeners.
3. Public CLI and workflow input construction, including missing/forged authority.
4. Temporary filesystem journals/locks plus REST transport with counted mutations.
5. Real hosted both-variation/exposure/disable runs after trusted-main bootstrap.

Vertical slices:

1. Given no flag or invalid SDK initialization, search stays original and diagnostics
   identify fallback; hosted promotion refuses unavailable evidence. Implement one
   client, bounded initialization, evaluation and bounded flush/close lifecycle.
2. Given true/false SDK evaluations, HTTP produces the independently specified
   ranking and one consistent evaluation result per request. Add synthetic context
   parsing and reject attribute spoofing; update the small browser selector.
3. Given provider snapshots for another flag/env/version or a conditional-patch
   conflict, mutation is refused with zero forbidden writes. Implement the narrow
   REST adapter, immutable request and conditional update contract.
4. Given signed current off/both-variation deployment proof, internal exposure
   requires a protected request. Missing/stale/wrong-subject proof and forged OIDC
   stop before PATCH. Reuse the existing fixed operate-job trust verification.
5. Given enough matching internal evidence, 5% exposure can proceed; omitted groups,
   tiny samples, stale flag config and mixed identities hold. Implement one cohort
   measurement/decision path with explicit denominators and data sufficiency.
6. Given unhealthy or insufficient prior exposure, disable still permits a narrow
   newly authorized false transition. Verify actual false evaluations and original
   results before declaring recovery. Do not require a healthy candidate to stop it.
7. Given response loss after a real effect, retain intent/lock and reconcile without
   repeating PATCH. Signing/upload failure preserves state without eligible proof.
8. Extend current workflows/history/state artifacts and then the real staging
   rehearsal so publication continues to test provider recovery with the baseline
   excluded persona. Add live off checks and both-variation staging proof.

## Component Design

- `src/flags.ts` owns SDK lifecycle and translates vendor details. Search remains
  pure; server owns request/context validation. One evaluation selects behavior.
- `tools/launchdarkly.ts` owns HTTP/provider schema and conditional effects.
  `tools/exposure.ts` owns eligibility, state, immutable receipts and observations.
  A vendor response cannot authorize the next lifecycle transition by itself.
- Reuse `operate.yml`, its trusted main/ref/job identity and shared concurrency
  group. Add distinct request-kind routing in resolve/finalize/execute/seal.
  Pass Writer credentials only for exposure/disable; preserve all raw state before
  signing. New outputs must not silently select deployment serializers.
- Refactor only the common protected-run identity check needed by both deployment
  and exposure. Each operation first validates its own request/policy/attachments;
  the common check receives a validated operator, target and request digest.
  Trusted workflow/job/issuer values remain code/policy constants, not user inputs.
- One shared target lock and carried `work` tree cover deployment and exposure.
  Extend historical run selection to all effect/reconciliation operations. Store
  exposure records separately under `work/exposure/attempts/<uuid>` with their own
  schema; expose an explicit recovery command for each record kind. Never delete
  another operation's lock or let deployment proceed past uncertain flag state.
- Provider reads before/after each window bind managed flag state and Railway
  identity. A configuration change invalidates that window. Runtime evidence
  proves the sampled contexts' behavior, not instantaneous global SDK convergence.
- No new controller service, database, message bus, generic DAG, invented agent
  approval receipt, or runtime dependency on ThreadLoop/GAAP is needed.

## Failure And Recovery Rules

| Trigger | Required result and recovery |
|---|---|
| Missing SDK key or invalid hosted mapping | Fail setup before listener; install the correct environment key through secret management. Never log it. |
| SDK init timeout, unknown flag, evaluation error | Serve original fallback with explicit diagnostics; block exposure acceptance. Restore connectivity/flag config and collect a new window. |
| Disconnection after initialization | Do not claim cache freshness. Expansion needs observed matching state; disable remains unknown if new false state does not reach requests. Use retained application recovery if required. |
| Missing/tampered/replayed/wrong-subject signed record | Block before effects; resolve/authenticate a new exact request. |
| Managed state/version differs before PATCH | Refuse stale request. Preserve readback; reframe the request instead of overwriting concurrent work. |
| Setup/auth/read failure before PATCH | No effect; actionable blocked record. Do not consume a repair/retry budget for code changes. |
| Network loss/5xx after submission | Unknown outcome with lock and intent; no retry. Read-only reconcile the exact attempt. |
| Wrong variation, insufficient contexts/window, request error | Hold; preserve all failures and denominators. A low error rate with zero treatment samples never advances. |
| Deployment, policy, roster or flag changes during measurement | Invalidate window. Collect new evidence bound to current subject; preserve earlier bytes. |
| Disable acknowledged but stale true remains | Unknown/blocked recovery; retain samples and state. Never label the POST/PATCH response as recovered. |
| Missing/expired workflow artifact or failed sealing | Preserve/restore durable state first; no blind next mutation. Observe and sign a new record without replaying the old effect. |
| Native Railway rollback | Does not roll back LaunchDarkly state. Disable/verify separately and observe the actual restored deployment. |

## Commit Plan

1. `feat(flags): evaluate the healthy ranking change with bounded SDK lifecycle`
2. `feat(exposure): bind synthetic cohort observations to current release subjects`
3. `feat(exposure): enforce protected conditional flag transitions and recovery`
4. `test(release): integrate both-variation staging proof and hosted exposure flow`
5. `docs(release): document reproducible exposure and feature recovery`

## Branch And PR Flow

1. Verify Build 2 hosted closeout, clean working tree and current pushed main.
   Create `feat/controlled-feature-exposure` and record its exact base SHA.
2. Apply the selected skills and vertical slices. Run focused checks after each
   behavior; full `npm run verify` before review. Audit changed CLI/docs surfaces.
3. Reconfirm Qodo runtime/auth and remote base. Attach self-contained context:
   Developer constraints, synthetic personas, separate evidence/authority, retained
   cached-value uncertainty, permitted effect kinds and the Build 3 plan URL.
4. Run `qodo review --deep` through the `qodo-review` skill against the complete local diff at that pinned base,
   including untracked files. Reproduce reported issues and fix confirmed findings;
   retain identities/coverage. Repeat affected/full checks and review after changes.
5. Only an actual repository/base eligibility failure permits a recorded skip.
   Review transport/auth failures remain unresolved checks, not clean outcomes.
6. Open one PR. Read Qodo findings through the structured resolver, requiring a
   completed review of its actual head. Fix/push/review until no actionable issue
   remains. Do not equate raw finding count with open issues; inspect attribution.
7. Merge normally with head matching and required checks, no administrator bypass.
   Run the hosted acceptance below from trusted main and retain real artifacts.
   Any execution-discovered code fix follows another reviewed PR before proceeding.
8. Record actual closeout separately; update the build index only with proved
   states. Plan Build 4 separately before implementing its regression/repair loop.

## Test Plan

Focused behavior includes both rankings; independent query expectations; actual
SDK off/true/error/test-data behavior; singular client/close; safe context handling;
correct conditional update and wrong-version rejection; signed producer identity;
forged/expired authority; state drift; replay; absent groups; window boundaries;
response loss; immutable originals; duplicate mutation refusal; disable during
failure; and carried state across deployment/exposure workflows.

Use one local response-loss test through the real authorization path, temporary
files and REST transport seams. Keep genuine attestation-verifier fixtures. A
local stub or simulated cache is never the hosted recovery result.

```bash
npm ci --ignore-scripts
npm run setup:verifier
npm run typecheck
npm test
npm run verify
npm run lab -- --help
```

Hosted measurement defaults (rehearse and tighten before expanding):

- Internal window: 120 requests, at least 60 elapsed seconds, at least 20 distinct
  internal and 20 distinct control contexts. Check excluded contexts remain false.
- 5% window: fixed roster coverage, up to 1,200 requests, launch ceiling 10/sec,
  concurrency 2, at least 120 elapsed seconds, hard deadline 180 seconds. Require
  at least 20 distinct eligible treatment and 200 eligible control contexts;
  internal traffic does not count toward eligible treatment sufficiency.
- Retain all samples including failures, actual counts per cohort/variation/query,
  error rate, client end-to-end p95, elapsed window and missing data. Require zero
  functional/identity/evaluation errors for this small tutorial. Provisional p95
  limit: the larger of 500 ms or twice the paired off baseline. Confirm these
  tutorial-specific limits during baseline measurement; do not call them SLOs.
- Percentage allocation hashes identities; 5% does not promise exactly 5% of a
  finite roster or its requests. Do not discard inconvenient contexts or resample
  until green. Insufficiency holds; an explicitly larger bounded window needs a
  fresh request and keeps the prior failed window.

Hosted acceptance:

1. Read actual Developer/trial entitlements and usage. Configure one flag off in
   both existing environments, false default/off variation, server-only availability,
   fixed rules/roster and the documented credential locations. Record redacted
   identities/configuration; verify a wrong version cannot mutate the test flag.
2. Introduce LD app settings under the authorized setup path. Capture the real
   SDK key from its named environment into Railway secret storage without output.
   Include a non-reversible key identity inside the configuration fingerprint so
   a wrong-key swap changes the subject; never store raw key values in artifacts.
   Update reviewed policy fingerprints. Retain Build 2 recovery evidence unchanged;
   its old configuration cannot automatically authorize the new configuration.
3. Publish healthy image E once. Complete its automatic staging provider-recovery
   rehearsal and signed observation. With staging-only targeting, verify both
   variants and independent query fixtures through the real SDK/live service.
4. Verify live flag off via provider read and live response before promoting E.
   Collect the strengthened fresh staging proof and promote the exact E digest;
   observe original behavior in live. Preserve this compatible known-good baseline.
5. Dispatch internal exposure with the exact signed baseline/request. Inspect and
   approve the protected job; verify treatment/control and retain signed evidence.
6. Prove stale/edited/wrong-version evidence refuses expansion with before/after
   flag/provider snapshots showing no forbidden mutation. Restore a fresh request,
   advance to 5%, and satisfy the actual cohort/window requirements.
7. Disable through LaunchDarkly using a separately approved narrow request. Verify
   managed state off, all previously exposed sampled personas now false/original,
   and the same serving E image/deployment. This is feature recovery without an
   application deployment; preserve signed recovery and original exposure history.
8. Reconfirm staged/live off, no unresolved locks, bounded usage, retained image
   and compatible recovery data. Leave the healthy candidate deployed and off for
   Build 4. Document participant reset/setup separately from measured learning.

## Definition Of Done

- A real LaunchDarkly flag selects both specified implementations on the hosted
  candidate; current app code never possesses a flag-management token.
- Exact-image promotion requires current both-variation evidence and off live
  configuration; new policy does not silently accept historical weaker proof.
- Internal and 5% exposure are separately authorized and measured; absent,
  inconsistent or stale evidence prevents expansion.
- Feature disablement is observed on live requests with the deployment unchanged;
  provider acknowledgement alone cannot complete recovery.
- All refusal, response-loss, replay and immutable-history tests pass; the existing
  publisher/recovery and native rollback contracts still work.
- CLI/workflow/docs parity and DX audit have no actionable unresolved issue;
  remaining provider limitations and synthetic-audience scope are explicit.
- Eligible Qodo Local Review and exact-head PR review complete, issues are resolved,
  required CI passes, and working code is merged normally.
- Actual hosted artifacts/approval events and closeout are retained. No seeded
  regression, paid-only dependency or claim of production/customer adoption leaks
  into this build.

## Assumptions And Defaults

- Account inspection on September 9, 2026 showed 12 trial days remaining, Developer
  after trial, one `default` project, zero flags and existing `test`/`production`
  environments. Recheck at execution; no plan change was made during planning.
- The dedicated lab has one owner and one intended release writer. Delegated owner
  approvals are not independent human review. Dashboard/API administrators remain
  a separately documented source of drift; conditional flag updates detect stale
  versions, while cross-provider atomicity is not claimed.
- Existing raw node:http/vanilla browser architecture is sufficient. Local demo
  personas are intentionally selectable; there is no production account boundary.
- Default rollout stops at 5%; 25%/100% and repaired completion belong to Build 4.
- Native LaunchDarkly automatic rollout/Guardian and custom-role extensions may
  be demonstrated separately only with current entitlement and explicit scope.
  The lasting workshop core must remain operable on Developer.

Primary references checked during planning:

- [LaunchDarkly pricing](https://launchdarkly.com/pricing/): Developer limits and
  distinction between basic targeting and paid release automation.
- [Node server SDK](https://launchdarkly.com/docs/sdk/server-side/node-js): singleton
  lifecycle and explicit flush before close; package version also checked in npm.
- [Evaluation details](https://launchdarkly.com/docs/sdk/features/evaluation-reasons)
  and [offline behavior](https://launchdarkly.com/docs/sdk/features/offline-mode):
  value/reason/fallback semantics; no invented cache-freshness guarantee.
- [REST API](https://launchdarkly.com/docs/api) and
  [flag updates](https://launchdarkly.com/docs/api/feature-flags/patch-feature-flag):
  pinned API version, JSON Patch preconditions, bounded failure handling.
- [API tokens](https://launchdarkly.com/docs/home/account/api): runtime SDK keys
  differ from management tokens; custom/inline roles require entitlement.
- [Percentage rollouts](https://launchdarkly.com/docs/home/releases/percentage-rollouts):
  stable context bucketing and finite-sample limits.
