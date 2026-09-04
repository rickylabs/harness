# Supervisor Identity — m1-dsh-coordinator--orchestration

Written at run start per `workflow/lane-policy.md` § Supervisor identity. A run dir without this
file is not activated. Other supervisors cross-peek a run by reading this file — it is how a run's
operating identity is discoverable without chat memory.

| Field | Value |
| --- | --- |
| Model | Claude Opus 5 (`claude-opus-5`) |
| Session | Claude Code desktop, session `5dc200b1-b629-4b56-b487-6990b69ef498` |
| Host | Windows 11 laptop (`win32`), user `chaut` |
| Checkout | ephemeral clone of `rickylabs/harness` (session scratchpad) |
| Worktree | same as checkout — this run touches only `.llm/`, no build tree is needed |
| Branch | `harness/m1-dsh-coordinator--orchestration` |
| Baseline | `b7d5e586e32f31ef44cab7b1327ab890f8e23794` on `main` (2026-08-14, last doc commit) |
| Run ID | `m1-dsh-coordinator--orchestration` |
| Role | milestone coordinator (topic orchestrators unbound — see § Deliberate deviations) |

This is a **milestone-cluster run**, not a generic supervisor integration run. The route is
`workflow/milestone-run.md` + the `agent-milestone-orchestrator` skill. The generic supervisor
integration branch does not apply.

## Routes in force

Bound as of 2026-09-04. The lanes are no longer `unbound`: W0 established that an unbound lane does
not fail closed, it silently inherits the host default, so every lane below names a model and an
effort. Reference `.llm/harness/workflow/lane-policy.md` for the complete route table; only the rows
this milestone actually launches are copied here.

| Task lane | Policy route | In force this run | Role |
| --- | --- | --- | --- |
| milestone coordinator | `astra@medium → fable_5_1@medium → opus_5@xhigh` | `opus_5@xhigh` (desktop session) | Step 0 freeze, wave plan, cluster state, dispatch gate, owner reporting |
| architecture (privileged) | `opus_5@xhigh` | `opus_5@xhigh` | the deliverable itself — the coordinator layer's structure |
| `light_implementation` | Codex · Sol · low | Codex · Sol · low | small, well-specified leaves |
| `normal_implementation` | Codex · Sol · medium | Codex · Sol · medium | default implementer for M1 leaves |
| `complex_implementation` | Codex · Sol · high | Codex · Sol · high | new subsystems (`#42` ran here) |
| `deep_analysis` | Fable 5 · medium | **blocked** → Codex · Sol · high | architecture/design analysis inside a leaf |
| `review_claude` | Codex · Sol · xhigh | Codex · Sol · xhigh | review of Claude-authored PRs (**PR #91**) |
| `review_codex_complex` | Fable 5 · medium | **blocked** → Opus 5 · medium | review of Sol·high work (**PR #90**) |
| `review_codex` | Fable 5 · low | **blocked** → Opus 5 · low | review of Sol·medium work |
| `review_codex_light` | Opus 5 · high | Opus 5 · high | review of Sol·low work |
| `review_codex_fast` | Opus 5 · medium | Opus 5 · medium | review of Luna·max work |
| `chore_code` | Claude · Opus 5 · medium | Claude · Opus 5 · medium | mechanical leaves |
| `documentation_review` | Claude · Sonnet 5 · high | Claude · Sonnet 5 · high | docs lane review |
| `docs_audit` | Codex · Sol · medium | Codex · Sol · medium | opposite-family by design; no cross-family fallback |
| `formal_plan_evaluation` | native opposite-family | Fable 5 · medium **blocked** → Qwen 3.8 Flash · max | PLAN-EVAL |
| `formal_impl_evaluation` | native opposite-family | Fable 5 · medium **blocked** → GLM 5.3 Flash · max | IMPL-EVAL of Codex work |
| `major_ui_ux_design` | GLM 5.2 · xhigh | dormant | no UI in M1 (`apps/` is out of scope by owner decision) |

The two `formal_*_evaluation` fallbacks are **relay** lanes, and the matrix restricts those to OPEN
models. They were unreachable earlier today because the OpenRouter account excluded endpoints with
permissive data policies; the owner opened those toggles on 2026-09-04, so `Qwen 3.8 Flash · max`
and `GLM 5.3 Flash · max` are now routable and the "AGY Gemini 3.6 Flash · high if OpenRouter
limited" second fallback is not needed. Two consequences worth stating rather than discovering:
relay evaluator prompts now reach providers that may train on them, so they must carry only the
diff under review and never run artifacts, credentials or `.llm/` evidence; and GLM over OpenRouter
returns no thinking blocks, so a GLM verdict is citable as "tools + streaming, no reasoning trace"
and never as reasoning evidence for a gate.

Two invariants constrain how this table may be read. **Generator ≠ evaluator:** a lane may not
review its own output, so PR #91 (Claude-authored) routes to a Codex reviewer and PR #90
(Codex-authored) routes to a Claude reviewer — the substitutions below preserve that property, which
is the only reason they are acceptable. **No implicit escalation:** where a fallback is a *higher*
effort than the blocked primary it is recorded here explicitly rather than chosen at launch.

## Recorded lane/eval overrides

**Coordinator tier.** The milestone coordinator row is `astra@medium → fable_5_1@medium →
opus_5@xhigh`. At run start (2026-09-04) neither of the first two tiers was reachable from this
session, so the run executes on the third. This is the policy's own fallback path, not a deviation
from it. It is recorded because *which* tier ran is part of the run's identity, and because the
condition that pushed it there is transient — it is a dated observation, not a standing fact about
this repository.

**Privileged `architecture` tier.** `lane-policy.md` fails this row closed unless the owner or a
milestone coordinator authorizes it, with the authorizer named and a non-empty rationale recorded.

| Field | Value |
| --- | --- |
| Authorizer | owner (chautems-eric) |
| Instrument | Session instruction: *"once the epic and sub issues are created enable orchestrator profile mode using the updated harness and AGENTIC toolchain we just merged"*, following *"I suggest you do the plan and context aggregation and focus on architecture"* |
| Rationale | The deliverable of this run **is** an architecture: the two-seam split between `ctx.subagents` and `ctx.llm`, the tri-regime governance model, and the published-contract boundary. Routing it to a cheaper tier would produce a plausible-looking structure the fleet would then build against for months. The cost asymmetry is the justification. |
| Scope of the grant | This run's Step 0 and Stage A artifacts only. It does not extend to implementation leaves, which route by their own topic lane. |

**Model binding and the Fable 5 window (owner instruction, 2026-09-04).** Two instructions, one
cause. The owner reports Fable 5 unavailable until midnight and directs the agent launched on it to
fall back to the netscript matrix; then adds the standing caveat that *a session must always launch
with a model according to the matrix, and the default must never be Fable 5 — the default is
Opus 5 medium*.

| Field | Value |
| --- | --- |
| Authorizer | owner (chautems-eric) |
| Instrument | Session instructions: *"for the agent that launched fable 5 ... fallback to what's described in the netscript agent harness matrix"*; *"1. session should always launch with a mode[l] according to matrix 2. the default should never be fable 5 the default is opus 5 medium"* |
| Rationale | W0 proved the binding was never enforced: `divybot.json` carries no model field, `#40`'s `/swarm` block carried no `model:` key, and the launch therefore inherited `claude-fable-5-1` from the host `settings.json` — into a rate limit. The matrix was correct and non-binding at the same time. |
| Scope | Host default + every dispatch in this milestone. The Fable substitutions are time-bound and lapse at midnight; the "declare the model explicitly" rule does not. |

Applied in three places, because a default alone would not have prevented W0:

1. **Host default** (`n5:/home/agent/.claude/settings.json`) — `claude-fable-5-1` → `claude-opus-5`,
   `modelSettings.claude-opus-5.effortLevel` `xhigh` → `medium`. Snapshot at
   `~/.claude/backups/settings.json.backup.1788552925`. This is the safety net, not the mechanism.
2. **Dispatch contract** — every `/swarm` block this milestone emits carries explicit `model:` and
   `effort:` rows drawn from the table above. `#36` already specifies both keys, so this is an
   addition per leaf, not a dispatcher change. Only 3 of 59 open issues currently carry a `/swarm`
   block, so this is a template fix applied at dispatch time rather than a bulk edit of the board.
3. **Live session** — `#40` was moved to `claude-opus-5` + `medium` in place via
   `herdr agent prompt`, rather than torn down. It had already reached `done` with PR #91 open;
   killing a herdr-supervised child to correct a binding that only takes effect on its next turn
   would have destroyed finished work to make a record tidier.

**The interaction the owner should decide.** `opus_5@medium` as the *inherited* default sits one
tier below the matrix's own orchestrator row, `planning_decisions` → Opus 5 · **high**. Both cannot
be satisfied by inheritance. The resolution consistent with the owner's first caveat is that the
orchestrator launches with an explicit `model:`/`effort:` like every other lane, and never relies on
the default at all — the default's job is to be a safe floor for anything that slips through, and
`medium` is a better floor than `xhigh` was. Recorded here rather than decided unilaterally, because
it changes the tier this run's successor executes on.

## Pinned doctrine sources

Pinned so a later reader can reproduce what this run was reading, per the pattern set by
`.llm/runs/architecture-foundation--seed/supervisor.md`.

| Source | Pin | What was taken from it |
| --- | --- | --- |
| `rickylabs/netscript` | `1c9eeef1a58316cff416bb9049e90346a78c89cc` (main, agentic toolchain merged) | `workflow/milestone-run.md`, `workflow/lane-policy.md`, `workflow/canary-cadence.md`, `workflow/milestone-reporting.md`, the `agent-milestone-orchestrator` skill, and the gate tooling vendored under `.llm/tools/` |
| `rickylabs/harness` | `b7d5e586e32f31ef44cab7b1327ab890f8e23794` (main) | the doctrine seed and the prior `architecture-foundation--seed` run |
| `deepseek-harness` reference | docs as read 2026-09-04 | Cordis plugin model, profile/bundle composition, `ctx.subagents` vs `ctx.llm`, ACP driver, `remote.mux` |
| `rickylabs/harness#30` | issue body as ratified | the four structural decisions and the epic breakdown this milestone freezes |

## Deliberate deviations

Recorded here rather than left for a reader to infer. Both are honest states, not gaps.

1. **Canary is `not-planned`.** `canary-cadence.md` expects a canary target per boundary. This
   repository publishes nothing yet — there is no artifact to canary. The first meaningful canary
   is the wave-1 boundary, when a dsh instance boots the `rickylabs` profile on the N5 (#49). The
   `eta.basis` field carries this reasoning so it survives without this file.
2. **Lane orchestrators are allocated but unbound.** Each lane carries
   `harness-m1/<lane>/unbound`. The validator requires a non-empty orchestrator id; inventing a
   session id that does not exist would satisfy the schema and lie. The `/unbound` suffix satisfies
   it and tells the truth. Stage C dispatch replaces these with real session identities.
3. **The gate tooling is vendored, not imported.** `.llm/tools/harness/` and `.llm/tools/gates/`
   are copies from the netscript pin above. This repository must be able to run its own dispatch
   gate without a netscript checkout on the box. Four files, one external import (`@std/path`).
   Drift against upstream is a known cost, logged in `drift.md`.

## Artifacts and how to re-check them

```bash
deno task harness:milestone:render -- .llm/runs/m1-dsh-coordinator--orchestration
```

```bash
deno task harness:milestone:validate -- .llm/runs/m1-dsh-coordinator--orchestration --github-prs .llm/runs/m1-dsh-coordinator--orchestration/github-prs.json
```

The validator is the dispatch gate, not a linter. A missing, stale or invalid artifact is a red
gate. `milestone-status.md` is **generated** — edit `milestone-cluster-state.json` and re-render;
a hand-edited status file fails the byte-identity check.
