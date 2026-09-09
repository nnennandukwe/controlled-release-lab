# Build 2 implementation and hosted acceptance

Observed September 9, 2026 UTC; credential closeout verified at 18:22 UTC.
Build 2 is complete: implementation is merged, the protected C-to-D-to-C hosted
acceptance passed, and the final CI-only credential handoff is verified. Build 3
is planned; its implementation has not started.

## Merged implementation and review

| PR | Merge commit | Result |
|---|---|---|
| [#3: Attestation and authorized promotion](https://github.com/nnennandukwe/controlled-release-lab/pull/3) | `f46e4e24cb3a508ee4c5aceb6a08ab73c3fc14d0` | 127 tests and required CI passed; exact-head Qodo review `1064723` marked its recovery finding implemented. |
| [#4: Complete observation window](https://github.com/nnennandukwe/controlled-release-lab/pull/4) | `9f161e40d2ce82056b77d734303df82bcfc58321` | 128 tests and required CI passed; exact-head Qodo review `1064895` completed with no findings. |
| [#5: Request timing and cancelled approval recovery](https://github.com/nnennandukwe/controlled-release-lab/pull/5) | `512c59a0fea22c110f438c0f55af3b14dced6f57` | 135 tests, typing, build, container checks, PR/push Verify and GitGuardian passed. |

All merges used the reviewed head and the normal merge path without administrator
bypass. The hosted operator below runs from `512c59a0fea22c110f438c0f55af3b14dced6f57`;
the image source and operator source are intentionally tracked separately.

Qodo review `1065081` completed on PR #5 head
`aa5428ed2254ff138fff9ace79a4605c00cd22f4`. It reported no new issue, but retained
`pending` for earlier finding `e89b02a2-1d08-44c6-9240-248e59e402c4`,
"Cancellation recovery lacks live proof." The [actual contract check](build-02-cancellation-check.md)
and complete captured provider fixture address the technical gap. Subsequently,
[protected rehearsal 34324866229](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34324866229)
restored state across that cancelled approval, deployed, reconciled and signed
successfully. All 134 original staging files remained unchanged. This is a retained
review-label discrepancy, not a claim that Qodo marked the finding closed.

## Published subjects

Both images are public, built once in the protected publisher, tested before
push, identified by registry digest, and accompanied by native GitHub attestations.
Their application behavior is the same original catalog search. D was built from
the source revision containing the operator fixes and has different embedded
source/build identity. The runtime image contains the application, not the
operator tools. D is a
deliberate distinct-image promotion fixture, not a ranking-feature release.

| Subject | Publisher | Application source |
|---|---|---|
| C | [34321502376 / attempt 1](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34321502376) | `f46e4e24cb3a508ee4c5aceb6a08ab73c3fc14d0` |
| D | [34325241119 / attempt 1](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34325241119) | `512c59a0fea22c110f438c0f55af3b14dced6f57` |

```text
C = ghcr.io/nnennandukwe/controlled-release-lab@sha256:c6a7ea05d1fd889d80f008a815d9692c0ff35f86fa840d9999e902494f40bb2c
D = ghcr.io/nnennandukwe/controlled-release-lab@sha256:b1d8162cb3bf01190dd6220fd8a32ca2768ce22708a933459d9404321409944b
```

The pinned GitHub CLI 2.100.0 verifier separately authenticated the signed
artifacts against the fixed repository, issuer, workflow, main ref, source digest
and producer run/attempt. Signatures establish provenance and subject integrity;
they do not establish semantic correctness or customer reliability.

## Actual hosted sequence

All successful measurement rows below contain 120 requests, zero failures, and
at least 60,000 ms of measured elapsed time. Each observation checks functional
results and serving source/deployment/environment identity against provider state.

| Operation | Workflow run, attempt 1 | Observed result |
|---|---|---|
| C staging recovery rehearsal | [34324866229](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34324866229) | Signed success; 60,001.513 ms; p95 68.53 ms. |
| C live promotion | [34325190802](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34325190802) | Fresh signed staging proof, then signed live success; 60,000.702 ms; p95 135.28 ms. |
| D staging recovery rehearsal | [34325479670](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34325479670) | Automatically queued by D publication; signed success; 60,001.675 ms; p95 86.90 ms. |
| Incompatible live request | [34325890988](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34325890988) | Expected refusal: requested C while staging served D; `DEPLOYED_IMAGE_MISMATCH`; live operation skipped. |
| D live promotion | [34326041973](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34326041973) | Fresh signed staging proof, then signed live success; 60,000.572 ms; p95 41.09 ms. |
| Native rollback to C | [34326530861](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34326530861) | Expected exit 2 / workflow failure: provider acknowledged without a deployment ID; original record remains `unknown_outcome` with a retained lock. |
| Separate C reconciliation | [34326824936](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34326824936) | New read-only dispatch; signed recovery; 60,000.752 ms; p95 33.63 ms; lock released. |

The staging response-loss fixtures deliberately discard one successful provider
response, then assert that recovery does not repeat the mutation. They are labeled
teaching/test fixtures. Native rollback's acknowledgment-only response is the
actual provider contract, not an injected failure.

Rollback selected original C live deployment
`ed402fb1-d0e0-4d44-8fa0-e0454f351543` from its signed live record. Original rollback
attempt `f159b84f-0a06-4f08-8fb4-3d5777bfcb0c` remains unchanged and unresolved as
history. Reconciliation attempt `36df832b-c1dd-4b32-be91-096fb897b385` establishes
the later observed recovery without rewriting that uncertainty or claiming a
provider acknowledgment identified the resulting deployment.

Final observed serving state:

| Target | Deployment | Image |
|---|---|---|
| [staging](https://catalog-staging-55dc.up.railway.app) | `47392c4d-5332-4b24-96b7-b70dd9258e06` | D |
| [live](https://catalog-live.up.railway.app) | `2725c00c-9222-4022-bed7-c89c7eb3048e` | Recovered C |

All 135 original live-baseline files and all 282 files present before reconciliation
retained their SHA-256 hashes. The final carried live state contains no unresolved
lock. Separate native-verifier invocations accepted the C/D staging and live
proofs and the final C recovery proof.

## Refusals and execution-discovered fixes

Real local checks refused a modified bundle (`RELEASE_ATTACHMENT_REJECTED`), a
wrong image (`PROVENANCE_REJECTED`), and unprivileged local apply
(`PROTECTED_RUN_REQUIRED`). All exited 2 before a mutation journal existed.
Before/after provider snapshots were identical. The protected incompatible live
request above also left both staging and live provider snapshots unchanged.

Two earlier failures are retained:

- [34321711822](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34321711822): real staging deployment and response-loss reconciliation succeeded,
  but signing correctly refused a 59,999.870 ms observation. PR #4 waits until the
  monotonic clock proves the full minimum window; it does not reduce the threshold.
- [34323370430](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34323370430): the fresh request's separate timestamp reads exceeded its maximum validity
  by 1 ms. Local verification refused it before approval. PR #5 uses one clock
  instant for issuance/expiry and preserves strict expiration. Cancelling that
  waiting job also produced the real unassigned-runner contract fixture.

## Protection and completed credential handoff

Public-source readiness checked all 276 reachable blobs at publication, including
known credential patterns and the two existing scoped Railway tokens. No match
was found. GitGuardian also passed. The repository and GHCR package are public.

Main requires a PR and strict `verify`, dismisses stale approvals, applies to
administrators, and disallows force push/deletion. `image-publication`, `staging`
and `live` use owner reviewers, main-only deployment branches and no environment
administrator bypass. Self-review is allowed for this solo-owner lab. The recorded
approvals were delegated owner approvals under the user's instructions; none is
represented as independent multi-person review.

Environment-scoped Railway secrets are installed in the corresponding protected
GitHub environments. Ordinary apply requires the exact request-bound, authenticated
GitHub OIDC identity. The desktop owner still retains setup/administrator authority;
this is enforcement of the ordinary release path, not a sandbox against an owner
rewriting trusted code or using separate administrative access.

Fresh project/environment-scoped tokens were created through the signed-in Railway
dashboard after CLI OAuth token creation returned `Not Authorized`. Each token's
scope was checked, then its value was passed in memory to `gh secret set` through
stdin for the corresponding protected environment's `RAILWAY_PROJECT_TOKEN`.
No replacement token was printed, written to a file or stored in local Keychain.
The temporary local handoff server was stopped and removed.

Both fresh protected `doctor` runs used trusted main
`0492006538dd3df02eea1f152d4a6fd3a8ded611`, after secret installation:

| Target | Replacement token name | Protected doctor, attempt 1 | Result |
|---|---|---|---|
| staging | `controlled-release-lab-ci-staging-build2` | [34388243329](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34388243329) | Verified scope, configuration and unchanged D deployment `47392c4d-5332-4b24-96b7-b70dd9258e06`. |
| live | `controlled-release-lab-ci-live-build2` | [34388316957](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34388316957) | Verified scope, configuration and unchanged recovered C deployment `2725c00c-9222-4022-bed7-c89c7eb3048e`. |

These are read-only credential/provider checks, not new deployment or recovery
rehearsals. Only after both passed were the two older `controlled-release-lab-local-*`
tokens revoked through the dashboard. Provider metadata confirmed that only the
two replacements remain; separate requests using each old token returned
`Project Token not found`. The two revoked local Keychain entries were then removed.
Main and environment protection settings were read back and remained in force.
The credential handoff is complete without a new tier or broader account permissions.

The dedicated project's usage was read after refreshing CLI authentication; the
raw current-period measurements are archived without converting undocumented units
into an invoice estimate. Both existing services, bounded traffic, and resource
limits were reused; no new hosting tier, database, volume or unrelated resource
was introduced.

## Retained evidence and next build

Workflow artifacts retain build records, signature bundles, resolved requests,
protected approval references, raw samples, immutable records and carried locks.
Retention is 90 days; download them before expiration. The source repository does
not embed the large raw artifacts. The local archive is
`artifacts/build2-acceptance/`, with a file-hash manifest; setup/rotation metadata is
under `artifacts/build2-setup/` and `artifacts/build2-rotation/` without secret values.

The [Build 3 plan](../.plan/build-03-controlled-feature-exposure.md) defines real
LaunchDarkly evaluation, default-off deployment, internal and 5% synthetic-cohort
exposure, sufficient measurements and verified feature disablement on the running
service. No flag, SDK integration or rollout was implemented in this build.
Regression/repair/full rollout remain Build 4; tutorial and workshop publication
remain Build 5. These results prove the demonstrated system behavior, not customer
adoption, participant learning, production SLOs or revenue impact.
