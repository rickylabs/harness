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
