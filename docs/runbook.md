# Hosted baseline and recovery runbook

The hosted A → B → A rehearsal has not yet run. Provider fixtures are synthetic
contract examples, not captured Railway deployment evidence.

## Account and resource prerequisites

Review the exact publication and hosting operation with the owner. Confirm
Railway's plan, credit, limits, rollback retention, and spending ceiling. Use one
dedicated project, staging and live environments, one replica per environment,
and no database or volume. The existing policyNIM project is unrelated.

The chosen distribution model is public GitHub source and public GHCR images
when ready. Source and package visibility are separate settings. Verify anonymous
image access before deploying; private registry deployments require Railway Pro.
Do not expand credentials or buy a plan to work around unintended visibility.

Create GitHub environments `image-publication`, `staging`, and `live`, each with a
required reviewer and deployment branches restricted to `main`. Protect main with
PR review and the Verify check. Workflows check protection presence and refuse
feature-branch execution; GitHub enforces the actual approval. A solo operator's
acknowledgment is not independent two-person approval. Administrators are trusted.

Create environment-scoped Railway project tokens through its normal settings,
with authorization for the new credentials. Store each as `RAILWAY_PROJECT_TOKEN`
in the corresponding GitHub environment. Do not use account-wide tokens, put
tokens in arguments, or mount your home/keychain into a coding-agent sandbox.
Verify jobs and the application receive no deployment credentials.

## Configure the dedicated service

Use no GitHub source, no image auto updates, one replica, `/readyz` health check,
and the image's default `node dist/src/main.js` start command. Source configuration
may itself create a deployment; perform setup within the approved rehearsal.

Set `LAB_ENVIRONMENT=staging` or `live`, `PORT=3000`, and `NODE_ENV=production`.
Railway supplies `RAILWAY_DEPLOYMENT_ID`. Source SHA is baked into the image and
cannot be overridden by a runtime variable.

Copy `config/lab.example.json` to ignored `config/lab.json`. Replace every example
ID and URL with the dedicated lab's values. HTTPS origins cannot contain credentials,
paths, or query strings. Staging and live must have different environment IDs.
For Actions, save this map as the GitHub environment variable `LAB_CONFIG_JSON`;
it may contain only the selected target. Precedence is `--config PATH`, then
`LAB_CONFIG_JSON`, then `config/lab.json`.

`.env.example` documents variables; commands do not automatically load `.env`.
Supply credentials through the process environment or secret manager. The CLI
never falls back to Railway CLI OAuth credentials or a linked project.

```bash
npm run lab -- doctor --target staging
```

Expected: a read-only preflight with source, active deployments, and configuration
fingerprint. It verifies access/configuration, not hosted release acceptance.

## Publish image A

After code review and merge, dispatch **Publish image** from main and approve the
`image-publication` environment. It builds one linux/amd64 image, tests that same
local image, pushes it to GHCR, and captures its registry digest.

Download `build-record-RUN_ID-RUN_ATTEMPT`. Its `build-record.json` contains `image`,
`sourceSha`, and `buildRunId`. This is an unsigned build receipt; Build 2 adds
provenance verification. Retain the image/package version for rollback. Tags remain
mutable; deploy accepts only `ghcr.io/...@sha256:...`. The publisher uses a single
platform and disables BuildKit's additional provenance manifest in Build 1 so
manifest identity remains unambiguous.

## Deploy A to staging and live

Run **Operate lab** with deploy, staging, A's image and source SHA, and apply=false.
Review the target and digest, then start a new authorized run with apply=true.
The default minimum window is 60 seconds, with a ceiling of 2 requests/second,
120 requests maximum, concurrency at most 2, and a 5-second request timeout.
Waiting for capacity can extend the window; the total traffic deadline defaults
to 300 seconds. Set `--max-duration-seconds` locally or the **Operate lab** input
`max_duration_seconds` to a shorter bound when needed. The workflow accepts
60-300 seconds because its minimum window is 60 seconds; local runs can select
a shorter minimum window and matching total deadline. Doctor sends no traffic
and ignores this input.
Provider polling is bounded
at 120 seconds plus any in-flight request deadline. Provider calls time out at
10 seconds; read retries are bounded, and mutations are never automatically retried.

A local operator can preview with these values replaced from A's build record:

```bash
LAB_IMAGE='ghcr.io/owner/lab@sha256:replace-with-64-hex-digest'
LAB_SOURCE_SHA='replace-with-40-hex-source-sha'
npm run lab -- deploy --target staging --image "$LAB_IMAGE" --source-sha "$LAB_SOURCE_SHA"
```

Add --apply only for the authorized operation. Local operators must share one
work directory. Do not mix local and GitHub mutations concurrently. Actions
serialize by environment and restore their previous work state before proceeding.

The adapter updates the source and reads it back. If a new latest deployment
appears, the update cannot establish who created it. The command records
UNATTRIBUTED_DEPLOYMENT, retains its lock, and requires read-only reconciliation
instead of adopting that ID or issuing a duplicate deployment. Otherwise it
requests one deployment and uses the ID returned by that mutation. Reconciliation
verifies the desired state without claiming which earlier request caused it.
Successful deployment requires:

1. The source preserved the digest-qualified reference and still matches the active image before measurement.
2. The deployment succeeded and its own meta.image matches that reference.
3. Exactly that deployment is active after any overlap drains.
4. Relevant configuration matches the expected fingerprint.
5. A full live sample returns expected keyboard results and intended source,
   deployment ID, and environment.
6. Provider state is stable before and after measurement.

The initial metadata contract is deliberately strict: digest-qualified meta.image.
IMAGE_EVIDENCE_UNAVAILABLE blocks when absent. Inspect real redacted metadata and
document what it proves before adapting the parser and tests. Never substitute
service configuration or /version alone. If the host cannot provide adequate
identity evidence, revisit hosting before Build 2.

After staging succeeds, deploy A's same digest to live and compare both records.
Build 1 supports the operation and comparison; Build 2 will enforce the signed
staging-to-live promotion policy.

## Measure the baseline

```bash
npm run lab -- observe --target live --duration-seconds 60 --rate 2 --max-requests 120
```

Each request records end-to-end duration, status, source, environment, deployment,
and expected keyboard result order. Transport failures stay in the denominator.
If any request has no completed response, p95 is null instead of a falsely complete
latency statistic. Mixed identity or provider drift prevents success.
The request cap must cover minimum duration times the configured rate. A full
concurrency limit causes the scheduler to wait, preserving the requested sample
count and launch-rate ceiling. Records include the actual start, finish, and
elapsed time; do not treat an extended sample as fixed-duration load evidence.
The total traffic deadline stops new probes and bounds in-flight requests.
OBSERVATION_BUDGET_EXHAUSTED or an incomplete sample prevents verification.

These bounds control the rehearsal. They are not rollout thresholds or evidence
of customer adoption. Build 3 will add cohorts, distinct contexts, and predeclared
policy thresholds based on the measured baseline.

## Deploy B, then restore A

Make and review a harmless visible change, such as a catalog description. Publish
B from its new source revision, validate in staging, and deploy to live. Preserve
A's verified live record and its provider rollback eligibility.

Use **Operate lab** with rollback, live, A's provider deployment UUID, and A's
verified restore_attempt UUID. Preview first; apply after reviewing the subject.
Locally:

```bash
LAB_PREVIOUS_DEPLOYMENT='replace-with-A-deployment-uuid'
LAB_RESTORE_RECORD='work/attempts/replace-with-A-attempt-uuid/record.json'
npm run lab -- rollback --target live --deployment "$LAB_PREVIOUS_DEPLOYMENT" --restore-record "$LAB_RESTORE_RECORD"
```

Keep the .sha256 file with its record. Rollback rejects a wrong-target, unverified,
ineligible, or wrong-image baseline. It checks the earlier configuration fingerprint
and verifies recovery with live requests. That fingerprint covers service
start/readiness/region/replica settings and LAB_ENVIRONMENT, PORT, and NODE_ENV;
it is not a full infrastructure or secret snapshot. Build 1 has neither app
secrets nor a database schema.

Railway rollback restores its previous image and custom variables within retention.
It does not restore external feature flags or undo writes. Restoring a retained
image/configuration after native rollback expires is a separate authorized operation.

## Reconcile an uncertain outcome

Never use GitHub's rerun button to repeat a mutation. Start a new **Operate lab**
run with reconcile and the original attempt UUID. It restores retained state and
inspects provider/live behavior without repeating the mutation. Locally:

```bash
LAB_UNCERTAIN_ATTEMPT='replace-with-original-attempt-uuid'
npm run lab -- reconcile --target live --attempt "$LAB_UNCERTAIN_ATTEMPT"
```

Verified reconciliation creates a new record and releases that attempt's lock.
The earlier unknown outcome remains unchanged. This establishes observed desired
state, not which previous request caused it. Durable intent and acceptance events
also support recovery after interruption before the final record was written.

If the desired state cannot be verified, the lock remains. Inspect target mapping,
provider deployment, and metadata compatibility. Missing/expired evidence for a
possibly started operation, or an interruption before durable intent, requires an operator to recover evidence or
authorize a separately reviewed recovery. Never discard locks just because they
are old. There is no force-unlock command.

Each lab-state artifact is retained for 90 days, subject to repository settings.
Mutation/reconciliation runs carry prior state forward. A missing artifact may
be skipped only when GitHub's completed job/step history proves the operation
was skipped. Earlier attempts of a rerun are still checked before older runs.
An operation that started, including one later cancelled, still requires its
artifact; ambiguous history, failed upload, expired artifacts, or history beyond
the bounded lookup blocks the next operation. The lookup inspects at most 20
operation attempts and 10 pages of workflow runs.
Read-only observations do not clear locks. Checksums detect changed bytes; these
files remain editable by their owner and are not tamper-resistant storage.

## Acceptance and cleanup

Retain A staging/live records, B staging/live records, A's recovery record, build
records, provider identity, measurements, and retention constraints. Build 1 is
not hosted-complete until the documented A → B → A exercise succeeds.

The full tutorial additionally requires LaunchDarkly exposure, separate feature
disablement, a repaired release, final observation, an operating owner, ongoing
monitoring, and flag-retirement criteria in later builds.

Stop local servers with Ctrl+C. Container tests remove only their own temporary
container/image. Preserve work before local cleanup. After hosted rehearsal,
inspect usage and stop or delete only the dedicated lab resources with explicit
cleanup authorization. Retain rollback artifacts for the next rehearsal.

## References

- [Railway deployment API](https://docs.railway.com/integrations/api/manage-deployments)
- [Railway service API](https://docs.railway.com/integrations/api/manage-services)
- [Railway rollback](https://docs.railway.com/deployments/deployment-actions)
- [Railway project tokens](https://docs.railway.com/integrations/api)
- [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub attempt-specific job history](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt)
