# Authenticated deployment and recovery runbook

Build 2 publishes signed image provenance and signs measured deployment evidence.
Live promotion consumes a fresh staging observation and a request-bound GitHub
OIDC identity inside the protected execution path. A signature establishes origin
and integrity; the policy still decides whether its evidence is sufficient.

The [Build 1 rehearsal](hosted-rehearsal.md) remains a historical record of the
local A → B → A exercise. Its unsigned images and receipts are not eligible for
Build 2 promotion. Build 2 hosted acceptance is recorded separately when executed.

## Prerequisites and trust configuration

Use Node 24.20.0, Docker for container verification, GitHub Actions, public GHCR,
and the dedicated Railway project with separate staging/live environments. Run:

```bash
npm ci --ignore-scripts
npm run setup:verifier
npm run verify
```

The verifier is GitHub CLI 2.100.0, downloaded from its official release and
checked against committed archive and executable hashes in
`config/toolchain.json`. It is installed under ignored `artifacts/bin/`; it does
not replace the system CLI. Supported platforms are Linux x64 and macOS arm64.
Verification needs network access to GitHub/Sigstore and the public registry.

Use the approved public-source/public-image distribution route after inspecting
reachable source history for secrets and private material. Source visibility and
package visibility are separate settings. Do not purchase a tier to bypass an
unsupported private-repository environment or registry setting.

Configure these GitHub environments:

| Environment | Access | Required controls |
|---|---|---|
| `image-publication` | Publisher's scoped GitHub package/attestation token | Owner reviewer; selected branch `main`; administrator bypass disabled |
| `staging` | Staging-only `RAILWAY_PROJECT_TOKEN` secret | Same controls |
| `live` | Live-only `RAILWAY_PROJECT_TOKEN` secret | Same controls |

Allow self-review for this solo-owner lab. An owner-authorized automated approval
is not independent human review. Main must require a PR and the `verify` check,
dismiss stale approvals, prohibit force pushes/deletion, and enforce protection
for administrators. The runtime checks exact environment reviewer identity,
selected main-only branch rule, bypass prohibition, and protected main metadata.
Administrative setup verifies the detailed branch-protection settings separately.
GitHub enforces access before releasing environment credentials.

Put each environment's target map in the variable `LAB_CONFIG_JSON`, using the
shape in `config/lab.example.json`. Keep tokens in Railway's normal project-token
settings and GitHub environment secrets; never pass them in CLI arguments. Verify,
request resolution, and finalization jobs receive no Railway credentials. Coding
agents and the deployed application receive no operator token.

`config/release-policy.json` pins this lab's repository and numeric owner/repository
identities, actual OIDC subject prefix, target identities, configuration fingerprints,
and evidence limits. Forks must review and replace these values and establish their
own protected publisher. Changing the policy invalidates earlier evidence; collect
new proof before promotion. Do not add an allow-all fallback for a fork.

## Railway configuration

Use one replica per environment, no database/volume, no GitHub source, and no image
auto-updates. The service runs `node dist/src/main.js` with `/readyz` health checks.
Set `PORT=3000`, `NODE_ENV=production`, and the selected `LAB_ENVIRONMENT`.
Railway supplies `RAILWAY_DEPLOYMENT_ID`; source SHA is baked into the image.

The expected fingerprint covers start/readiness/region/replica settings plus those
three variables. It is not a full infrastructure or secret snapshot. Doctor shows
the observed fingerprint. A legitimate configuration change needs a reviewed policy
update and fresh evidence; do not paste whatever the provider returned into policy
without inspecting the change.

Local read-only inspection uses the selected environment-scoped token:

```bash
npm run lab -- doctor --target staging
npm run lab -- observe --target staging --duration-seconds 60 --rate 2 --max-requests 120
```

Target-map precedence is `--config PATH`, then `LAB_CONFIG_JSON`, then ignored
`config/lab.json`. `.env.example` documents variables but is not automatically loaded.
The CLI never falls back to Railway desktop OAuth or a remembered linked project.

## Publish a candidate

After review and merge, dispatch **Publish image** on main with a `change_reference`
(existing PR URL or change ID). Review and approve the `image-publication` job.
It builds one linux/amd64 image, tests that exact image, pushes it, and issues
native GitHub SLSA provenance for the pushed digest. BuildKit's extra provenance
manifest is disabled to preserve a single-platform deployment subject; GitHub
attestation is a separate signed provenance record.

Retain `build-record-RUN_ID-RUN_ATTEMPT`. It contains:

- `build-record.json`: schema version 2, exact image/source, producer run and attempt.
- `image.bundle.jsonl`: the native provenance bundle.

The build record is an unsigned selector. Consumers authenticate the image bundle
and compare its certificate-backed producer to the successful publisher run and
protected-main source history. Tags are never a promotion input. Retain the image
and artifacts for at least 90 days, subject to Railway rollback retention.

## Deploy to staging, then promote to live

Dispatch **Operate lab** from main. Inputs:

| Operation | Required inputs beyond `operation`, `target` |
|---|---|
| `doctor` | None; read-only preflight |
| `deploy` | `build_run`, `build_attempt` (default 1), `change_reference`; `apply=true` for mutation |
| `observe` | Same build selectors and reference; collects and signs evidence without mutation |
| `rollback` | `evidence_run`, `evidence_attempt` (default 1), `change_reference`; `apply=true` for mutation |
| `rehearse-recovery` | Staging only, `apply=true`, exact build selectors and reference; automatically queued after publication |
| `reconcile` | Original uncertain `attempt` UUID; reads retained state without repeating the mutation |

Optional `image`/`source_sha` inputs assert the selected build identity. Optional
`deployment`/`restore_attempt` assert the selected rollback record. A mismatch
blocks resolution. Fresh dispatches are required; workflow re-runs are refused.

For staging, resolve the candidate, inspect the immutable release-request artifact
and job summary, then approve the protected staging operation. `apply=false` is a
preview; it does not issue authority or produce deployment proof.

For live apply, the workflow first obtains staging approval and re-observes that
exact candidate currently deployed to staging. It signs the resulting evidence.
Only after the staging-proof job succeeds can the workflow finalize the immutable
live request and ask for live approval. Inspect the resolved digest, source, target,
configuration, policy, change reference, expiry, and request hash in that run.
An approval for a different run or request cannot authorize this mutation.
The signed staging proof must also match the same operator run and the canonical
staging-observation projection of that request, including its change reference,
issuance/expiry, build, policy and image-bundle hash. A fresh proof transplanted
from another request is refused even when the image is identical.

The request expires after 30 minutes. Evidence must contain at least 120 distinct
successful requests over at least 60 seconds, with consistent source, deployment,
environment, and catalog behavior. Apply uses rate 2/sec, concurrency 2, a 5-second
request timeout, and a 90-second total traffic deadline. Clock skew tolerance is
30 seconds. Missing, stale, failed, mixed-subject, or edited evidence blocks live
promotion. These are synthetic baseline criteria, not production SLOs.

All operator runs share one Actions concurrency group across both environments.
It remains held across proof, approval, mutation, and observation. Approval delays
can expire a request; start a fresh dispatch. The lab requires one provider writer:
Railway dashboard actions, other API clients, and image auto-updates must not race
this workflow. Neither local locks nor Actions concurrency can exclude a trusted
Railway administrator, and Railway has no compare-and-set rollback primitive.

`execute()` checks signed provenance and policy, obtains a cryptographically
verified request-bound OIDC token, checks exact run/attempt/job metadata and current
environment protection, and preserves authorization before provider effects.
It checks evidence again before each mutation. The local CLI's `--apply` flag does
not bypass this boundary, even when supplied with a Railway token and GitHub-looking
environment variables. Preview and evidence verification are separate operations:

```bash
npm run lab -- verify --target live --release-dir work/release/current
npm run lab -- deploy --target staging --release-dir work/release/current
```

Download a resolved request artifact into that directory first. `verify` requires
only `--target` and `--release-dir`, uses no Railway credential, and returns
`authorized: false`. A live apply request is available only after staging proof.
A live preview checks selectors/provider readiness; it is not promotion eligibility.

## Evidence and failure handling

Successful deployment requires exact configured image, deployment `meta.image`,
source identity, active deployment, expected configuration, healthy live requests,
and stable provider state across the observation. Absent digest-qualified provider
identity blocks with `IMAGE_EVIDENCE_UNAVAILABLE`.

| Artifact | What it records |
|---|---|
| `release-request-RUN-ATTEMPT` | Immutable manifest and hashed signed attachments |
| `staging-proof-RUN-ATTEMPT` | Fresh staging evidence plus native file provenance |
| `staging-observations-RUN-ATTEMPT` | Raw staging observations, including failures |
| `lab-state-TARGET-RUN-ATTEMPT` | Append-preserved records, per-attempt requests, unresolved locks |
| `lab-proof-TARGET-RUN-ATTEMPT` | Verified deployment observation plus native file provenance |

State upload precedes final evidence signing. Failed signing cannot erase a real
provider mutation; it leaves no eligible signed observation. Start a new protected
`observe` run for the same build after investigating the signer failure.

CLI exit 0 means verified/preview, 1 failed/invalid, and 2 blocked/unknown. A refused
request is not a deployment. A lost response after a mutation is not a retry cue.
The work directory keeps intent, authorization, observations, checksummed records,
and locks. Raw samples preserve failures in the denominator; missing responses
produce a null p95 instead of claiming a complete latency measurement.

## Automated hosted recovery test

Each successful **Publish image** run on main triggers **Queue hosted recovery
test**, which dispatches **Operate lab** with `rehearse-recovery`, staging and
that exact build run/attempt. The queue does not run producer code or receive
Railway credentials. Inspect the resolved request and approve staging to run it.
A successful queue or publication does not establish recovery: the separate
**staging / rehearse-recovery** run must finish successfully, including signing.

The request explicitly binds `purpose: recovery-rehearsal`. Ordinary deployment
cannot consume it, and the rehearsal rejects live targets or preview mode. The
real protected execution path updates the staging image and deploys it once.
A labeled teaching fixture then discards the successful deployment response.
This simulates response loss after a real Railway mutation; it does not simulate
a Railway outage or introduce a broken catalog implementation.

Automated assertions require an unknown outcome, retained lock and durable intent,
then wait for the provider using reads only. Ordinary reconciliation receives the
original attempt UUID, verifies provider/source/configuration identity and collects
120 live requests over 60 seconds. The test requires unchanged original evidence,
no repeated mutation, and a released lock before declaring verified recovery.
Its signed observation carries the rehearsal purpose. Fixture and assertion
records remain under `work/rehearsals/attempts/` in the `lab-state` artifact.

A real failure before injection produces `REHEARSAL_NOT_EXERCISED`; an unresolved
provider state or failed measurement leaves the test incomplete and retains its
underlying evidence. Inspect the original attempt and use a new read-only
`reconcile` dispatch where needed. Do not retry the mutation or delete its lock.
Local tests exercise the same assertions with controlled external seams; only the
protected hosted run establishes actual Railway behavior. Native rollback remains
a distinct acceptance case below.

## Native rollback and separate reconciliation

Retain a successful earlier **live** `lab-proof` run and its image publisher
artifact. After deploying another candidate, select the earlier proof with
`evidence_run` and `evidence_attempt`, target live, operation rollback, and a new
change reference. Inspect the resolved recovery image/deployment before approval.

Rollback verifies the signed earlier observation, exact source/image, current policy,
compatible configuration, provider rollback eligibility, and restored record identity.
A known-good recovery observation does not expire under the staging freshness limit;
the new rollback request and authorization still expire after 30 minutes. Missing
images, expired artifacts, revoked images, or changed policy/configuration block.

Railway native rollback returns a Boolean acknowledgment, not a deployment ID.
The apply run intentionally exits 2 with `ROLLBACK_REQUIRES_RECONCILIATION` and retains
its lock. Start a new **Operate lab** run with `reconcile` and the original attempt
UUID. It restores the failed run's state, observes recovery, writes a new record,
and releases the lock only after provider and live-request evidence agree.
It then signs a new observation under that reconciliation run's identity. The earlier
unknown outcome remains unchanged. Reconciliation proves observed desired state,
not which previous request caused it. No mutation is repeated.

Source alignment precedes deployment/rollback. If that update coincides with a new
latest deployment, `UNATTRIBUTED_DEPLOYMENT` retains the lock for reconciliation.
Final rollback state checks reject observed drift with `ROLLBACK_STATE_CHANGED`.
There is no force-unlock command. Missing/expired state or ambiguous execution history
requires recovery of the evidence, not deletion of locks. History lookup is bounded
to 10 pages of workflow runs and 20 operation attempts; incomplete job/artifact
lookups fail closed. State is retained 90 days and carried into later operations.

Railway rollback restores retained application image/configuration, not external
flags, writes, or migrations. LaunchDarkly feature disablement is a separate Build 3
exercise. Full repaired feature release and completion remain later milestones.

## Acceptance and cleanup

Build 2 hosted acceptance requires a protected CI baseline C, candidate D promoted
through staging to live, native rollback to C, and separately verified recovery.
Preserve failed attempts as well as successful signed records. Local tests, merged
code, public images, and green CI alone do not establish that outcome.

After rehearsal, inspect usage. Stop/delete only the dedicated lab's resources with
cleanup authorization. Do not touch unrelated projects or discard retained recovery
artifacts. A rehearsed system proves behavior, not participant learning or adoption.

## References

- [GitHub artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations)
- [GitHub workflow inputs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Railway deployment API](https://docs.railway.com/integrations/api/manage-deployments)
- [Railway rollback](https://docs.railway.com/deployments/deployment-actions)
