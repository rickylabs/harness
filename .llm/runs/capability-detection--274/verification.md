# capability-detection--274 — verification

This is a research run. It produced no product code, so there is nothing to test; what follows is
the receipt for the **measurements** `research.md` relies on. Every row is a command this session
executed on the agent host on 2026-09-13, with its actual result. `pnpm run build` was run to
confirm the documentation-only change leaves the repository green, not to claim a gate on new
behaviour. **Independent plan and implementation evaluation is pending with the coordinator and is
not inferred from anything here.**

Baseline: harness `aa06a6c` (origin/main), branch `research/274-capability-detection`, run from
the assigned isolated worktree. Fleet authority read at NetScript source `155dbbe90`. Raw output
and three scratch probe scripts remain in local scratch outside git. This receipt contains no
operator location, no credential value and no account identifier: the three identifier fields
returned by `claude auth status` were redacted with a substitution filter at the moment of
capture, before the output reached this session.

## Commands and actual results

| Command | Result |
|---|---|
| `deno task agentic:matrix -- --json` | Exit 0; 11,349 bytes. Top-level keys exactly `schemaVersion` (1), `mode` (`full`), `tiers`, `coordinators`, `transportPriority`. 5 tiers; 8 role arrays plus 3 policy objects per tier; 17 distinct logical model ids; 6 efforts; 76 candidates; 4 coordinator scopes; `transportPriority` = 7 strings. Substring `capab` occurs 0 times |
| `deno task agentic:matrix -- --help` | Exit 0; documented flags are `--tier`, `--role`, `--plan-evaluator`, `--impl-evaluator`, `--fallback-of`/`--fallback`, `--json`, `--help`. No capability or resolve view |
| `deno run --allow-read` importing `MODEL_CATALOG` | Exit 0; 41 capability declarations totalled — `agy 1, claude 2, codex 3, github_copilot 3, ollama 6, opencode_go 12, openrouter 14`. Exactly one model declares two capabilities on one transport (`muse_spark_1_3`, `openrouter` ×2, 3 capabilities total). Zero models with no capabilities |
| `deno run --allow-read` calling `resolveWorkloadRoute` over 15 tier/role/availability combinations | Exit 0. Returned concrete `{agent, provider, profileId?, model, effort, logicalModel, family, transport, requestedEffort}` in every resolvable case. Threw `complex workload tier requires explicit owner or milestone-coordinator authorization` with no authorization, and `simple/plan is not applicable` on an empty cell |
| Same, over every populated cell's primary (38 resolutions) | Exit 0. Transport distribution `agy 8, claude 5, codex 6, github_copilot 8, opencode_go 11`. Cross-referenced against the captured live catalogues: 19 present, 8 model-id-absent (all `agy`), 11 undetectable (5 `claude`, 6 `codex`). 6 primaries coerced `requestedEffort: provider_default` to `effort: high` |
| `deno task agentic:runtime doctor --json` | **Exit 2** (`status: degraded`), and that is the truthful result, not a PASS. Reported 18 components with versions and statuses, `auth[]` for `claude` (ready) and `antigravity` (auth_required), `capabilities` for three agents, a `stateId` digest and a `timing` block. Diagnostics: `component_outdated` node, `component_missing` antigravity/dotnet/aspire, `auth_required` ×2. **No `opencode` component appears at all** |
| `deno task agentic:provider-canary --all` | Exit 0; `status: "passed"`; 5 presets, each with `validation`, `launchValid`, `liveEligible`, `agenticTurn`, `transport`, `incompatibility`, `attestedEffort`. Two presets `liveEligible: false`, one with `incompatibility: "codex-native-namespace-tool"`. Credential-free |
| `deno task agentic:copilot-preflight -- --model github-copilot/grok-4.6 --variant high` | Exit 0; `{"present":true,"variantPresent":true,"capturedAt":...}` |
| Same, `--variant max` | `{"present":true,"variantPresent":false,...}` — model present, effort variant absent |
| Same, `--model github-copilot/not-a-real-model --variant high` | `{"present":false,"variantPresent":false,...}` — negative control behaves |
| Same, swept over 3 declared Copilot ids × 6 matrix efforts (18 runs) | All 18 returned an attestation. `gemini-3.8-flash`: low/medium/high/provider_default yes, xhigh/max no. `kimi-k3`: low/high/max/provider_default yes, **medium no**, xhigh no. `grok-4.6`: low/medium/high/xhigh/provider_default yes, max no |
| `deno task agentic:expense-watch -- --provider opencode_go --model opencode-go/muse-spark-1.3-contributor --estimated-cost-usd 0.01` | **Exit 4**, `reason: "provider_rate_limited"`, `snapshotAgeMs: 0`. Three live windows: rolling-5h 0% of $12 ok; **weekly 100% of $30, status `rate-limited`, exhausted**; monthly 93% of $60 ok; each with `resetsAt`. No credential or account id in the output. This is a refusal, not a PASS, and it is the correct answer |
| Same, with the **bare** model name `muse-spark-1.3-contributor` | Exit 4, `{"reason":"usage_unproven","error":"OpenCode Go usage credential is unavailable"}`. **The error string is wrong** — the credential file is present at mode 0600; the model id lacked the `opencode-go/` prefix that selects the credential policy |
| `deno task agentic:expense-watch -- --provider ollama --snapshot $HOME/.config/netscript-agentic/ollama-usage-snapshot.json --estimated-cost-usd 0.01` | Exit 4, `reason: "usage_stale"`, `snapshotAgeMs: 142074498` (39.5 h against a 15-minute ceiling). A conforming snapshot exists on this host; it is unusable because it is stale, and the reason code says so correctly |
| `deno task agentic:expense-watch -- --help` | Exit 4, `{"allowed":false,"reason":"usage_unproven","error":"unknown argument: --help"}`. An argument error reported as a usage verdict |
| `grep -n usage_unproven` over `subscription-expense.ts` | 7 return sites at `:144,170,178,210,228,283,294`, plus an 8th catch-all at `cli/expense-watch.ts:107-114` |
| `command -v` for `claude codex antigravity agy opencode ollama gh` | `claude`, `codex`, `agy`, `opencode`, `gh` present. `antigravity` and `ollama` absent as binary names — `agy` is the antigravity CLI and Ollama here is a cloud provider behind `opencode` |
| `claude --version` | `2.1.270 (Claude Code)` |
| `claude auth status` | Exit 0; JSON with `loggedIn: true`, `authMethod: "claude.ai"`, `apiProvider: "firstParty"`, `subscriptionType: "max"`, plus `email`, `orgId`, `orgName` — **the last three redacted at capture and never recorded** |
| `claude --help` | Documents `--effort <level>` with the vocabulary `(low, medium, high, xhigh, max)`, and an `auth` subcommand with `login`/`logout`/`status`. No models subcommand |
| `printenv` name-only filter | `CLAUDE_EFFORT` is present in this session's environment with value `high`. `grep -rn CLAUDE_EFFORT` returns 0 hits in netscript `.llm/tools/` and 0 in harness. No provider API-key variable is set in this environment |
| `codex --version` | `codex-cli 0.154.0`, with a non-fatal stale-temp-dir warning on stderr |
| `codex login status` | Exit 0; `Logged in using ChatGPT` |
| `codex --help` | 24 subcommands; `doctor` present; **no models subcommand**. Effort is `-c model_reasoning_effort=<level>`, a config override |
| `codex doctor` | **Terminated at a 90-second timeout (exit 143).** Not a failure of the command as such; it disqualifies it as a pre-dispatch probe. Cause not determined |
| `agy --version` | `1.2.2` — while `agentic:runtime doctor` reported `antigravity` **missing** in the same minute |
| `agy --help` | Documents `--effort` with the vocabulary `(low|medium|high)` only — no `xhigh`, no `max`. Subcommands include `models` |
| `agy models` | Exit 0; performed a live fetch and returned 14 model ids — so the transport is authenticated, while the doctor reported `antigravity-auth: auth_required`. Exact anchored match for the bare `gemini-3.8-flash` returned **0**; `gemini-3.8-flash-high`, `-medium`, `-low` are present. Two of the 14 are Anthropic-family models served by a Google-transport CLI |
| `opencode --version` | `1.18.30`, against `OPENCODE_TOOL.pinnedVersion = '1.17.20'` |
| `opencode auth list` | Exit 0; 4 credentials as display name plus kind — OpenRouter `api`, OpenCode Go `api`, Ollama Cloud `api`, GitHub Copilot `oauth`. No value printed. Output is a drawn box, not machine-readable |
| `opencode models` | Exit 0; 463 ids. By prefix: `openrouter` 367, `opencode-go` 27, `github-copilot` 27, `ollama-cloud` 24, `n5air` 9 + 2, `opencode` 7. All 35 declared opencode-hosted capability ids are present; 0 absent |
| `ls -l $HOME/.config/netscript-agentic/` | `ollama.env`, `opencode-go.env`, `openrouter.env` and `ollama-usage-snapshot.json` all present at mode 0600. Keys of the snapshot: `provider`, `capturedAt`, `tier`, `monthlyUsedUsd`, `concurrentRequests` — **values not recorded** beyond `provider: ollama`, `tier: pro` and the capture timestamp |
| `gh --version` | `gh version 2.100.0 (2026-09-03)` |
| `wc -l packages/routing/src/*.test.ts` | 1906 lines over six files |
| `pnpm run build` | **Exit 0.** Green at this branch's head with the documentation-only change applied |

## Critical proofs

- **The resolution the harness resolver needs already completes inside netscript.**
  `resolveWorkloadRoute` (`routing-policy.ts:190`) returned a concrete transport and concrete
  provider model string in every resolvable case, took detection as input via `RouteAvailability`
  (`:80-83`), and failed closed without privileged-tier authority. Nothing in harness calls it and
  no CLI exposes it.
- **Four facts, separated by measurement rather than by argument.** `claude` is installed
  (`command -v`), at 2.1.270 (`--version`), authenticated (`loggedIn: true`) and entitled
  (`subscriptionType: "max"`) — four commands' worth of distinct evidence — and its live model
  availability is still unobservable because the CLI lists no models.
- **`installed` is itself detector-dependent.** `agentic:runtime doctor` reported `antigravity`
  missing and unauthenticated; `agy --version` returned 1.2.2 and `agy models` fetched live, in
  the same minute. Root cause located: `wsl-foundation.ts:43` probes the hardcoded path
  `/home/codex/.local/bin/agy`, while `doctor()` already computes `${home}/.local/bin/agy` at
  `:257` and uses it only as a display label.
- **A completed resolution is not a verified resolution.** The single `agy` capability resolves to
  `gemini-3.8-flash`, which is absent from the live catalogue; the live ids are effort-suffixed.
  All 8 `agy` primaries in the matrix are affected.
- **Effort capability is real, per-model, and non-monotonic.** `copilot-preflight` separates
  `present` from `variantPresent` with a `capturedAt`; `kimi-k3` serves `low`, `high` and `max`
  but not `medium`. Any ladder assumption over effort is unsafe.
- **`usage_unproven` is eight causes**, seven in `subscription-expense.ts` and one in the CLI's
  catch-all, and on the unprefixed-model path the accompanying error string names a credential
  problem for an identifier problem.
- **Credential hygiene held throughout.** No credential value, token, cookie or account identifier
  was printed or written. Credential presence was established by env var **name** and by file
  existence and mode. The three identifier fields `claude auth status` returns were filtered
  before capture.

## Failures inspected and limitations

- `codex doctor` was terminated at 90 seconds and its output was never seen. The claim in
  `research.md` is only that it exceeded that bound on this host, which is what was measured.
- A first attempt to sweep Copilot variants lost 9 of 18 rows to output handling and was re-run
  in full from a script writing to a file. Only the complete 18-row second run is reported.
- `opencode auth list` output is box-drawn. Its content was read visually; no parser was written,
  and `research.md` records the absence of a machine-readable form as an open question rather than
  assuming a `--json` flag exists.
- The ollama snapshot's numeric contents were not recorded, only its keys and staleness. That is
  sufficient for the finding and avoids publishing consumption data.
- Three claims in `research.md` are explicitly **cited, not measured**, and are labelled as such
  there: that the dispatcher ignores `model:` and `effort:` overrides (the Orchid fork's source is
  not on this host), that the `muse_spark_1_3` contributor tier refuses `max` effort, and the
  router-instance observation in `ARCHITECTURE.md` §10, which is cited to the charter and to
  decision 0004 rather than re-derived.
- `CLAUDE_EFFORT=high` is present in this session's environment. That `claude --effort` is what
  sets it was **not** proven — doing so needs a paid launch — and it is filed as spike U-1, not as
  a finding.

## What is not claimed

No detection implementation, no new package, no schema, no configuration file and no contract
exists for 274 as a result of this run. `pnpm run build` returning 0 proves the repository is
green with four markdown files added; it proves nothing about behaviour that was not written. The
per-transport detection table and the 38-resolution audit are measurements of what the *current*
commands do on *this* host on *this* date; they are evidence for a plan, not a plan, and not a
parity certification. Nothing here has been independently evaluated.
