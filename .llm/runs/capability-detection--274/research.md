# capability-detection--274 — research

Stage B/C artifact for issue 274 (step 4 of E11, 270). Research only: no product code, no
package, no schema file, and no copy of the matrix, the capability table or the model catalogue.
Harness baseline `aa06a6c` (origin/main), branch `research/274-capability-detection`. Fleet
authority read at NetScript source `155dbbe90`. Every command in this document was run on the
agent host on 2026-09-13 and is reproduced with its result in `verification.md`.

This resumes the run paused on 2026-09-08. `reset-checkpoint.md` records that `research.md` and
`plan.md` did not exist; this file is the first half of that debt. `plan.md` is deliberately not
written here — issue 274's execution rules require an independent plan evaluation before product
mutation, and that gate is funded behind a higher-priority one.

---

## Summary, for a reader on a phone

The gap issue 274 exists to close is **not** that the capability mapping is missing. It is that
the *resolver that consumes it already exists in netscript and no CLI exposes it*.
`resolveWorkloadRoute` (`routing-policy.ts:190`) already returns concrete transport, concrete
provider model string, concrete effort, agent binary, provider kind and profile id — and it
already takes detection results as input, as `unavailableModels` / `unavailableTransports`
(`routing-policy.ts:80-83`). The matrix CLI just does not call it. The upstream ask is therefore
*expose the resolver*, not *export the table*.

Detection is in better shape than the issue assumes, and worse in one specific place:

- **Four of the seven transports** — `github_copilot`, `opencode_go`, `ollama`, `openrouter` —
  are fully covered for installed, version, authenticated and live model availability by two
  free read-only commands that already ship, `opencode auth list` and `opencode models`. Neither
  is a bespoke provider integration. `opencode_go` additionally has live quota headroom.
- **`claude`** exposes login, account route *and subscription entitlement* through
  `claude auth status`, which prints JSON. It also has a real `--effort` flag with the exact
  netscript effort vocabulary. Both contradict assumptions currently recorded upstream.
- **`codex`** exposes login and its account class through `codex login status`.
- **`agy`** is the one genuinely broken row, in two independent ways: netscript's own doctor
  reports it `missing` because of a hardcoded foreign home directory, and the one concrete model
  id netscript declares for it **does not exist** in the live `agy models` catalogue.

Measured against the live catalogues, of the **38 primary matrix resolutions** (5 tiers × 8
roles, two cells empty), **19 are verified servable, 8 resolve to a model id the transport does
not have, and 11 are undetectable today** because `claude` and `codex` ship no free catalogue
command. Six of the 38 silently coerce `provider_default` to `high`.

---

## Question and method

**Question.** For each transport in `transportPriority`, what can be detected today, by what
command, and what cannot; what contract must netscript emit for a resolution to complete; which
of 274's six acceptance items already ship and where; and what invariant I1 can actually record.

**Method, three legs held to the citation bar in `AGENTS.md`.**

- **Repo leg.** `packages/routing/src/*`, `packages/telemetry/src/{cli,source}.ts` at `aa06a6c`;
  netscript `.llm/tools/agentic/{runtime,config,lib,opencode,wsl}` at `155dbbe90`.
- **Document leg.** `ARCHITECTURE.md` v1 §5, §7/I1, §10, §11; `doctrine/WORKFLOW.md`;
  `doctrine/decisions/0004-uhp-park-evidence.md`; issues 270/274/275; this run's
  `coordinator-discovery.md` and `reset-checkpoint.md`; `.llm/runs/routing-configuration--271/`
  research; `.llm/runs/route-identity-uhp--s10/research.md`;
  `.llm/runs/architecture-v1--smoke/receipt.md` on `orch/divybot-304`.
- **External leg.** Vendor CLI self-description read by executing `--help` and read-only status
  subcommands on the agent host: `claude 2.1.270`, `codex-cli 0.154.0`, `agy 1.2.2`,
  `opencode 1.18.30`, `gh 2.100.0`. Vendor CLI help output is cited for *behaviour* because it
  is the installed binary describing itself, not a marketing page.

**Not done, by constraint.** No live provider inference, no account change, no credential value
read or printed, no UHP work (`ARCHITECTURE.md` §10), no proposal to extract the runtime out of
netscript (`ARCHITECTURE.md` §11). One read-only usage GET against `opencode.ai` was made; it
spends nothing and changes nothing. Three account identifiers returned by `claude auth status`
were redacted at the point of capture and are recorded here only as field names.

---

## R-1 — The central gap, restated after measuring it

`deno task agentic:matrix -- --json` emits exactly five top-level keys: `schemaVersion` (1),
`mode` (`full`), `tiers`, `coordinators`, `transportPriority`. Per tier it emits eight role
arrays plus three policy objects; each candidate is exactly `{model, effort}` with `model` a
logical id. `transportPriority` is one global array of seven strings. Measured: 5 tiers, 17
distinct logical model ids, 6 efforts, 76 candidates, 4 coordinator scopes. The string
`capab` appears zero times in the whole export.

The documented flag surface is `--tier`, `--role`, `--plan-evaluator`, `--impl-evaluator`,
`--fallback-of` / `--fallback`, `--json`, `--help` (`agentic:matrix -- --help`). None exports the
mapping from a logical model to the transports that can serve it.

That mapping exists as 41 `capability(transport, concreteModelId)` calls inside
`.llm/tools/agentic/runtime/delegation-matrix.ts`, reachable only by importing the module.
Measured distribution, by importing it:

| transport | declared capabilities |
|---|---|
| `agy` | 1 |
| `claude` | 2 |
| `codex` | 3 |
| `github_copilot` | 3 |
| `ollama` | 6 |
| `opencode_go` | 12 |
| `openrouter` | 14 |
| **total** | **41** |

So the consequence recorded by the predecessor session holds: a caller shelling out to the matrix
CLI gets a logical model and a global precedence list and cannot reach a concrete transport plus
concrete model string. That is `ARCHITECTURE.md` §11 step 2's gap, and issue 275's fourth
acceptance item already names the remedy — authoritative CLI export support, failing on
incomplete coverage rather than hand-transcribing source.

**What the predecessor did not find, and what changes the shape of the fix.** The function that
completes the resolution already exists and is exported:

- `resolveWorkloadRoute(request: WorkloadRouteRequest): ResolvedDelegationRoute` —
  `routing-policy.ts:190`.
- `ResolvedDelegationRoute extends RouteIdentity` and adds `logicalModel`, `family`, `transport`,
  `requestedEffort` — `routing-policy.ts:101-108`. `RouteIdentity` carries `agent`, `provider`,
  `profileId?`, `presetId?`, `baseUrl?`, `model`, `effort`, `worktree`, `sessionId?`,
  `mobileRequired` — `contract.ts:93-104`.
- It already accepts detection results: `RouteAvailability { unavailableModels?,
  unavailableTransports? }` — `routing-policy.ts:80-83`, consumed at `routing-policy.ts:149-162`.
- It already owns four rules a harness re-implementation would have to duplicate: transport
  precedence (`MODEL_TRANSPORT_PRIORITY`, sorted at `routing-policy.ts:158-160`), the
  deep-research transport restriction (`isTransportAllowedForRole`,
  `delegation-matrix.ts:316-323`), evaluator family opposition (`routing-policy.ts:153-154`), and
  privileged-tier authority, fail-closed (`assertPrivilegedTierAuthorization`,
  `delegation-matrix.ts:286-297`).
- The transport→binary and transport→provider maps are already data:
  `TRANSPORT_AGENT` (`routing-policy.ts:110-118`), `TRANSPORT_PROVIDER`
  (`routing-policy.ts:119-127`), `TRANSPORT_PROFILE` (`routing-policy.ts:129-135`).

Measured directly, by importing and calling it (full transcript in `verification.md`):

    simple/implementation                -> codex   gpt-5.6-luna        effort max
    simple/implementation, codex + opencode_go unavailable
                                         -> openrouter openrouter/qwen/qwen3.8-flash effort high
                                            (requestedEffort provider_default)
    feature/deep_research                -> agy     gemini-3.8-flash    effort high
    feature/deep_research, agy unavailable
                                         -> github_copilot github-copilot/gemini-3.8-flash high
    complex/implementation, no authorization
                                         -> THREW: complex workload tier requires explicit owner
                                            or milestone-coordinator authorization
    simple/plan                          -> THREW: simple/plan is not applicable

This is the whole contract issue 274's resolver needs, already written, already fail-closed,
already taking detection as an argument. It is unreachable from a CLI. That is the finding.

**Sources:** `delegation-matrix.ts:65-97,166-178,249-257,286-297,312-323`;
`cli/delegation-matrix-table.ts:1-30`; `routing-policy.ts:80-135,141-186,190-220`;
`contract.ts:23-37,93-104`; `agentic:matrix -- --json` and `-- --help`; executed 2026-09-13.

---

## R-2 — Per-transport detection, measured

Seven transports, six facts. `yes` means a free, read-only, credential-free command establishes
the fact; the command is named. `no` means nothing on this host establishes it and the row says
what would.

### `claude`

| fact | today | how |
|---|---|---|
| binary present | **yes** | `command -v claude`; netscript doctor component `claude` (`wsl-foundation.ts:42`) |
| version | **yes** | `claude --version` → `2.1.270 (Claude Code)` |
| authenticated | **yes** | `claude auth status` → `"loggedIn": true` |
| entitled | **yes** | same call → `"authMethod": "claude.ai"`, `"apiProvider": "firstParty"`, `"subscriptionType": "max"` |
| quota headroom | **no** | not in that output; would need a vendor-side allowance field on the same `auth status` call, or a documented usage endpoint |
| live model availability | **no** | the CLI has no models subcommand (`claude --help`); would need a `claude models`-shaped read-only listing, the same shape `opencode models` and `agy models` already ship |

`claude auth status` also returns `email`, `orgId` and `orgName`. **A detector must emit an
allowlist of fields, not a denylist** — those three are account identifiers and were redacted at
capture. netscript currently detects claude authentication far more weakly, by scanning
`$HOME/.claude` for a filename matching `/auth|credential|oauth|session/i`
(`wsl-foundation.ts:155-161`), which is presence, not validity, and carries no entitlement.

`claude --help` on 2.1.270 documents `--effort <level>` with the vocabulary
**`(low, medium, high, xhigh, max)`** — identical to netscript's `EFFORTS`
(`contract.ts:36`). This session's own environment carries `CLAUDE_EFFORT=high`. See R-6.

### `codex`

| fact | today | how |
|---|---|---|
| binary present | **yes** | `command -v codex`; doctor components `codex` and `codex-app-server` (`wsl-foundation.ts:40-41`) |
| version | **yes** | `codex --version` → `codex-cli 0.154.0` |
| authenticated | **yes** | `codex login status` → exit 0, `Logged in using ChatGPT` |
| entitled | **partial** | the same string names the account *class* (ChatGPT subscription vs API key). It does not name a plan tier. A machine-readable form — the `--json` that `claude auth status` already emits — would close it |
| quota headroom | **no** | no free read-only surface found. `codex doctor` exists and self-describes as diagnosing "installation, config, auth, and runtime health", but it **exceeded a 90-second timeout** on this host and is therefore unusable as a pre-dispatch probe |
| live model availability | **no** | no models subcommand in `codex --help`'s 24-command list |

Codex effort is not a flag: it is a config override, `-c model_reasoning_effort=...`
(`codex --help`), matching what `.llm/runs/route-identity--e35/context-pack.md` records as
`thread/start.config.model_reasoning_effort`.

### `agy`

| fact | today | how |
|---|---|---|
| binary present | **yes, and netscript gets it wrong** | `command -v agy` → `/home/agent/.local/bin/agy`. netscript's doctor reports `antigravity: missing` because `wsl-foundation.ts:43` hardcodes the probe as `/home/codex/.local/bin/agy` |
| version | **yes** | `agy --version` → `1.2.2` |
| authenticated | **effectively yes, and netscript gets it wrong** | `agy models` performed a live fetch and returned 14 model ids, which is only possible authenticated. netscript's doctor reports `antigravity-auth: auth_required` because it tests for `$HOME/.gemini/google_accounts.json` and `oauth_creds.json` (`wsl-foundation.ts:273-276`); both are absent on this host, so the file-marker heuristic is wrong for agy 1.2.2 |
| entitled | **no** | no entitlement surface in any `agy` subcommand |
| quota headroom | **no** | none |
| live model availability | **yes** | `agy models` → 14 ids, tab-separated id and label |

Two detectors disagreed about the same host in the same minute. `agentic:runtime doctor --json`
said antigravity was missing and unauthenticated; `agy --version` and `agy models` said 1.2.2 and
authenticated. This is issue 274's checkbox 2 demonstrated at the weakest possible link: not
"installed implies authenticated", but *installed itself was reported wrong*, from a hardcoded
foreign `$HOME`. `doctor()` already computes the correct path one screen later, using it only as
a label — `expected: \`${home}/.local/bin/agy\`` at `wsl-foundation.ts:257`.

### `github_copilot`

| fact | today | how |
|---|---|---|
| binary present | **yes** | `command -v opencode` → `/home/agent/.opencode/bin/opencode`. The transport's agent is `opencode` (`TRANSPORT_AGENT`, `routing-policy.ts:114`) |
| version | **yes, and it is out of contract** | `opencode --version` → `1.18.30`; netscript pins `OPENCODE_TOOL.pinnedVersion = '1.17.20'` (`config/versions.ts:69`) |
| authenticated | **yes** | `opencode auth list` → four credentials, each as display name plus kind. Copilot shows kind `oauth`; exit 0. No value is printed |
| entitled | **partial** | `opencode models` lists only what the credential grants — 27 `github-copilot/` ids. That is entitlement-by-consequence. The plan's credit allowance is configuration, not detection (`COPILOT_PRO_PLUS_LIMITS`, `config/subscriptions.ts:9-15`) |
| quota headroom | **no** | `evaluateSubscriptionExpense` returns `usage_unproven` unconditionally for this provider (`subscription-expense.ts:144`); `agentic:expense-watch` does not even accept `--provider github_copilot` (`cli/expense-watch.ts:44`). The local reservation ledger (`provider-usage.ts:32`) is a reservation, not a live balance, and its own comment says so |
| live model availability **and effort capability** | **yes, per model and per effort** | `deno task agentic:copilot-preflight -- --model <id> --variant <effort>` → `{model, present, variant, variantPresent, capturedAt}`. Read-only; the CLI's own help says "Read-only model catalog; never runs inference" (`opencode-preflight.ts:55-58`) |

That last row is the most useful existing surface for issue 274, because it separates *model
present* from *effort variant present* and stamps a `capturedAt`. Measured sweep of all three
declared Copilot ids × six matrix efforts, 18 attestations:

| model | low | medium | high | xhigh | max | provider_default |
|---|---|---|---|---|---|---|
| `github-copilot/gemini-3.8-flash` | yes | yes | yes | no | no | yes |
| `github-copilot/kimi-k3` | yes | **no** | yes | no | yes | yes |
| `github-copilot/grok-4.6` | yes | yes | yes | yes | **no** | yes |

Effort support is not monotonic — `kimi-k3` serves `low`, `high` and `max` but not `medium`. No
ladder or ordering assumption is safe. An availability model that treats effort as a scalar to
compare will be wrong here.

### `opencode_go`

| fact | today | how |
|---|---|---|
| binary present / version | **yes** | as above, one `opencode` binary serves all four |
| authenticated | **yes** | `opencode auth list` → `OpenCode Go` kind `api` |
| entitled | **partial** | `opencode models` lists 27 `opencode-go/` ids |
| quota headroom | **yes — the only transport with a live, free, credential-free allowance read** | `deno task agentic:expense-watch -- --provider opencode_go --model <full routing id> --estimated-cost-usd <n>` |
| live model availability | **yes** | `opencode models` |

Measured live, 2026-09-13: `{"reason":"provider_rate_limited","snapshotAgeMs":0,...}` with three
windows — rolling five hours 0% of $12, **weekly 100% of $30, status `rate-limited`,
exhausted**, monthly 93% of $60. The output carries limits, used, remaining, observed and
projected percent, status and `resetsAt` per window, and **no credential and no account id**. It
is exactly the shape `ARCHITECTURE.md` §9 row 1 asks for.

The limits table is keyed on the **full** routing id (`OPENCODE_GO_MODEL_MONTHLY_INCLUDED_USD`,
`config/subscriptions.ts:37-50`), and the credential policy is keyed on the `opencode-go/` id
**prefix** (`CREDENTIAL_POLICIES`, `lib/provider-credential.ts:21-39`;
`policyForModel`, `:67-69`). See R-4 for what that does to the diagnostics.

### `ollama`

| fact | today | how |
|---|---|---|
| binary present | **no native binary** | `command -v ollama` → absent. This transport is Ollama *Cloud* through `opencode`, not a local daemon |
| version | **n/a**, inherits `opencode 1.18.30` | |
| authenticated | **yes** | `opencode auth list` → `Ollama Cloud` kind `api`; credential file present at 0600 |
| entitled | **partial** | `opencode models` lists 24 `ollama-cloud/` ids; the subscription tier comes from a snapshot field, not from detection |
| quota headroom | **only from a snapshot, and the one on this host is stale** | `agentic:expense-watch -- --provider ollama --snapshot <json>` |
| live model availability | **yes** | `opencode models` |

A conforming snapshot **does** exist on this host —
`$HOME/.config/netscript-agentic/ollama-usage-snapshot.json`, mode 0600, keys `provider`,
`capturedAt`, `tier`, `monthlyUsedUsd`, `concurrentRequests`. Fed to the CLI it returned
`{"reason":"usage_stale","snapshotAgeMs":142074498}` — 39.5 hours against the 15-minute ceiling
`EXPENSE_SNAPSHOT_MAX_AGE_MS` (`config/subscriptions.ts:5`). So the predecessor's conclusion
stands (no *usable* snapshot) but its premise needs correcting: the snapshot format has a
producer, it just is not being run. **And the taxonomy works when a snapshot exists** —
`usage_stale` is a distinct, correct, actionable reason. The conflation in R-4 is specific to the
absent-or-misshapen path.

### `openrouter`

| fact | today | how |
|---|---|---|
| binary present / version | **yes**, `opencode 1.18.30` | |
| authenticated | **yes** | `opencode auth list` → `OpenRouter` kind `api` |
| entitled | **partial** | `opencode models` lists 367 `openrouter/` ids — by far the widest surface |
| quota headroom | **no producer** | `--snapshot` required; `availableBalanceUsd` is the field (`subscription-expense.ts:29,227-228`). `packages/telemetry/src/source.ts:18-24` already defines a `SpendSource` against `https://openrouter.ai/api/v1/key` with four windows and a `credentialEnv` **name** — so the harness side of this is built and only unconfigured |
| live model availability | **yes** | `opencode models` |
| static route validation | **yes, credential-free** | `deno task agentic:provider-canary --all` → per-preset `validation`, `launchValid`, `liveEligible`, `agenticTurn`, `transport`, `incompatibility`, **`attestedEffort`**; exit 0 |

`attestedEffort` is worth naming: netscript already carries a per-preset attested effort
(`max`, `xhigh`, or `null`), credential-free, and already records a named incompatibility code
(`codex-native-namespace-tool`) that makes a preset `liveEligible: false`.

### What is undetectable, and what would make it detectable

Three facts are undetectable on at least one transport. None of them needs a bespoke provider
integration — issue 274 forbids four of those, and each remedy below is either a vendor CLI
read-only subcommand of a shape that already ships on a sibling CLI, or a netscript change.

1. **Live model availability on `claude` and `codex`.** Neither CLI lists models. `opencode
   models` and `agy models` both do, so this is a request to the vendor CLI for a shape two of
   the four already have — not an API client. Until it lands, a claude or codex resolution can be
   recorded only as `unknown`, and `mayDispatch` (`packages/routing/src/probe.ts:413-415`)
   correctly refuses to treat that as available.
2. **Quota headroom on `claude`, `codex`, `agy`, `github_copilot`.** `claude auth status` already
   returns a subscription type; a remaining-allowance field on that same call would close it
   without a new integration. For `github_copilot` the honest answer is that the plan allowance
   is configuration and the consumption is not observable, which is why netscript models it as a
   local reservation and says so.
3. **Entitlement as a named plan on `codex` and `agy`.** `claude auth status` proves the shape is
   achievable (`subscriptionType`). The other two print prose or nothing.

---

## R-3 — Declared versus live: a measured parity audit

Cross-referencing the 41 declared capabilities against the live catalogues captured on
2026-09-13 (`opencode models`, 463 ids; `agy models`, 14 ids):

| transport | declared | present in live catalogue | absent |
|---|---|---|---|
| `github_copilot` | 3 | 3 | 0 |
| `opencode_go` | 12 | 12 | 0 |
| `ollama` | 6 | 6 | 0 |
| `openrouter` | 14 | 14 | 0 |
| `agy` | 1 | **0** | **1** |
| `claude` | 2 | — | no free catalogue command |
| `codex` | 3 | — | no free catalogue command |

All 35 opencode-hosted declared ids are present. **The single `agy` declaration is not.** It
declares `gemini-3.8-flash`; the live catalogue contains `gemini-3.8-flash-high`,
`gemini-3.8-flash-medium` and `gemini-3.8-flash-low` and **no bare form** — verified by an exact
anchored match returning zero. On `agy` the effort is baked into the model id, and separately
`agy --help` documents `--effort` with the vocabulary **`(low|medium|high)`** only, missing
`xhigh` and `max`.

Resolving every populated matrix cell's primary and checking the result against the live
catalogues — 38 resolutions, transport distribution `agy 8, claude 5, codex 6, github_copilot 8,
opencode_go 11`:

| outcome | count | which |
|---|---|---|
| model (and where measurable, effort variant) present | **19** | all 8 `github_copilot`, all 11 `opencode_go` |
| model id absent from the live catalogue | **8** | every `agy` primary — `simple/documentation`, `simple/deep_research`, `straightforward/documentation`, `straightforward/deep_research`, `feature/vision_evaluation`, `feature/deep_research`, `complex/deep_research`, `architecture/deep_research` |
| undetectable — no free catalogue command | **11** | 5 `claude`, 6 `codex` |

Every `agy` primary is affected, because `agy` has exactly one declared capability and it is the
broken one. The blast radius is the whole `deep_research` role at four tiers plus three
documentation cells and one vision-evaluation cell.

Separately, **6 of the 38 primaries coerce `provider_default` to `high`** —
`simple/implementation_evaluation`, `simple/vision_evaluation`,
`straightforward/implementation_evaluation`, `straightforward/vision_evaluation`,
`feature/plan_evaluation`, `feature/documentation` — via `concreteEffort`
(`routing-policy.ts:137-139`) reading `OPENCODE_TOOL.defaultVariant` (`config/versions.ts:70`).
`ResolvedDelegationRoute` keeps both values, `requestedEffort: 'provider_default'` and
`effort: 'high'`. That is requested-versus-observed effort, correct by construction, and it is
the one place I1 is already satisfiable without any new work. Across the whole matrix, 18 of 76
candidates declare `provider_default` (efforts: `max` 17, `provider_default` 18, `high` 13,
`medium` 11, `xhigh` 10, `low` 7).

This audit is the direct answer to issue 275's executable-parity acceptance item, produced free
and read-only, and it is why R-5's upstream requests are worth making: three of the seven rows
can be kept honest by a command that already exists.

---

## R-4 — `usage_unproven` is eight causes, and one error string is actively wrong

`ExpenseDecisionReason` has nine members (`subscription-expense.ts:60-69`). `usage_unproven` is
returned from **seven distinct sites** in the library —

- `:144` — provider is `github_copilot`, always;
- `:170` — the model key is unclassified **or** any of the three percentage windows is absent;
- `:178` — a window's `percent` is not finite-non-negative or its `status` is not a non-empty string;
- `:210` — ollama `monthlyUsedUsd` or `concurrentRequests` is not finite-non-negative;
- `:228` — openrouter `availableBalanceUsd` is not finite-non-negative;
- `:283`, `:294` — two Copilot-ledger paths.

— and from an **eighth** site that is not in the library at all: the CLI wraps *every* thrown
error, including an argument error, as `{"allowed":false,"reason":"usage_unproven","error":...}`
(`cli/expense-watch.ts:107-114`). Measured: `agentic:expense-watch -- --help` returns
`{"allowed":false,"reason":"usage_unproven","error":"unknown argument: --help"}`. A mistyped flag
and an exhausted subscription are the same reason code.

Line `:170` alone is two causes in one condition: `!limits` (the model key is not in the
inclusion table) and `!rolling || !weekly || !monthly` (the snapshot is incomplete).

The predecessor session's diagnosis needs one correction, and it sharpens the finding. Passing
the **bare** model name does not reach the limits table at all. Measured:

    --provider opencode_go --model muse-spark-1.3-contributor
      -> {"allowed":false,"reason":"usage_unproven",
          "error":"OpenCode Go usage credential is unavailable"}
    --provider opencode_go --model opencode-go/muse-spark-1.3-contributor
      -> {"allowed":false,"reason":"provider_rate_limited",...three live windows...}

The credential *is* available: `$HOME/.config/netscript-agentic/opencode-go.env` is present at
mode 0600. The failure is that credential resolution is keyed on the model-id **prefix**
(`policyForModel`, `lib/provider-credential.ts:67-69`), so an unprefixed id selects no policy,
`OPENCODE_API_KEY` stays unset, and `fetchOpenCodeGoUsageSnapshot` throws
`'OpenCode Go usage credential is unavailable'` (`provider-usage.ts:150`).

So the operational rule is stronger than "read the error string, not the reason code": **on this
path the error string is wrong.** It names a credential problem for what is a model-identifier
problem. The only reliable signal is the model id's shape, checkable before the call with
`openCodeCredentialProviderForModel` (`lib/provider-credential.ts:43-48`), which is exported and
pure.

This is issue 274's checkbox 4 — "credential-free diagnostics" — failing in the direction nobody
guards against: not a leak, a lie.

---

## R-5 — The contract the resolver needs, as a request against netscript

Stated as requests, not as a schema to implement here. One source of truth: harness cites and
calls; it does not copy. Each request names the reason and the file that already contains most of
the answer.

**N-1 — Expose the existing resolver through the matrix CLI.** *Blocks `ARCHITECTURE.md` §11
step 2 and issue 275 item 4.*

Add a resolve view to `.llm/tools/agentic/runtime/cli/delegation-matrix-table.ts` that calls
`resolveWorkloadRoute` (`routing-policy.ts:190`) and `resolveCoordinatorRoute` (`:221`) and prints
`ResolvedDelegationRoute` as JSON under the existing `schemaVersion`. Inputs it needs, all of
which the request type already has (`routing-policy.ts:85-99`): `--tier`, `--role`, `--worktree`,
`--generator-model` (required for the three evaluation roles, already enforced at `:205-208`),
repeatable `--unavailable-transport` and `--unavailable-model`, and `--authorizer` +
`--rationale` for privileged tiers. Output is the object already returned, unchanged: `agent`,
`provider`, `profileId?`, `model`, `effort`, `logicalModel`, `family`, `transport`,
`requestedEffort`, plus the authorization echo.

*Reason.* Without it a CLI caller cannot complete a resolution. With it, transport precedence,
the deep-research restriction, family opposition, privileged-tier authority and the
`provider_default → defaultVariant` coercion stay in netscript. **Exporting the 41 capability
rows instead would be strictly worse**: it would move five rules across the boundary and require
harness to re-implement them, which is the drift `ARCHITECTURE.md` §11 warns about. Failure
behaviour is already correct — the function throws on an unresolvable chain and on an
unauthorized privileged tier, so the CLI needs only a non-zero exit.

**N-2 — Fix the antigravity component probe.** One line. `wsl-foundation.ts:43` hardcodes
`/home/codex/.local/bin/agy`; `doctor()` already computes `${home}/.local/bin/agy` at `:257` and
uses it only as a display label. *Reason:* on this host the doctor reports a present, working,
authenticated CLI as `missing`, and `agy` carries 8 of the 38 matrix primaries.

**N-3 — Add `opencode` and its four providers to the doctor.** `OBSERVED_FOUNDATION_COMPONENTS`
(`contract.ts:39-44`) and `COMMAND_SPECS` (`wsl-foundation.ts:30-47`) omit `opencode` entirely,
so the doctor reports nothing about the transport that carries 19 of 38 primaries. There is
already a pinned version to compare against (`config/versions.ts:69`) and the `auth[]` array
already has a `{agent, route, status, conflictKeys}` shape that `opencode auth list`'s
name-plus-kind output maps onto directly. *Reason:* one command covers four transports; the
absence is not a missing integration, it is a missing row.

**N-4 — Reconcile the `agy` capability id with the live catalogue.** Declared
`gemini-3.8-flash`; live ids are effort-suffixed. This is netscript's data and launcher decision
— either declare the three variants, or have the agy launcher compose `${model}-${effort}` and
refuse the two efforts `agy --effort` cannot express. *Reason:* the resolution completes and
names a model the transport does not have. This is an owner-visible fork, not a harness choice.

**N-5 — Split `usage_unproven`.** Give `!limits` its own reason (the model key is not classified)
and stop the CLI catch-all labelling argument and transport errors as a usage verdict
(`subscription-expense.ts:168`, `cli/expense-watch.ts:107-114`). Correct the
`'credential is unavailable'` string on the unprefixed-id path (`provider-usage.ts:150`).
*Reason:* issue 274's checkbox 4. A diagnostic that names the wrong cause is worse than one that
says `unknown`.

**N-6 — Generalise the catalogue attestation past Copilot.** `preflightCopilotCatalog` already
returns `{model, present, variant, variantPresent, capturedAt}`
(`opencode-preflight.ts:71-78`), and the mechanism underneath is `opencode`'s own catalogue, which
serves all four opencode-hosted transports. Only the `github-copilot/` guard is provider-specific.
*Reason:* this is the one existing surface that separates model presence from effort capability
with a freshness stamp — exactly what checkbox 2 asks for — and generalising it is a prefix
change, not a new integration.

**N-7 — Make the second same-transport capability selectable, or delete it.**
`muse_spark_1_3` is the only model in the catalogue with two capabilities on one transport
(measured: one duplicate across all 17 models), declaring both a contributor and a standard
`openrouter` tier at `delegation-matrix.ts:171` and `:176`, with a source comment at `:172-175`
saying both exist "so a route can pick deliberately rather than by price alone".

Measured: **the standard tier is unreachable.** `resolveRouteChain` sorts capabilities by
transport priority and takes `.find()` (`routing-policy.ts:158-162`), a stable first match, so
declaration order decides and the contributor entry always wins. With `opencode_go` marked
unavailable the resolution reaches openrouter and still returns
`openrouter/meta/muse-spark-1.3-contributor`. There is no input to `resolveWorkloadRoute` that
selects `:176`. *Reason:* the comment promises a choice the resolver cannot express. Either add a
selector or remove the declaration, so nothing suggests a decision is being taken where none is.

Two claims about this cell that this run did **not** verify, and which are therefore spikes and
not findings: that the contributor tier refuses `max` effort, and that the matrix cell requiring
`max` therefore passes a guard the provider then refuses. Neither is stated anywhere in netscript
source that this run read, and confirming it requires a paid call. What *is* measured is that the
resolution silently and always selects the contributor id at `max`, and that netscript's only
free effort-capability attestation (`copilot-preflight`) does not cover openrouter — which is
request N-6.

**Not requested, deliberately.** Extraction of the runtime out of netscript
(`ARCHITECTURE.md` §11). A capability-table export (superseded by N-1). Any UHP work
(`ARCHITECTURE.md` §10, `doctrine/decisions/0004`). Any of the four bespoke provider
integrations issue 274 forbids — every request above is a change to a command that already runs.

---

## R-6 — Effort is bound in more places than the charter records

`ARCHITECTURE.md` §5 records as a known gap that "`effort` is a real argument for one vendor CLI
only. Everywhere else it is injected as prose into the brief."
`.llm/runs/architecture-v1--smoke/receipt.md` on `orch/divybot-304` records the consequence in
its own words: `effort` requested `max`, observed `unknown — no effort argument is visible to
this session`.

Measured on this host, three of the four agent CLIs take effort as a real argument:

| CLI | mechanism | vocabulary |
|---|---|---|
| `claude 2.1.270` | `--effort <level>` | `low, medium, high, xhigh, max` — identical to `EFFORTS` (`contract.ts:36`) |
| `agy 1.2.2` | `--effort` | `low, medium, high` only — cannot express `xhigh` or `max` |
| `codex 0.154.0` | `-c model_reasoning_effort=<level>` | config override, not a flag |
| `opencode` | `--variant`, via the netscript launchers | per-model, and measurably non-monotonic (R-2) |

And effort is *observable* from inside a claude session: this session's environment carries
`CLAUDE_EFFORT=high`. Neither repository references that variable —
`grep -rn CLAUDE_EFFORT` returns zero hits in netscript `.llm/tools/` and zero in harness.

**What this does and does not establish.** It establishes that an effort argument exists on the
claude transport and that a session-visible variable with the same name and a legal value is
present. It does **not** establish that `--effort` is what sets it, because proving that requires
launching a paid session with a known flag and reading the variable back. That is a one-turn,
zero-risk spike and it is the cheapest available step toward closing I1's effort leg.

An agent may not amend `ARCHITECTURE.md` (§ preamble). This is filed as evidence for a numbered
decision in `doctrine/decisions/`, per §13, not as an amendment.

---

## R-7 — Which of issue 274's six items already ship, and where

Verdicts are about what exists, not what would be nice. Two repositories are in scope: harness
`packages/` at `aa06a6c`, and netscript at `155dbbe90` as a service behind an adapter
(`AGENTS.md`, ratified decision 2).

### Item 1 — detect CLIs and versions; safe auth metadata, else explicit unknown and accept configuration

**The "explicit unknown and accept configuration" half ships. The detection half does not exist
in harness, and mostly does exist in netscript.**

Shipped in harness: the four-value `Availability` including `unknown`
(`packages/routing/src/probe.ts:87-88`); `Source` including `fallback` and `none` (`:108-109`);
absence of evidence yielding `unknown`/`source:"none"` (`:316-317`); a configured constant that
may refuse and may never permit (`:318-325`); `mayDispatch` requiring both `available` and
`source === "probe"` (`:413-415`). That asymmetry is exactly what item 1's fallback clause needs
and it is already tested.

Also shipped in harness, and easy to miss because it is in the wrong package: **a bounded,
credential-safe subprocess reader.** `runUsageProbe` (`packages/telemetry/src/cli.ts:713-738`)
spawns with `shell: false`, an argument array, an explicit child environment, `stdio` with stderr
ignored, a byte cap, a timeout `SIGKILL`, close-based resolution and fixed `SourceError` codes.
`GovernanceSource` (`packages/telemetry/src/source.ts:31-36`) binds a credential by **env var
name** (`credentialEnv`) and carries an `accountLabel` validated by `safeLabel` (`:48-51`), with
`credential-unbound` as a first-class refusal (`cli.ts:768-769`). A detector should call this, not
rebuild it.

Genuinely missing: any module that executes a detection command. `probe.ts:16-23` forbids I/O in
that module by design and names `codex --version` only as an example of what a caller does. There
is no version type, no version comparator, no `installed` fact and no account or subscription
field anywhere in `packages/routing`.

In netscript, the detection half largely exists and is what harness should call: per-component
binary and version with an `outdated` verdict, per-agent `auth[]` with `route`, `status` and
`conflictKeys` (names only), `capabilities` in four states, a `stateId` digest and a `timing`
block — all from `agentic:runtime doctor --json`, measured. Its gaps are N-2 and N-3.

### Item 2 — binary, login, entitlement, quota and live availability as different facts

**The doctrine ships. Two of the five facts have a representation; three do not.**

Shipped: the permitted-versus-possible split (`packages/routing/src/probe.ts:11-14`,
`admit.ts:1-4`, `packages/routing/README.md` §"Availability expires"); `reachable` and `completed`
as separate observation fields (`probe.ts:171-174`); `degraded` as a verdict distinct from
`unavailable` (`probe.ts:87`); admission explicitly observing no quota (`admit.ts:3`).

Genuinely missing: `installed`, `authenticated`, `entitled` and `quota` have **no representation
at all** in `packages/routing`. Quota appears only as two routing triggers,
`native-quota-limit` and `openrouter-limit` (`schema.ts:12`); entitlement only as a two-value
`SUBSCRIPTION_STATES` enum, `included | outside_plan` (`schema.ts:13`). No shortcut exists because
the facts do not — there is nothing yet to keep separate.

The live evidence for why this matters is now stronger than the checkbox's wording. The
predecessor's demonstration is superseded but still correct and now **cited, not re-derived**:
`ARCHITECTURE.md` §10 and `doctrine/decisions/0004-uhp-park-evidence.md` record a router instance
that answers, with eleven harness CLIs installed, every model `available: false`, and zero harness
objects registered, for want of a provider credential. Per §10 that is evidence about detection
and nothing more; no UHP work is proposed. This run adds two independent demonstrations that need
no router at all: two netscript detectors disagreeing about whether `agy` is installed and
authenticated (R-2), and 8 of 38 resolutions naming a model the transport does not have (R-3).

### Item 3 — account bindings, per-model and per-family rules, provider precedence, client-version constraints; precedence through data

**Precedence through data is fully satisfied. Two of the four configuration axes are missing.**

Shipped: per-model family binding (`schema.ts:106`, `configuration.ts:3`); per-lane restriction
over transports, harnesses, families and models (`LaneConstraint`, `schema.ts:75-81`, enforced at
`resolve.ts:298-304`); ordered chain precedence consumed purely as data by `resolveFallback`
(`resolve.ts:163-189`) with a configured depth bound (`configuration.ts:27`); credential binding
by profile name (`schema.ts:33`, `admit.ts:135-142`).

Genuinely missing: **account or subscription identity** — `subscription` is a two-value enum on a
chain step with no account id, plan name or entitlement set, and every occurrence in the shipped
document is `"included"`. And **client-version constraints** — no field exists; the only trace is
a prose `note` string in the packaged configuration, and `schema.test.ts:74` actively forbids
version literals from runtime source. Both matter concretely: `opencode 1.18.30` against a pin of
`1.17.20` (`config/versions.ts:69`) is a real, measured skew that nothing in harness can express.

Also worth recording against this item: a global provider precedence independent of a lane chain
does not exist in harness, and **should not be built** — `MODEL_TRANSPORT_PRIORITY` is netscript's
(`delegation-matrix.ts:249-257`), and N-1 delivers it applied rather than copied.

### Item 4 — validated JSON and configuration operations with provenance and freshness; credential-free diagnostics

**Mostly shipped, across two packages. Two narrow gaps.**

Shipped: whole-document strict validation with a supported-version refusal
(`schema.ts:181,188-190`); hostile-input hardening before any value is read (`schema.ts:136-171`,
`load.ts:24-64`); byte-digest provenance computed and never accepted from the document
(`load.ts:17-20,85`); a refusal taxonomy with a renderer (`load.ts:11-16,118`); a credential-shape
gate that runs *first* and scrubs every outgoing diagnostic twice (`admit.ts:208-229,419-425,
451-455`) plus an echo guard that refuses to quote anything longer than the longest known name
(`admit.ts:188-193`); `probe.ts` never echoing observed `output`. In telemetry, a sixteen-code
`SourceRefusal` including `stale-source` and `future-source` (`source.ts:37-41`) and a test
asserting no credential, model or env-var-name canary reaches published output
(`cli.test.ts:995`).

Genuinely missing: **freshness on configuration**. `provenance` is one free-form `description`
string (`schema.ts:102`); there is no `capturedAt` anywhere in `RoutingConfiguration`, and the
shipped document smuggles its capture date into prose. Freshness machinery exists but only for
observations (`probe.ts:208,245`). And **configuration *operations*** are read-plus-validate only;
there is no write, diff or candidate-check operation.

Netscript's side of this item is stronger than harness's in one respect and weaker in another:
`CopilotCatalogAttestation` carries a `capturedAt` (`opencode-preflight.ts:71-78`) and the expense
decision carries `snapshotAgeMs`, but `usage_unproven` conflates eight causes and one error
string is wrong (R-4, request N-5).

### Item 5 — a versioned configuration and detection contract plus fixtures for the backend

**A versioned configuration contract ships. A detection contract does not, and there is no
machine-readable artifact.**

Shipped: `SCHEMA_VERSION = 1` (`schema.ts:7`) with the literal in the root type (`:100`) and a
dedicated refusal carrying `seen` and `supported` (`:188-190`); one fixture shipped and proven
resolvable from an extracted package tarball (`package.json:16,18-21`; `load.test.ts:102-117`).

Genuinely missing: there is nothing to version on the detection side, because detection does not
exist. And the validator is hand-written with zero dependencies, so **no schema artifact exists
that an OpenAPI generator could consume** — the requirement is not "add zod", it is that the
contract has no machine-readable form at all today. The single shipped fixture is a compatibility
transcription that its own README calls "not a fleet-parity result".

The evidence this item needs is now available cheaply: R-3 is a parity result, produced free, and
its shape — declared, present, absent, undetectable, per transport — is the natural fixture for a
detection contract.

### Item 6 — tests for missing CLI, unsupported introspection, logged-out, unknown entitlement, configured override, conflicting bindings

**Two of six covered, two partial, two absent.** Six test files, 1906 lines, run by `node --test`
over compiled `dist`.

| scenario | status | evidence |
|---|---|---|
| conflicting / invalid bindings | **covered** | `load.test.ts:213,258,207,339`; `family.test.ts:77,135,158,82`; `resolve.test.ts:50,320`; `admit.test.ts:310-311` reaches every refusal in the set |
| configured override cannot permit | **covered** | `probe.test.ts:269,279,287,388`; whole-document replacement `load.test.ts:301,316,324` |
| unsupported introspection | **partial** | `probe.test.ts:243,261,209,198` cover a probe that could not establish a fact; none covers a CLI with no introspection command |
| unknown entitlement | **partial at best** | `resolve.test.ts:171` exercises `outside_plan` as an approval gate, not as an unknown. There is no entitlement concept to leave unknown |
| **missing CLI** | **absent** | nothing. The nearest is `probe.test.ts:185`, an unreachable endpoint, which is not an absent binary |
| **logged-out** | **absent** | no test, and no state to assert on |

Netscript covers the two absent ones in adjacent form and is worth citing rather than
reproducing: `component_missing` and `auth_required` are first-class diagnostic codes
(`contract.ts:62-73`) and both were emitted for real on this host, measured. And
`packages/telemetry` already has real-child negative cases for oversize output, malformed JSON,
non-zero exit, timeout and a missing binary (`cli.test.ts` around `:956`), which is the
missing-CLI test this item asks for, in the wrong package.

---

## R-8 — What invariant I1 can record today

I1 requires requested and observed **model, effort, transport, role and tier** in the run receipt
(`ARCHITECTURE.md` §7). The shape to model it on already exists twice and neither needs
inventing.

**In netscript**, `LaunchIdentityEvidence` (`launch-route-identity.ts:23-28`) is I1's receipt
minus role and tier:

- `requested: { provider, model, effort, transport? }` (`:4-9`) — validated, and it refuses a
  request that is not explicit: a supported `--provider`, a non-empty `--model` and a legal
  `--effort` are all mandatory (`:40-56`).
- `observed: { provider: string|null, model: string|null, effort: string|null, transport?,
  catalog?: { model, present, capturedAt } }` (`:11-21`) — `null` is the encoding of
  unobservable, and `catalog` is the Copilot attestation embedded as evidence with its own
  freshness stamp.
- `status: 'matched' | 'pending' | 'mismatch'` and `mismatches: ('provider'|'model'|'effort')[]`,
  computed at `:60-82`: any `null` yields `pending`, any disagreement yields `mismatch`.
- `enforceLaunchIdentity` (`:85-93`) allows only `matched`, unless an operator passes an explicit
  route-mismatch opt-out. **`pending` is blocked by default.** Fail-closed, already.

**In harness**, `.llm/runs/architecture-v1--smoke/receipt.md` on `orch/divybot-304` is the
rendered human form, and it already has the three-way distinction this deliverable asks about,
stated in its own header: a value the session cannot know is `unknown`; a value it could only
state by exposing a host, path, session or credential is `withheld`. Its Deviations section names
the model gap as `ARCHITECTURE.md` §11 step 2 and the effort gap as §5. Model the receipt on that
file — it exists and works — and fill it from `ResolvedDelegationRoute` plus
`LaunchIdentityEvidence`.

What each field can honestly carry today, measured:

| field | requested | observed | verdict |
|---|---|---|---|
| **model** | concrete, from `ResolvedDelegationRoute.model`, once N-1 lands | `opencode_go`, `openrouter`, `ollama`, `github_copilot`: **observable** against `opencode models`. `agy`: observable, and currently **mismatch** for the one declared id. `claude`, `codex`: **`unknown`** — no free catalogue command | observable on 5 of 7 |
| **effort** | concrete, and `requestedEffort` preserves `provider_default` separately (`routing-policy.ts:105`) | `github_copilot`: **observable per model and per effort** via `copilot-preflight`. `claude`: `CLAUDE_EFFORT` is present in-session — a spike, not yet proven causal (R-6). `agy`: the vocabulary is narrower than the matrix's. `codex`, and the other opencode transports: **`unknown`** | the weakest leg; one cheap spike improves it |
| **transport** | concrete, `ResolvedDelegationRoute.transport` | derivable from the launched binary and profile (`TRANSPORT_AGENT`, `TRANSPORT_PROFILE`), but **not from the model string alone** — `.llm/runs/route-identity-uhp--s10/research.md` §2 is the standing warning, and `agy models` proves it live by listing two Anthropic-family models on a Google-transport CLI | observable at the launcher, not from output |
| **role** | present in `WorkloadRouteRequest.role` (`routing-policy.ts:87`) | not in `ResolvedDelegationRoute` at all; the launcher must carry it through | **gap: echo the request** |
| **tier** | present in `WorkloadRouteRequest.tier` (`:86`) | same | **gap: echo the request** |

Three conclusions, and none requires new machinery:

1. **`role` and `tier` are the only two of I1's five fields with no home in the existing
   resolution object.** The fix is to echo the request alongside the result — part of N-1's output
   shape, not a new contract.
2. **`withheld` has no encoding.** netscript uses `null` for both "unobservable" and "not
   stated", and the smoke receipt distinguishes `unknown` from `withheld` only in prose. Given
   what `claude auth status` returns — `email`, `orgId`, `orgName` alongside the three fields a
   receipt wants — the distinction is load-bearing, not decorative: a detector that returns a
   denylist will eventually publish an account identifier. This is the one place where issue 274's
   contract genuinely needs a field harness does not have, and it belongs in the versioned
   detection contract of item 5.
3. **A receipt that says `matched` on `claude` or `codex` today would be false**, because nothing
   observes the model. `enforceLaunchIdentity` already returns `pending` and blocks, which is
   correct; a harness receipt must render that as `unknown` and must not describe the run as
   verified. The smoke receipt already does exactly this, which is why it is the model.

---

## Contradictions surfaced, not resolved

- **C-1 — "The fix is upstream in netscript" is right; "export the capability table" is wrong.**
  Issue 275's fourth item asks for authoritative CLI export support. The resolver already exists
  (R-1), so exporting the table would move five rules across the boundary. N-1 supersedes the
  literal reading of that item without contradicting its intent.
- **C-2 — netscript's doctor and the vendor CLIs disagree about `agy`.** Doctor: `missing`,
  `auth_required`. Binary: `1.2.2`, and `agy models` fetched live. Both were run within one
  minute (R-2). Resolution is N-2; the contradiction is recorded because it is the cleanest
  available proof that "installed" is detector-dependent.
- **C-3 — `ARCHITECTURE.md` §5 says effort is a real argument for one CLI; three of four have
  one.** Measured in R-6. Not resolved here: an agent may not amend the charter. Route is a
  numbered decision per §13.
- **C-4 — the predecessor recorded that nothing on this host produces an expense snapshot; one
  exists.** A conforming ollama snapshot is present, and 39.5 hours stale (R-2). Both statements
  are operationally the same — nothing usable — but the premise matters for the plan, because the
  producer exists and is merely not scheduled.
- **C-5 — `provider_default` is in the matrix vocabulary and is not a provider default.** It is
  coerced to `high` by a harness-side constant, `OPENCODE_TOOL.defaultVariant`
  (`config/versions.ts:70`, applied at `routing-policy.ts:137-139`), on 6 of 38 primaries and 18
  of 76 candidates. Nothing at the point of use says a substitution occurred; only
  `requestedEffort` preserves it.
- **C-6 — a source comment describes a deliberate choice the resolver cannot make.**
  `delegation-matrix.ts:172-175` versus the measured `.find()` behaviour at
  `routing-policy.ts:158-162`. N-7.
- **C-7 — transport vocabulary still does not align, and step 4 does not need it to.** Issue 271's
  research C-8 records that harness `TRANSPORTS` is `native | openrouter` and `HARNESSES` cannot
  spell `github_copilot` or `ollama`. N-1 makes that moot for resolution — harness consumes
  `ResolvedDelegationRoute`, which spells all seven — but the local vocabulary is still wrong for
  detection, and reconciling it is step 5's audit, not this run's.

---

## Unknowns reported to the coordinator

- **U-1 — Does `claude --effort` set `CLAUDE_EFFORT`?** Present with a legal value in this
  session; neither repository references it. Proving it needs one paid launch with a known flag
  and an environment read-back. Cheapest available step toward I1's effort leg. **Spike.**
- **U-2 — Does the contributor tier of `muse_spark_1_3` refuse `max`?** Asserted by the
  predecessor; no netscript source read by this run states it, and confirming it costs a paid
  call. Recorded as a spike, not a finding (R-5, N-7).
- **U-3 — Does the dispatcher ignore `model:` and `effort:` overrides?** Asserted by the
  predecessor and consistent with `ARCHITECTURE.md` §5 and the smoke receipt's deviations. **Not
  verified here:** the dispatcher is the Orchid fork and its source is not on this host. Cited,
  not measured.
- **U-4 — Why does `codex doctor` exceed 90 seconds?** Measured, cause not determined. It matters
  only because it disqualifies the one command that self-describes as diagnosing codex auth.
- **U-5 — What is the `opencode auth list` machine-readable form?** The measured output is a
  drawn box with display names and kinds. A detector must not parse box-drawing characters. Either
  a `--json` flag exists and was not found, or N-3 should ask for one.
- **U-6 — Is entitlement per account or per credential?** `openCodeCredentialProviderForModel`
  maps a model-id prefix to exactly one provider (`lib/provider-credential.ts:43-48`) and
  `environmentWithOpenCodeCredential` clears every rival key (`:109-129`), so one credential is
  assumed per provider. `coordinator-discovery.md` records that one account can serve both seams.
  Whether the configuration schema must admit more than one account per provider is an owner
  question and belongs in `plan.md`, not here.

---

## What this run deliberately did not produce

`plan.md`. Issue 274's execution rules require research **and an independent plan evaluation**
before product mutation, and `doctrine/WORKFLOW.md` Stage G forbids mutation until `plan-eval.md`
reads `PASS`. Producing a plan that cannot be evaluated, or code that cannot be evaluated, would
be waste. Research needs no evaluator; it is the step that could be delivered now, and it is
what this file is.

---

## Citations

Every command below was executed by this session on the agent host on 2026-09-13 from the
assigned worktree, read-only and free. Raw output is reproduced in `verification.md`; no operator
path, credential value or account identifier is retained in either file.

[observed — `deno task agentic:matrix -- --json` and `-- --help`, NetScript source `155dbbe90`;
 topic: five top-level keys, 5 tiers, 8 roles, 17 logical models, 6 efforts, 76 candidates, 4
 coordinator scopes, 7-transport `transportPriority`, documented flag surface, zero capability
 export; executed 2026-09-13]
[observed — `resolveWorkloadRoute` imported and called for 15 tier/role/availability combinations
 and for every populated cell's primary; topic: the resolution completes to a concrete transport
 and model string, takes detection as input, fails closed on an unauthorized privileged tier and
 on an empty cell; executed 2026-09-13]
[observed — `MODEL_CATALOG` imported; topic: 41 capability declarations, per-transport
 distribution, one and only one duplicate same-transport declaration, no model with zero
 capabilities; executed 2026-09-13]
[observed — `agentic:runtime doctor --json`; topic: per-component binary, version and `outdated`
 verdict, per-agent `auth[]` with route/status/conflictKeys, four-state `capabilities`, `stateId`
 digest, `timing` block, exit 2 for degraded, and the absence of any `opencode` component;
 executed 2026-09-13]
[observed — `agentic:provider-canary --all`; topic: credential-free static preset validation with
 `attestedEffort`, `liveEligible` and a named incompatibility code; executed 2026-09-13]
[observed — `agentic:copilot-preflight` swept over 3 declared Copilot ids × 6 matrix efforts, 18
 attestations, plus one absent model as a negative control; topic: model presence and effort
 variant presence are separately observable with a `capturedAt`, and effort support is
 non-monotonic; executed 2026-09-13]
[observed — `agentic:expense-watch` for `opencode_go` with the full routing id and with the bare
 name, for `ollama` with the host's snapshot, and with `--help`; topic: live three-window
 allowance, `usage_stale` at 39.5 hours against a 15-minute ceiling, a wrong credential error
 string on an unprefixed id, and an argument error reported as `usage_unproven`; executed
 2026-09-13]
[observed — `claude --version`, `claude --help`, `claude auth status`, `codex --version`,
 `codex login status`, `codex --help`, `codex doctor`, `agy --version`, `agy --help`, `agy models`,
 `opencode --version`, `opencode auth list`, `opencode models`, `gh --version`, `command -v` for
 each transport binary; topic: per-transport installed/version/authenticated/entitled evidence,
 effort argument vocabularies, live catalogue sizes, and the three account identifier fields a
 detector must withhold; executed 2026-09-13]
[observed — declared capability ids cross-referenced against the captured live catalogues; topic:
 35 of 35 opencode-hosted ids present, the single `agy` id absent with three effort-suffixed
 variants in its place, 19/8/11 outcome split over the 38 primaries, 6 `provider_default`
 coercions; executed 2026-09-13]

[source: `.llm/tools/agentic/runtime/delegation-matrix.ts:65-97,166-178,249-257,286-297,312-323`;
 topic: transport vocabulary, capability shape, the duplicate openrouter declaration and its
 comment, transport precedence, privileged-tier authority, deep-research restriction; inspected
 2026-09-13]
[source: `.llm/tools/agentic/runtime/routing-policy.ts:80-135,137-139,141-186,190-232`; topic: the
 existing resolver, its availability inputs, the transport→agent/provider/profile maps, the
 `provider_default` coercion, evaluator family opposition; inspected 2026-09-13]
[source: `.llm/tools/agentic/runtime/launch-route-identity.ts:4-93`; topic: I1's requested/observed
 receipt shape, `null` as unobservable, the embedded catalogue attestation, `pending` blocked by
 default; inspected 2026-09-13]
[source: `.llm/tools/agentic/runtime/subscription-expense.ts:12,17-37,60-69,144,163-178,202-228,
 283,294,320-327` and `cli/expense-watch.ts:44,65-69,89-95,107-114`; topic: the eight
 `usage_unproven` sites and the snapshot contract; inspected 2026-09-13]
[source: `.llm/tools/agentic/lib/provider-credential.ts:6-48,67-101,109-129` and
 `runtime/provider-usage.ts:138-176`; topic: credential binding by env var name, the 0600
 permission check, model-prefix→provider mapping, and the misleading credential error; inspected
 2026-09-13]
[source: `.llm/tools/agentic/config/versions.ts:45-50,66-84` and `config/subscriptions.ts:5,9-15,
 26-50`; topic: pinned client versions, `defaultVariant`, credential file paths, the 15-minute
 snapshot ceiling and the model-weighted inclusion table; inspected 2026-09-13]
[source: `.llm/tools/agentic/wsl/wsl-foundation.ts:30-47,155-161,248-300` and
 `runtime/adapters/foundation-adapter.ts:117-147`; topic: the component probe table, the hardcoded
 foreign `agy` path, the filename-regex auth heuristic, the antigravity file markers, and the
 report digest; inspected 2026-09-13]
[source: `.llm/tools/agentic/runtime/contract.ts:23-44,50-73,89-104` and
 `opencode/opencode-preflight.ts:55-58,71-78`; topic: agent and provider vocabularies, effort
 vocabulary, observed foundation components, the diagnostic-code taxonomy, `RouteIdentity`, and
 the read-only catalogue attestation; inspected 2026-09-13]

[source: `packages/routing/src/probe.ts:11-23,87-126,165-199,208,217,316-325,413-415`; topic: the
 no-I/O contract, the four availabilities, the twelve refusals, and the asymmetry that a constant
 may refuse and never permit; inspected 2026-09-13]
[source: `packages/routing/src/resolve.ts:163-189,232-233,243-251,264-315` and
 `schema.ts:7,11-13,75-81,100-115` and `load.ts:11-20,85,118` and `admit.ts:1-4,12-35,135-142,
 188-193,419-425,451-455` and `configuration.ts:1-27` and `family.ts:104-138`; topic: what item 3
 and item 4 already satisfy and what they cannot express; inspected 2026-09-13]
[source: `packages/telemetry/src/cli.ts:713-738,763-772` and `source.ts:8-24,31-41,48-51` and
 `cli.test.ts` around `:956,:995`; topic: the existing bounded credential-safe subprocess reader,
 credential binding by name, the sixteen-code refusal taxonomy, and the canary
 non-publication test; inspected 2026-09-13]
[source: `packages/routing/src/*.test.ts`, 1906 lines over six files; topic: which of item 6's six
 scenarios are covered, partial or absent; inspected 2026-09-13]

[source: `ARCHITECTURE.md` §5, §7/I1, §9, §10, §11 and §13 at `aa06a6c`; topic: the effort gap,
 the receipt invariant, the three cost rows, the park and its evidence, the build order, and the
 amendment route; consulted 2026-09-13]
[source: `doctrine/decisions/0004-uhp-park-evidence.md`; topic: the router-instance evidence about
 detection, and that the park holds; consulted 2026-09-13]
[source: `.llm/runs/architecture-v1--smoke/receipt.md` on `orch/divybot-304`; topic: a real
 dispatch receipt, its requested/observed table, and its `unknown` versus `withheld` rule;
 retrieved 2026-09-13]
[source: `.llm/runs/routing-configuration--271/research.md` §"External leg" and contradiction C-8,
 and `.llm/runs/route-identity-uhp--s10/research.md` §2; topic: the prior export inventory and the
 standing warning that the running CLI is not the model provider; consulted 2026-09-13]
[source: this run's `coordinator-discovery.md` and `reset-checkpoint.md` at
 `feat/274-capability-detection`; topic: the 2026-09-08 scope, the bounded-execution prior art,
 and the record that `research.md` and `plan.md` did not exist; consulted 2026-09-13]
