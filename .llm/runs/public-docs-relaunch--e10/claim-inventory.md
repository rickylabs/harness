# Claim inventory — public-docs-relaunch--e10 (W1)

**Stage H worksheet for E10 child [#209](https://github.com/rickylabs/harness/issues/209).** Every
claim the rewritten `README.md` and repaired docs pages make, with its authority and status label,
resolved against the merge baseline **before** prose landed, per plan W1
([`plan.md`](plan.md#w1--freeze-claims-before-prose)). Status vocabulary is D2 only:
**Implemented** (source + meaningful tests here), **Composed** (the `dsh-app` profile registers it),
**Host-dependent** (use needs a live provider/server/credential/transport a clone does not supply),
**Stub** (placeholder reserving dependency shape).

## Baseline pin and re-pin history

| When | Baseline | Delta | Effect on this inventory |
| --- | --- | --- | --- |
| Plan/research (Stage B/E) | `9d800b5` | — | research.md pin |
| Implementation start | `78d2490` (2026-09-07) | includes #213 tutorial fix (five profile rows) | all source reads below first resolved here |
| Pre-commit re-pin 1 | `3c866d2` (2026-09-07) | `8cf90c3`/`aaa5178` BOARD.md-only publishes; **#214** (`728e561`) board session projection; **#216** (`3c866d2`) governance display | rows 7–8 added; #214/#216 surfaces re-read and every preserved pasted block re-verified byte-wise at `3c866d2` |
| Pre-commit re-pin 2 | `c0f4434` (2026-09-07) | **#219** (`e78935a`) implements the #218 fix — every board *terminal* view banners anomalies and marks affected rows (`renderAnomalyBanner`, `render.ts:92-115`); `digest` keeps its own `## Anomalies` section (`digest.ts:254-266`); **#221** (`5645a1c`) adds a machine-readable release reason to the subagents lease | the interim #218 wording (columns/status hide anomalies) was true at `3c866d2` and false at merge time; rewritten to the #219 behavior before commit; step-3 board literals re-verified unchanged at the new line numbers |
| Pre-commit re-pin 3 | `a4693bd` (2026-09-07) | **#222** (`0768ed9`) makes the telemetry guarantee a dispatch check: a raw (unmarked) provider cannot be selected — `isInstrumented` checked at selection (`provider.ts:237,411`); BOARD.md publish | status-row *conclusions* unchanged (registry still empty, refusal still named); citations re-anchored to moved lines; README/inventory snapshot pin corrected to `a4693bd` (finding M1) |

| Follow-up integration | `c98fbeb` (2026-09-07) | Owner merged #223 with the #212 link correction while the conditional-review fixes were local; #224 renamed the liveness types and #226 bounded telemetry titles | Corrections carried onto merged main without replacing the owner link fix. Forge CLI, subagent composition, LLM adapter and board projection have no source delta from a4693bd; the four stub declarations remain. Status conclusions unchanged; current provider refusal references re-anchored after #224. |

Status rows were last resolved against `c98fbeb` (merged main before the correction follow-up);
`git diff c98fbeb..HEAD` touches only docs and run artifacts. Contradictions
found while resolving are recorded inline, not smoothed over.

## Diagram arrows (README §"How the layer works")

Edges are exactly the plan-evaluated diagram ([`plan.md:102-118`](plan.md), verdict PASS in
[`plan-eval.md`](plan-eval.md) F1/F2). Every edge is also stated in README prose (W2 gate).

| Edge | Claim | Authority |
| --- | --- | --- |
| H → G | Humans hold intent in GitHub issues/labels/PRs; GitHub is board truth | ratified decision 3, [`AGENTS.md`](../../../AGENTS.md) "Ratified decisions"; [`docs/concepts/03-the-board.md:3-5`](../../../docs/concepts/03-the-board.md) |
| H → F | `dsh-forge` is invoked explicitly by an operator to set labels/process up | [`packages/forge/src/cli.ts:135-143`](../../../packages/forge/src/cli.ts) (usage: doctor/labels/skill/init) |
| F → G | Forge mutates GitHub when invoked: named label create/update | [`packages/forge/src/labels/github.ts:39-40`](../../../packages/forge/src/labels/github.ts) (interface), `:95-109` (POST/PATCH via `gh api`) |
| G → B | `dsh-board` reads GitHub and projects; never writes | [`packages/board/src/github.ts:115-118`](../../../packages/board/src/github.ts) (`GhReadArgs` admits only `issue list`, `pr list`, `repo view`; `gh api` deliberately absent, comment `:97-114`) |
| B → C | Coordinator decisions consume state derived from the board projection; deciding ≠ doing | [`packages/coordinator/src/workflow.ts:1-8`](../../../packages/coordinator/src/workflow.ts) (shape inert; *doing* is somebody else's job); [`packages/coordinator/README.md:26-31`](../../../packages/coordinator/README.md) (reads JSON stdin, no network); **contradiction record:** nothing writes the state file yet — [`packages/coordinator/README.md:5-8`](../../../packages/coordinator/README.md); README caption says so |
| C → D | A dispatcher/operator on a live host performs effects | [`packages/coordinator/src/workflow.ts:24-33`](../../../packages/coordinator/src/workflow.ts) (`effect` = changes the world outside this process); no scheduler exists in-repo (durable loop #191 not built — parent steer 2026-09-07) |
| D → S | Autonomous vendor CLIs attach at `ctx.subagents` | [`packages/dsh-app/src/plugins/subagents.ts:1-8`](../../../packages/dsh-app/src/plugins/subagents.ts); [`docs/concepts/02-the-two-seams.md:7-15`](../../../docs/concepts/02-the-two-seams.md) |
| D → L | Prompt/token calls attach at `ctx.llm` | [`packages/dsh-app/src/plugins/llm.ts:1-8`](../../../packages/dsh-app/src/plugins/llm.ts); same concept rows |
| S → E, L → E | Both seams produce artifacts/changes/run evidence | [`docs/concepts/02-the-two-seams.md:58-61`](../../../docs/concepts/02-the-two-seams.md) (unit of work per seam); telemetry records both measures `:46-51` |
| E → T | Telemetry sinks and backfills the run record | [`packages/telemetry/README.md:1-20`](../../../packages/telemetry/README.md); env surface [`packages/telemetry/src/cli.ts:112-116`](../../../packages/telemetry/src/cli.ts) |
| T → H | Readable with no agent awake | [`packages/telemetry/src/cli.ts:1`](../../../packages/telemetry/src/cli.ts) (banner: "read from disk, with no agent awake"); [`docs/concepts/03-the-board.md:18-19`](../../../docs/concepts/03-the-board.md) (requirement) |
| E → A | Evidence does not write itself to GitHub; a human/dispatcher *chooses* the update | plan-eval F1 fix ([`plan-eval.md:7`](plan-eval.md)); board transport read-only (`GhReadArgs` above); forge mutations are label-setup only (`:39-40`), not evidence |
| A → G | The chosen update lands as an issue/label/PR change | same as H → G |

| README walkthrough step 2 ("every view says so — banner, marks; check carries the detail") | Authority: [`render.ts:92-115`](../../../packages/board/src/render.ts) (banner text, `!` marks, opt-out default), [`cli.ts:224-232`](../../../packages/board/src/cli.ts) (all three views render through it), [`digest.ts:254-266`](../../../packages/board/src/digest.ts) (digest's own section instead) — #219 at `c0f4434` |

Caption claims (mandatory per [`plan.md:120-131`](plan.md)):

| Caption claim | Authority |
| --- | --- |
| Harness supplies the deterministic decisions/services shown, not a continuously running, fully wired dispatcher | [`packages/coordinator/src/workflow.ts:1-8`](../../../packages/coordinator/src/workflow.ts); [`packages/coordinator/README.md:5-8`](../../../packages/coordinator/README.md) ("nothing writes the state file yet, and nothing runs the census on a schedule") |
| Profile composes an **empty** subagent registry | [`packages/dsh-app/src/plugins/subagents.ts:89-105`](../../../packages/dsh-app/src/plugins/subagents.ts) (`emptyRegistry` → `{ providers: [] }`, instrumented, provided) — lines re-anchored after #222 |
| Dispatch into the empty seam returns a named refusal, not a crash | [`packages/subagents/src/provider.ts:312`](../../../packages/subagents/src/provider.ts) (`no-providers` in the `BlockRule` union), `:381` (returned) — lines re-anchored after #222 |
| #222 (`a4693bd`): a raw, uninstrumented provider cannot be selected at all; dispatch checks the mark | [`provider.ts:237,411`](../../../packages/subagents/src/provider.ts) (`isInstrumented`/`instrumentedBy` at selection). Not claimed in README prose — it constrains future provider packages, not the empty registry |
| Local LLM routes are registered but host-dependent | [`packages/dsh-app/src/plugins/llm.ts:114-125`](../../../packages/dsh-app/src/plugins/llm.ts) (all three `BACKENDS` register; credentials from env at dispatch `:52-65`); [`packages/llm-local/src/backends.ts:33`](../../../packages/llm-local/src/backends.ts) (`lm-studio`, `llama-rocm`, `openrouter`) |

## Status matrix rows (README §"What exists at this baseline")

| # | Surface | Label(s) | Authority | Rationale / forbidden shortcut |
| --- | --- | --- | --- | --- |
| 1 | Five CLIs (`dsh-board`, `dsh-coordinator`, `dsh-telemetry`, `dsh-forge`, `dsh-profile`) | Implemented | binaries + suites in each package; generated reference byte-compares ([`scripts/cli-reference.mjs:1-20`](../../../scripts/cli-reference.mjs)); receipt: five `--help` exit 0 at `3c866d2` | forbidden: "shipped" as one flag; board/forge CLIs are Host-dependent for GitHub reach (row 10) |
| 2 | `dsh` profile composition | Composed | five rows: [`packages/dsh-app/src/bundle.ts:77,91,100,109,118`](../../../packages/dsh-app/src/bundle.ts); checkout-bound: [`packages/dsh-app/src/profile.ts:26-29`](../../../packages/dsh-app/src/profile.ts); receipt: install/check/dump-config in isolated `/tmp/dsh-home`, byte-exact vs tutorial | forbidden: registry install of the coordinator; profile is not published |
| 3 | `ctx.subagents` seam | Composed, empty | row 2 authorities + [`subagents.ts:89-105`](../../../packages/dsh-app/src/plugins/subagents.ts); refusal [`provider.ts:381`](../../../packages/subagents/src/provider.ts), union `:312` | forbidden: "full swarm", any availability claim; registry has zero providers at baseline |
| 4 | `provider-claude`, `provider-opencode` | Implemented; **not** Composed; Host-dependent to run | [`packages/provider-claude/README.md:18`](../../../packages/provider-claude/README.md) (SDK injected by a composition root); [`packages/provider-opencode/README.md:3`](../../../packages/provider-opencode/README.md) (long-lived external `opencode serve`); suites pass (receipt) | forbidden: implemented ⇒ composed or live; the profile registers neither |
| 5 | `ctx.llm` seam | Composed; destinations Host-dependent | [`llm.ts:114-125`](../../../packages/dsh-app/src/plugins/llm.ts); [`backends.ts:33`](../../../packages/llm-local/src/backends.ts); reachability/credentials resolved at dispatch ([`llm.ts:52-65`](../../../packages/dsh-app/src/plugins/llm.ts)) | forbidden: registered route ⇒ reachable backend; "zero headroom"/quota claims |
| 6 | Board session projection (#214 / #204 / #68) | Composed (when dsh provides `ctx.sessionProjections`); smoke-proven with synthetic input — **not** a daemon boot | [`packages/dsh-app/src/plugins/board.ts:1-28`](../../../packages/dsh-app/src/plugins/board.ts) (`ctx.harnessBoard` owns taxonomy; caller owns data+clock); [`board-projection.ts:18-19`](../../../packages/dsh-app/src/plugins/board-projection.ts) (strict DTO key + `harness/board-write`); owner statement [`packages/dsh-app/README.md:234-264`](../../../packages/dsh-app/README.md); receipt: `pnpm --filter @rickylabs/dsh-app run smoke:board-projection` → "board projection smoke passed", exit 0 | forbidden: claiming a full daemon boot, live sessions, or GitHub writes from the projection — GitHub stays authoritative, appends are local session events |
| 7 | Governance **display** (#216 / #205 display half) | Implemented + composed into the CLI display; live host adapter **not** included | `--observations` on tree/status: [`packages/telemetry/src/cli.ts:95,104-108`](../../../packages/telemetry/src/cli.ts); typed parse [`observations.ts`](../../../packages/telemetry/src/observations.ts); strict projection preserves it: [`packages/telemetry/src/public.ts`](../../../packages/telemetry/src/public.ts); owner demo [`packages/telemetry/README.md:121-219`](../../../packages/telemetry/README.md); rendering [`packages/telemetry/README.md:76-81`](../../../packages/telemetry/README.md) | forbidden: "production canary", live quota readings, claiming the producer exists; no flag ⇒ explicit UNKNOWN/UNAVAILABLE, unreadable ⇒ exit 3, expired ⇒ STALE — the display never invents headroom |
| 8 | `governance` (package), `netscript-bridge`, `provider-codex`, `provider-acp` | Stub | each README opens `**Status: stub.**`: [`governance:5`](../../../packages/governance/README.md), [`netscript-bridge:6`](../../../packages/netscript-bridge/README.md), [`provider-codex:6`](../../../packages/provider-codex/README.md), [`provider-acp:5`](../../../packages/provider-acp/README.md); [`packages/README.md:7-10,20`](../../../packages/README.md) | governance live authority is blocked behind #62 ([`packages/governance/README.md:45`](../../../packages/governance/README.md)); #216 display half does **not** change this row |
| 9 | `contracts` | Implemented; publishable — **no npm release claimed** | name/version, no `private`: [`packages/contracts/package.json:2-3`](../../../packages/contracts/package.json); tag-triggered pipeline [`.github/workflows/release-contracts.yml:27-33,56`](../../../.github/workflows/release-contracts.yml); `check:publish` receipt in build | forbidden: "installable from npm"; publish configured ≠ released; owner tag decision open (parent steer 2026-09-07) |
| 10 | GitHub transports (board, forge); `deploy/` stack | Host-dependent | `gh` or token, exit 3 without: [`packages/board/src/cli.ts:29-50`](../../../packages/board/src/cli.ts), [`packages/forge/src/cli.ts:110-133`](../../../packages/forge/src/cli.ts); deploy encodes one box: [`deploy/README.md:10-12`](../../../deploy/README.md) | forbidden: routing a newcomer into `deploy/` as a general install ([`plan.md:142-143`](plan.md)) |
| 11 | Durable orchestration loop | Not built — stated in prose, not as a matrix row (outside D2 vocabulary) | coordinator README:5-8 above; #191 open (parent steer); branch `docs/191-durable-loop-plan` is planning only | forbidden: any "runs itself"/"continuous" phrasing |

## README section claims (non-matrix)

| Section | Claim | Authority |
| --- | --- | --- |
| Hero | "deterministic coordinator layer"; dsh plugin monorepo; board projection; "without waking an agent to ask" | [`package.json:5`](../../../package.json) (description); [`packages/board/src/github.ts:115-118`](../../../packages/board/src/github.ts); [`packages/telemetry/src/cli.ts:1`](../../../packages/telemetry/src/cli.ts) |
| Hero scope note | dsh layer only; cockpits are separate products over a published contract package | [`AGENTS.md`](../../../AGENTS.md) decision 4; [`docs/concepts/01-what-this-is.md:27-37`](../../../docs/concepts/01-what-this-is.md) |
| Why this exists | agent output outpaces human review; status readable without interrupting; the working loop it replaces | [`docs/concepts/03-the-board.md:9-19`](../../../docs/concepts/03-the-board.md) (owns the originating complaint); current README:202-216 (owner's motivation prose, reused as fact-of-intent) |
| Why this exists | doctrine ran across three stacks with nothing in common; mechanics portable, knowledge specific | [`doctrine/WORKFLOW.md:5-6`](../../../doctrine/WORKFLOW.md) (autocorner PR #14); [`AGENTS.md`](../../../AGENTS.md) prior-art table; [`doctrine/PRINCIPLES.md:47-51`](../../../doctrine/PRINCIPLES.md) (principle 8). **Dropped:** t3.codes/Linear comparison — plan §2 forbids competitor comparisons not independently refreshed and cited this run |
| Who decides what | human: intent, owner forks, acceptance, running forge, choosing the GitHub update; agent: stochastic work, lifecycle moves per generated skill; layer: projection, eligibility, independence, ungated-effect refusal, record/replay | [`packages/coordinator/src/workflow.ts:16-19,126-137`](../../../packages/coordinator/src/workflow.ts) (gate-before-effect, checked); [`packages/coordinator/src/independence.ts:39`](../../../packages/coordinator/src/independence.ts) (`Seam` union); [`packages/coordinator/README.md:36-52`](../../../packages/coordinator/README.md) (refusal-first, blocker not degraded outcome); skill lifecycle [`.claude/skills/board-process/SKILL.md:29-49`](../../../.claude/skills/board-process/SKILL.md) (generated) |
| Choose your path | four audience routes | [`plan.md:133-143`](plan.md) (approved table) |
| Local proof first | Node ≥ 24, pnpm 11 | [`package.json:8-11`](../../../package.json) |
| Local proof first | `build` runs eight checks around the compile; docs that lie fail the build | [`package.json:23`](../../../package.json) (build chain); [`CONTRIBUTING.md:36-52`](../../../CONTRIBUTING.md) (owns the table) |
| Local proof first | `policies` needs nothing but the build; prints both policies and the default | receipt: exit 0 at `3c866d2`; output names `opposite-family (default)` and `seam-or-family` |
| Local proof first | why `node packages/…/dist/cli.js`: all but `contracts` are `private: true` | [`packages/board/package.json:6`](../../../packages/board/package.json) (representative); [`packages/README.md:43-48`](../../../packages/README.md) (convention); root `skill:install` does the same ([`package.json:27`](../../../package.json)) |
| Local proof first | board/forge exit **3** without `gh`/`GITHUB_TOKEN`; telemetry needs no network | EXIT tables: [`board/src/cli.ts:29-50`](../../../packages/board/src/cli.ts), [`forge/src/cli.ts:110-133`](../../../packages/forge/src/cli.ts); generated reference [`docs/reference/cli/README.md`](../../../docs/reference/cli/README.md) |
| Architecture commitments | two seams / GitHub board truth / generated artifacts / durable evidence, each linking its owner page | owners: [`docs/concepts/02-the-two-seams.md`](../../../docs/concepts/02-the-two-seams.md), [`03-the-board.md`](../../../docs/concepts/03-the-board.md), [`05-determinism.md`](../../../docs/concepts/05-determinism.md) + [`CONTRIBUTING.md:105`](../../../CONTRIBUTING.md), [`doctrine/PRINCIPLES.md:12-16`](../../../doctrine/PRINCIPLES.md) + [`docs/concepts/04-the-run.md`](../../../docs/concepts/04-the-run.md) — README summarizes in one or two sentences and links; does not restate (principle 9) |
| Ratified decisions | the four decisions, restated compactly; reversing one is a change to #30 first | [`AGENTS.md`](../../../AGENTS.md) "Ratified decisions"; GOVERNANCE.md:15,61 link `README.md#ratified-decisions` — **anchor must survive** (GOVERNANCE.md not in mutation manifest) |
| Packages | grouped inventory; packages/README.md remains the authoritative package → epic → attaches-to table | [`packages/README.md:12-25`](../../../packages/README.md) |
| Repository map | dirs as mapped; `deno.json`/`deno.lock` run `.llm/tools/`, open owner fork on #140 | files exist at baseline (ls receipt); current README:296-318 (owner prose reused) |
| Contributing | live inbox: `harness` label dispatches a real agent, ~30-second poll | [`AGENTS.md:37-41`](../../../AGENTS.md) (owns the full hazard); community files exist (ls receipt) |
| Licence | MIT, matching dsh; reversible decision on #30 | [`LICENSE`](../../../LICENSE); [`package.json:6`](../../../package.json) |
| Board pointer | BOARD.md generated every half hour, never hand-edited; edits are reverted not rejected | [`.github/workflows/board.yml:15-18`](../../../.github/workflows/board.yml) (`cron: */30`); [`AGENTS.md`](../../../AGENTS.md) ("stale by at most half an hour") |

## Docs repair rows (W3)

| File | Repair | Authority for the corrected sentence |
| --- | --- | --- |
| [`docs/concepts/02-the-two-seams.md:118-131`](../../../docs/concepts/02-the-two-seams.md) | replace stale "four provider packages are stubs / llm-local is a stub" | rows 3–5, 8 above; plan W3 names lines 126–127 exactly |
| [`docs/concepts/01-what-this-is.md:39-49`](../../../docs/concepts/01-what-this-is.md) | "five binaries … composed into one profile" conflates binaries with profile rows; forge has no row | bundle rows [`bundle.ts:77-118`](../../../packages/dsh-app/src/bundle.ts) |
| [`docs/concepts/03-the-board.md:45-49`](../../../docs/concepts/03-the-board.md) | "ten phases are listed in the root README" — new README does not list them; point at the generated skill, which does | [`.claude/skills/board-process/SKILL.md:29-49`](../../../.claude/skills/board-process/SKILL.md); non-duplication (principle 9) |
| [`docs/concepts/05-determinism.md:93-97`](../../../docs/concepts/05-determinism.md) | "links are next (#147)" is stale — `check:links` runs inside `build`; the remaining named gap is pasted prose output (#212) | [`package.json:18,23`](../../../package.json); [`scripts/check-links.mjs:1-42`](../../../scripts/check-links.mjs); #212 via commit `78d2490` message |
| [`docs/README.md:22`](../../../docs/README.md), [`docs/tutorials/README.md:13`](../../../docs/tutorials/README.md), [`docs/tutorials/01-from-clone-to-board.md:75`](../../../docs/tutorials/01-from-clone-to-board.md) | `README.md#quickstart` anchor dies in W2 → repoint to `#local-proof-first` | check-links anchor rule [`scripts/check-links.mjs:33-37`](../../../scripts/check-links.mjs) |
| [`docs/tutorials/01-from-clone-to-board.md`](../../../docs/tutorials/01-from-clone-to-board.md) step 2 | **#217 absorption:** `init`/`doctor` resolve the repo root from `--cwd`, default the working directory — run from the harness clone without `--cwd`, `init` overwrites the clone's tracked `.github/labels.yml` and board skill with the scratch taxonomy. Rewrite: prerequisite = a *cloned* scratch repo; pass `--cwd ../scratch` to `doctor`, `init --dry-run` **and** `init`; explain generated files belong in the scratch checkout for review/commit there; state plainly that no automatic origin/target guard exists (that code half is open on #217 — do not claim it) | [`packages/forge/src/cli.ts:1475`](../../../packages/forge/src/cli.ts) (`resolve(values.cwd ?? process.cwd())`), `:157` (usage); owner finding #217 (parent steer 2026-09-07) |
| tutorial step 3 taxonomy sentence | corrected twice as the code moved: at `3c866d2` (#218 open) it named `check`/`digest` as the only views naming contradictions; at `c0f4434` (#219 merged) every terminal view banners and marks, `check` names the detail — final sentence states the #219 behavior and keeps "run the check" as the action the banner itself instructs | [`render.ts:92-115`](../../../packages/board/src/render.ts) (banner + marks), `:193-199` (opt-out default), [`digest.ts:254-266`](../../../packages/board/src/digest.ts) |
| tutorial step 2 readbacks (final pass, H1) | added offline `git -C ../scratch status --short` + live `labels check`; init's exit-0-without-apply behavior stated; exit-3 scope corrected to `labels check`/`plan`/`apply` | [`packages/forge/src/cli.ts:583-604`](../../../packages/forge/src/cli.ts) (`cmdInit` maps unavailable apply → `EXIT.ok`, prints `skipped apply`), `:356-392` (`doctor` exits 0), `:1606-1608` (`TransportError` → 3), `:426-440` (`labels check` drift → non-zero), `:416` (success line) |
| tutorial steps 1, 2, 5 pasted output | validate-or-remove per finding #212 | receipts table below |

## Pasted-output validation receipts (finding #212)

Re-verified at `3c866d2` after rebuild (`pnpm install --frozen-lockfile && pnpm run build`, exit 0),
in isolated temp homes only (`/tmp/dsh-home`, `/tmp/tel-home`, `/tmp/e10-fixtures`); no real home,
credential, or vendor transcript read; no network.

| Block (tutorial unless noted) | Verdict | Evidence |
| --- | --- | --- |
| Step 1 test totals `# pass 122` | **REMOVED** — doubly stale: baseline prints `ℹ pass 258` (dsh-app) and the reporter shape changed (`ℹ` spec lines, not TAP `#`); count grows by design ⇒ brittle | `pnpm test` receipt, all packages `fail 0`, exit 0; prose now states the format only |
| Step 2 `doctor` output block | **REMOVED** — values host/version-dependent (prints the machine's `gh` version and live label counts), unverifiable offline; six field labels verified from source and named in prose instead | [`packages/forge/src/cli.ts:378-383`](../../../packages/forge/src/cli.ts) (`repository`, `github`, `labels present`, `labels proposed`, `lane prefix`, `skill dirs`) |
| Step 3 healthy-check line `no anomalies — every item has exactly one status label` | **KEPT** — byte-identical to the source literal at `3c866d2`, `c0f4434` and `a4693bd` | [`packages/board/src/render.ts:273`](../../../packages/board/src/render.ts); live GitHub run not performed (no network) — recorded limit |
| Step 3 anomaly excerpt (`## closed-but-unshipped` / `## no-status` + `  #N: detail`) | **KEPT** — kind ids, detail templates, and `  #N: ` / `## kind` layout all match source at all three pins; excerpt introduced as "read like this" | [`project.ts:179,181,297,299`](../../../packages/board/src/project.ts); [`render.ts:281,286-289`](../../../packages/board/src/render.ts); exit contract [`docs/reference/cli/dsh-board.md:45`](../../../docs/reference/cli/dsh-board.md) |
| Step 4 `install` block (five rows, #213) | **KEPT, preserved** — byte-exact vs real output at both baselines, with the documented `/path/to/harness` placeholder on the `link` line only | receipt: `install --home /tmp/dsh-home`, exit 0, `diff` clean |
| Step 4 `--dump-config` excerpt (five ids/names) | **KEPT** — byte-exact (tail −11) | receipt: `DSH_HOME=/tmp/dsh-home …/dsh --profile rickylabs --dump-config`, exit 0 |
| Step 4 `installed and matching.` | **KEPT** — byte-exact | receipt: `check --home /tmp/dsh-home`, exit 0 |
| Step 5 `record` line | **KEPT** — byte-exact | receipt: exit 0, `diff` clean |
| Step 5 `runs` one-line block | **REMOVED** — actual output carries two trailing pad spaces the block lacks; invisible to readers but fails byte validation, and trailing whitespace in Markdown is itself unstable | receipt: `od -c` shows `…opus-5␣␣\n` at both baselines; prose now describes the columns |
| Step 5 `why` block | **KEPT** — nine content lines byte-exact; real output adds one trailing blank line the fenced block omits (renders identically; noted, not silently altered) | receipt: `diff` clean on lines 1–9 |
| Step 5 failure lines (`no store on this box`, `named no seam … add "source"`) | **KEPT** — byte-exact from live fixture runs, including exit 3 for the incomplete scan | receipts at both baselines; literal also at [`live.ts:414`](../../../packages/telemetry/src/live.ts) |
| README `policies` | **no output pasted** — prose states what it prints | receipt: exit 0; output names both policies + default |
| tutorial step 2 `init` exit-code semantics (final pass, H1) | **PROVEN WITHOUT GITHUB** by the coordinator's injected-transport receipt: real CLI main with `CliOverrides.probeTransport` returning `kind:"none"` — `init --dry-run` → 0 (no file), `init` → 0 (labels.yml + skill written in fixture only), `labels check` → 3, `doctor` → 0; four injected probes, Node exit 0. Conclusion stands: init's exit code says nothing about GitHub | [`offline-forge-receipt.md`](offline-forge-receipt.md); seam [`packages/forge/src/cli.ts:1418-1422`](../../../packages/forge/src/cli.ts), `resolveContext` `:251-273`, `cmdInit` `:583-604` |
| **Incident record (correcting this file's earlier row):** the author's "isolated fixture" init run was **not** offline — `GH_CONFIG_DIR`/`HOME` overrides did not disable the inherited transport, the run attempted a real label POST against `owner/scratch` (HTTP 404, zero applied), and its `INIT_EXIT` was read after a pipe (tail's status, not the producer's). Constraint violation caught by the coordinator; user informed; superseded by the injected-transport receipt above. Not characterized as offline; not counted as validation | [`offline-forge-receipt.md`](offline-forge-receipt.md) §"Forge verification correction" | preserved: the run's outputs remain quoted only as the incident, never as a receipt |
| tutorial step 2 readbacks (H1): `gh label list --repo owner/scratch --limit 100` and `labels check` | **CLASSIFIED, NOT EXECUTED** — both are network instructions (need a gh transport against a real repo); documented with prerequisite, expected output, and a stop-if-fails rule; never claimed run | `labels check` semantics from [`cli.ts:426-440`](../../../packages/forge/src/cli.ts) + evaluator's transport-required observation; `gh label list` flags from established gh CLI knowledge, not execution |
| tutorial step 2 `git -C ../scratch status --short` | local file review only (what `init` wrote locally); NOT a live readback | shape verified against the local fixture (`?? .claude/`, `?? .github/`) |

## Forbidden claims (checked against final prose)

Unsupported at this baseline and absent from every changed file: production-ready / production
canary; autonomous or full swarm; zero headroom or any live quota figure; registry-installable
coordinator; contracts released on npm (publish is configured; the owner's tag decision is open);
#204/#205 "fully shipped" (only what #214/#216 actually merged is claimed, with the not-a-daemon-boot
and blocked-on-#62 limits); a forge origin/target guard (#217 code half open); a durable loop (#191
not built); any claim inferred from live board contents; competitor comparisons (t3.codes/Linear
paragraph dropped per plan §2 — not refreshed or cited this run); `init` exit 0 as proof labels
exist on GitHub (H1 — exit 0 covers the local files only); any cockpit UI ("no cockpit is built
here" is the claim); session-projection anomaly parity (#220 open — the projection carries task
phase and run completeness, not board anomaly/completeness metadata).

## W3 status-term search dispositions

Gate: every status-bearing sentence matching `stub`, `ships`, `shipped`, `today`, or a provider name
in the changed files has a disposition. Filled after W2/W3 drafting; see
[`worklog.md`](worklog.md) entry "W3 term search" for the executed search and per-hit disposition.
