# Controlled Release Lab

Controlled Release Lab serves a read-only product catalog and records image,
deployment, and live-request evidence for a Railway deployment or rollback.
It is the runnable companion being built for **From AI-Generated Code to a
Controlled Release**.

The application returns search results at `/api/search`, readiness at `/readyz`,
and embedded source identity at `/version`. Operator commands write raw
observations and checksummed records under `work/attempts/`. Those records let
an operator investigate failures and verify deployment or application recovery.

This is for engineers practicing delivery with a small hosted demo. The catalog
and traffic are synthetic. Build 1's hosted baseline and application recovery
were exercised on Railway; see the [rehearsal and evidence](docs/hosted-rehearsal.md)
and [live catalog](https://catalog-live.up.railway.app). Attestation enforcement, LaunchDarkly
exposure, the seeded regression, and completed feature release belong to Builds
2–4. Local checks alone do not complete the release exercise.

## Run locally

Install Node 24.20.0 (the version in `.nvmrc`). Docker is needed only for container
verification. From a checkout:

```bash
npm ci --ignore-scripts
npm run dev
```

Open [localhost:3000](http://localhost:3000). Search for `keyboard`; the compact
and full-size keyboards appear. Stop with Ctrl+C. No cloud credentials are needed.
Local builds report `sourceSha: "local"`.

```bash
npm run typecheck
npm test
npm run build
npm start
```

`build` writes compiled output and metadata to `dist/`; `start` serves it.
`npm run verify` runs typing, tests, compilation, and the Docker smoke test.

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
`RAILWAY_PROJECT_TOKEN`. Keep that credential in the operator's secret store,
outside the application and coding-agent environment. Deployment and rollback
preview by default; `--apply` performs the operation. Live application also
requires `--change-reference` (a change identifier or review URL) for the audit
record. The reference does not replace release authorization.

Observations preserve the requested sample count by waiting for concurrency
capacity. `--duration-seconds` is the minimum window; `--max-duration-seconds`
sets the total traffic deadline (default 300 seconds). The record includes the
actual elapsed time, and exhausted budgets block verification.

For machine-readable stdout without npm's script banner:

```bash
node --import tsx tools/lab.ts doctor --target staging
```

| Output | Meaning |
|---|---|
| `work/attempts/<uuid>/*-*.json` | Preserved intent, provider observations, and requests |
| `work/attempts/<uuid>/record.json` and `.sha256` | Final record and checksum |
| `work/locks/*.lock` | Environment ownership retained after an uncertain mutation |
| GitHub `build-record-*` artifact | Published digest and declared source/build identity |
| GitHub `lab-state-*` artifact | Preserved operator evidence and unresolved locks |

Exit `0` means verified or preview, `1` invalid/failed, and `2` blocked/unknown.
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
  operations. This build implements the application recovery path.
- Retain earlier images, configuration, provider deployments, and evidence.
  Expired rollback targets or missing evidence require operator intervention.
- GHCR images are public for the authorized rehearsal. The source repo remains
  private. Protected GitHub deployment access still requires supported environment
  approval settings; the rehearsal used scoped local operator credentials.
- There is no runtime integration with ThreadLoop, GAAP, or `workshop-platform`.

## Plans and requirements

- [Build 1 plan](.plan/build-01-hosted-baseline-recovery.md)
- [Build sequence](.plan/README.md) — Builds 2–5 will be planned separately here
- [Approved tutorial brief](docs/tutorial-brief.md)
- [Platform decisions](docs/platform-plan.md)
- [Operator runbook](docs/runbook.md)
- [Repository instructions](AGENTS.md)
