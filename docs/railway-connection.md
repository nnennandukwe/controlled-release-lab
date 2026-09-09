# Railway connection evidence

On September 6, 2026, the local lab operator successfully connected to the
dedicated Railway staging and live environments using separate environment-scoped
project tokens. Both `doctor` commands exited 0 with `outcome: verified`.

The checked source commit was `92b2a4c1bb3c7aaa193ae19295994bd7f8c6281d`, running
Node 24.20.0. The [recorded preflight results](evidence/railway-preflight-2026-09-06.json)
include timestamps, target identities, provider snapshots, and configuration
fingerprints. They are unsigned operator records of those observations; rerun
preflight before a later operation.

The subsequently authorized [hosted rehearsal](hosted-rehearsal.md) records actual
deployments, public image publication, response-loss reconciliation, and native
rollback. The empty provider snapshots below remain the historical preflight.

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

## Qodo recovery follow-up

Finding `45a6ac35-e252-4fde-9076-8e42722b0b5b`, **Operators face untested
recovery**, concerns real provider behavior after a deployment or uncertain
mutation. Successful authentication and configuration readback do not exercise
those paths.

The subsequent [execution record](hosted-rehearsal.md) establishes image identity,
live observations, A-to-B-to-A restoration, and read-only reconciliation of an
uncertain operation. The attached sources are immutable digests and their provider
readback reported no available image update. The original connection record alone
did not establish those results.

The owner authorized deployment and the necessary public images for that execution.
Protected GitHub workflow access remains unresolved. The small services remain
running; CPU/memory limits are not a dollar spending cap. No workspace-wide cap
was changed, since it could stop unrelated projects.
