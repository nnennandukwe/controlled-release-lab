# Railway connection evidence

On September 6, 2026, the local lab operator successfully connected to the
dedicated Railway staging and live environments using separate environment-scoped
project tokens. Both `doctor` commands exited 0 with `outcome: verified`.

The checked source commit was `92b2a4c1bb3c7aaa193ae19295994bd7f8c6281d`, running
Node 24.20.0. The [recorded preflight results](evidence/railway-preflight-2026-09-06.json)
include timestamps, target identities, provider snapshots, and configuration
fingerprints. They are unsigned operator records of those observations; rerun
preflight before a later operation.

## Configured resources

The private Railway project is `controlled-release-lab`, with one `catalog`
service represented in two environments. Both have one replica in `us-west2`,
limits of 1 CPU and 0.5 GB RAM, `/readyz` readiness checks, a 60-second readiness
timeout, and `node dist/src/main.js` as the start command. No database or volume
was created. GitHub source deployment and PR deployments are not configured.

| Target | Reserved HTTPS origin | Preflight result |
| --- | --- | --- |
| staging | `https://catalog-staging-55dc.up.railway.app` | Verified at 23:42:40 UTC |
| live | `https://catalog-live.up.railway.app` | Verified at 23:42:40 UTC |

Both domains route to port 3000. Variables are `PORT=3000`,
`NODE_ENV=production`, and `LAB_ENVIRONMENT` matching the target.
These are reserved origins: the preflight recorded no source image, latest
deployment, or active deployment. It did not establish application reachability.

## Credential and workflow boundary

Separate project tokens were created through Railway's authenticated dashboard,
verified against each target's project/environment IDs, and stored in the local
operator's macOS Keychain. Token values and local secret configuration remain
outside version control. The committed record contains no credentials.

This connects the local operator to Railway. GitHub Actions deployment access is
not yet configured: creating required-reviewer protection for this private repo
returned HTTP 422 because the current billing plan does not support that rule.
No deployment tokens were installed as GitHub secrets, and the partially created
empty environment was removed. Existing workflow approval and main-branch guards
remain in place.

To repeat the check, configure your own target mapping and supply its scoped
`RAILWAY_PROJECT_TOKEN` through your secret store, following the [runbook](runbook.md):

```sh
npm run lab -- doctor --target staging
npm run lab -- doctor --target live
```

## Remaining Qodo recovery evidence

Finding `45a6ac35-e252-4fde-9076-8e42722b0b5b`, **Operators face untested
recovery**, concerns real provider behavior after a deployment or uncertain
mutation. Successful authentication and configuration readback do not exercise
those paths.

The [hosted rehearsal](runbook.md#deploy-b-then-restore-a) must still establish
image identity, live observations, and A-to-B-to-A restoration, including
[read-only reconciliation](runbook.md#reconcile-an-uncertain-outcome) of an
uncertain operation. Image auto-update settings must be checked when attaching
the first immutable image. No such execution is claimed by this connection record.

The approved Build 1 plan treats hosted acceptance as a separately recorded
execution. Publication timing and protected workflow access remain to be resolved
before that execution. Resource limits constrain CPU and memory; they are not a
dollar spending cap. Use the existing account and agree the rehearsal's running
cost limit and stop point without silently changing a workspace-wide cap that
could stop unrelated projects.
