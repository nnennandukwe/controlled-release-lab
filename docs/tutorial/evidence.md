# Evidence for the release story

The [Build 4 closeout](../build-04-closeout.md) records the executed September
18–20, 2026 release. These observations explain the tutorial; they do not authorize
another deployment or establish current health. Build 5's fresh rehearsal results
belong in its [acceptance record](../build-05-closeout.md).

## Retained image selectors

All publishers below are successful attempt 1 of `image.yml`. Image repository:
`ghcr.io/nnennandukwe/controlled-release-lab`. Append `@sha256:` and the full digest.
Authenticate the image and producer before use; the unsigned build record alone
is only a selector.

| Role | Application source SHA | Digest | Publication run |
|---|---|---|---|
| E: healthy recovery target | `58b0fe899446cec0d916fcaca31025972e6eea24` | `13d1c7f9e6dc3e264730ba72a71d54f207564a26240873fc089cbe24c216d294` | [34398598619](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/34398598619) |
| F: disclosed latency fixture | `68a01714700eb57ae47390fbab611b2abe1dd590` | `a37cdba9011e7d54c4532b83675420047c77f31bff08d26e4527ed282202b2c8` | [35374672780](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35374672780) |
| G: source repair | `fb9aaaea83a80cecfd63c30ed2de81ae68a0f99c` | `1f38ac2ff7292d873a2162f91631a3dbc810b31f5a83b9e702c6f621f6ada8f4` | [35380922988](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35380922988) |

F adds a fixed asynchronous 1,000 ms delay for ranked normalized `workspace`.
This is an intentional teaching fixture, not a defect that occurred spontaneously
during agent generation. G removes that source delay. Neither candidate changes
catalog data or writes customer state.

## Evidence by decision

Every linked action below is historical, attempt 1. Fresh replay selectors must be
recorded separately; do not substitute these observations into a new expansion chain.

| Decision | Executed evidence | What it supports and limits |
|---|---|---|
| Original E baseline | [Live 35373611751](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35373611751) | E off, 1,160 feature requests plus 120 deployment checks; zero errors. |
| F's reviewed change | [PR #12](https://github.com/nnennandukwe/controlled-release-lab/pull/12) | Fixture/control source and checks; review labels remain in the closeout. Review alone proves no hosted behavior. |
| Staging response-loss recovery | [35374927373](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35374927373), [35375563659](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35375563659) | Real protected effects with deliberately lost responses, then public read-only reconciliation. These are labeled failure injections. |
| F internal | [35377440111](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35377440111) | Normal-query success; no ranked `workspace` latency claim. |
| Detect F at 5% | [35377878158](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35377878158) | All 1,160 requests completed; ranked `workspace` p95 1,036.932 ms exceeded 500 ms. Aggregate also failed. |
| Refuse expansion | [35378411122](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35378411122) | No healthy predecessor artifact; `ARTIFACT_UNAVAILABLE`, mutation skipped, no PATCH. |
| Disable F | [35378431955](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35378431955) | Same F deployment, all 1,160 responses original, zero errors; p95 113.218 ms. |
| Roll back application | [35379007491](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35379007491), [35379332875](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35379332875) | Acknowledged rollback remained unknown; reconciliation verified E/configuration and unchanged external off flag, preserving the original record. |
| Repair source | [PR #13](https://github.com/nnennandukwe/controlled-release-lab/pull/13) | HTTP regression test failed on F at 1,003.443 ms; removal of the delay passed. G does not claim to fix the unexplained 502. |
| G live off baseline | [35382661097](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35382661097) | G exact-image promotion with exposure off and a fresh staging recheck. |
| G internal / 5 / 25 / 100 | [35383738980](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35383738980), [35384193609](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35384193609), [35384642186](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35384642186), [35385151774](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35385151774) | Authorized staged rollout; each used its own predecessor evidence. At 100%, 1,000 eligible + 20 internal ranked, 20 excluded original. |
| Monitor after completion | [35518027573](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35518027573) | September 20 signed window: zero errors, ranked `workspace` p95 33.551 ms; read-only, not completion authority. No September 19 window is claimed. |

At historical 5%, 41 of 1,000 eligible personas received treatment. This finite
cohort is not exactly 5%. The subgroup gate matters even when aggregate p95 passes,
but that masking scenario was demonstrated by an automated test, not this hosted
F window. Keep these two observations separate.

## Artifacts and interpretation

| Artifact | Retain and inspect |
|---|---|
| `build-record-RUN-ATTEMPT` | Build record and native image provenance bundle. |
| `release-request-RUN-ATTEMPT` | Immutable operation request and signed attachments; binds the approval subject. |
| `staging-proof-RUN-ATTEMPT` | Fresh signed staging observation for live promotion. |
| `lab-proof-TARGET-RUN-ATTEMPT` | Deployment or exposure envelope and `evidence.bundle.jsonl`. |
| `lab-diagnostic-TARGET-RUN-ATTEMPT` | Authenticated unhealthy observation, never expansion eligibility. |
| `lab-state-TARGET-RUN-ATTEMPT` | Durable attempts, raw samples, requests, original uncertain records and locks. |

Authenticity, health, freshness and authority are separate checks. An authentic
old successful window can fail today's `EXPOSURE_WINDOW` check. Do not alter its
timestamp or suppress the verifier. `verify-diagnostic` exit 0 means authenticated
failure evidence, not a healthy release. Current `verify-exposure` returns
`authorized: false`; only a fresh healthy authorized 100% exposure (or its verified
reconciliation) can return `completionEvidence: true`. Monitoring returns false.

## Retention and unresolved observations

The local archive `artifacts/build4-hosted-evidence-2026-09-20.tar.gz` has SHA-256
`4a40e6be011d4a7f593dd44607d9d83976907a3599baaf155639108e11c59964` and 28,872
manifested files. Its local receipt is not an off-site guarantee. Copy it to an
owner-designated durable location, retain a destination receipt, retrieve a copy,
and compare the archive hash and internal manifest. Do not commit raw operational
archives or credentials to this public repository.

GitHub artifact metadata checked September 20 lists E's build-record expiry as
December 8 at 20:02:05 UTC; F's as December 17 at 17:29:48 UTC; G's as December 17
at 18:34:00 UTC. Inspect the earliest expiry across every artifact needed for a
future run, including state and request attachments. Workflow URLs alone do not
preserve downloadable records, and the workflow has no archive-input fallback.

Keep these follow-ups visible in the [Build 5 record](../build-05-closeout.md):

- F's first live off window [35375982664](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35375982664)
  included one 502 lacking application identity. [Reconciliation 35376961075](https://github.com/nnennandukwe/controlled-release-lab/actions/runs/35376961075)
  later passed; it did not establish the 502's cause or erase the failed window.
- [PR #14](https://github.com/nnennandukwe/controlled-release-lab/pull/14) fixed
  recovery from demonstrably unexecuted rejected approvals. Qodo finding
  `b26dfa01-c10b-4dc4-8bc3-7e2aeac4e4d7` still recommends recurring CI coverage;
  hosted recovery of one instance does not close that recommendation.
- The flag stays through Build 5. Seven healthy daily windows, no unresolved
  recovery, and a separately reviewed removal/rollback plan are required before
  removal. There is no unattended monitor or automatic disablement.
