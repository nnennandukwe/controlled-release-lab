# Controlled Release Lab

Controlled Release Lab serves a read-only product catalog and records image,
deployment, flag exposure, and live-request evidence for a Railway release.
It is the runnable companion being built for **From AI-Generated Code to a
Controlled Release**.

The application returns search results at `/api/search`, readiness at `/readyz`,
and embedded source identity at `/version`. Operator commands write raw
observations and checksummed records under `work/attempts/`. Those records let
an operator investigate failures and verify deployment or application recovery.

This is for engineers practicing delivery with a small hosted demo. The catalog
and traffic are synthetic. Build 1's hosted baseline and application recovery
were exercised on Railway; see the [rehearsal and evidence](docs/hosted-rehearsal.md)
and [live catalog](https://catalog-live.up.railway.app). Build 2
[passed signed C-to-D promotion and native recovery](docs/build-02-closeout.md),
including its final CI-only credential handoff. Build 3
[passed hosted internal and 5% exposure, refusal checks, and feature disablement](docs/build-03-closeout.md)
on the same E deployment. That closeout records both environments off and
discloses the remaining Qodo sampling-policy label.

[Build 4](.plan/build-04-regression-repair-release.md) adds query-specific latency
gates, 25%/100% exposure, unhealthy diagnostics, and candidate F's disclosed
teaching fixture: ranked `workspace` searches wait asynchronously for 1,000 ms.
Normal queries and original search are unchanged. Its hosted failure and recovery
must be verified before a separate source repair produces candidate G. This
implementation is not evidence that the hosted Build 4 release has completed.

## Run locally

Install Node 24.20.0 (the version in `.nvmrc`). Docker is needed only for container
verification. From a checkout:

```bash
npm ci --ignore-scripts
npm run dev
```

Open [localhost:3000](http://localhost:3000). Search for `keyboard`; the compact
and full-size keyboards appear. Stop with Ctrl+C. No cloud credentials are needed.
Local builds report `sourceSha: "local"`. The persona selector uses public synthetic
identities. Local mode stays original with explicit offline fallback diagnostics;
hosted mode requires the matching server SDK key. No management token reaches
the app or browser.

```bash
npm run setup:verifier
npm run typecheck
npm test
npm run build
npm start
```

`build` writes compiled output and metadata to `dist/`; `start` serves it.
`npm run verify` installs/checks the pinned attestation verifier, then runs typing,
tests, compilation, and the Docker smoke test. Tests include an authentic signed
fixture and require GitHub/Sigstore network access. The protected recovery test
uses the real authorization path and a 60-second local observation; it needs no
Railway credential. Each successful image publication separately queues the real
Railway staging recovery rehearsal described in the runbook.

## Operate the hosted lab

Start with the [runbook](docs/runbook.md) for account prerequisites, target
configuration, publication, deployment, rollback, and reconciliation. The CLI
never uses a remembered Railway project or the desktop's OAuth session.

```bash
npm run lab -- --help
npm run lab -- doctor --target staging
npm run lab -- observe --target staging --duration-seconds 60 --rate 2 --max-requests 120
```

Hosted commands require a target and its environment-scoped
`RAILWAY_PROJECT_TOKEN`. Flag-aware observation also needs `LD_READ_TOKEN`.
The deployed app uses only its environment-specific `LD_SDK_KEY`; protected
exposure/disable steps alone receive `LD_MANAGEMENT_TOKEN`. Keep operator credentials in the operator's secret store,
outside the application and ordinary coding environment. Deployment and rollback
preview by default. Apply requires an immutable release request, signed evidence,
and authenticated OIDC identity inside the protected GitHub workflow. A local
`--apply` flag or change reference alone cannot authorize deployment.

Deployment observations preserve the requested sample count by waiting for concurrency
capacity. `--duration-seconds` is the minimum window; `--max-duration-seconds`
sets the total traffic deadline (default 300 seconds). The record includes the
actual elapsed time, and exhausted budgets block verification.

Exposure commands use fixed observation budgets and reject sampling overrides.
See [controlled exposure and reset](docs/runbook.md#controlled-feature-exposure)
for the exact workflow inputs and evidence selectors.

For machine-readable stdout without npm's script banner:

```bash
node --import tsx tools/lab.ts doctor --target staging
```

| Output | Meaning |
|---|---|
| `work/attempts/<uuid>/*-*.json` | Preserved intent, provider observations, and requests |
| `work/attempts/<uuid>/record.json` and `.sha256` | Final record and checksum |
| `work/rehearsals/attempts/<uuid>/` | Labeled response-loss fixture and automated recovery assertions |
| `work/flag-rehearsals/attempts/<uuid>/` | Labeled staging flag response-loss and read-only recovery assertions |
| `work/exposure/attempts/<uuid>/` | Immutable flag intents, raw cohort samples, and checksummed exposure records |
| `work/locks/*.lock` | Environment ownership retained after an uncertain mutation |
| GitHub `build-record-*` artifact | Published digest, producer identity, and signed image provenance |
| GitHub `lab-proof-*` artifact | Signed deployment or exposure evidence bound to the exact subject |
| GitHub `lab-diagnostic-*` artifact | Signed unhealthy observation; authenticates failure evidence but cannot authorize expansion |
| GitHub `lab-state-*` artifact | Preserved operator evidence and unresolved locks |

Exit `0` means verified, preview or authenticated diagnostic; `1` invalid/failed;
and `2` blocked/unknown. An authenticated diagnostic always reports
`authorized: false` and cannot authorize release.
A verified Build 1 operation means the provider image record and live observation
agreed. It does not establish cryptographic provenance, production reliability,
or feature-release completion.

## Current limits

- Railway digest preservation, real response-loss reconciliation, and native
  rollback were exercised. The adapter requires digest-qualified `meta.image`
  and blocks when absent; regression fixtures include captured provider data.
- Native rollback acknowledges without a deployment ID. Apply exits 2 and retains
  the lock until a separate reconcile verifies recovery. The lab requires one
  deployment writer; its checks cannot atomically exclude dashboard/API changes.
- Railway application rollback and LaunchDarkly feature disablement are different
  operations. Disablement must verify false evaluations and original results;
  a PATCH acknowledgement does not prove recovery.
- Retain earlier images, configuration, provider deployments, and evidence.
  Expired rollback targets or missing evidence require operator intervention.
- Build 2 uses the approved public GitHub source/public GHCR route. Configure and
  verify environment protection before deployment. Build 1 historical receipts
  remain unsigned and cannot authorize Build 2 promotion.
- LaunchDarkly may serve cached values after disconnecting. Readiness and SDK
  initialization do not prove current flag delivery; failed or stale observations hold.
- Internal observation covers only `keyboard` and `compact`. The challenge query
  `workspace` enters treatment measurement at 5%; passing internal checks makes no
  claim about its ranked latency. Full-population windows require every query and
  variation group, even when the aggregate latency passes.
- There is no runtime integration with ThreadLoop, GAAP, or `workshop-platform`.

## Plans and requirements

- [Build 1 plan](.plan/build-01-hosted-baseline-recovery.md)
- [Build sequence](.plan/README.md) — each build has a separate plan and acceptance boundary
- [Approved tutorial brief](docs/tutorial-brief.md)
- [Platform decisions](docs/platform-plan.md)
- [Operator runbook](docs/runbook.md)
- [Repository instructions](AGENTS.md)
