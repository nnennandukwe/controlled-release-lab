# Build 1 closeout

Checked September 9, 2026 UTC. [PR #1](https://github.com/nnennandukwe/controlled-release-lab/pull/1)
merged at `2026-09-09T05:21:52Z` as
`2e2bc8dc4c9583b80c1e58effaed0993e766ba90`.

The reviewed head was `d79e4bbfd1c2256f567c096a2fd3d7ec48e33983`.
Its PR and push Verify jobs and GitGuardian check passed. The subsequent
[main Verify run](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34314577880)
also passed. All 104 files in the archived rehearsal manifest still matched
their SHA-256 checksums.

Read-only Railway preflights and HTTPS `/version` requests confirmed:

| Target | Active deployment | Serving image |
|---|---|---|
| staging | `0d76e127-7385-4e31-9a14-2b3d1fe5211e` | B, `sha256:ebe9826ed42dbcc0963f79257121d615f2beb89ce7bb3210f0740666ef0d8325` |
| live | `677c904e-9f93-4cea-97bc-43139932cd76` | Restored A, `sha256:87a99d8bd78d280705f4b30b8947030217d12e3848649ea9cda005f7fc71bd0c` |

Both provider statuses were SUCCESS, with one active deployment and configured
source equal to the serving digest. HTTPS responses agreed on source SHA,
environment, and deployment ID. This was a current identity check, not a new
measurement window or redeployment. The [original rehearsal](hosted-rehearsal.md)
contains the actual deployment, uncertain-outcome recovery, and rollback proof.
There was no application change requiring another deployment at closeout.

Qodo review `1039749` completed on the exact reviewed head: nine findings had
`attribution_status: implemented`; `45a6ac35-e252-4fde-9076-8e42722b0b5b`,
"Operators face untested recovery," retained `pending`. The committed real
lost-response recovery, captured provider contracts, fixes, and clean rollback
replays address that technical concern. This is a disposition discrepancy,
not a claim that Qodo marked every finding closed. Qodo CLI
`0.1.0-next.45` remained read-only for review dispositions after one catalog
refresh. No status was forged or dismissed. GitHub reported the PR mergeable
with passing checks; normal merge used the exact reviewed head and no admin
bypass, under the owner's explicit instruction to merge working code.

Build 1 is complete for its hosted baseline and recovery scope. The source
repository remains private; the GHCR package is public. There are currently no
configured GitHub environments or Railway deployment secrets in Actions.
The [Build 2 plan](../.plan/build-02-attestation-authorized-promotion.md) owns
public-source readiness, protected workflow access, authenticated evidence,
and enforced promotion. Gradual feature exposure and completed feature release
remain Builds 3 and 4; tutorial/workshop publication remains Build 5.
