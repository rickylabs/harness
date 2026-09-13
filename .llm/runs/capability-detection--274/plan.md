# capability-detection--274 — plan

Stage E artifact for issue 274 (step 4 of E11, 270). **Plan only.** No product code, no package, no
schema file, no configuration file and no copy of the matrix, the capability table or the model
catalogue was written by the session that produced this file. Baseline `e7af112` (origin/main),
branch `docs/274-capability-detection-plan`.

Its input is [`research.md`](research.md), merged today as PR 308, and
[`verification.md`](verification.md), which is that research's measurement receipt. **Nothing in
research is re-derived here.** Where this plan states a fact about the current tree or about a
vendor CLI, it cites the research section or the file and line that establishes it.

Mutation of the world is still forbidden: `doctrine/WORKFLOW.md` Stage G requires `plan-eval.md` to
read `PASS` before any step below is executed. This file exists so that gate is cheap when it opens.

---

## Summary, for a reader on a phone

Ten ordered steps. Two of them touch a package other than `routing`; none creates a package; none
invents an abstraction where a function already ships.

The shape of the work is: **represent facts, call the existing resolver, publish the record.**

1. The resolution is not ours. `resolveWorkloadRoute` (netscript `runtime/routing-policy.ts:190`)
   already returns concrete transport, model and effort, already takes live detection as input, and
   already fails closed on privileged tiers (research R-1). Harness calls it. The CLI view is filed
   as **netscript#2015**; until it lands, step 7 reaches the same exported function through a bounded
   Deno service adapter, which is a mechanism this repository already ships
   (`packages/telemetry/adapters/opencode-usage-probe.ts`). No matrix data crosses the boundary
   either way.
2. Six facts get a representation that cannot omit one, with `unknown` and `withheld` as members of
   the state union rather than as an absent field — the asymmetry `packages/routing/src/probe.ts`
   already enforces for availability, transplanted rather than re-invented.
3. The detection command table is **configuration**, so this is generic detection and not the four
   bespoke provider integrations issue 274 forbids.
4. The published record is `packages/contracts/src/capability-read.ts`, modelled field-for-field on
   `governance-read.ts`, which already ships a versioned read document with coverage, provenance and
   freshness, plus an inventoried fixture directory.

Four of the six acceptance items are substantially satisfied already, in three places the issue does
not name. The table in §"Acceptance map" says which step delivers the rest.

---

## Decisions

**D1 — Harness calls a resolve view. It never reimplements resolution.**
`resolveWorkloadRoute` owns transport precedence (`MODEL_TRANSPORT_PRIORITY`,
`delegation-matrix.ts:249-257`), the deep-research transport restriction
(`delegation-matrix.ts:316-323`), evaluator family opposition (`routing-policy.ts:153-154`),
privileged-tier authority (`delegation-matrix.ts:286-297`) and the `provider_default` coercion
(`routing-policy.ts:137-139`). *Rejected:* exporting the 41 `capability(...)` rows. That moves five
rules across the repository boundary, which is the drift `ARCHITECTURE.md` §11 forbids and which
netscript#2015's own first comment retracts in those words.

**D2 — The interim is a bounded service adapter against an operator-configured checkout, not a
copy and not a wait.** Precedent, shipping: `packages/telemetry/adapters/opencode-usage-probe.ts`
is a Deno service entry deliberately outside `src/` and outside the Node TypeScript project, and
`usageCommand` (`packages/telemetry/src/cli.ts:682-694`) launches it with an in-memory import map
pointing into `${checkout}/.llm/tools/agentic/`, under `--no-config --no-lock --no-prompt
--no-remote --no-code-cache` and a single narrow permission. `packages/telemetry/README.md:456-466`
states the status this establishes: *"an operational service dependency, never a package or build
dependency"* — which is ratified decision 2 exactly. *Rejected:* blocking step 4 on netscript#2015
(detection wiring is the half harness owns and it does not need the view to be written), and
transcribing the matrix (forbidden by §11 and by 275's fourth acceptance item).

**D3 — The fact record is total over a fixed fact set, and `unknown` / `withheld` are states, not
missing fields.** `probe.ts` already refuses the convention: `AVAILABILITIES` carries `unknown`
(`probe.ts:87`), `SOURCES` carries `none` (`probe.ts:108`), and absence of evidence *settles* to
`unknown`/`none` rather than leaving a hole (`probe.ts:316-317`). *Rejected:* optional fields per
fact. An absent optional field and a deliberate `unknown` are the same bytes, and telling them apart
by convention is the failure this issue's checkbox 2 exists to prevent.

**D4 — Which command detects which fact is document data, never compiled.** #270's boundary sentence
puts *capability detection* in compiled architecture and *accounts, CLI version requirements and
provider precedence* in configuration. A per-vendor detector module would be four bespoke provider
integrations under another name. *Rejected:* a `claude.ts` / `codex.ts` / `agy.ts` / `opencode.ts`
quartet.

**D5 — Extract the bounded reader; do not write a second one.** `runUsageProbe`
(`packages/telemetry/src/cli.ts:713-738`) already spawns with `shell: false`, an argv array, an
explicit child environment, stderr ignored, a byte cap, a timeout `SIGKILL`, close-based resolution
and fixed `SourceError` codes. It is JSON-only and collapses non-zero exit into `spawn-failed`,
which a detector cannot accept: a missing binary and a logged-out account would be one code, and
those are two separate cases of checkbox 6. Step 1 extracts the body and keeps `runUsageProbe`'s
observable behaviour byte-identical. *Rejected:* a second subprocess reader inside `routing` — the
research names this explicitly as the thing not to do.

**D6 — The detector allowlists fields at the parse site.** `claude auth status` returns `email`,
`orgId` and `orgName` beside the three fields a receipt wants (research R-2, measured). A denylist
publishes the identifier the vendor adds in the next point release. The double scrub in
`admit.ts:419-425,451-455` is a backstop and not a substitute for reading only four keys.
*Rejected:* scrub-after-capture.

**D7 — No new executable is added in this step.** Harness stays headless; the surface is library
functions plus the published read document. A new `bin` would add a `scripts/cli-reference.mjs`
golden (build stage 10) and would collide with the argv guard at
`packages/telemetry/src/cli.ts:654-655`, which runs telemetry's `main()` whenever the invoked script
ends in `cli.js`. *Rejected:* a `dsh-routing detect` command in this step; it is a later, separate
item if the backend asks for one.

**D8 — No harness-side workaround for the `agy` model id.** The single declared `agy` capability
`gemini-3.8-flash` is absent from the live catalogue, whose ids are effort-suffixed (research R-3,
measured, all 8 `agy` primaries affected). The truthful record is `modelPresent: "no"` with the
catalogue's `capturedAt`. Composing `${model}-${effort}` in harness is the fork §11 forbids.
*Rejected:* a local id-composition rule. Owner visibility for this is F6.

---

## The six facts, and where `unknown` lives in the type

Issue 274 checkbox 2 names five; the owner's comment on 274 of 2026-09-08 adds the sixth and says
why: *"reported native capacity refusal and physical unsupported-effort rejection are distinct
failure reasons… preserve those observations separately from login, entitlement and configured route
presence."* Research R-2 measured the same thing independently — `kimi-k3` serves `low`, `high` and
`max` but not `medium`, so effort capability is not a scalar and not monotonic.

| Fact | What establishes it today | Weakest transport |
|---|---|---|
| `installed` | a version command exiting 0, or a `spawn-failed`/127 exit meaning absent | none — but *detector-dependent*: netscript reports `agy` missing from a hardcoded foreign `$HOME` (research C-2) |
| `authenticated` | an auth-status command's exit code and allowlisted JSON | the four opencode-hosted transports: `opencode auth list` is box-drawn, so `unknown` until U-5 |
| `entitled` | `subscriptionType` on `claude`; account *class* prose on `codex`; catalogue-by-consequence elsewhere | `agy` — no entitlement surface at all |
| `quota` | `agentic:expense-watch` for `opencode_go` (live, free, credential-free) | `claude`, `codex`, `agy`, `github_copilot` — no free surface |
| `modelPresent` | `opencode models`, `agy models`, `agentic:copilot-preflight` | `claude`, `codex` — no catalogue command exists at all |
| `effortSupported` | `agentic:copilot-preflight`'s `variantPresent` with its `capturedAt` | everything except `github_copilot`; generalising it is netscript request N-6 |

The representation, in one new pure module (step 2):

- `DETECTION_FACTS` is a fixed tuple of the six names; the record is
  `Readonly<Record<DetectionFact, FactVerdict>>`, so **no fact can be omitted** — `noUncheckedIndexedAccess`
  is already on in `tsconfig.base.json` and a missing key is a type error, not a runtime surprise.
- `FACT_STATES = ["yes", "no", "unknown", "withheld"]`. `unknown` means nothing established it.
  `withheld` means it *was* established and may not be published — the encoding research R-8
  conclusion 2 says harness needs and netscript does not have, because `null` in
  `LaunchIdentityEvidence` (`launch-route-identity.ts:11-21`) means both.
- every `FactVerdict` carries `source: Source` and `observedAt: string | null` **reused from
  `probe.ts:108,191-199`**, not redeclared, plus `problems: readonly ProbeProblem[]`.
- the record embeds the existing `Verdict` for the (transport, model) pair, so `mayLaunch` calls
  `mayDispatch` (`probe.ts:413-415`) rather than restating its rule, and adds the fact gates.
- **the configured-cannot-assert rule is transplanted, not re-invented.** `availabilityOf` refuses a
  constant that claims `available` (`probe.ts:318-325`, refusal `constant-claims-available`). Its
  analogue: a configured `yes` for `quota`, `modelPresent` or `effortSupported` is downgraded to
  `unknown` with refusal `configured-claims-supported`. A configured `no` is honoured. F2 covers the
  two facts where a configured `yes` is legitimate.

---

## Ordered steps

Every step names the file it changes and the existing thing it calls. No step is "design an
abstraction for X".

### Step 1 — Give the existing bounded reader an exit code and a text body

**File:** `packages/telemetry/src/cli.ts`. **Also:** `packages/telemetry/src/index.ts:219`,
`packages/telemetry/src/cli.test.ts`.

Extract the body of `runUsageProbe` (`:713-738`) into
`runBoundedCommand(command: UsageCommand): Promise<{ readonly exitCode: number; readonly stdout: string }>`
with the same `spawn` options, the same byte cap, the same timeout `SIGKILL` and the same
`SourceError` codes for `timeout` and `oversize`. `runUsageProbe` becomes `JSON.parse` over its
stdout and keeps its current contract exactly: non-zero exit still rejects with `spawn-failed`,
unparseable output still rejects with `non-json`. Add `safeLabel` and `SourceError` to the
`./source.js` re-export at `index.ts:219`, which today exports only `parseSource`.

Why the exit code: `codex login status` signals logged-out by exit status and prints prose
(research R-2), `claude --version` prints text, and today both land on the one code that also means
"binary absent". Checkbox 6 requires those to be different tests.

Tests extend the real-child negative cases already at `packages/telemetry/src/cli.test.ts` around
`:956` (oversize, malformed JSON, non-zero exit, timeout, missing binary) and assert `runUsageProbe`
is unchanged against them.

### Step 2 — The pure fact module

**File:** new `packages/routing/src/capability.ts`, beside `probe.ts`, with the same no-I/O contract
stated in `probe.ts:16-23`.

Imports `Source`, `Verdict`, `ProbeProblem`, `describeProbeProblem`, `mayDispatch`, `isFresh` and
`DEFAULT_FRESHNESS` from `./probe.js`. Adds `DETECTION_FACTS`, `FACT_STATES`, `FactVerdict`,
`CapabilityRecord`, `CAPABILITY_REFUSALS` + `describeCapabilityRefusal` (same shape as
`PROBE_REFUSALS` / `describeProbeRefusal` at `probe.ts:112-144`), `factsOf(evidence, at)` and
`mayLaunch(record)`. `factsOf` settles every unestablished fact to `unknown`/`none`, the way
`availabilityOf` settles at `probe.ts:316-317`. Freshness is `isFresh` over the record's
`capturedAt`; no second duration parser.

Also here, because it is pure: `compareClientVersion(observed, constraint)`, the comparator research
R-7 item 3 records as absent. It reads constraint values from the document and contains no version
literal — `packages/routing/src/schema.test.ts:74` already forbids version literals in runtime
source.

**Gate hazard to respect while writing this file:** `scripts/check-compiled-policy.mjs` fails any
non-test assignment of a string literal to `model`, `effort`, `tier`, `lane`, `family`, `profile`,
`preset` or `harness`. That check is build **stage 6**, one stage before the compile, so tripping it
means the compile never ran. Fields named `model` and `effort` on `CapabilityRecord` must be
assigned from inputs only; no `effort: ""` default, no placeholder model string.

### Step 3 — Export it

**File:** `packages/routing/src/index.ts`. Add a `capability.js` export block mirroring the existing
`probe.js` block at `:48-70` — values and types listed explicitly, matching the package's convention.

### Step 4 — The detector that executes

**Files:** `packages/routing/package.json` (add `"@rickylabs/telemetry": "workspace:*"`),
`packages/routing/tsconfig.json` (add the matching `{ "path": "../telemetry" }` reference), new
`packages/routing/src/detect.ts`.

Both manifest and tsconfig, or **build stage 1** fails: `scripts/check-project-graph.mjs` asserts the
two sets are equal in both directions, and its header records that a missing reference builds today
and breaks later. Stage 1 failing means the compile at stage 7 never ran.

`detect.ts` contains:

- `detectionCommands(spec)` — builds `UsageCommand`s from document data, modelled on `usageCommand`
  (`packages/telemetry/src/cli.ts:682-694`): absolute bin path, argv array, explicit minimal child
  env, `timeoutMs`, `maxBytes`. Field validation reuses `safeLabel` and the env-name rules already
  enforced by `packages/telemetry/src/source.ts:48-51` and documented at
  `packages/telemetry/README.md:450-455` — names only, never values, and `HOME`, `PATH`, `DENO_*`,
  `NODE_*`, `LD_*`, `DYLD_*` rejected.
- `runDetection(...)` — calls step 1's `runBoundedCommand`, then maps: `spawn-failed` or exit 127 →
  `installed: "no"`; non-zero from the auth slot → `authenticated: "no"`; `timeout` → `unknown` with
  refusal `probe-timeout` (this is the `codex doctor` row — measured to exceed 90s, research R-2);
  exit 0 with no catalogue → `modelPresent: "unknown"`, never `"no"`.
- `readAuthFields(json)` — **the allowlist.** Reads exactly `loggedIn`, `authMethod`, `apiProvider`,
  `subscriptionType`, each through `safeLabel`; nothing else is read, so `email`, `orgId` and
  `orgName` cannot reach a record. An allowlisted value that fails `safeLabel` becomes `withheld`
  with refusal `unsafe-field`, never the raw value.
- `resolveCommand(...)` — step 7's half of this file.

No vendor command string is compiled in (D4). The `opencode models` and
`agentic:copilot-preflight` readers are the same `runBoundedCommand` call with different
document-supplied argv; preflight is chosen for Copilot because it is the one existing surface that
separates `present` from `variantPresent` and stamps `capturedAt`
(netscript `opencode/opencode-preflight.ts:71-78`).

### Step 5 — The configuration axes, and configuration operations

**Files:** `packages/routing/src/schema.ts`, `packages/routing/config/routing.v1.json`, new
`packages/routing/src/operations.ts`.

In `schema.ts`, add as **optional root keys** under the unchanged `SCHEMA_VERSION = 1`:

- `provenance.capturedAt` — the freshness field research R-7 item 4 records as missing; today the
  packaged document smuggles its capture date into the `description` prose
  (`config/routing.v1.json:5`).
- `accounts` — keyed by id; each entry names `provider`, a `label` bounded by the same
  `[A-Za-z0-9][A-Za-z0-9._:-]*` rule `safeLabel` enforces, `credentialEnv` as a **name**, and an
  optional declared `plan`. This is the account identity research R-7 item 3 records as absent:
  today `subscription` is a two-value enum on a chain step (`schema.ts:59`) with no account id.
- `bindings` — lane or step → account id. A dangling id is the existing `dangling-reference` refusal;
  two accounts for one provider on one lane is an `invariant` refusal raised by `checkPolicy`
  (`resolve.ts`, already the place policy invariants are raised). This is what gives checkbox 6's
  "conflicting bindings" case something real to fail on.
- `clientVersions` — per transport, `{ min?, max?, pinned? }`, consumed by step 2's comparator. The
  measured skew this expresses: `opencode 1.18.30` against netscript's pin of `1.17.20`
  (`config/versions.ts:69`).
- `detection` — the command table of D4: per transport, per fact, `{ bin, args, timeoutMs, maxBytes,
  envNames }`.

**Every new key must also be added to `STRUCTURAL_FIELDS` (`schema.ts:124-130)`** or the strict
validator refuses the document it just gained the ability to describe, with `unknown-key`.

`operations.ts` adds the operations research R-7 item 4 records as absent:
`compareRoutingDocuments(currentText, candidateText)` calls `parseRoutingDocument`
(`load.ts:66`) twice and reports both digests and the structural differences. **No writer and no
merge:** #270 requires wholesale replacement, and a writer is how a deep merge gets added later.

### Step 6 — The published, versioned detection contract and its fixtures

**Files:** new `packages/contracts/src/capability-read.ts`, `packages/contracts/src/index.ts`, new
`packages/contracts/test-fixtures/capability-read/*.json`, `scripts/check-snapshots.mjs`.

`capability-read.ts` is modelled on `packages/contracts/src/governance-read.ts`, which already ships
exactly this artifact class: a `GOVERNANCE_READ_SCHEMA = 1` constant, per-source coverage unions
carrying `observedAt`, `validUntil`, `freshness` and `provenance`, fixed failure-reason tuples, and a
`read…()` validator. The new file adds `CAPABILITY_READ_SCHEMA = 1`,
`readCapabilityDetection(document)`, and the `requested` / `observed` pair of step 8.

Fixtures, one per checkbox-6 scenario. **Two gate facts, both concrete:**

- `scripts/check-snapshots.mjs` refuses any tracked `.json` containing an `observedAt` key
  (it is in `TIME_SLIDING_KEYS`) and refuses any data file whose *name* matches `allowance|quota`.
  So the quota fixture is named `headroom-unknown.json`, not `quota-*.json`.
- the eight `governance-read` and `repository-run-observation` fixtures are permitted by an exact
  path-and-SHA-256 inventory at `scripts/check-snapshots.mjs:84-92`. Each new fixture must be added
  there with its digest, and **any later byte change requires updating the digest**. This is build
  **stage 5**; failing it means the compile at stage 7 never ran.

Publication is *not* proposed here. `packages/contracts/package.json` is at `0.4.0` in source and
its publication is gated by the separate owner decision 283. The contract lands in source and the
backend consumes it when that decision resolves. F4 covers the machine-readable artifact question.

### Step 7 — Call the resolver: the interim view and its retirement

**Files:** new `packages/routing/adapters/delegation-resolve-probe.ts`, `packages/routing/src/detect.ts`.

The adapter is a Deno service entry, deliberately outside `src/` and outside the Node TypeScript
project, carrying the same two-line header as
`packages/telemetry/adapters/opencode-usage-probe.ts:1-3`. It imports one static alias,
`harness:routing-policy` → `${checkout}/.llm/tools/agentic/runtime/routing-policy.ts`, calls
`resolveWorkloadRoute` and prints `ResolvedDelegationRoute` as JSON **plus the echoed `tier` and
`role`** (step 8). `resolveCommand` in `detect.ts` builds the argv the way `usageCommand` does:
`--no-config --no-lock --no-prompt --no-remote --no-code-cache`, an in-memory import map, and
`--allow-read=<checkout>` only — no net, no env, no write, no subprocess.

What it passes in, all of them the function's own parameters:

- `--unavailable-transport` / `--unavailable-model`, computed from step 2's records where `mayLaunch`
  is false. This is the wiring that makes detection *matter*: `RouteAvailability`
  (`routing-policy.ts:80-83`) is consumed at `routing-policy.ts:149-162`.
- the generator model for evaluator family opposition, required for the three evaluation roles and
  already enforced at `routing-policy.ts:205-208`.
- `--authorizer` and `--rationale` passed through untouched, so privileged tiers stay fail-closed
  upstream (`delegation-matrix.ts:286-297`). Harness adds no authorization of its own and supplies
  no default.

Failure behaviour: a missing or incompatible checkout **fails unread**. There is no fallback to a
local table, because a local table is the thing that must not exist.

Provenance: the netscript source identity is recorded in the record, the way `verification.md`
records `155dbbe90` for the research.

**Retirement.** When netscript#2015 lands, `resolveCommand`'s argv points at the official resolve
view and `adapters/delegation-resolve-probe.ts` is deleted. One file removed, one argv changed, no
consumer edit — the availability inputs and the output shape are `RouteAvailability` and
`ResolvedDelegationRoute` in both cases, because the adapter calls the same exported function the
view will call.

### Step 8 — The receipt gaps: role, tier, `withheld`

**Files:** `packages/contracts/src/capability-read.ts`, `packages/routing/adapters/delegation-resolve-probe.ts`.

`LaunchIdentityEvidence` (`launch-route-identity.ts:23-28`) is I1's receipt minus role and tier, and
research R-8 establishes that those two are the only fields of I1's five with no home in the
resolution object — they are present on the *request* (`routing-policy.ts:86-87`) and absent from
`ResolvedDelegationRoute`. The fix is to echo the request beside the result (step 7's output), not a
new contract.

`withheld` gets the encoding netscript's `null` cannot express, as a member of `FACT_STATES`
(step 2). The allowlist reasoning is D6 and it is the reason this state is load-bearing rather than
decorative: the same call that returns `subscriptionType` returns three account identifiers.

The rendered human form is **not** invented here. `.llm/runs/architecture-v1--smoke/receipt.md` on
`orch/divybot-304` already states the three-way rule in its own header — a value the session cannot
know is `unknown`, a value it could only state by exposing a host, path, session or credential is
`withheld`. That file is the model.

Consequence recorded, not smoothed: a receipt saying `matched` for `claude` or `codex` today would
be false, because no catalogue command observes the model. `modelPresent` is `unknown`, `mayLaunch`
is false, and `enforceLaunchIdentity` (`launch-route-identity.ts:85-93`) already blocks `pending` by
default. Harness renders that as `unknown` and does not call the run verified.

### Step 9 — Tests: the six cases of checkbox 6

**Files:** new `packages/routing/src/capability.test.ts`, new `packages/routing/src/detect.test.ts`,
`packages/routing/src/load.test.ts` (bindings cases). Run by the package's own
`test` script — `tsc -b && node --test "dist/**/*.test.js"`.

| Scenario | Test | Pattern it follows |
|---|---|---|
| **missing CLI** — absent today | real child, a bin path that does not exist → `installed: "no"`, and `authenticated` stays `unknown` (no inference in either direction) | the missing-binary real-child case at `packages/telemetry/src/cli.test.ts` ~`:956` |
| **unsupported introspection** — partial today | a fake bin exiting 0 with no catalogue → `modelPresent: "unknown"`, `source: "none"`, `mayLaunch === false`. This is the `claude`/`codex` row | `probe.test.ts:243,261,209,198` cover a probe that established nothing |
| **logged out** — absent today | a fake bin exiting non-zero in the auth slot → `authenticated: "no"`; `entitled` and `quota` stay `unknown` | netscript's `auth_required` is the adjacent form, cited not reproduced |
| **unknown entitlement** — partial today | auth JSON with `loggedIn: true` and no `subscriptionType` → `entitled: "unknown"`; a second case where the value fails `safeLabel` → `withheld`, raw value absent from the record | `resolve.test.ts:171` exercises `outside_plan`, which is a gate and not an unknown |
| **configured override** | configured `yes` for `quota`/`modelPresent`/`effortSupported` → `unknown` + `configured-claims-supported`; configured `no` honoured | `probe.test.ts:269,279,287,388` — a constant may refuse and may never permit |
| **conflicting / invalid bindings** | two accounts for one provider on one lane → `invariant`; an account id no `accounts` entry defines → `dangling-reference` | `load.test.ts:213,258,207,339`, `family.test.ts:77,135` |

Two more, both from measurements rather than from the checkbox list:

- **non-monotonic effort.** `effortSupported` `no` at `medium` while `yes` at `high` for one model
  must survive; any ordering or ladder assumption is a bug (research R-2 measured `kimi-k3`).
- **credential canary.** No allowlisted-off field, env var name, account id or raw command output
  reaches a published document. The existing assertion to copy is
  `packages/telemetry/src/cli.test.ts:995`.

**No test invokes a real vendor CLI.** Fake bins only, so CI spends nothing and changes no account.

### Step 10 — Documentation, then the gates, stage by stage

**Files:** `packages/routing/README.md` (a new section after "Availability expires, and everything
else here does not", documenting the six facts, the configured-cannot-assert rule and `capturedAt`),
`packages/README.md` (the `routing` row gains E11 step 4), `packages/contracts/README.md` (the new
read document, beside governance-read).

Then run the stages **individually** and report them individually. `pnpm run build` is a twelve-stage
`&&` chain and the compile is stage 7:

    1 check:graph   2 check:lifecycle   3 check:links   4 check:forms   5 check:snapshots
    6 check:compiled-policy   7 pnpm -r run build   ← the compile
    8 check:publish   9 check:label-registry   10 check:docs   11 check:skill   12 check:tutorial

`pnpm run typecheck` has the same shape with the compile at stage 3 of 3. Steps 4, 5, 6 and 2 each
have a *named* way to fail before stage 7 — the project graph, `STRUCTURAL_FIELDS`, the fixture
digest inventory and the compiled-policy scan respectively. **A failure at any of stages 1–6 says
nothing about whether the code compiles**, and the implementation report must say which stage failed
and whether stage 7 executed at all. `pnpm -r run test` and `pnpm run check:installed` are separate
and must be named separately.

---

## Acceptance map — issue 274's six items

| # | Item | Status | Where |
|---|---|---|---|
| 1 | detect CLIs and versions; safe auth metadata else explicit unknown, accept configuration | **half ships** | the unknown-and-fail-closed half is `probe.ts:87-88,108-109,316-325,413-415`, already tested; the bounded credential-safe reader is `packages/telemetry/src/cli.ts:713-738` with credential binding by name at `source.ts:31-36`. **Steps 1, 2, 4, 5** add the execution, the version comparator and the command table |
| 2 | binary, login, entitlement, quota, live availability as different facts | **doctrine ships, representation absent** | the permitted-vs-possible split is `probe.ts:11-14` and `admit.ts:1-4`; `reachable` and `completed` are already separate (`probe.ts:171-174`). `installed`/`authenticated`/`entitled`/`quota` have **no representation** in `packages/routing` — verified again over the 14 tracked routing files, zero hits. **Step 2** delivers it, **step 9** proves no shortcut |
| 3 | account bindings, per-model/family rules, provider precedence, client-version constraints; precedence through data | **precedence fully ships; two axes absent** | per-model family binding `schema.ts:106`; `LaneConstraint` `schema.ts:75-81` enforced at `resolve.ts:298-304`; ordered chain precedence consumed as data by `resolveFallback` `resolve.ts:163-189`. Global transport precedence stays netscript's and arrives *applied* via **step 7**, never copied. **Step 5** adds `accounts`, `bindings` and `clientVersions` |
| 4 | validated JSON and configuration operations, provenance/freshness, credential-free diagnostics | **mostly ships; two narrow gaps** | whole-document strict validation `schema.ts:181,188-190`; hostile-input hardening `schema.ts:136-171`, `load.ts:24-64`; byte-digest provenance never accepted from the document `load.ts:17-20,85`; credential gate first and twice-scrubbed diagnostics `admit.ts:208-229,419-425,451-455`; sixteen-code `SourceRefusal` `source.ts:37-41`. **Step 5** adds `capturedAt` and `compareRoutingDocuments` |
| 5 | versioned configuration and detection contract, fixtures for the backend's UI and generated OpenAPI | **configuration half ships; detection half absent** | `SCHEMA_VERSION = 1` `schema.ts:7` with a dedicated refusal carrying `seen`/`supported` `:188-190`; one fixture proven resolvable from an extracted tarball `load.test.ts:102-117`. **Step 6** adds the detection contract and its fixtures, on the `governance-read.ts` pattern. F4 owns the machine-readable-artifact question |
| 6 | tests: missing CLI, unsupported introspection, logged out, unknown entitlement, configured override, conflicting bindings | **two of six covered, two partial, two absent** | covered: conflicting bindings (`load.test.ts:213,258`, `family.test.ts:77,135`, `admit.test.ts:310-311`), configured override (`probe.test.ts:269,279,287,388`). **Step 9** delivers the other four |

---

## The netscript dependency, and what harness does without it

**Depended on:** netscript#2015 — a resolve view on
`runtime/cli/delegation-matrix-table.ts` that calls `resolveWorkloadRoute` and emits
`ResolvedDelegationRoute` unchanged. Filed, open, and its first comment already retracts the
capability-table framing in favour of this one.

**Interim:** step 7's bounded Deno service adapter, which calls **the same exported function** the
view will call. Nothing is forked: no capability row, no precedence list, no effort coercion and no
authority rule is reimplemented or copied into this repository. `ARCHITECTURE.md` §11 ("move rather
than fork — one source of truth, or it drifts inside a month") and 275's fourth acceptance item are
both satisfied by construction, because the resolution is computed by netscript's code in a
netscript checkout on every call.

**Also filed or to file, each with a located root cause in research R-5, none of them blocking:**

| Request | What | Consequence today |
|---|---|---|
| N-2 | `wsl-foundation.ts:43` hardcodes `/home/codex/.local/bin/agy`; `doctor()` computes the right path at `:257` and uses it only as a label | a present, working, authenticated CLI is reported `missing`, and `agy` carries 8 of 38 primaries |
| N-3 | `opencode` and its four providers are absent from `OBSERVED_FOUNDATION_COMPONENTS` (`contract.ts:39-44`) and `COMMAND_SPECS` (`wsl-foundation.ts:30-47`) | the doctor says nothing about the transport carrying 19 of 38 primaries |
| N-4 | the one declared `agy` capability id is absent from the live catalogue | 8 resolutions complete and name a model the transport does not have — F6 |
| N-5 | `usage_unproven` is eight causes and one error string names the wrong one (`provider-usage.ts:150`) | checkbox 4 failing as a *lie* rather than a leak |
| N-6 | `preflightCopilotCatalog`'s provider guard is the only Copilot-specific part | the one surface that separates model presence from effort capability covers one of seven transports |

Harness ships no workaround for any of them (D8). Where a fact cannot be established, the record
says `unknown` and `mayLaunch` returns false — which is `probe.ts`'s existing discipline, not a new
one.

---

## Owner forks

**F1 — Do the new configuration keys land under `SCHEMA_VERSION = 1` now, while 272's schema
expansion is owner-gated?**
*Options:* (a) add them now as optional root keys; (b) wait for 272 to merge; (c) put detection in a
second document with its own version.
*Recommendation:* (a). 270 states step 4 "may proceed after step 1 independently of steps 2/3", 271
is shipped, and optional keys cannot invalidate a document 272 later produces.
*Cost if wrong:* one reconciliation of `STRUCTURAL_FIELDS` and one merge conflict in `schema.ts`
when 272 lands. (c) costs a second loader and a second provenance story.

**F2 — May configuration assert a fact, and which?**
*Options:* (a) configuration may say `yes` for `installed` and `entitled` only, never for `quota`,
`modelPresent` or `effortSupported`; (b) configuration may only ever refuse, for all six; (c) any
fact may be configured.
*Recommendation:* (a). A remote host cannot always be probed for a binary, and an entitlement is a
contract rather than an observation — but the record carries `source: "fallback"` so I1 shows which
it was, and `mayLaunch` still requires `source === "probe"` for the three live facts.
*Cost if wrong:* a launch is attempted against an absent binary and fails at spawn — cheap, and it
spends nothing. (b) makes harness unusable on any host it cannot shell into; (c) reintroduces
exactly the "declared facts become live proof" failure the supervisor forbids.

**F3 — One account per provider, or many? (research U-6)**
*Options:* (a) `accounts` admits many, resolution requires exactly one binding per (lane, provider)
and refuses two; (b) one account per provider, structurally.
*Recommendation:* (a). netscript's `environmentWithOpenCodeCredential`
(`lib/provider-credential.ts:109-129`) clears every rival key, so more than one *simultaneously* is
not executable — but two *configured* accounts with one bound per lane is a real operator case, and
`coordinator-discovery.md` records one account serving both seams.
*Cost if wrong:* the schema carries an unused axis. The reverse error is a schema change later.

**F4 — What is the machine-readable artifact for the backend's OpenAPI generator?**
*Options:* (a) inventoried fixtures plus the published `.d.ts` of
`@rickylabs/harness-contracts`; (b) a generated JSON Schema golden file plus a `scripts/check-*`
gate; (c) adopt a schema library — which would be the first runtime dependency in `contracts`, whose
validators are hand-written and zero-dependency.
*Recommendation:* (a) now, (b) only if the backend reports it cannot generate from the types.
Decision 4 puts the adaptation on the backend, and harness stays headless.
*Cost if wrong:* one round trip with the backend owner and a later additive step. (c) is a permanent
dependency decision taken to save a generator.

**F5 — Does `routing` take a dependency on `telemetry` for the bounded reader?**
*Options:* (a) yes, via the existing `./cli` subpath export; (b) move the reader into `subagents`,
which both may depend on; (c) duplicate ~20 lines in `routing`.
*Recommendation:* (a). The edge is one-way and acyclic, and `check:graph` enforces the manifest and
the tsconfig reference together. (c) is the second subprocess reader the research explicitly says
not to write. (b) would make `telemetry` depend on a workspace package for the first time, which its
own header states it deliberately does not.
*Hazard either way:* `packages/telemetry/src/cli.ts:654-655` runs telemetry's `main()` when
`process.argv[1]` ends in `cli.js`, so no future `routing` entry point may be named `cli.js`.
*Cost if wrong:* a later move of one function and two manifest edits.

**F6 — Who composes the `agy` model id? (research N-4)**
*Options:* (a) netscript declares the three effort-suffixed variants; (b) the netscript `agy`
launcher composes `${model}-${effort}` and refuses the two efforts `agy --effort` cannot express;
(c) harness composes it locally.
*Recommendation:* (a) or (b), upstream — never (c). Harness records `modelPresent: "no"` until then.
*Cost if wrong:* the whole `deep_research` role at four tiers plus three documentation cells and one
vision-evaluation cell stay unroutable on `agy`. That is already true today; this plan makes it
visible instead of silent.

---

## Spikes

Each is a load-bearing claim that is not established, with the cheapest thing that would establish
it. None gates a step; each is named where it would change an answer.

- **S1 (research U-1) — does `claude --effort` set `CLAUDE_EFFORT`?** One paid launch with a known
  flag and an environment read-back. Cheapest available step toward invariant I1's effort leg.
  Until then `effortSupported` on `claude` stays `unknown`, and `ARCHITECTURE.md` §5's recorded gap
  is neither confirmed nor amended — §13 routes that through a numbered decision, and an agent may
  not amend the charter.
- **S2 (research U-5) — is there a machine-readable `opencode auth list`?** Blocks
  `authenticated` for four transports. The detector must **not** parse box-drawing characters; if no
  flag exists, this becomes netscript request N-3's ask. Until then those four report
  `authenticated: "unknown"` and lean on the catalogue for `modelPresent`.
- **S3 (research U-2) — does the `muse_spark_1_3` contributor tier refuse `max`?** Costs a paid
  call. Bears on N-7, not on any step here.
- **S4 (research U-4) — why does `codex doctor` exceed 90 seconds?** It disqualifies the one command
  that self-describes as diagnosing codex auth; step 4 maps the timeout to `unknown`, which is
  correct whatever the cause.
- **S5 (research U-3) — does the dispatcher ignore `model:` and `effort:` overrides?** The Orchid
  fork's source is not on this host. Cited, never measured, and not relied on by any step.

---

## Dependency DAG

    271 (shipped) ──> Step 5 (schema axes) ──┬─> Step 4 (detector)
                                             └─> Step 9 (bindings tests)
    Step 1 (reader) ──> Step 4 ──> Step 7 (resolve view + interim)
    Step 2 (facts)  ──> Step 3 (exports)
                    ├─> Step 4
                    ├─> Step 6 (contract) ──> Step 9 (fixtures)
                    └─> Step 8 (receipt)
    Steps 2..9 ──> Step 10 (docs + per-stage gates)

    netscript#2015 ──(replaces the adapter inside Step 7; blocks nothing)
    272, 273 ──(independent by 270's own sequencing; Step 5 must not assume either)
    275 ──(consumes Step 7's resolution evidence; not in scope here)
    283 ──(gates publication of the Step 6 contract, not its source)

---

## Risk register

| # | Risk | Likelihood | Impact | The gate that catches it |
|---|---|---|---|---|
| R1 | netscript#2015 never lands and the adapter becomes permanent | medium | medium | the adapter fails unread without a checkout, and it calls the same exported function — so no copied data accumulates to be un-forked later |
| R2 | a fixture byte change silently invalidates the digest inventory | high | low | `check:snapshots`, build stage 5, fails loudly and names the path |
| R3 | importing `@rickylabs/telemetry/cli` executes telemetry's `main()` | low | high | the argv guard is `cli.ts:654-655`; the rule is in F5 and a test asserts the detector imports cleanly |
| R4 | the allowlist misses a vendor field that is an identifier | low | high | allowlist by construction (D6) plus the canary assertion at `cli.test.ts:995` |
| R5 | step 5 collides with 272's schema expansion | medium | low | F1; the keys are optional and additive |
| R6 | a test or detector spends money or touches an account | low | high | fake bins only in tests; every configured detection command is read-only and free, and no inference command is in the table |
| R7 | a configured fact is read as live proof | medium | high | the transplanted `configured-claims-supported` refusal, plus `mayLaunch` requiring `source === "probe"` for the three live facts |
| R8 | an early build stage fails and the report says "build red" | high | medium | step 10's stage-by-stage rule: name the stage and say whether stage 7 executed |

---

## Non-goals

Stated so an evaluator can check the boundary rather than infer it.

- **No four bespoke provider integrations.** No Anthropic, OpenAI, Google or GitHub API client, no
  vendor SDK, no OAuth flow, no credential-store read, no token refresh. Every detection command is
  a read-only free subcommand of a CLI that is already installed, and *which* command is document
  data (D4).
- **No matrix data in this repository.** No capability table, no model catalogue, no tier/role cell,
  no transport precedence list, no effort vocabulary. Not even as a fixture.
- **No reimplementation of the five resolution rules** listed in D1.
- **No UHP and no E3 work.** Parked by `ARCHITECTURE.md` §10 and decision
  `doctrine/decisions/0004-uhp-park-evidence.md`. Nothing here reads, writes or shapes a UHP
  contract.
- **No extraction of the netscript runtime**, per §11: not on the critical path, and steps 1–2 of
  the build order must not wait on it.
- **No cockpit, backend, UI or OpenAPI generation.** Decision 4 and 274's own wording: harness stays
  headless. Step 6 hands over a contract and fixtures; the backend adapts them.
- **No new executable** (D7), no schema library, no runtime dependency added to `contracts`.
- **No charter amendment.** Research C-3 (three of four CLIs bind effort as a real argument, against
  §5's "one") is evidence for a numbered decision under §13 and is not acted on here.
- **No live provider process, no spend, no account change** in any step, including tests.
- **No committed allowance, quota or session snapshot.** Enforced by `check:snapshots`, and by the
  naming rule in step 6.

---

## Provenance

[owner — deliver `plan.md` for 274; plan only, no product code, branch from origin/main, no
 pseudo-abstraction and every step names its file and the function it calls; received 2026-09-13]
[source: `.llm/runs/capability-detection--274/research.md` §R-1…R-8 and C-1…C-7 at `e7af112`; topic:
 the resolver that already exists, per-transport detection, the parity audit, what ships and what
 does not, and I1's receipt shape; merged as PR 308 and consulted 2026-09-13]
[source: `ARCHITECTURE.md` v1 §5, §7/I1, §9, §10, §11, §13 at `e7af112`; topic: the dispatch
 contract, the receipt invariant, the park, move-rather-than-fork, and the amendment route;
 consulted 2026-09-13]
[source: issues 270 (boundary sentence, completion bar, step-4 independence), 274 (six items and the
 owner comment of 2026-09-08 on capacity refusal versus unsupported effort), 275 (fourth acceptance
 item), 283 (publication decision) and netscript#2015 with its first comment; retrieved 2026-09-13]
[source: `packages/routing/src/{probe,schema,load,admit,resolve,index}.ts`,
 `packages/telemetry/src/{cli,source,index}.ts`, `packages/telemetry/adapters/opencode-usage-probe.ts`,
 `packages/telemetry/README.md:440-470`, `packages/contracts/src/governance-read.ts`,
 `packages/routing/README.md`, `packages/README.md`; topic: the functions this plan calls and the
 conventions it inherits; inspected 2026-09-13]
[source: `package.json` `build`/`typecheck` scripts and `scripts/{check-project-graph,
 check-compiled-policy,check-snapshots,check-links}.mjs`; topic: the twelve-stage chain, the compile
 at stage 7, and the four named ways a step here fails before it; inspected 2026-09-13]
[observed — the absence claims in the acceptance map re-verified over one enumerated input set of 308
 tracked `packages/**/*.ts` files with a passing control; topic: zero references to
 `resolveWorkloadRoute`, `routing-policy` or `ResolvedDelegationRoute`, and zero `capturedAt`,
 `installed`, `authenticated` or `entitled` in the 14 tracked `packages/routing` files; executed
 2026-09-13, recorded in `verification.md`]
