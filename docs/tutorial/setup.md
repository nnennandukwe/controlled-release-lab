# Set up the controlled release exercise

This guide prepares the existing dedicated Railway lab for the
[main tutorial](README.md). The tutorial begins with healthy catalog search
already running. Participants in the [90-minute workshop](../workshop/README.md)
need the repository and evidence worksheet; only the designated release operator
needs permission to dispatch and approve hosted operations.

**Acceptance status:** the Build 5 instructions require an independent hosted
rehearsal. Read the [acceptance record](../build-05-closeout.md) before describing
this package as rehearsed. Build 4's observations are historical evidence.

## 1. Prepare a fresh operator checkout

Use macOS arm64 or Linux x64, Node **24.20.0**, Git, and an authenticated GitHub CLI.
Docker must be running for container verification. Allow GitHub, Sigstore, and
public-registry network access. The setup command installs the repository-pinned
GitHub verifier into ignored `artifacts/bin/`; it does not replace your system CLI.

```bash
git clone https://github.com/nnennandukwe/controlled-release-lab.git
cd controlled-release-lab
node --version
npm ci --ignore-scripts
npm run setup:verifier
npm run lab -- --help
npm run verify
```

Before continuing, `node --version` must say `v24.20.0`. With nvm installed,
`nvm install` and `nvm use` read `.nvmrc`. Stop and resolve setup errors rather
than continuing on another runtime. Successful commands exit 0; `verify` covers
typing, tests, compilation, and container behavior. Docker or network failure
means that verification did not complete, not that the hosted lab failed.

For rehearsal of an unmerged documentation PR, fetch and check out its exact
reviewed documentation commit in this fresh checkout before following the guide.
Record that SHA. Hosted operations still dispatch the reviewed operator workflow
on `main`; never run an older application's operator code against the lab.

A fresh checkout has no `work/`, downloaded proofs, `config/lab.json`, or cached
verifier. Do not copy the author's working directory. Download evidence using its
exact run/attempt. GitHub workflows restore their existing durable state; a clean
checkout does **not** mean empty remote history or permission to clear locks.

## 2. Separate coding, verification, and release access

Authenticate through `gh auth login` and the normal account flow. Local proof
verification uses `GH_TOKEN` without any Railway or LaunchDarkly management key.
If your approved GitHub CLI login is the credential source, this captures the
credential without printing it:

```bash
export GH_TOKEN="$(gh auth token --hostname github.com)"
export GH_REPO=nnennandukwe/controlled-release-lab
```

Do not enable shell tracing or print the token. Unset `GH_TOKEN` when finished.
The coding checkout and participants receive no release credentials. The protected
`staging` and `live` GitHub jobs receive their environment-scoped Railway token;
flag writes additionally receive the scoped LaunchDarkly management token.
The application receives only its server SDK key. GitHub environment approval and
the runtime OIDC/request checks enforce release authority. Solo-owner approval is
not independent multi-person review.

This package reuses existing resources, roles, protected environments, flag identity,
and image publishers. See the [runbook prerequisites](../runbook.md#prerequisites-and-trust-configuration)
for their administrative configuration. Creating an installation or adapting a fork
is outside this replay: repository IDs, targets, configuration fingerprints,
producer trust and flag identity are pinned in policy. Never copy this policy to a
new account and assume it authorizes that account.

Ordinary hosted work uses GitHub Actions, not local `--apply`. Local direct provider
inspection, when separately permitted, uses `--config PATH`, then `LAB_CONFIG_JSON`,
then ignored `config/lab.json`, in that order. `.env.example` is documentation and
is not automatically loaded. Desktop Railway OAuth is not a fallback.

## 3. Check retained inputs before requesting a run

Use the [evidence index](evidence.md#retained-image-selectors) to select the original
E/F/G publications. These are immutable build selectors, not fresh health proof.
Download their complete build records and bundles:

```bash
mkdir -p artifacts/build5/builds
for run in 34398598619 35374672780 35380922988; do
  gh api "repos/$GH_REPO/actions/runs/$run/artifacts" \
    --jq '.artifacts[] | {name,expired,expires_at}'
  gh run download "$run" --name "build-record-$run-1" \
    --dir "artifacts/build5/builds/$run"
done
```

Expected: exactly the named attempt-1 build record is available and `expired` is
false; downloads exit 0. Do not replace missing records with a tag, another attempt,
or an archive directory. The [verification recipe](README.md#2-inspect-the-change-and-authenticate-the-build)
authenticates each image bundle. Provider rollback availability must also be checked
immediately before changing the hosted baseline.

The current workflow downloads evidence by GitHub run/attempt. An owner-managed
archive protects history but is not an alternate workflow input after expiry.
The earliest listed image record expires December 8, 2026. Inventory **all**
selected records and state artifacts; another required artifact may expire sooner.
Stop if any required artifact is unavailable. Restoring executable replay after
expiry needs a separately reviewed approach.

## 4. Obtain a concrete hosted-run authorization

Use the [rehearsal request and traffic ledger](rehearsal.md). It identifies exact
images, targets, preparation, recovery, end state, and a proposed new ceiling of
40,000 search requests. The implementation of these docs is not approval to run it.
Fill the current-state and operator fields after read-only inventory, obtain the
owner's approval of that concrete request, and retain the approval reference.
Each protected workflow still needs its matching environment approval.

No paid resources, permission changes, new image publication, flag recreation, or
resource deletion are needed. The core uses server SDK targeting and explicit
operator decisions, without LaunchDarkly trial-only automation.

## 5. Prepare the E baseline through protected operations

This is hosted work covered by the new authorization, not a local setup command.
Use the [run-selection procedure](README.md#how-to-run-and-record-an-operation)
for every row. Stop on unresolved locks, subject drift, missing evidence, or a
failed window. Never rerun a mutation job to obtain a favorable result.

1. Dispatch protected `doctor` for staging and live. Inspect provider scope,
   configured and serving image, deployment, configuration, and rollback eligibility.
   Inspect the latest durable state and current flag through the resolved requests
   and signed observations. Verify the present G subject against the closeout;
   historical deployment IDs are selectors, not live proof.
2. Select the current compatible G off deployment proof for each target. If the
   Build 4 subject is unchanged, its baseline selectors are staging `35381160025`
   and live `35382661097`, attempt 1. Use these only after verifying image,
   deployment, policy, configuration and flag identity still match. Disable any
   non-off exposure with a fresh protected `disable` request. Keep G's recovery
   image/configuration and provider rollback target available before replacing it.
3. With staging off, dispatch `rehearse-recovery` for **E**. This makes one real
   deployment and deliberately discards its response; read-only reconciliation
   verifies recovery. Record its signed off proof as `E_STAGING_OFF`.
4. Inspect and approve its automatically queued staging internal response-loss
   rehearsal; do not dispatch a duplicate. Its normal-query observation validates
   both rankings for the staging gate. It does not measure ranked `workspace`.
5. Deploy E's exact digest to live, with live still off. The workflow obtains a
   fresh staging proof before asking for live approval. Record its signed schema-3
   live off proof as `E_LIVE_OFF`, the actual E deployment ID, and rollback
   availability. This is the tutorial's retained recovery target.
6. Disable staging using `E_STAGING_OFF`. Both environments now serve E with flags
   off. Download their state/proof artifacts and record zero unresolved locks.

The dispatch shapes are the same ones used for F/G in the tutorial. For example,
step 3 uses:

```bash
: "${CHANGE_REF:?Set the owner-approved rehearsal reference}"
gh workflow run operate.yml --ref main \
  -f operation=rehearse-recovery -f target=staging -f apply=true \
  -f build_run=34398598619 -f build_attempt=1 \
  -f change_reference="$CHANGE_REF"
```

Expected: a new run is queued, not a completed deployment. After protected execution,
retain the signed E proof and the response-loss/reconciliation history. Failed or
uncertain execution follows the [recovery table](README.md#recovery-reference).

Preparation is complete only when provider identity, fresh requests, full workload,
compatible policy/configuration, flags off, and retained native rollback target
agree. Start the main lesson promptly; off evidence used for initial exposure has
a 30-minute freshness limit. Refresh it with protected `observe` when needed,
without redeploying, and charge that window to the ledger.
