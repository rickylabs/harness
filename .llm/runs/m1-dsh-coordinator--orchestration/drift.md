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
