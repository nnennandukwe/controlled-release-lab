# Build 3: controlled feature exposure

Hosted acceptance was executed on September 9, 2026 (UTC). The healthy ranking image E
was published once, promoted to Railway live with exposure off, exposed to internal
and 5% eligible synthetic audiences, then disabled through LaunchDarkly on the same
live deployment. This record covers measured software behavior. It does not
establish participant learning, customer adoption, or production reliability.

## Release subject and authority

Image E was published by [34398598619 / attempt 1](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34398598619)
from application source `58b0fe899446cec0d916fcaca31025972e6eea24`:

```text
ghcr.io/nnennandukwe/controlled-release-lab@sha256:13d1c7f9e6dc3e264730ba72a71d54f207564a26240873fc089cbe24c216d294
```

The accepted operator runs use main
`ae7c7a7c7eec67d1df4108bb4a622072d7c2f3ac`. Operator fixes did not rebuild E.
The pinned native GitHub verifier separately authenticated the image and signed
observations against source and workflow identities and exact producer
runs/attempts. Release verification also checked the resolved request and its
attachment hashes. Request verification supplies evidence; protected GitHub
environment approval and request-bound OIDC supply execution authority.

The owner authorized these deployments and releases in the working session.
Protected approvals were submitted on the owner's delegated authority. They are
recorded approval events, not an independent human review of each release.
The runtime has only its server SDK key. Management credentials remain in the
protected operator environments; read-only preparation uses a separate Reader
credential. The ordinary Writer role is account-wide in this dedicated lab;
application checks constrain its use to the configured flag and environments.

## Observed sequence

All rows are successful attempt-1 workflows with signed evidence. Every measurement
has zero failed requests. Counts below describe the feature observation; deployment
runs also performed the existing baseline observation. Latency is client end-to-end
p95 for this synthetic exercise, not a production SLO.

| Operation | Run | Feature requests | Elapsed ms | p95 ms | Observed flag version |
|---|---|---:|---:|---:|---:|
| E staging provider recovery, off | [34402181696](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34402181696) | 1,160 | 120,211.041 | 95.447 | 2 |
| Automatically queued staging flag recovery, internal | [34402685724](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34402685724) | 120 | 60,001.227 | 27.525 | 3 |
| E live promotion, off | [34403061830](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34403061830) | 1,160 | 120,071.242 | 106.196 | 2 |
| Live internal exposure | [34403934914](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34403934914) | 120 | 60,000.960 | 97.421 | 3 |
| Live 5% exposure | [34404526777](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34404526777) | 1,160 | 120,088.305 | 43.924 | 4 |
| Independent live disable | [34405026589](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34405026589) | 1,160 | 120,114.525 | 91.453 | 5 |
| Staging reset, off | [34405455140](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34405455140) | 1,160 | 121,112.835 | 114.899 | 4 |

Live promotion collected a new signed staging proof in the same workflow before
live approval: 120 requests, 60,001.608 ms, zero failures, p95 26.193 ms, and both
variations. The live request required the production flag off before deployment.

The live internal window observed 20 distinct internal treatment personas,
20 eligible controls, and 20 excluded controls. The 5% window covered the fixed
1,000 eligible personas: 41 received treatment and 959 remained controls, alongside
20 internal and 20 excluded personas. Hash allocation produced 4.1% treatment in
this finite roster. The workflow neither assumed exactly 5% nor resampled for a
preferred result. Its minimum treatment/control, window, error, and latency gates
all passed within the unchanged 1,200-request/180-second budget.

## Feature recovery and retained uncertainty

Live E remained on deployment `a49248ee-d187-4a02-a203-359ad6c25e83` throughout
internal exposure, 5% exposure, and disablement. The disable request used the
retained signed off baseline and its own protected approval; it did not require
a successful treatment proof to authorize recovery.

The recovery comparison verified identical image, source, deployment,
configuration, and all 1,160 persona/query pairs. All 82 samples that previously
returned true—including internal and eligible treatment requests—returned false
and original ranking after disablement. All recovery samples reported `OFF`, an
initialized SDK, and no fallback. The browser's internal persona selector also
returned original ranking after disablement.

The staging response-loss fixture deliberately discarded one successful flag
update response. Original attempt `52d71ffa-d436-4d3e-97eb-5db57ebfe18b` retained its
uncertain outcome and original bytes. Separate read-only reconciliation
`e6315df9-8c7d-455e-b699-0cb87d4e4c49` verified the desired state and behavior.
The retained fixture assertions show exactly one update call, unchanged original
record, and released lock. The later observation does not attribute the provider
change to a particular lost response. This is a labeled test fixture.

## Refusal evidence and execution fixes

Before 5% expansion, copies of actual signed hosted attachments were checked by
the production exposure verifier. The candidate had no new protected approval or
execution authority. The local refusal harness had no provider credentials and
no mutation path:

| Changed input | Observed refusal |
|---|---|
| Expired request | `EXPOSURE_REQUEST_EXPIRED` |
| Edited signed baseline attachment bytes | `EXPOSURE_ATTACHMENT_CHANGED` |
| Inconsistent flag version and snapshot digest | `FLAG_SUBJECT` |

A fresh workflow request then read the exact same flag state, version, and digest
as the signed internal proof. Direct Railway readback confirmed unchanged images
and active deployments in both environments. Separately, setup exercised an
actual wrong-version conditional PATCH in the test environment: LaunchDarkly
returned HTTP 409 `optimistic_locking_error` and the flag remained off. That
provider check is distinct from the copied-artifact refusal tests above.

Hosted execution uncovered two workflow issues, both fixed through normal PRs:

- [PR #9](https://github.com/nnennandukwe/controlled-release-lab/pull/9) moved the
  flag-rehearsal dispatch into the successful signed staging workflow. The first
  staging run [34398832101](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34398832101)
  succeeded but produced no child. The repeated parent
  [34400360194](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34400360194)
  queued a child after this fix.
- [PR #10](https://github.com/nnennandukwe/controlled-release-lab/pull/10) removed
  a circular import between the executing release CLI and the exposure module.
  Child [34400909599](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34400909599)
  had exited 13 with unsettled top-level await before approval or mutation.
  Seven actual subprocess tests reproduced that failure, then passed after shared
  helpers moved to a module with no CLI execution. The accepted parent/child rows
  above prove the corrected automatic queue and hosted command path together.

The application and exposure implementation merged in
[PR #8](https://github.com/nnennandukwe/controlled-release-lab/pull/8).
`npm run verify` passed 206 tests, TypeScript, application build, and container
readiness/search/identity/non-root/read-only-filesystem/shutdown checks for the
final operator fix. PR #10's exact head
`5e8c7eebd91d86406c19e5ca4f145d5beb912088` passed both GitHub verification runs,
the secret scan, and completed Qodo review with no findings. PR #9's exact-head
Qodo finding was marked implemented before merge.

One PR #8 Qodo label discrepancy remains disclosed: finding
`9cd945c3-ad25-4c42-96b0-68093d87d97f`, “Healthy exposure checks miss deadline,”
flags the interaction between the latency floor and fixed sampling budget. We
retained both as independent acceptance gates. At 500 ms per request,
1,160 requests at concurrency two cannot finish within 180 seconds; the workflow
must hold even if p95 alone is acceptable. The controlled-clock test proves this
hold. Two authenticated UI dismissal attempts returned “The finding could not be
dismissed. Try again.” No dismissal was recorded; Qodo still reports `action_required` / `pending`.
This is not a claim of zero historical Qodo labels or automatic spec-review coverage.

## Final state and evidence retention

Both environments finished with the managed flag off and healthy E still deployed:

| Environment | E deployment | Final managed flag state |
|---|---|---|
| [staging](https://catalog-staging-55dc.up.railway.app) | `b15d3df5-e354-40ee-b392-b0df945e9e83` | `default/test`, off, version 4 |
| [live](https://catalog-live.up.railway.app) | `a49248ee-d187-4a02-a203-359ad6c25e83` | `default/production`, off, version 5 |

Final direct Railway readback showed the E image, unchanged deployment IDs, and
one active deployment/replica per environment. Six subsequent real requests
(internal, eligible, and excluded in each environment) reported original ranking,
`OFF`, initialized SDKs, and no fallback. Both final signed states contained zero
unresolved locks. All 3,007 pre-disable live history files and all 4,427 pre-reset
staging history files retained their hashes; derived current-request/output paths
were excluded from immutable-history comparisons.

LaunchDarkly still displayed 11 trial days. Its accumulated service-connection
usage displayed zero after live promotion, despite the verified SDK-backed
requests. Treat that lagging counter as reported usage, not a real-time assertion
of zero connections. The runtime has one SDK client per process and one replica
per environment, targeting two steady service connections. No paid resources,
plan changes, or expanded account roles were introduced during acceptance.

Each of the seven signed observation runs in the table retains
`lab-proof-<target>-<run>-1` and `lab-state-<target>-<run>-1` artifacts for 90 days.
Successful `doctor` runs retain state without a signed observation proof. The proof contains the signed
observation and native attestation bundle; state includes raw samples, immutable
attempts, and any unresolved locks. Local acceptance copies and native verification
results are under the ignored `artifacts/build3-acceptance/` directory; they contain
no raw provider credentials. Download the named GitHub artifacts before expiry if
retention beyond 90 days is needed.

The [runbook](runbook.md#controlled-feature-exposure) provides the repeatable
exposure and reset inputs. Build 2's [native application rollback evidence](build-02-closeout.md)
remains separate: disabling a flag does not roll back deployments, writes, or
schema changes. Build 4 must be planned separately for the seeded regression,
repair, and completed expanded release. Tutorial and participant workshop authoring
remain Build 5; no ThreadLoop or GAAP runtime integration is claimed here.
