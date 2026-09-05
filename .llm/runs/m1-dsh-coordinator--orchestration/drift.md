# Drift Log: M1 — dsh coordinator foundation

Drift is append-only. Record facts that diverge from the plan, RFC, doctrine, or current-state
documentation.

## 2026-09-04 — Gate tooling vendored, creating a second copy with its own lifecycle

- **What:** `.llm/tools/harness/{render-milestone-status,validate-milestone-cluster}.ts` and
  `.llm/tools/gates/{contract,evidence-set}.ts` were copied into this repository rather than
  referenced from a netscript checkout.
- **Source:** `rickylabs/netscript` @ `1c9eeef1a58316cff416bb9049e90346a78c89cc`.
- **Expected:** doctrine assumes one canonical copy of the gate toolchain.
- **Actual:** there are now two, and they will diverge the moment netscript's validator gains a
  rule this copy does not have. A run that gates green here could gate red there.
- **Severity:** significant.
- **Action:** accept. The alternative — a hard dependency on a netscript checkout being present on
  whatever box runs the gate — makes the dispatch gate unrunnable in exactly the situation it
  exists for. The cost is bounded: four files, one external import (`@std/path`).
- **Evidence:** `deno.json`; the pin table in `supervisor.md`.

## 2026-09-04 — Canary declared `not-planned` against a cadence that expects one per boundary

- **What:** `reporting.canary.state` is `not-planned` for the whole milestone.
- **Source:** `workflow/canary-cadence.md`.
- **Expected:** a canary target named at each wave boundary.
- **Actual:** this repository publishes no artifact. There is nothing to canary until a dsh
  instance boots the `rickylabs` profile on the N5 (`#49`), at the W1 boundary.
- **Severity:** minor.
- **Action:** defer. The reasoning is carried in `eta.basis` inside the state file so it survives
  independently of this log, and the underlying every-boundary-vs-surface-gated question is
  recorded as an owner decision rather than resolved by habit.
- **Evidence:** `milestone-cluster-state.json` → `reporting.canary`.

## 2026-09-04 — Lane orchestrator ids are placeholders, and say so

- **What:** all four lanes carry `harness-m1/<lane>/unbound`.
- **Source:** the validator requires a non-empty `orchestratorAgentId` per lane.
- **Expected:** a real session identity per lane.
- **Actual:** no topic orchestrator has been launched, because no dispatch has been authorized.
- **Severity:** minor.
- **Action:** accept until Stage C. The `/unbound` suffix satisfies the schema without asserting
  a session that does not exist — a fabricated id would pass the same check and mislead every
  later reader, including the coordinator's own ownership matching.
- **Evidence:** `milestone-cluster-state.json` → `lanes[].orchestratorAgentId`;
  `reporting.blockers[topic-orchestrators-unbound]`.

## 2026-09-04 — Coordinator running on the third tier of its route

- **What:** the milestone coordinator row is `astra@medium → fable_5_1@medium → opus_5@xhigh`;
  this run executes on `opus_5@xhigh`.
- **Source:** `workflow/lane-policy.md`.
- **Expected:** the first reachable tier.
- **Actual:** neither of the first two was reachable from this session at run start.
- **Severity:** minor.
- **Action:** accept — this is the policy's own fallback path. Logged because the condition is
  transient and must not be mistaken for a standing property of this repository.
- **Evidence:** `supervisor.md` § Recorded lane/eval overrides.

## 2026-09-04 — The `fixes` lane holds one issue

- **What:** lane tally is `docs` 3, `internals` 22, `fixes` 1, `features` 23.
- **Source:** `milestone-inventory.json`.
- **Expected:** four roughly comparable topic lanes.
- **Actual:** a greenfield repository has almost nothing to fix. The four lanes are mandatory and
  fixed, so the lane exists and is nearly empty.
- **Severity:** minor.
- **Action:** accept. The lane is where defects filed *from inside* this milestone land; it fills
  as the other lanes produce code. Rebalancing by reclassifying feature work into `fixes` would
  make the lane look healthy and the board dishonest.
- **Evidence:** `milestone-status.md` → orchestrator matrix.

## 2026-09-04 — The two-thread lane split was never real, and is retracted

- **What:** the programme was planned and published as two coordinating threads — this run on
  architecture (`#31` `#32` `#36` `#38`), a NetScript supervisor thread on software
  (`#33` `#34` `#37`), and `#35` `#39` joint. The split was published as a comment on `#30` and a
  steer was delivered to that thread.
- **Source:** `#30` comment; `context-pack.md` § Next Steps; `worklog.md` § Handoff Notes.
- **Expected:** a second thread picking up three epics and reporting findings back.
- **Actual:** that thread was already committed to unrelated work and was not running this
  programme. Three epics had no owner while the board recorded them as owned, and the steer landed
  in a thread whose context it did not describe.
- **Severity:** significant. This is not a scheduling inconvenience — for a period the board
  asserted ownership that did not exist, which is the specific failure the status file is meant to
  make impossible.
- **Action:** retract, do not reassign. The milestone consolidates to a single coordinator for all
  nine epics. Scope is not held open for a thread that is not working it, and no lane is bound to
  an identity that is not real — the same reasoning that put `/unbound` on the lane ids in the
  first place, applied one level up.
- **Consequence for dispatch:** W0 is armed and held rather than fired. That thread's
  harness-related findings are reconciled into this run before any agent starts, because it saw the
  box directly and its evidence is not otherwise available here. Dispatching first would mean
  agents building on a picture already known to be incomplete.
- **Evidence:** `worklog.md` § Stage C — prepared and held.

## 2026-09-04 — Local inference is down across all three backends

- **What:** from `ai-agents`, `lm-studio:1234`, `llama-vulkan:8080` and `llama-rocm:8081` all fail
  to connect.
- **Source:** Stage B transport checks.
- **Expected:** a local tier available for cheap evaluator work and for verifying the capability
  probes.
- **Actual:** all three refuse connection. DNS from `ai-shared` resolves every one of them
  correctly and both llama containers log nothing at all, so the services are not listening — this
  is not a network fault.
- **Severity:** minor for M1, significant for the run that verifies `#59` and `#60`.
- **Action:** route hosted and schedule no local evaluators. No W0 or W1 leaf depends on local
  inference, so dispatch is not blocked. `#59` and `#60` cannot be verified against a live backend
  until the cause is fixed on the box.
- **Evidence:** `worklog.md` § Stage B.

## 2026-09-04 — `codex --version` answers with a permission warning

- **What:** `codex` on `ai-agents` prints a stale-temp-dir permission warning instead of a version
  string.
- **Source:** Stage B CLI inventory.
- **Expected:** a version.
- **Severity:** minor, pending.
- **Action:** accept for now, but watch the first codex-bound slice rather than assuming health.
  This is the shape of failure that presents later as "the agent started and did nothing", and the
  cost of noticing it at dispatch time is far lower than at review time.
- **Evidence:** `worklog.md` § Stage B.

## 2026-09-04 — `#40`'s dispatch inherited its model instead of declaring it

- **What:** divybot logged, in the same second, two lines about the same issue:
  `issue #40: goal inject failed: goal did not register after retries`, then
  `issue #40: spawned claude on n5-agents/claude-40 (branch orch/divybot-40)`.
- **First reading, and it was wrong.** This was recorded as "an agent with no goal: it is up, it
  holds its allowance, and it produces nothing", with a watch-and-tear-down remediation. That
  conclusion was drawn from process state and the absence of a branch. It did not survive contact
  with the agent's own terminal: `#40` had its goal, ran install to green, ran typecheck and build,
  wrote memory notes on the pnpm 11 `allowBuilds` requirement, and opened **PR #91**. The inject
  failed on its first attempts and succeeded on a retry. The entry is corrected in place rather
  than left standing with a rebuttal appended, because a drift log that has to be read twice to
  learn the truth is worse than one that is simply right.
- **Actual root cause, established from primary evidence:** the session launched on
  `claude-fable-5-1`, and Fable 5 is rate-limited until midnight. The session transcript
  (`/home/agent/.claude/projects/-ephemeral-orch-work-issue-40/*.jsonl`) contains 80 assistant
  turns all on `claude-fable-5-1`, alongside `rate_limit_error` and
  `rate limit. Please try again later.`. The failed goal inject and the slow progress are the same
  fact seen twice: a rate-limited model that fails the first injects and then crawls.
- **Why it ran on Fable at all — the defect worth keeping:** nothing in the dispatch chose that
  model. `divybot.json` binds `targets` as label → repo → **agent** (`harness` → `claude`) and
  carries no model or effort field anywhere. `#40`'s `/swarm` block declared only
  `harness: claude` and `timeout: 180m`. So the model fell through to the host default in
  `/home/agent/.claude/settings.json`, which read `"model": "claude-fable-5-1"`. The lane's model
  was **inherited, not chosen** — the one thing a routing matrix exists to prevent.
- **Severity:** significant, and systemic rather than local. Every future `harness: claude` leaf
  would have inherited the same default, so a matrix that is correct on paper was not binding on
  anything that actually launched.
- **Action taken:** see the entry below. The host default is no longer Fable, and the launch is no
  longer allowed to be silent about its model.
- **What survives from the first reading:** the meta-point still holds and is still owed to `#33`
  and `#51`. divybot reported success on the line *after* it reported failure, so a status read
  that trusted the last log line would have said "spawned" and been right only by accident. A
  spawn is unconfirmed until the agent produces an artifact — and, equally, an *absence* of
  artifacts is not proof of a dead agent. Both readings were available from the log; only the
  agent's own terminal settled it.
- **Evidence:** `worklog.md` § Stage C — model binding corrected.

## 2026-09-04 — Two probes gave confident wrong answers; recording the method, not just the result

- **What:** while verifying pickup, two intermediate readings were wrong and were corrected before
  they reached a conclusion. `gh run list` returned nothing, which briefly read as "the dispatch
  did not trigger" — but this repository has **no Actions workflows at all**, so that output was
  never capable of saying anything about dispatch. Then a port check on `ai-agents` printed
  "nothing on 222x" and briefly read as "the spawn transport is down" — but neither `ss` nor
  `netstat` is installed there, so the empty result meant *no tool*, not *no listener*. `sshd` was
  in fact running with live `node@notty` sessions.
- **Severity:** minor for the milestone, significant for `#59`/`#60`.
- **Action:** the capability probes must distinguish **negative** from **unable to answer**. A
  probe whose failure mode looks identical to a real negative will eventually be believed, and a
  coordinator that acts on it will tear down healthy work. Every probe reports three states, not
  two.
- **Evidence:** this run; the divybot log is what actually settled pickup.

## 2026-09-04 — The Fable 5 window, and the fallback the matrix already specified

- **What:** the owner reports Fable 5 is unavailable until midnight, and instructs that the agent
  launched on it falls back to the netscript harness matrix
  (`.llm/harness/workflow/lane-policy.md` in `rickylabs/netscript`). Two further caveats: a session
  must **always** launch with a model named by the matrix, and the default must **never** be Fable 5
  — it is Opus 5 medium.
- **Why this is a fallback and not an exception:** the ruleset already anticipates exactly this.
  Its route table carries a declared **token-limit fallback** column so a quota-blocked primary
  has a pre-ratified successor, and the substitutions here were obtained by calling
  `resolveCanonicalFormalEvaluatorRoute` / `resolveCanonicalRoute`, not by transcribing rows.
- **Scope, stated precisely:** the policy contains six Fable rows; this milestone reaches **two**,
  both on PR #90 — its `review_codex_complex` review (→ Opus 5 · medium) and its
  `formal_impl_evaluation` (→ `z-ai/glm-5.3-flash` · max over OpenRouter). PR #91 is Codex family
  end to end. An earlier draft of this entry listed the whole Fable column as blocked, which
  overstated the exposure fourfold and is corrected here.
- **The window is a symptom, not the cause.** `#40` was not running a blocked lane; it was running
  *off* the table entirely. Fable has no implementer row under any lane — it is a sub-agent
  analysis and evaluator model. A rate limit is simply what made a silent misroute visible. The
  finding is the launch-identity defect; Fable being down is how it surfaced.
- **Action:** host default changed from `claude-fable-5-1` to `claude-opus-5` with effort `medium`
  (snapshot kept at `~/.claude/backups/settings.json.backup.1788552925`). `#40`'s live session was
  moved to Opus 5 medium in place rather than torn down — it was already `done` with PR #91 open,
  so killing it would have destroyed finished work to fix a binding that only matters on the next
  turn. The bound routes, including the Fable-blocked substitutions, are recorded in
  `supervisor.md` § Model binding and the Fable 5 window.
- **The one interaction the owner should know about:** `modelSettings.claude-opus-5.effortLevel`
  was `xhigh` and is now `medium`, per the stated default. The matrix routes the **orchestrator**
  (`planning_decisions`) to Opus 5 · **high**, so an orchestrator that relies on the host default
  now launches a tier below its lane. Under the owner's own first caveat the orchestrator should
  launch with an explicit model and effort rather than inheriting either — which is the same
  instruction applied to the session that gives the instructions.
- **Time-bound:** the Fable substitutions expire at midnight. They are recorded as a dated
  observation, not as a standing property of the matrix.
- **Evidence:** `supervisor.md`; divybot config read from `orchid:/data/divybot.json`.


## 2026-09-04 — Agents are children of `herdr`, not of bare ssh

- **What:** this run earlier recorded that divybot's agents run "over non-interactive ssh
  (`sshd: node@notty`), NOT under tmux". The ssh part was observed; the conclusion was too strong.
  Walking the actual ancestry of both live agents gives
  `claude → herdr server (pid 922) → herdr → bash loop → tmux session maint`. divybot ssh's in;
  **`herdr`** is what spawns and supervises the agent, inside a tmux session after all.
- **Severity:** minor for W0, significant for `#33`/`#51`/`#59`/`#60`, which have to describe the
  real execution topology rather than a plausible one.
- **Why it matters:** `herdr` is a far better control surface than a pid. `herdr agent list`
  returns per-agent `agent_status` (`working`/`done`/`blocked`), cwd, and terminal title;
  `herdr agent read` returns the agent's actual terminal. That is the difference between inferring
  progress from the absence of a branch and reading what the agent is doing. It is also what
  corrected the `#40` entry above. A coordinator with `herdr` does not need to ask "status?".
- **Action:** `#33`/`#51` should treat `herdr agent list` as the primary liveness probe and the
  GitHub signals (comment → branch → PR) as the completion probe. They answer different questions
  and this run mistook one for the other.
- **Evidence:** process ancestry and `herdr agent list` output, this run.


## 2026-09-04 — `#36`'s body begins with `/swarm`, and that is a live trigger

- **What:** epic `#36` documents the `/swarm` dispatch grammar, and does so by starting its body
  with a literal `/swarm` line followed by `model:    <id>`, `effort:   <level>`, `router:` and
  `profile:` placeholder rows.
- **Severity:** minor while it stays unlabelled; significant the moment anyone labels it.
- **Why:** the `harness` label is the trigger and the body is the directive block. Labelling `#36`
  would dispatch an agent whose declared model is the literal string `<id>`. The only thing
  preventing it is that nobody has labelled an epic yet.
- **Action:** fence the grammar block in `#36` so it is documentation rather than a directive, or
  move it into `doctrine/`. Not urgent, but it is a loaded trigger sitting in the issue that
  specifies the dispatcher.
- **Evidence:** `gh issue view 36`; the grammar itself is otherwise the best record of the
  supported keys, and is what confirmed that `model:` and `effort:` are expressible in a `/swarm`
  block at all — which is what makes the fix above a one-line addition per leaf rather than a
  dispatcher change.


## 2026-09-04 — OpenRouter data policy opened; relay evaluator lanes are reachable

- **What:** the matrix routes both `formal_*_evaluation` fallbacks to OPEN models over OpenRouter
  (`Qwen 3.8 Flash · max` for plan evaluation, `GLM 5.3 Flash · max` for implementation
  evaluation). Those endpoints were being excluded from routing by the account's data-training
  policy, which is why the route table carried a second fallback to AGY Gemini 3.6 Flash "if
  OpenRouter limited". The owner enabled the paid and free training-data endpoint toggles.
- **Effect:** with Fable 5 blocked until midnight, the relay tier is what carries IMPL-EVAL for
  Codex-authored work. Had the OpenRouter path stayed closed, the blocked-lane rule would have
  forced a second hop to a third family for a gate that is supposed to be a native opposite-family
  check. It is now one hop, off the table.
- **The cost, recorded because it is a real trade and not a formality:** the enabled toggles admit
  providers that may retain and train on prompts and completions. Relay evaluator briefs must
  therefore carry the diff under review and nothing else — no run artifacts, no `.llm/` evidence,
  no credentials. That is already the standing rule for this repository's harness directories; it
  now has teeth it did not have this morning.
- **Unchanged:** GLM over OpenRouter still returns zero thinking blocks. A GLM verdict is evidence
  of "tools + streaming, no reasoning trace" and must never be cited as reasoning evidence.
- **Evidence:** owner-supplied OpenRouter privacy settings, 2026-09-04 22:27.

## 2026-09-04 — `/swarm` binds the agent. It does not bind the model or the effort.

One commit ago this run recorded that `#40` launched on an inherited model because its `/swarm` block
declared none, and the remediation was to add explicit `model:` and `effort:` keys to the dispatch
blocks. Dispatching the two W0 reviews tested that remediation, and it does not hold. The keys are
read by humans. They are not read by the dispatcher.

**The dispatch that proved it.** `#92` (review of PR #91) declared `harness: codex`,
`model: gpt-5.6-sol`, `effort: xhigh`. Its lane is `review_claude`, whose route is
Codex · `gpt-5.6-sol` · **`xhigh`**. What actually launched, read out of the session rollout rather
than out of the brief:

| Dimension | Declared in `/swarm` | Observed at launch | Where the observed value came from |
| --- | --- | --- | --- |
| agent | `codex` | `codex` | **the `/swarm` block** — `divybot.json`'s `harness` target defaults to `claude`, so `codex` can only have come from the issue body |
| model | `gpt-5.6-sol` | `gpt-5.6-sol` | `~/.codex/config.toml` — which already pins that model, so this match proves nothing |
| effort | `xhigh` | `high` | `~/.codex/config.toml`'s `model_reasoning_effort = "high"` |

`#93` (review of PR #90) tells the same story from the other side: declared `claude-opus-5` /
`medium`, observed `claude-opus-5` / `medium` — but those are exactly the host defaults that were
changed earlier today, so again the match is inheritance, not binding.

**Why the agent dimension is the decisive evidence.** `divybot.json` carries
`{ "label": "harness", "repo": "rickylabs/harness", "agent": "claude" }` and nothing else — no model
field, no effort field, no argv or env passthrough anywhere in the file. If the `/swarm` block were
inert, `#92` would have spawned **claude**. It spawned codex. So the dispatcher does parse the block;
it parses `harness:` and stops. `model:` and `effort:` fall through to the host config silently, with
no warning and no record.

**What this changes.** The `#40` finding was that a dispatch inherited its model instead of declaring
it. That was too generous. The dispatch had no way to declare it. Writing `model:` into an issue body
is a comment, and the previous commit's remediation — patching the `#40` and `#42` blocks — is
therefore documentation of intent, not a route binding. It should be read that way and not as a fix.
The single binding surface for model and effort today is the per-host agent config
(`~/.claude/settings.json`, `~/.codex/config.toml`), which is global to the host: every Claude agent
on `n5-agents` gets one model and one effort, and every Codex agent gets one model and one effort.
A ruleset with per-lane efforts cannot be expressed through a per-host default. The two cannot both
be satisfied, and today the host wins.

**The one deviation this produced, stated plainly.** `#92` is reviewing PR #91 at `high` where
`review_claude` specifies `xhigh` — one tier under-provisioned. It is not being torn down: the
invariants that carry the review's weight are intact (opposite-family evaluator, generator ≠
evaluator, no self-certification), a relaunch would inherit the same host default and change nothing,
and mutating the global Codex pin to `xhigh` to win one tier would silently re-route every future
Codex implementer on the host — a larger drift than the one it fixes. Recorded as observed-vs-
requested, which is what launch identity being data rather than prose is for.

**Fix, and who owns it.** This is a dispatcher change, not an issue-body change: divybot must read
`model:`/`effort:` and pass them through as spawn arguments (`codex -c model_reasoning_effort=…`,
`claude --model …`), or refuse the dispatch when a block names a route it cannot bind. Failing closed
is the better default here — a review that silently runs a tier low is worse than one that does not
start, because it produces a verdict that looks routed and is not. Until then, every dispatch's
effort must be verified after launch rather than assumed, and this run does that.
