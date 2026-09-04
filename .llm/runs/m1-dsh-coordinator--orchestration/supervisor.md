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

| Task lane | Provider / model / effort | Role in this run |
| --- | --- | --- |
| milestone coordinator | `opus_5@xhigh` | Step 0 freeze, wave plan, cluster state, dispatch gate, owner reporting |
| architecture (privileged) | `opus_5@xhigh` | the deliverable itself — the coordinator layer's structure |
| docs / internals / fixes / features | unbound | allocated, not yet dispatched |

Reference `.llm/harness/workflow/lane-policy.md`; the complete route table is not copied here.

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
