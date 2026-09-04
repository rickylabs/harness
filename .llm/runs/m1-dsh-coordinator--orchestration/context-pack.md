# Context Pack: M1 — dsh coordinator foundation

## Run Metadata

| Field | Value |
| --- | --- |
| Run ID | `m1-dsh-coordinator--orchestration` |
| Branch | `harness/m1-dsh-coordinator--orchestration` |
| Current phase | `plan` — Step 0 frozen and gated, nothing dispatched |
| Route | milestone-cluster |
| Baseline | `b7d5e586e32f31ef44cab7b1327ab890f8e23794` |

## Current State

Orchestrator profile mode is **enabled and gated green** for milestone M1. The board carries 49
leaf issues under nine epics; the cluster control plane exists, validates, and knows exactly which
issue belongs to which lane and which wave. No lane is bound to a session and no work has been
dispatched — that is the correct state for a validated Step 0 awaiting an owner go.

Everything below wave 0 is unblocked. The `features` lane is idle by design until `#51` lands the
dispatch contract in wave 1; dispatching it earlier would fork that contract four ways.

## Completed

- 49 leaf issues filed, linked, labelled and frozen into M1 (`#40`–`#88`).
- Epics de-milestoned so the burn-down counts leaves once.
- Gate tooling vendored in-repo with a `deno.json` that runs it.
- Step 0 artifacts generated from the live board: intake, inventory, dependency DAG, cluster state.
- `milestone-status.md` rendered; dispatch gate green with zero errors and zero findings.

## In Progress

- Nothing is executing. The run is parked at a green gate.

## Next Steps

1. Owner decides whether to bind the four topic lanes and dispatch wave 0.
2. Owner decides `#62` — the sandboxctl execution channel — which unblocks all of E5.
3. On go: record the Stage B provider-quota and paid-transport checks in `worklog.md`, then bind
   lanes and dispatch W0 attached, never one-shot, through the agentic suite.
4. Brief the N5 supervisor thread against `#30` so it starts from this architecture instead of
   rediscovering it. It owns `#33` `#34` `#37`.

## Key Decisions

| Decision | Source | Notes |
| --- | --- | --- |
| Plugin-only, no dsh core fork | owner | depend on published `@deepseek-ai/dsh` |
| Node + pnpm, netscript as a service | owner | not a build-time dependency |
| GitHub is the board's truth | owner | dsh projects the live view; proven by the Orchid integration |
| dsh layer only, both cockpits elsewhere | owner | forces `contracts` to be a *published* package |
| Two seams, not one | architecture | vendor CLIs → `ctx.subagents`; API/local models → `ctx.llm` |
| Gate at the sandbox boundary | architecture | dsh cannot gate tool calls inside a vendor CLI child |
| Strangler-fig on divybot | plan | one dispatch payload, per-target flag selects provider or divybot |

## Files Changed

| Path | Status | Notes |
| --- | --- | --- |
| `deno.json` | new | `@std/path` plus the render and validate tasks |
| `.llm/tools/harness/*.ts` | new | vendored renderer and validator |
| `.llm/tools/gates/*.ts` | new | the validator's only transitive dependencies |
| `.llm/harness/templates/*` | new | the ten run templates |
| `.llm/runs/m1-dsh-coordinator--orchestration/*` | new | this run |

## Gates

| Gate family | Current status | Evidence |
| --- | --- | --- |
| Step 0 dispatch gate | PASS | `{ ok: true, errors: [], findings: [] }` |
| Status byte-identity | PASS | `milestone-status.md` is renderer output |
| Board reconciliation | PASS | PR export supplied and identity-matched |
| Static / fitness / runtime / consumer | N/A | no product code exists in this repository yet |

## Open Questions

- Does a wave boundary with no published artifact still declare a canary point, or does the first
  canary wait for a booting dsh instance at the W1 boundary? Recorded as owner-undecided in
  `canary-cadence.md`; resolving it by habit inside a run is exactly what the skill forbids.
- `#62`: ssh executor or privileged sidecar for `sandboxctl`? The sidecar is narrower and
  auditable; the ssh executor is zero new code and broad host authority.

## Drift and Debt

- Drift: one entry — vendored gate tooling now has two copies with independent lifecycles.
- Debt: lane orchestrator ids are placeholders until Stage C binds real sessions.

## Commits

- See the PR's commit list.
