# Hosted baseline and recovery rehearsal

Executed September 6, 2026 (America/Los_Angeles), across September 6-7 UTC.
The owner authorized deployment of the dedicated lab and the necessary recovery.
The final normal-operator replay restored Image A after Image B, verified its
provider digest and saved configuration, and completed a fresh live sample.
Staging remains on B; live remains on A. This completes the hosted baseline and
application-recovery exercise for Build 1.

- [Live catalog](https://catalog-live.up.railway.app)
- [Staging catalog](https://catalog-staging-55dc.up.railway.app)
- [Machine-readable index](evidence/hosted-rehearsal-2026-09-06/index.json)
- [Evidence checksums](evidence/hosted-rehearsal-2026-09-06/manifest.json)

## Subjects and execution boundary

| Image | Source revision | Immutable GHCR digest |
|---|---|---|
| A | `a635c9ea83a0a484fbffb673d949665bebfcca44` | `sha256:87a99d8bd78d280705f4b30b8947030217d12e3848649ea9cda005f7fc71bd0c` |
| B | `61d136f96242202d43f2637fa284985a42b589f7` | `sha256:ebe9826ed42dbcc0963f79257121d615f2beb89ce7bb3210f0740666ef0d8325` |

Both images use `ghcr.io/nnennandukwe/controlled-release-lab`. Each linux/amd64
image was built once, container-tested, published, and promoted by its digest.
The package is public; the source repository remains private. The builds were
performed by the owner-authorized local operator, not the protected GitHub
publisher. These are unsigned Build 1 records, not provenance attestations.
GitHub deployment approval and credentials remain a separate prerequisite.

B changes one synthetic catalog description from “Quiet switches in a portable
keyboard.” to “Quiet switches and a compact footprint in a portable keyboard.”
The response archives show B serving that copy and A restoring the original.
This harmless difference was deliberate, not a naturally occurring regression.

The initial operator used `61d136f96242202d43f2637fa284985a42b589f7` (A's initial
runs used its earlier revision). The final clean replay used
`e15c5b34a3a56f890c7b7098c36b4e67b177723e`. Operator fixes did not require rebuilding either
application image. Future source changes do not inherit this execution proof.

## Observed sequence

Requests / failures and p95 describe synthetic keyboard-search requests from one
local machine. Each verified window lasted at least 60 seconds, used 2 requests
per second, and allowed at most 120 requests, concurrency 2, a five-second request
timeout, and a 90-second total traffic deadline. Across 9 verified
windows, all 1080 requests passed. These observations establish this rehearsal's
behavior; they are not rollout thresholds, load testing, or customer reliability.

| Step | Environment | Recorded outcome | Requests / failures | p95 ms |
|---|---|---|---|---|
| deploy-a-staging | staging | verified | 120 / 0 | 49.1 |
| deploy-a-live | live | verified | 120 / 0 | 46.9 |
| fault | staging | unknown_outcome: PROVIDER_TRANSPORT | No measurement | - |
| reconcile-b-staging | staging | verified | 120 / 0 | 49.4 |
| deploy-b-live | live | verified | 120 / 0 | 46.8 |
| rollback-a-live | live | unknown_outcome: PROVIDER_HTTP | No measurement | - |
| reconcile-rollback-source | live | blocked: CONFIGURED_IMAGE_MISMATCH | No measurement | - |
| repair-a-live | live | verified | 120 / 0 | 35.4 |
| deploy-b-live-repeat | live | verified | 120 / 0 | 34.2 |
| rollback-a-live-repeat | live | unknown_outcome: ROLLBACK_REQUIRES_RECONCILIATION | No measurement | - |
| reconcile-a-live-repeat | live | verified | 120 / 0 | 33.8 |
| deploy-b-live-final | live | verified | 120 / 0 | 40.1 |
| rollback-a-live-final | live | unknown_outcome: ROLLBACK_REQUIRES_RECONCILIATION | No measurement | - |
| reconcile-a-live-final | live | verified | 120 / 0 | 39.8 |

The index links every preserved original record and its checksum. Records contain
all raw request samples; exported journal events retain intent, source readback,
provider observations, and acknowledgments. The local work directory also retains
the separate per-request journal files. No failed or uncertain record was rewritten.

## Real uncertain-outcome recovery

The staging teaching fixture made one actual Railway deployment call for B and
intentionally discarded its successful response before the adapter received it.
There was no fake hosting implementation or simulated application response.
The operator recorded `PROVIDER_TRANSPORT`, retained the environment lock, and
refused a second apply with `OPERATION_LOCKED`. The normal, read-only reconcile
command then checked Railway's deployment-owned digest and 120 live requests.
It released the original lock while preserving the unknown record byte-for-byte.
Reconciliation establishes observed desired state without claiming request causality.

The [fault receipt](evidence/hosted-rehearsal-2026-09-06/fault-result.json),
[reconciliation proof](evidence/hosted-rehearsal-2026-09-06/reconciliation-proof.json),
and [exact fixture script](evidence/hosted-rehearsal-2026-09-06/discard-deployment-response.mjs)
are retained. To repeat this opt-in fixture from the repository root, configure
separate staging/live targets and supply the staging token through the secret
store, then set `REHEARSAL_IMAGE`, `REHEARSAL_SOURCE_SHA`, and optionally
`LAB_WORK_DIR`, and record the checked-out operator commit for the new run:

```sh
node --import tsx docs/evidence/hosted-rehearsal-2026-09-06/discard-deployment-response.mjs --apply
```

Its successful exit means the intentional uncertainty and lock were demonstrated;
then run the ordinary reconcile command using its attempt UUID and work directory.
It performs real hosting operations and is excluded from default tests.

## Provider defects discovered and fixed

The first native rollback failed with HTTP 400. The provider's live schema exposes
`deploymentRollback: Boolean!`, while the documentation example selected object
fields. The adapter now sends the scalar mutation and never fabricates a returned
deployment ID. A true acknowledgment writes a durable event, exits 2 with
`ROLLBACK_REQUIRES_RECONCILIATION`, and retains its lock until reconciliation.
False acknowledgments remain uncertain and are not retried.

The corrected native mutation restored A under a new deployment ID, but Railway
retained B as the service's configured source. Reconciliation rejected that state
with `CONFIGURED_IMAGE_MISMATCH`. The operator now aligns the configured source
with the saved recovery digest before requesting native rollback. Its existing
source-update race guard applies to this path too: an unexplained new deployment
prevents a second mutation and requires reconciliation.

To recover the already locked first attempt, the authorized local operator issued
one corrected scalar rollback, recorded the retained source mismatch, and aligned
the source with the already serving A image. This repair preserved the original
lock and history; ordinary reconciliation subsequently verified recovery. The
repair intent, acknowledgments, source snapshots, and blocked record are exported.

The final replay then deployed B again and used only the corrected normal
`rollback` and `reconcile` commands to restore A. It required no separate API
repair or lock deletion. The final deployment is `677c904e-9f93-4cea-97bc-43139932cd76`.
The [final recovery proof](evidence/hosted-rehearsal-2026-09-06/final-recovery-proof.json)
checks the restored digest, source, configuration, unchanged prior records, and
absence of outstanding locks.

The final operator also rechecks provider state immediately before native rollback.
Observed drift blocks the call. Railway supplies no conditional version argument,
so this is explicitly a single-writer lab: neither local locks nor Actions
concurrency can atomically exclude a trusted administrator using another client.

Regression coverage uses real captured Railway responses and exercises the scalar
rollback contract, false acknowledgments, source alignment, lock retention,
read-only reconciliation, and rejection of stale or cross-target evidence.
The final code passed 71 tests and strict TypeScript checks; GitHub Verify also
runs the container smoke checks. Check PR 1 for the review of the current head.
The later refinement that persists refused drift snapshots is covered by its
failure-path regression. No hosted concurrent-writer fault was induced or claimed.

## Remaining scope

Only the dedicated catalog service was operated, with staging/live each limited
to one replica, 1 CPU, and 0.5 GB RAM. No database or volume was added. The services
remain running; retained images and deployments are needed for future rollback.
Provider rollback eligibility and retention must be rechecked before another run.

This is not the completed tutorial release. Signing and enforced promotion,
LaunchDarkly audiences, gradual exposure, feature disablement, the seeded latency
regression, and repaired feature-release completion belong to Builds 2-5. The
configuration fingerprint covers the documented service fields and three custom
variables, not a complete infrastructure or secret snapshot. Checksums detect
changed bytes; they do not make these owner-editable records authenticated.
