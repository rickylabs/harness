# Published governance read path — #205 / #87 — research

**Summary.** At `8fd096d` the richest governance evidence this repository can produce is telemetry's
`GovernanceView` (envelope + per-source coverage in note strings + item-scoped admission refusals), and
the only published governance shape is `GovernanceState`, reachable solely as a field of
`RemoteSnapshot`. Nothing in the repository produces a `RemoteSnapshot`; the hub is a pure function;
the bridge and governance packages are empty stubs. The published package `@rickylabs/harness-contracts`
0.1.0 / protocol 1 is actually on npm and its source is byte-identical to the tag. A standalone,
strictly decoded, versioned governance read document plus a one-shot producer command is the smallest
path that reaches an installed consumer without inventing board data. Option B (envelope on
`RemoteSnapshot`) cannot be produced today without fabricating `generation`, `complete`, `lifecycle`
and `repo`, which the brief forbids. Details and citations below.

Baseline: branch `fix/205-published-governance`, HEAD `8fd096df76f48a80df8ee94a1ee881cc709cefa0`,
2026-09-07. PR #276 merged 2026-09-07T14:57:01Z as `f12b353f5116bac239d09a6dcb73475750602297`
(`gh pr view 276`). `git diff --stat eef24f9 HEAD -- packages/contracts` is empty: contracts source is
unchanged since the v0.1.0 tag commit.

## 1. Repo leg — what the code does

### 1.1 Published contracts (`packages/contracts`)

- `GovernanceState` is `{generatedAt, regimes, pending, notes}`; every regime is always present and
  an unread regime reports `allow` with a note ([`src/governance.ts:16-26`](../../../../packages/contracts/src/governance.ts),
  `:204-209`). `RegimeStatus` is a closed union on `regime` (`:118-136`). Leaves carry `observedAt: string | null`
  (`SubscriptionAccount:82`, `MeteredSpend:92`, `CapacityReading:108`).
- `RemoteSnapshot` requires `protocol`, `generation`, `generatedAt`, `complete`, `repo`, `lifecycle`,
  `tasks`, `runs`, `anomalies`, `governance: GovernanceState`, `notes`
  ([`src/snapshot.ts:54-70`](../../../../packages/contracts/src/snapshot.ts)). `complete` is documented as
  projection truncation, not source coverage (`:20-26`).
- `PROTOCOL_VERSION = 1` ([`src/events.ts:54`](../../../../packages/contracts/src/events.ts));
  `governance.changed` carries a whole `GovernanceState` (`:93`); `readServerEvent` validates the envelope
  and deliberately not the payload (`:180-225`).
- `DispatchOutcome.accepted: true` means admitted, not launched (`src/routes.ts:86-91`); the refused arm
  carries `reason` as "a short machine-ish reason" and prose `detail` (`:96-113`).
- The hub is pure: "Nothing here opens a socket, reads a clock or allocates an id"
  ([`src/server.ts:14-17`](../../../../packages/contracts/src/server.ts)); `openHub(state)` needs a full
  `RemoteSnapshot` (`:100-104`, `:124-126`); `publish` diffs whole boards (`:189-205`).
- The fold returns `null` from `snapshotOf` when `governance` is null (`src/fold.ts:188-215`); it stores
  `governance.changed` payloads verbatim (`:487-488`).
- Root entry exports for governance are types plus `REGIMES`, `REGIME_STATES`, `KNOWN_APPROVAL_KINDS`,
  `APPROVAL_VERDICTS` ([`src/index.ts:117-134`](../../../../packages/contracts/src/index.ts)). The installed
  0.1.0 tarball has no runtime export whose name contains "governance" (executed 2026-09-07, §4.1).
- README policy: no dependencies (`README.md:18`); "While 0.x, the minor plays the role of the major"
  (`:201`); protocol bump is always a package major (`:190-214`); deprecation path "Add before removing"
  (`:220`), "Never unpublish, never reuse a version" (`:231`); releases are cut by tag only (`:234-266`).
- `scripts/check-publish.mjs` asserts manifest name = `PACKAGE_NAME`, `PROTOCOL_VERSION` = `dsh.protocol`,
  the root entry does not export `openHub` (`:151-157`), required tarball files (`:163-170`) and no test
  artefacts (`:171-174`). `files` is `["dist","src","!**/*.test.*","!**/*.tsbuildinfo"]`
  (`packages/contracts/package.json:41-46`).
- `.github/workflows/release-contracts.yml:84-103`: a tag must be an ancestor of `main` and equal the
  manifest version; `ci.yml:53-63` runs `pnpm install --frozen-lockfile`, `typecheck`, `build`, `test`.

### 1.2 Telemetry producer (`packages/telemetry`, PR #276 source)

- Descriptor validation: `parseSource` requires exactly `usage|spend|capacity|admissions|accountLabel`,
  absolute paths, bounded numbers, safe labels; refuses runtime-control env names
  ([`src/source.ts:87-129`](../../../../packages/telemetry/src/source.ts)). `SourceRefusal` is the closed
  failure vocabulary (`:38-41`). `Leg<T>` is `{ok:true,value,observedAt,validUntil} | {ok:false,code}` (`:131-132`).
- Leg mappers: usage (`src/governance/usage.ts:5-22`, subscription, `binding:false`, reader-stamped);
  spend (`spend.ts:4-15`, `ceilingUsd: null`); capacity (`capacity.ts:7-23`, `max` → `ramTotalBytes: null`);
  admissions (`admissions.ts:25-94`): newest-per-item/regime, duplicate collapse, `admission-conflict`,
  `stale-source`, `log-unreadable`, `no-admissions`; caller provenance replaced by `reader:recorded-admission`
  and private detail withheld (`:63-65`).
- Composition ([`src/governance/compose.ts:15-59`](../../../../packages/telemetry/src/governance/compose.ts)):
  failed or discarded legs become `unreadRegimes` entries with `note: "<leg>: <code>"` (`:26-40`); the only
  structured record of per-leg failure is the note string; `ok` is a separate boolean; the envelope is
  stamped with `completion` and `provenance: "reader:composed"` (`:51-53`); with no successful expiry the
  view is `unavailableGovernance("no successful live sources")` (`:48-50`).
- `ParsedGovernance = {governance: GovernanceView, notes, ok}` ([`src/observations.ts:75-81`](../../../../packages/telemetry/src/observations.ts));
  `UnavailableGovernanceView.state` is `null` (`:63-71`); `parseGovernanceObservation` enforces exactly three
  regimes, leaf timestamps not later than the envelope, admissions `accepted:false` and state `throttle|pause`
  (`:303-369`, `:385-416`). `unavailableReason` is free prose (`:414`).
- CLI ([`src/cli.ts`](../../../../packages/telemetry/src/cli.ts)): `--observations-from` accepts a descriptor
  or `file:` alias (`:473-480`); `status`/`tree` compose live governance (`:565-599`) and publish
  `PublicSnapshot`/`PublicTree` with `governance: PublicGovernance` (`src/public.ts:95-130`, `:223-244`);
  `collectGovernance(source, log, services, now?)` is the injectable seam (`:715-754`); `SourceServices`
  is `{env, clock, usage, fetch, readText}` (`:631-637`); the usage probe is spawned from the configured
  `denoBin` and killed on `timeoutMs` → `SourceError("timeout")` (`:665-690`); `record` appends to the
  observability log (`:342`), whose location is `--home` or `DSH_TELEMETRY_DIR`
  (`src/observability.ts:104-125`, `logPaths:179`).
- Test seams: `main(argv, services)` is exported (`:452`); `cli.test.ts:43-56` captures stdout;
  `fakeServices` (`:745-750`) fakes env, clock, probe, fetch and cgroup reads; the live describe at `:787`
  proves no credential reaches argv and that failures are isolated.
- Telemetry `exports` are `.` and `./cli`; `bin` is `dsh-telemetry` (`packages/telemetry/package.json`).
  Telemetry depends on contracts via `workspace:*`; contracts depends on nothing.

### 1.3 Legacy DTOs that must not become a second authority

- The `--observations` file envelope (`GovernanceObservation`, `src/observations.ts:41-47`) is the display
  slice's fixture handoff (`.llm/runs/governance-display--205/plan.md` D3, line 87). Re-serializing a live
  composition through it drops `ok` and `availability`; the CLI then reports `complete: true` for the file
  read (executed 2026-09-07, §4.2).
- `dsh-app`'s board projection mirrors `PublicGovernance` with a strict zod schema and ships it as a
  dsh-session wire DTO at `stateVersion: 2`
  ([`packages/dsh-app/src/plugins/board-projection.ts:183-186`](../../../../packages/dsh-app/src/plugins/board-projection.ts),
  `:470-490`, `:711`). It is private to the app and is not the published contract.

### 1.4 What does not exist

- No package outside `contracts` imports `openHub`, `/server`, or `RemoteSnapshot`
  (`grep -rn "openHub\|harness-contracts/server\|RemoteSnapshot" packages --include=*.ts -l`, excluding
  contracts: no matches, 2026-09-07).
- `packages/netscript-bridge/src/index.ts` and `packages/governance/src/index.ts` export only `PACKAGE_NAME`.
- No HTTP or socket server exists in the workspace; `docs/concepts/02-the-two-seams.md:48-50` describes
  telemetry's two side-by-side measures and "most recent quota reading per seam", not a transport.

## 2. Document leg

- Issue #205 body (retrieved 2026-09-07): acceptance requires quota/spend/capacity beside progress with
  timestamps/provenance and explicit unknown states, admission reasons not absences, no committed
  time-sliding values, and independent re-evaluation of #87. Display and live-reader slices are ticked;
  live acceptance remains open.
- Issue #205 comment `5575275001` (rickylabs, 2026-09-07T20:17:27Z): the published-boundary gap. Exact
  missing pieces: envelope/coverage/admissions lost by `.state`; unavailable `state: null` unrepresentable
  in `RemoteSnapshot`; partial composition fresh with `ok:false`; failed-leg detail only in notes;
  `complete` is not leg coverage; hub is pure and no bridge exists; recovery #265 separate; "not a new
  research issue or permission to author a downstream shadow contract".
- Issue #87 body: three acceptance bullets (quota per account, spend, capacity beside progress; throttle
  or pause visible as a reason; nothing time-sliding committed).
- Issue #265 body (`status:plan-eval`): reconnect freshness defect; "publish/version compatibility remains
  a separate explicit receipt". No implementation exists in source for it.
- `.llm/runs/contracts-release--v010/context-pack.md:67`: "Issue 265 owns the reconnect freshness defect;
  proposed 0.2.0 remains draft/deferred."
- `.llm/runs/live-governance--205/plan.md` D24 (line 353): normative producer rules this plan inherits
  (completion clock, explicit unavailable, no inferred binding, fixed spend URL, recorded-admission
  envelope, configured cgroup scope, injectable services).
- `supervisor.md` (this run): plan-only; only `research.md`, `plan.md`, `drift.md`, `worklog.md` may be
  written; governance read precedes #265; "types without the producer path do not finish the slice".
- `AGENTS.md:103`: contracts must be a published package, not a workspace import (decision 4).
- `packages/README.md:25`: contracts is the only non-private package.

## 3. External leg

- npm registry, `https://registry.npmjs.org/@rickylabs%2Fharness-contracts` (retrieved 2026-09-07T20:5xZ):
  `dist-tags.latest = 0.1.0`; version `0.1.0` published `2026-09-07T09:50:50.018Z`; `dsh.protocol = 1`;
  exports `.`, `./server`, `./package.json`; 68 files; SLSA provenance attestation present; integrity
  `sha512-5UCtJKDw…` matches the release handoff's locally built tarball integrity
  (`.llm/runs/contracts-release--v010/context-pack.md`). **0.1.0 is published and licensed; it is not
  a draft.**
- `git ls-remote --tags origin`: `refs/tags/harness-contracts-v0.1.0` → `eef24f9…` ("docs: prepare
  contracts v0.1.0 release handoff (#268)"), an ancestor of HEAD.

## 4. Executed checks (this run, 2026-09-07, no product edits)

### 4.1 Gates that run here

| Command | Result |
| --- | --- |
| `pnpm --filter @rickylabs/harness-contracts test` | exit 0, 121 tests pass |
| `pnpm --filter @rickylabs/telemetry test` | exit 0, 413 tests pass |
| `pnpm run check:publish` | exit 0: `@rickylabs/harness-contracts@0.1.0, protocol 1, 68 files, no tests` |
| `npm pack` + offline `npm install <tgz>` into a temp consumer | installed 0.1.0, `PROTOCOL_VERSION` 1, `/server` resolves, zero governance runtime exports |

Toolchain observed: node v26.8.1, pnpm 11.25.0, npm 11.19.0.

### 4.2 Synthetic characterization probe (inline `node --input-type=module`, no files written)

Inputs: descriptor with `usage: null`, `spend` configured with `timeoutMs: 30` and a fetch that never
resolves, `capacity` from fake cgroup reads (`1024` / `4096`), `admissions` from an in-memory log with one
`governance.admission` event (item 7, subscription, throttle, `quota-paced`, private detail canary),
clock fixed at `2026-09-07T12:00:00.000Z`.

Observed through `collectGovernance` + `publicGovernance`:

- `ok: false`, `availability: fresh`, `observedAt = validUntil-10m = completion`, `provenance: reader:composed`.
- notes: `pending approvals unobserved`, `usage: not-configured`, `spend: timeout`.
- subscription: `allow`, 0 leaves, note `usage: not-configured`; metered: `allow`, 0 leaves, note
  `spend: timeout`; capacity: 1 host, `ramTotalBytes 4096`, leaf `observedAt` = reader clock.
- admissions: item 7, throttle, `quota-paced`, provenance `reader:recorded-admission`, private detail
  replaced by the fixed sentence; credential, private detail and cgroup path absent from output.
- `Object.keys(state)` = `generatedAt, notes, pending, regimes`: `.state` alone loses availability,
  observedAt, validUntil, provenance, admissions, unavailableReason and `ok`.
- A `governance.changed` frame carrying that `state` is accepted by `readServerEvent`, and a
  `RemoteSnapshot` built around it folds; the failed leg is visible only as the note string
  `"spend: timeout"` on an `allow` regime.
- Legacy file round trip (`status --observations-from file:<tmp> --json`): exit 0, `complete: true`,
  `availability: fresh`, no `protocol`/`generation` keys. The composition's `ok:false` is gone.

This reproduces every gap named in comment `5575275001` at the current head.

## 5. Findings for synthesis

F1. Producer capability is exactly: four legs, each with `not-configured | read(observedAt, validUntil) |
failed(code) | discarded(stale-source|future-source|shape-mismatch)`; admissions additionally
`records`, `empty`, `dropped(admission-conflict|stale-source|shape-mismatch)`; pending approvals never
observed; regime `state` always `allow` (no policy runs); `binding:false`; `ceilingUsd:null`; GPU null;
unbounded cgroup → `ramTotalBytes:null`. Anything richer in a published shape would be invented.

F2. The per-leg outcome is computed in `compose.ts` and `admissions.ts` but only survives as note text.
Structured coverage needs those two functions to return codes alongside notes. No parsing of notes.

F3. A `RemoteSnapshot` producer does not exist and cannot be written from telemetry's inputs without
inventing `generation`, `complete`, `repo`, `lifecycle` and board arrays. The hub is caller-driven and
opens nothing. Option B therefore requires either a fake board or a new resident service.

F4. 0.1.0 is published; contracts source is unchanged since the tag; the next contracts release is
the first post-publication change and the README's 0.x rule makes any additive export a minor.

F5. Admission evidence: the only producer is the `record` CLI writing `governance.admission` events
(README §"Recorded admissions"); E5's gate is a stub. Admission in any published shape is "recorded
refusal", never execution.

F6. Existing test seams (`main(argv, services)`, `fakeServices`, temp `--home`, configurable `denoBin`,
`cgroupRoot`, `DSH_TELEMETRY_DIR`) allow a network-free producer run from both a node test and a shell,
including a real `timeout` by pointing `denoBin` at a sleeping executable.

[source: packages/contracts/src/{governance,snapshot,events,routes,server,fold,index}.ts; topic: published shape and hub purity; read 2026-09-07]
[source: packages/telemetry/src/{cli,source,observations,public}.ts and src/governance/*.ts; topic: producer capability and loss points; read 2026-09-07]
[source: https://registry.npmjs.org/@rickylabs%2Fharness-contracts; topic: 0.1.0 publication state; retrieved 2026-09-07]
[source: issue #205 comment 5575275001; topic: published-boundary gap; retrieved 2026-09-07]
[source: issues #87, #265; topic: acceptance and separate recovery scope; retrieved 2026-09-07]
[source: executed probes §4; topic: current-head characterization; run 2026-09-07]
