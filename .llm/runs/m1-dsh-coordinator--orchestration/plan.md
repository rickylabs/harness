# Plan: M1 — dsh coordinator foundation

This is a **milestone-cluster run**. The plan is a *dispatch schedule*, not an implementation
design. Each leaf below carries its own acceptance criteria on its issue; the merge history is the
record of what actually happened.

## Run Metadata

| Field | Value |
| --- | --- |
| Run ID | `m1-dsh-coordinator--orchestration` |
| Branch | `harness/m1-dsh-coordinator--orchestration` |
| Phase | `plan` (Step 0 frozen, Stage A bootstrapped, nothing dispatched) |
| Target | milestone `M1 — dsh coordinator foundation` in `rickylabs/harness` |
| Baseline | `b7d5e586e32f31ef44cab7b1327ab890f8e23794` |
| Scope | 49 leaf issues, `#40`–`#88`, under epics `#31`–`#39` |

## Goal

Stand up the coordinator layer that does not exist today: a monorepo of DeepSeek Harness plugins
that makes the N5 fleet deterministic and observable, so that *"status ?"* stops being a question
anyone has to ask an agent.

## Scope freeze

| Decision | Value |
| --- | --- |
| Included | the 49 PR-sized leaves listed below |
| Excluded — epics `#31`–`#39` | containers. Their scope enters M1 through their sub-issues; milestoning both would double-count the burn-down. |
| Excluded — `#30` | the roadmap and decision log. It outlives M1. |
| Sources swept | target milestone, unmilestoned, backlog, later milestones — all four, recorded in `milestone-intake.json` |

Lane tally: `docs` 3 · `internals` 22 · `fixes` 1 · `features` 23.

The `fixes` lane holding a single issue is expected, not a modelling error: this is a greenfield
repository with no defects to fix yet. That lane is where defects filed *from inside* the run land.

## Dispatch schedule

Waves are small on purpose. A large fan-out froze the host at load 160 in an earlier release; the
per-lane limits (2 implementation slices, 1 evaluator) exist to stop that, and they are enforced by
`limits` in `milestone-cluster-state.json`, not by discipline.

Only **cross-wave** edges are recorded in `milestone-dependency-dag.json` (29 of them). Ordering
*within* a wave is the topic orchestrator's business, not the coordinator's.

### W0 — Foundation — the workspace the rest attaches to

| Issue | Lane | Title |
| --- | --- | --- |
| #40 | `internals` | E1.1 — pnpm workspace skeleton and shared TypeScript base |
| #41 | `internals` | E1.2 — Pin the toolchain with mise, outside the git checkout |
| #42 | `docs` | E1.3 — Port .llm/harness → doctrine/ with a commitment→epic map |
| #43 | `docs` | E1.4 — Root agent entry points: README, AGENTS.md, CLAUDE.md |
| #44 | `internals` | E1.5 — LICENSE MIT, repo topics, and CI (typecheck + build only) |
| #45 | `docs` | E1.6 — Decide the doctrine/ ↔ Orchid memory/ relationship |

### W1 — Shell, contract and the blocking decision

| Issue | Lane | Title |
| --- | --- | --- |
| #46 | `internals` | E2.1 — packages/dsh-app: the `rickylabs` profile and bundle |
| #47 | `internals` | E2.2 — Fork deepseek-harness-docker, keeping the upstream remote |
| #48 | `internals` | E2.3 — deploy/compose/dsh.yaml for the N5 |
| #49 | `internals` | E2.4 — Register the stack on the N5 and verify it comes up |
| #50 | `internals` | E2.5 — Golden --dump-config snapshot test |
| #51 | `features` | E3.1 — DispatchRequest and the SubagentProvider contract |
| #62 | `internals` | E5.1 — DECISION: the sandboxctl execution channel (blocks this epic) |

`#51` and `#62` are pulled forward out of their epics deliberately. `#51` is the contract every
provider implements — landing it late forks four implementations. `#62` is an owner decision that
blocks all of E5; asking it early costs nothing and asking it late costs a wave.

### W2 — Both seams — subagent providers and the model gateway

| Issue | Lane | Title |
| --- | --- | --- |
| #52 | `features` | E3.2 — provider-claude on @anthropic-ai/claude-agent-sdk |
| #53 | `features` | E3.3 — provider-codex against the running app-server daemon |
| #54 | `features` | E3.4 — provider-acp: agy on dsh's in-tree ACP driver |
| #55 | `features` | E3.5 — provider-opencode on @opencode-ai/sdk/v2 |
| #56 | `features` | E3.6 — Single-writer session lease and run-id keying |
| #57 | `internals` | E4.1 — llm-local: LM Studio, llama-rocm and OpenRouter adapters |
| #58 | `internals` | E4.2 — routing: tiers, the family rule, and fallback chains |
| #59 | `internals` | E4.3 — Capability probes instead of committed constants |
| #60 | `internals` | E4.4 — The local capability matrix, as data |
| #61 | `internals` | E4.5 — Model-id validation at the dispatch boundary |

This is the wave where the two-seam split becomes code: `#52`–`#56` attach to `ctx.subagents`,
`#57`–`#61` to `ctx.llm`. They are independent and run in parallel across two lanes.

### W3 — Governance and the coordinator

| Issue | Lane | Title |
| --- | --- | --- |
| #63 | `internals` | E5.2 — Port the Orchid subscription-quota governor |
| #64 | `internals` | E5.3 — Metered-spend regime |
| #65 | `internals` | E5.4 — Local-capacity regime: the third regime, which has no owner today |
| #66 | `internals` | E5.5 — Wire the gate at the sandbox boundary |
| #67 | `fixes` | E5.6 — Boot-parameter verification after every kernel update |
| #68 | `features` | E6.1 — board: task DAG, kanban projection, issue↔card reconciliation |
| #69 | `features` | E6.2 — coordinator: the workflow definitions |
| #70 | `features` | E6.3 — Emit one dispatch payload in the /swarm wire format |
| #71 | `features` | E6.4 — Determinism: persist decisions, not just outcomes |
| #72 | `features` | E6.5 — Structural evaluator independence |
| #73 | `features` | E6.6 — Worktree lifecycle and the auto-archiver hazard |

### W4 — Forge and the published contract

| Issue | Lane | Title |
| --- | --- | --- |
| #74 | `features` | E7.1 — forge: the issue/PR bridge and label→target mapping |
| #75 | `features` | E7.2 — PR supervision loop |
| #76 | `features` | E7.3 — Dispatch selector: provider or divybot, per target |
| #77 | `features` | E7.4 — Port timeout: semantics |
| #78 | `features` | E7.5 — Preserve the /swarm comment-authority security property |
| #79 | `internals` | E8.1 — contracts: route, payload and event types |
| #80 | `internals` | E8.2 — Snapshot and delta shapes designed for replay |
| #81 | `internals` | E8.3 — Publish @rickylabs/harness-contracts to npm |
| #82 | `internals` | E8.4 — Reference client bindings shared by both cockpits |

### W5 — Telemetry — the "status ?" killer

| Issue | Lane | Title |
| --- | --- | --- |
| #83 | `features` | E9.1 — SessionTelemetrySink on every run, on both seams |
| #84 | `features` | E9.2 — Push over /api/remote.mux, never poll |
| #85 | `features` | E9.3 — The hierarchy view: milestone → epic → task → subagent |
| #86 | `features` | E9.4 — Backfill from disk, so a coordinator crash loses nothing |
| #87 | `features` | E9.5 — Surface governance state alongside progress |
| #88 | `features` | E9.6 — Observability sink with rotation and failure deep-links |

## Thread split

Two threads work this milestone and must not collide. Ownership is by **epic**, and the coordinator
matches ownership on the actual `--cwd` argument of a dispatched process, never by string-matching
a session name.

| Thread | Epics | Character of the work |
| --- | --- | --- |
| Architecture lane (this session, laptop) | `#31` `#32` `#36` `#38` | structure, composition, coordinator semantics, the published contract |
| Software lane (N5 supervisor thread) | `#33` `#34` `#37` | provider implementations, netscript backend, model plumbing, the GitHub bridge |
| Joint, last | `#35` `#39` | both need the other lane's surfaces to exist |

## Locked decisions

| ID | Decision | Rationale |
| --- | --- | --- |
| `d1` | Plugin-only, no dsh core fork | depend on published `@deepseek-ai/dsh`; only `runzhliu/deepseek-harness-docker` is forked, upstream remote kept |
| `d2` | Node + pnpm; netscript is a service behind an adapter | not a build-time dependency |
| `d3` | GitHub is the board's truth; dsh projects the live view | already proven by the Orchid integration, which dispatches from issues and can drive 100% local models |
| `d4` | This repo is the dsh layer only | both cockpits live in netscript, so `contracts` must be a *published* package, not a workspace import |
| `d5` | MIT licence | matches dsh, lets our plugins carry the `dsh-plugin` topic |
| `d6` | divybot / herdr is not retired on day one | strangler-fig: one dispatch payload, a per-target flag selects `provider` or `divybot`; herdr retires per vendor, at parity |

## Open-decision sweep

| Decision | Status | Notes |
| --- | --- | --- |
| sandboxctl execution channel (`#62`) | **must resolve now** | blocks all of E5 (`#63`–`#67`); ssh executor vs privileged sidecar is a security-posture call |
| bind lanes and dispatch W0 | **must resolve now** | the gate is green either way; only the owner decides when subscription spend starts |
| canary shape for a repo that publishes nothing | safe to defer | recorded as `not-planned` with its basis; revisit at the W1 boundary |
| `doctrine/` ↔ Orchid `memory/` relationship (`#45`) | safe to defer | it is itself a W0 leaf |

## Risk register

| Risk | Mitigation |
| --- | --- |
| A large fan-out saturates the N5 scheduler | per-lane WIP limits are in `limits`, enforced by the validator, not by intent |
| The four providers fork the dispatch contract | `#51` lands in W1 and every provider edge in the DAG requires it |
| Vendored gate tooling drifts from the netscript original | pinned to `1c9eeef1` in `supervisor.md`; re-vendor deliberately, log in `drift.md` |
| `harness` label dispatches a real agent by accident | M1 issues carry `dsh` / `task` / `lane:*` / `topic:*` only — never `harness` — until dispatch is intended |
| The two threads collide on shared files | ownership is by epic; the coordinator verifies by `--cwd`, not by name |

## Validation plan

| Order | Gate | Command or check | Expected result |
| --- | --- | --- | --- |
| 1 | render | `deno task harness:milestone:render -- .llm/runs/m1-dsh-coordinator--orchestration` | `milestone-status.md` regenerated |
| 2 | dispatch gate | `deno task harness:milestone:validate -- .llm/runs/m1-dsh-coordinator--orchestration --github-prs .llm/runs/m1-dsh-coordinator--orchestration/github-prs.json` | `{ ok: true, errors: [], findings: [] }` |
| 3 | board reconciliation | the PR export must be re-captured before each report | no `source-unavailable` finding |

## Drift watch

- The 49-issue inventory: any issue closed, moved, or filed into M1 makes the freeze stale.
- `currentMainSha`: every merge into `main` must be reflected before the next report.
- Vendored tool versions against the netscript pin.
- Lane orchestrator ids: they must stop being `/unbound` the moment a lane is dispatched.

## Seat 3 continuation owner forks — 2026-09-06

These are draft forks for the new durable-loop scope in issue 191. They do not rewrite the
original dispatch schedule or authorize production activation. Full design and gates are in
[durable-loop-plan.md](durable-loop-plan.md).

F1. **Production durable-store deployment.** Atomic local journal on a persistent volume or
service-backed transactional store? Recommendation: prove the store interface with local
persistence first, then choose production storage against documented deployment constraints.
Cost if wrong: migration and recovery work. Blocks production activation; interface and fake
crash tests may proceed through their own plan gates.

F2. **First live mutation canary.** Which repository/task is authorized and what human merge
policy applies? Recommendation: one explicitly opted-in harness task with manual merge.
Cost if wrong: duplicate agents or unauthorized repository changes. Blocks live activation;
no existing release or governance owner decision is inferred from this proposal.
