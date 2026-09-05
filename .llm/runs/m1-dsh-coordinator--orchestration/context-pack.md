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

Orchestrator profile mode is **enabled, gated green, and running**. Wave 0 is dispatched: `#40`
(claude, `internals`) and `#42` (codex, `docs`) carry the `harness` label and are live. The other
47 leaves are unlabelled and inert.

**One coordinator owns the whole milestone.** The two-thread lane split published in `#30` is
retracted — the second thread was already committed to unrelated work and was never running this
programme. Its harness-related findings were parked, recovered, and reconciled into this run before
any agent started; see `reconciliation.md`. All four topic lanes are bound to
`harness-m1/<lane>/claude-opus-5-desktop-5dc200b1`.

Everything below wave 0 is unblocked. The `features` lane is idle by design until `#51` lands the
dispatch contract in wave 1; dispatching it earlier would fork that contract four ways.

## Completed

- 49 leaf issues filed, linked, labelled and frozen into M1 (`#40`–`#88`).
- Epics de-milestoned so the burn-down counts leaves once.
- Gate tooling vendored in-repo with a `deno.json` that runs it.
- Step 0 artifacts generated from the live board: intake, inventory, dependency DAG, cluster state.
- `milestone-status.md` rendered; dispatch gate green with zero errors and zero findings.
- Stage B: vendor CLI inventory, credential presence, and paid-transport reachability established.
- The N5 thread's parked work recovered off an `/ephemeral` mount and reconciled — four receipts,
  two corrections to Stage B, and the `ctx.agentTeams` contract it flagged as an unretrieved gap.
- Four lanes bound to a real coordinator identity; `topic-orchestrators-unbound` resolved.
- **Wave 0 dispatched** — `#40` and `#42` labelled.

## In Progress

- `#40` — pnpm workspace skeleton, TS project references, 14 buildable package stubs (claude).
- `#42` — doctrine move into `doctrine/` plus the commitment-to-epic pointer table (codex).
- Both are attached runs bounded at `timeout: 180m`. Neither has opened a PR yet, which is why
  `state.leaves[]` is still empty — the schema records a leaf only once a PR exists.

## Next Steps

1. Watch `#40` and `#42` to first PR. A leaf that **closes without an open PR** was torn down by
   its `timeout:`, not completed — reopen and re-dispatch rather than counting it done.
2. On `#40`'s PR: release `#41`, `#43`, `#44`, `#45`. They are held only because they edit files
   `#40` creates, and `#43` owns the root `README` / `AGENTS.md` / `CLAUDE.md`.
3. **Owner:** decide `#62` — ssh executor or privileged sidecar — which unblocks all of E5. It now
   carries hard evidence: `ai-agents` cannot see the host daemon at all (`reconciliation.md` § 1.3).
4. **Owner:** merge PR `#89`, and ratify "adopt the `ctx.agentTeams` shapes, not the dependency".
5. Before W3: rescope `#65` from service repair to the health-probe contract `#34` already calls
   for, and re-plan `#36` on `TeamTaskSnapshot` shapes.

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
| Single coordinator for all nine epics | owner | the two-thread split in `#30` is retracted, not reassigned |
| Adopt `ctx.agentTeams` shapes, not the dependency | proposed | experimental private seam; copy `revision` CAS, `blockedBy`, `writeScopes` |

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

- Drift: eight entries. The significant one is the retracted two-thread lane split — for a period
  the board asserted ownership that did not exist, which is the exact failure the status file is
  meant to make impossible.
- Debt: `build-cluster.ts` is no longer safe to re-run blind. It regenerates state from the frozen
  inventory and would discard lane bindings, the resolved blocker and the dispatch record while
  agents are running against the board it describes. Renderer and validator stay safe; they read.
- Debt: the `#41`/`#43`/`#44`/`#45` file-collision constraint lives in prose, not in data.

## Commits

- See the PR's commit list.
