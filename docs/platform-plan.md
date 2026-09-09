# Platform direction and first validation

Recorded September 6, 2026. This is a bootstrap decision record, not a completed
implementation plan or proof of deployment.

## Follow-up decisions

The user selected public GitHub source and public GHCR images when ready. This
sets distribution policy, not immediate publication approval. Railway CLI login
subsequently succeeded, and the LaunchDarkly trial was inspected in the signed-in
UI. Bootstrap access observations below are historical. Railway is now configured
for the dedicated lab, and both local operator preflights passed with scoped
credentials. See the [Railway connection record](railway-connection.md) and its
timestamped evidence. The account was verified as Hobby; hosted digest/rollback
acceptance subsequently passed in the authorized [local rehearsal](hosted-rehearsal.md).
As of September 9, source and GHCR images are public. Protected GitHub Actions
publication, staging/live promotion and native recovery passed the
[Build 2 acceptance](build-02-closeout.md). At 18:22 UTC on September 9, fresh
CI-only Railway tokens had passed protected checks and the older locally accessible
tokens were verified revoked. The original bootstrap observations
and proposed criteria below are historical; the rehearsal records executed results.

The Build 1 implementation plan is saved in
[.plan](../.plan/build-01-hosted-baseline-recovery.md). Build 2 and the
[Build 3 exposure plan](../.plan/build-03-controlled-feature-exposure.md) now have
separate files there; Builds 4–5 will be planned separately. See [the runbook](runbook.md) for the implemented
operator contracts and remaining hosted acceptance.

## Direction

Use the existing GitHub, Railway, and LaunchDarkly accounts. Railway is the
preferred host; Google Cloud is a fallback if Railway cannot meet the verified
artifact-promotion requirement. Preserve the approved tutorial's real release
scope regardless of provider.

| Responsibility | Proposed implementation |
|---|---|
| Repository and CI | GitHub and GitHub Actions |
| Application | Small TypeScript/Node read-only search service and browser interface |
| Build artifact | One container image built in CI, identified by digest |
| Registry | GHCR candidate; visibility and host access to be resolved |
| Staging and live hosting | Isolated Railway environments |
| User exposure | LaunchDarkly server-side feature evaluation |
| Core promotion | Explicit authorization and checks against measured evidence |
| Feature recovery | Disable new behavior and verify actual requests recover |
| Application recovery | Restore a known-good Railway deployment and verify image/configuration |
| Optional trial exercise | LaunchDarkly guarded rollout automation, subject to entitlement and rehearsal |

Do not attach unrestricted production GitHub autodeploys or image auto-updates.
The release path must verify evidence before promotion. Railway environment
isolation alone does not establish approval or artifact verification.

## Access observed

- GitHub CLI authenticated as the repository owner and could query the account.
- The Railway CLI is installed, but its OAuth refresh failed with
  `invalid_grant`; reauthentication is required before inspecting its current
  workspace, subscription, remaining credit, or project limits.
- The supplied LaunchDarkly project URL opens a sign-in page in the agent's
  browser. Account entitlements and trial expiry have not been inspected.
- The user reports a new two-week LaunchDarkly trial followed by Developer tier.
- No Railway project, service, deployment, registry package, LaunchDarkly flag,
  account permission, or billing setting was created or changed during bootstrap.

For the current CLI, the normal account refresh entry point is `railway login`.
Complete account authentication through the vendor's login flow; keep secrets
out of chat and repository files.

## Railway suitability and unresolved proof

Railway documents isolated environments, deployments from container registries,
and rollback to a previously successful deployment. Its rollback restores the
image and custom variables, and availability depends on retention. This differs
from changing a LaunchDarkly flag: Railway rollback does not by itself restore
external flag configuration.

Before committing to the complete pipeline, prove:

1. A prebuilt image can be selected immutably by digest, or an equivalently
   verified immutable reference. A mutable tag alone is insufficient.
2. Staging and live deployment use the exact verified image without rebuilding.
3. Provider records and live requests can be correlated to the intended image.
   Application-reported version text alone is not independent artifact proof.
4. A previous deployment and compatible configuration can be restored and
   observed serving healthy requests within the account's retention window.

The inspected general service docs do not establish the complete digest-pinning
and readback contract. This remains the first engineering compatibility check.
If unsupported, report the gap and revisit the host rather than weakening the
tutorial's evidence requirements.

## Keep the core usable after the trial

The public LaunchDarkly pricing page currently lists Developer at $0/month,
with one project, three environments, unlimited flags, five service connections,
and included observability usage. Workflows/approvals and Guardian automation
are listed in paid offerings. Confirm the actual account before configuration.

Plan around one LaunchDarkly project and the existing test environment plus a
live environment, with environment keys mapped explicitly to Railway. Confirm
existing configuration first. Keep server SDK connection counts, service
replicas, local development connections, and telemetry volume within verified
allowances.

The lasting core uses real hosting, cohort exposure, measurable runtime checks,
an explicit release operator, feature disablement, and deployment rollback.
Do not present an operator acknowledgment as independent multi-person approval.
Native guarded rollouts are an optional, separately evidenced trial exercise.
Record observations while accessible; do not make retained screenshots a claim
that an expired feature remains usable.

## Repository and registry visibility

Start the repository private while the foundation is prepared. The intended
tutorial companion can become public when explicitly authorized.

GitHub's native artifact attestations for private/internal repositories require
Enterprise Cloud; public repositories are supported on current Free/Pro/Team
plans. The account's applicable entitlement is not yet established. Resolve
visibility or entitlement before the attestation milestone. Do not substitute
an unsigned local manifest and describe it as verified hosted attestation.

Railway's service docs currently require Pro for private registry deployments.
Public source-repository visibility and public container-package visibility are
separate choices. Resolve both alongside the current Railway plan; publishing
either is outside this private bootstrap.

## First engineering milestone

Produce an implementation-ready build plan after resolving the account and
artifact compatibility questions. Then deliver the hosted original search
behavior, version identification, health checks, baseline metrics, and repeatable
traffic generation. Its acceptance evidence is a reachable HTTPS endpoint, an
identified serving artifact, and an observed restoration of a previous deployment.

Local app planning and implementation can proceed while account login is
resolved. Creating paid resources and traffic generation require a concrete
usage budget and authorization before execution.

The full next milestones are: artifact verification; staging-to-live promotion;
controlled user exposure; disclosed regression and both recovery mechanisms;
repaired complete rollout; clean tutorial rehearsal.

## Sources checked

- [Railway environments](https://docs.railway.com/environments)
- [Railway services and image sources](https://docs.railway.com/services)
- [Railway deployment actions](https://docs.railway.com/deployments/deployment-actions)
- [Railway pricing](https://railway.com/pricing)
- [LaunchDarkly pricing](https://launchdarkly.com/pricing/)
- [LaunchDarkly guarded rollouts](https://launchdarkly.com/docs/home/releases/guarded-rollouts)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [Google Cloud trial FAQ](https://cloud.google.com/signup-faqs)

Google Cloud currently advertises $300 of credit for eligible new users over
90 days. This is an alternative to evaluate only if needed; eligibility for this
account has not been established.
