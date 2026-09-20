# Build 4: regression, recovery, and repaired release

F's disclosed latency fixture was observed on the hosted service, blocked 25%
expansion, and was recovered through separate feature disablement and native
application rollback to E. The separately reviewed G source repair completed
internal → 5% → 25% → 100% on September 18, 2026 (UTC). Final cleanup and the
additional operator monitoring window are recorded below. These are synthetic
software observations, not participant learning, customer adoption, or continuous
service reliability claims.

## Exact release subjects

All images use `ghcr.io/nnennandukwe/controlled-release-lab@sha256:` followed by
the digest below. F and G were each published once and promoted by exact digest.

| Candidate | Application source | Image digest | Publication, attempt 1 |
|---|---|---|---|
| E, healthy rollback target | `58b0fe899446cec0d916fcaca31025972e6eea24` | `13d1c7f9e6dc3e264730ba72a71d54f207564a26240873fc089cbe24c216d294` | [34398598619](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34398598619) |
| F, disclosed regression | `68a01714700eb57ae47390fbab611b2abe1dd590` | `a37cdba9011e7d54c4532b83675420047c77f31bff08d26e4527ed282202b2c8` | [35374672780](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35374672780) |
| G, source repair | `fb9aaaea83a80cecfd63c30ed2de81ae68a0f99c` | `1f38ac2ff7292d873a2162f91631a3dbc810b31f5a83b9e702c6f621f6ada8f4` | [35380922988](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35380922988) |

Railway project is `3e9cfaf4-3dec-4aa9-a8a9-ef7a8af538b6`, service
`a84fd6cc-c41c-4ba0-ad84-470634a51e28`. Staging environment is
`80bb920f-55eb-479c-b395-cacfb78344c3`; live is
`b78392fc-1a1b-40a4-a209-bb2260b106e2`. Configuration fingerprints remained:

- Staging: `d174192d79e0d2f36ddbff6a7c8ba587fa9771db6c10b427a51970531375bbad`.
- Live: `00fb2f014d7c85e2db93175da02d0c94b00507ee1b88b292d56d45f5c973375d`.

LaunchDarkly flag identity remains `default/catalog-ranked-search`, with `test`
for staging and `production` for live. Percentage changes retained flag identity,
salt, bucketing inputs, rule IDs, and variation mapping; inspected desired states
changed only eligible percentage weights between 5%, 25%, and 100%.

The owner authorized this concrete hosted sequence and a cumulative ceiling of
40,000 search requests, including failed windows and retries. Protected approvals
were submitted on delegated owner authority; they are not independent multi-person
review. Existing CI-scoped credentials, runtime SDK keys, protected environments,
and account roles were retained. No paid resource or permission expansion was made.
Native GitHub attestations and producer identities were checked separately from
request authority, subject identity, policy, workload, and health.

## Starting state and failure gates

September 18 provider checks [live 35373470412](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35373470412)
and [staging 35373515198](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35373515198)
confirmed E, compatible configuration, no unresolved locks, and native rollback
eligibility. Fresh signed off baselines used the new policy:
[live 35373611751](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35373611751)
and [staging 35373906084](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35373906084).
Each completed 1,160 feature requests with zero errors, plus 120 deployment checks.
E's original live deployment `a49248ee-d187-4a02-a203-359ad6c25e83` was retained
as the native rollback target before F was introduced.

Exposure policy and feature-proof schema 2 require query/variation p95 at most
`max(500 ms, 2 × the same query's off-baseline p95)`, at least 20 distinct personas
per required group, complete workload/window, valid SDK evaluation and identity,
correct results, and zero errors. Every hosted query threshold here was 500 ms.
Internal windows use 120 `keyboard`/`compact` requests; they do not establish
ranked `workspace` performance. Other windows use all 1,040 personas for
`workspace` plus 120 normal-query requests. Limits stayed at concurrency two,
10 requests/second, 1,200 requests, a 180-second deadline, and five seconds per
request. No resampling, deadline extension, or threshold relaxation was used.

F staging [deployment recovery 35374927373](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35374927373)
and [internal recovery 35375563659](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35375563659)
passed their declared workloads. Both deliberately discarded successful provider
responses, then recovered through public entry points with one provider effect,
unchanged original records, and released owned locks. They are failure-injection
rehearsals, not naturally occurring provider outages.

## Failure and independent recoveries

After the off-state failure and reconciliation described below,
[live internal exposure 35377440111](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35377440111)
completed 120 normal-query requests with zero errors and p95 62.269 ms, at
production flag version 6. Its fresh proof authorized the next 5% request.

F was a disclosed teaching fixture, not a naturally occurring agent defect: ranked normalized `workspace` awaited a fixed asynchronous 1,000 ms source delay. It preserved search results and had no runtime override. Internal windows deliberately covered only `keyboard` and `compact`; their success made no ranked challenge-latency claim.

F's [live 5% window](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35377878158) completed all 1,160 requests with zero errors. It evaluated 41 of 1,000 eligible personas as ranked, alongside all 20 internal personas; 959 eligible and all 20 excluded personas remained original. Ranked `workspace` p95 was 1,036.932 ms against 500 ms. Both query and aggregate latency gates held (aggregate p95 1,023.152 ms). The separate automated masked-minority test proves subgroup detection when aggregate p95 passes; this hosted window did not exhibit that masking.

The signed diagnostic authenticated the blocked operation without supplying eligibility. A [25% request](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35378411122) selected the failed 5% producer; resolution refused the absent healthy artifact with `ARTIFACT_UNAVAILABLE`, and the mutation job was skipped. It issued no PATCH. The failed exposure's state was known, its lock was released, and an independently approved disable was possible.

[Feature disablement](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35378431955) kept F on deployment `7e744909-b9bb-4999-9d3e-e01083d83f69`. All 1,160 matched persona/query pairs returned original behavior, including all 101 requests that previously evaluated true. The signed recovery p95 was 113.218 ms, with zero errors and production flag off at version 8.

[Native application rollback](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35379007491) then selected retained E deployment `a49248ee-d187-4a02-a203-359ad6c25e83`. Railway acknowledged the action without returning a deployment ID. Original attempt `42e0fc1c-9f54-431e-acb4-63860681876a` remained `unknown_outcome`, with its owned lock retained. Separate [read-only reconciliation](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35379332875) `fe776f01-f912-4142-8710-5e871cb9b56b` verified E's exact digest on new deployment `800d9a3b-920d-40db-8580-79f8faedf39c`, compatible configuration, zero errors, 96.985 ms feature p95, and the unchanged off flag version/digest. The original record hash remained `e1b5a324ffa9c480ddc7392e397294fa3c757b19afa80ead1b334bdfd271e457`; only its owned lock was released. The restored E deployment remained native-rollback-capable. Staging was independently reset off before G publication.

## Additional failed and uncertain history

F's [first live deployment operation](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35375982664) encountered one HTTP 502 in its off feature window: 1,159 other feature samples were valid. The failed response lacked application identity. This was separate from the seeded ranked-query regression because the flag was off. Original attempt `9ebadacc-b5a9-43bd-b43e-6853ba9d4841` retained `unknown_outcome` and its lock. Required [read-only reconciliation](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35376961075) `8deab79b-97eb-4c4c-bf38-152fa94582bc` subsequently verified the same F deployment with zero errors and released the owned lock. The original record remained byte-for-byte unchanged (SHA-256 `07f3d8223c04493165895ecc8daf985b3bc46d638387f516f11b165917219fc8`). The failed deployment run was never used as healthy exposure eligibility.

Provider-log inspection did not establish the cause of the 502. No error row in the inspected filter is not proof that the observed response did not occur. G repairs the intentional delay; it does not claim to fix an unproven 502 root cause. The failed window and the later reconciliation both count against the traffic budget. No deployment was repeated to obtain a favorable result.

Both F and G staging rehearsals deliberately discarded successful provider responses. Each retained one source update/one deployment or one flag PATCH, preserved the original uncertain record, and verified recovery through the public operator path. These are labeled failure-injection results, not provider outages. History comparisons across F recovery found 7,030 prior staging files and 9,237 prior live files unchanged.

## Separate source repair and completed rollout

Only after both live recoveries were verified did [PR #13](https://github.com/nnennandukwe/controlled-release-lab/pull/13)
implement G. A real-SDK HTTP regression test required normalized `workspace` to
return the same ranked products in under 500 ms. It failed on F at 1,003.443 ms
before the delay call and fixture module were removed. G changed no catalog,
ranking, workload, policy threshold, runtime switch, or dependency. Admission and
SDK-capacity protections remain; a permanently unsettled SDK call still requires
operator restart or rollback after bounded capacity is exhausted.

G staging deployment is `ccf563b3-8dd2-4f3d-af4f-ed65196f8b77`; G live deployment
is `66c3c123-9125-4463-a0e6-dcd783035c6e`. All rollout rows below completed the
fixed workload with zero errors. p95 is client end-to-end latency in milliseconds.
Deployment rows additionally performed 120 deployment-check requests.

| Operation | Run, attempt 1 | Feature requests | Aggregate p95 | Ranked workspace p95 | Flag version |
|---|---|---:|---:|---:|---:|
| Staging off and deployment recovery | [35381160025](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35381160025) | 1,160 | 84.713 | Not exposed | 6 |
| Staging internal flag recovery | [35381718155](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35381718155) | 120 | 48.333 | Not sampled | 7 |
| Staging 5%, challenge validation | [35382108176](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35382108176) | 1,160 | 52.936 | 66.078 | 8 |
| Live promotion, off | [35382661097](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35382661097) | 1,160 | 87.642 | Not exposed | 8 |
| Live internal | [35383738980](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35383738980) | 120 | 116.679 | Not sampled | 9 |
| Live 5% | [35384193609](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35384193609) | 1,160 | 92.597 | 93.997 | 10 |
| Live 25% | [35384642186](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35384642186) | 1,160 | 32.921 | 32.076 | 11 |
| Live 100%, authorized completion | [35385151774](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35385151774) | 1,160 | 87.192 | 88.058 | 12 |

Live promotion also collected a fresh staging proof in the same workflow: 1,280
search requests including deployment checks, zero errors, feature p95 90.654 ms,
and ranked `workspace` p95 99.384 ms. The live request kept exposure off while
promoting that same G digest. Each later expansion used fresh signed evidence from
its immediate authorized predecessor for the same image, deployment,
configuration, policy, and current flag snapshot, with a separate protected action.

At live 5%, the same 41 eligible personas received treatment in F and G; all 20
internal personas also received treatment. The same 61 challenge-treatment
personas improved from 1,036.932 to 93.997 ms p95. At 25%, 260 eligible personas
received treatment and 740 remained controls, with all earlier treatment personas
retained. At 100%, all 1,000 eligible and 20 internal personas received ranked
behavior; all 20 excluded personas remained original. Earlier treatment members
were retained. The measured finite cohorts, not an assumed exact percentage,
provided acceptance evidence.

The signed authorized 100% window was September 18, 19:20:21.152–19:22:21.244 UTC.
Its envelope SHA-256 is `2e48c4e83c2187c4d9195a8fdddaa7f504bf44ac1170ac791e08bd6e5ca2ada6`.
A session interruption delayed the final local inspection until September 20.
Native signature verification authenticated its exact successful producer and
subject; historical inspection recomputed its request, policy and healthy samples.
The normal current-policy verifier correctly refused the old window with
`EXPOSURE_WINDOW`. It is retained as historical release-completion evidence, not
fresh authority or evidence of uninterrupted health. The subsequent fresh read-only
monitor is separate and does not authorize expansion or replace the authorized
completion record. No September 19 daily monitoring window is claimed.

## Interrupted approvals and operator recovery

Expired staging cleanup requests [35385310028](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35385310028)
and [35513302938](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35513302938)
were rejected; neither acquired a runner or performed a provider effect. Fresh
attempt [35515591301](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35515591301)
then stopped before execution because state restoration treated the rejected
job's `failure` conclusion as uncertain despite explicit unallocated-runner and
zero-step evidence.

[PR #14](https://github.com/nnennandukwe/controlled-release-lab/pull/14) added a narrow
operator-only recovery fix beyond the two planned application PRs. It recognizes
that exact unexecuted state while retaining the block for missing, null, assigned,
contradictory, or incomplete execution metadata. The captured regression failed
before the edit; a read-only check against actual GitHub history then selected
the preceding durable staging state. It does not clear locks, alter old attempts,
reuse expired approvals, or rebuild G. Full protected recovery is recorded below.

Fresh protected [staging disable 35517540894](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35517540894)
restored `lab-state-staging-35382108176-1` through the actual workflow, then verified
1,160 original responses with zero errors, p95 107.569 ms, and the unchanged G
deployment. Staging finished off at version 9. All 10,819 earlier immutable staging
history files remained byte-for-byte unchanged.

The independent [live monitoring window 35518027573](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35518027573)
ran September 20, 15:00:23.799–15:02:23.799 UTC. It completed all 1,160 requests
with zero errors, aggregate p95 33.583 ms and ranked `workspace` p95 33.551 ms.
All 1,000 eligible and 20 internal personas remained ranked; all 20 excluded
personas remained original. Flag version 12 and G's deployment/configuration stayed
unchanged. The fresh public verifier returned `exposure_verified`,
`authorized: false`, and `completionEvidence: false`, as required for a read-only
observation. All 15,483 earlier immutable live history files remained unchanged.
Both final state artifacts contain zero unresolved locks.

The monitoring approval POST lost its response to a connection reset. Read-only
GitHub approval history confirmed that approval had applied and the workflow had
completed successfully. Its signed proof was then verified within 30 minutes.
Neither approval nor workflow was repeated. This transport failure and its
recovery are retained separately from application measurements.

| Final environment | G deployment | Flag state | Signed observation |
|---|---|---|---|
| [Staging](https://catalog-staging-55dc.up.railway.app) | `ccf563b3-8dd2-4f3d-af4f-ed65196f8b77` | `test`, off, version 9 | 35517540894 |
| [Live](https://catalog-live.up.railway.app) | `66c3c123-9125-4463-a0e6-dcd783035c6e` | `production`, 100%, version 12 | 35518027573 |

Provider readback in both final signed windows showed the exact G image, one active
successful deployment, compatible configuration and `canRollback: true`. Health
claims cover the recorded windows only.

## Verification, reviews, and evidence retention

The fixture/control implementation [PR #12](https://github.com/nnennandukwe/controlled-release-lab/pull/12)
passed 275 tests and full verification. Its exact reviewed head was
`d615a9a9bd66f80d637319a392d4f3502135f10e`. Qodo review 1076836 completed with
six implemented findings and three retained labels: bounded permanent SDK stalls,
hosted recovery not yet executed at review time, and assessed client-state pressure.
The [review notes](../.plan/build-04-review-notes.md) preserve dispositions; subsequent
hosted results do not rewrite those historical labels. Build 3's separate sampling
policy label discrepancy remains in its own closeout.

G's exact reviewed head was `70231ef4f81aaa691ab5ccd41df6dbf254d43ac5`;
Qodo PR review 1177447 completed with no findings. Full local verification passed
274 tests, TypeScript, build and container checks; CI passed before normal merge.
An initial local full run stopped because Docker was not running; the unchanged
code passed after Docker started. Both results are retained. Full local review had
complete file coverage and no findings, but its two spec URLs were unresolved and
the spec reviewer skipped; this is not independent full specification validation.

The operator recovery fix passed 36 focused tests and full verification with 278
tests, TypeScript, build and container checks. DX audits covered changed interfaces
and recorded hosted verification separately. The exact operator head
`4ff70ac2ffa3f51abceacb84b872a894818f3a45` passed both CI runs and completed Qodo
PR review 1192258 before normal merge to `3d9ea0d5f32989fee5a0631e90b1380b2576e890`.
Automatic and initial manual reviews had reported skipped; a full review completed.
One Reliability / remediation-recommended finding remains recorded:
`b26dfa01-c10b-4dc4-8bc3-7e2aeac4e4d7`, recurring CI coverage for rejected-approval
recovery. Local review raised the same coverage concern. This exercise verifies
actual GitHub history and the protected recovery path; it does not add recurring
CI authority to reject environment approvals. No Qodo finding dismissal is claimed.
The operator fix and this documentation update do not rebuild the G application.

Hosted acceptance recorded **22,680 search requests of the authorized 40,000**,
including failed windows and required read-only recovery. No reservations remain.
The rejected approvals, refused expansion, and pre-execution operator failure
issued zero search requests. Infrastructure readbacks and local tests are separate
from this hosted search count.

Successful windows retain `lab-proof-<target>-<run>-1` and
`lab-state-<target>-<run>-1`; F's unhealthy 5% window retains
`lab-diagnostic-live-35377878158-1` plus its state. Resolved requests retain
`release-request-<run>-1`, and image publications retain their build records and
native attestation bundles. Preserve failed and uncertain attempts alongside
successful envelopes, samples, signatures and request attachment hashes.

Original local acceptance copies are under ignored `artifacts/build4-acceptance/`.
A verified local archive, `artifacts/build4-hosted-evidence-2026-09-20.tar.gz`,
contains 28,872 files, including final complete state histories and downloaded
proofs/requests/build records. Every archived file was checked against its SHA-256
manifest; the archive SHA-256 is
`4a40e6be011d4a7f593dd44607d9d83976907a3599baaf155639108e11c59964`.
This is a local archive, not an off-site retention guarantee. Earlier duplicate
state snapshots and detailed verification/review logs remain in the acceptance
directory. Raw provider credentials are not included.

GitHub retention remains 90 days. The referenced E publication artifact expires
December 8, 2026 at 20:02:05 UTC; G's publication artifact expires December 17 at
18:34:00 UTC. Preserve the archive in owner-managed durable storage and download
any additional referenced artifacts before their individual expiry; keeping a
workflow URL alone does not preserve its downloadable evidence.

The [runbook monitoring procedure](runbook.md#operator-monitoring-and-retained-recovery)
requires one signed operator-run window daily and after deployment, flag or
configuration changes. There is no unattended monitor or automatic disablement.
Retain this flag through Build 5. Retirement requires seven healthy daily windows,
no unresolved recovery, and a separately reviewed removal and rollback plan; those
retirement criteria have not been met by this exercise. Tutorial/workshop authoring
and ThreadLoop/GAAP adapters remain deferred.
