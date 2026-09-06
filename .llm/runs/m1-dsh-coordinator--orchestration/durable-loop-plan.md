# E6/E9 durable loop — draft execution plan

The next slice must make one task survive coordinator restart and remain visible over the
published snapshot/mux contract. The planner, board and telemetry already ship; the missing
component owns their lifecycle and durable effects. This is a draft for review, not deployment
authorization. No stub package or owner fork is resolved by this plan.

## Research and boundaries

- E6 requests deterministic decomposition, persisted decisions and stable public dsh seams:
  https://github.com/rickylabs/harness/issues/36 (retrieved 2026-09-06).
- E9 requires pushed status and disk recovery independent of an agent conversation:
  https://github.com/rickylabs/harness/issues/39 (retrieved 2026-09-06).
- `packages/dsh-app/src/plugins/coordinator.ts:79` exposes workflow lookup, checks and evaluator
  selection; `:135` only provides that service. It contains no execution loop.
- `packages/dsh-app/src/plugins/board.ts:89` projects supplied issues; `:113` calls the pure
  projector. A caller must supply fresh GitHub data and timestamps.
- `packages/coordinator/src/journal.ts:25` records full decision inputs/outputs and digests;
  `:74` serializes a line. This is evidence encoding, not an effect transaction store.
- `packages/dsh-app/src/plugins/telemetry.ts:70` exposes a sink and pure snapshot builder;
  `packages/telemetry/src/sink.ts:45` reports failed writes through notes. A resolved sink write
  therefore cannot certify that a dispatch intent was persisted.
- `packages/dsh-app/src/instrument.ts:259` caches observed liveness in process memory and
  `:267` writes events. Existing issue 182 findings 5/6 must repair writer/reader identity and
  double counting before the end-to-end recovery proof.
- `packages/contracts/src/snapshot.ts:54` defines the existing RemoteSnapshot;
  `packages/contracts/src/server.ts:124` opens a hub and `:135` begins each subscription with
  hello plus snapshot. Reuse this protocol and its sequence/generation semantics.

Prior art inspected read-only: netscript worker idempotency port (`packages/plugin-workers-core/
src/ports/worker-idempotency-port.ts:36`), saga optimistic store (`packages/plugin-sagas-core/
src/ports/saga-store-port.ts:10`), and trigger durable ingress (`packages/plugin-triggers-core/
README.md:9`), in the sibling source checkout. These establish patterns to adapt, not build
imports. eis-chat `netscript.config.ts:16` binds an Aspire AppHost and `:23` composes workers,
streams and AI. The autocorner website repository/PR14 could not be retrieved with this gh
identity (repository not found); its detailed implementation remains an unverified prior-art
spike, not assumed evidence. Doctrine WORKFLOW remains the available ported lifecycle.

## Proposed ownership and iteration

1. Keep decision functions in coordinator pure. Add an effect driver at the dsh-app composition
   boundary, using explicit clock, store, GitHub, provider and push ports. No netscript runtime
   import, private agent-team dependency or cockpit code.
2. On startup acquire exclusive ownership for the configured repository/milestone. Read a
   versioned durable checkpoint, reconcile pending intents with external receipts, restore
   provider run handles, then enable admission. A second owner must fail closed.
3. Each iteration ingests observations, fetches/reconciles GitHub truth, builds a cited planner
   input, records the decision and prepares an effect intent. Persist intent before dispatch;
   persist receipt before acknowledging completion. Store failure prevents the effect.
4. Intent identity includes repository, task, workflow step, attempt and input revision. Retry
   the same intent only where the destination proves idempotency or definitively proves no
   execution occurred. Crash after send/before receipt becomes unknown/reconciliation-required,
   never automatic re-dispatch. This promises recoverable state, not universal exactly-once.
5. Rehydrate run state from durable mappings and provider observations. A process exit, stale
   poll, timeout or missing transcript cannot manufacture completion. Artifact/head-specific
   gate evidence determines phase advancement; owner forks remain terminal blockers.
6. Project committed state through BoardSnapshot/TelemetrySnapshot into RemoteSnapshot and
   the existing hub. GitHub remains task truth; durable local state owns pending effects and
   causal history. Reconnect uses the contract's full snapshot and deltas. Mark stale or partial
   upstream reads explicitly rather than publishing a confident empty board.
7. Schedule reconciliation and worktree census with injected timers and bounded concurrency.
   Event wakeups reduce latency; bounded GitHub reconciliation recovers missed events. Cockpits
   subscribe to push, never ask an agent to poll. Shutdown drains durable writes and releases
   owned resources; it cannot kill another repository's processes.

## PR-sized dependency DAG

A. E6 state-store contract and crash-safe persistence, exclusive writer and corruption refusal.
B. E6 effect intents/receipts and recovery reducer; depends A and citation-gate finding 182.3.
C. E6 driver wiring for GitHub and one configured provider; depends B. Start with dry-run/fakes,
   require checked routing and existing admission evidence before any live dispatch.
D. E9 consistent run identity/live-backfill merge; separate existing findings 182.5/6 PR.
E. E9 snapshot/hub transport lifecycle and recovery visibility; depends A, C, D and E8 contract.
F. E6/E9 restart acceptance proof and operational runbook; depends C and E.

Board/forge umbrella parity (182.8) is a prerequisite for trusting projected hierarchy in F.
The sibling-text fix (182.9) is independent and ships separately. Each A–F needs its own
brief, plan gate, implementation evaluation and PR. No package behavior before that contract.

## Decisive gates

- Kill at each persistence/send/receipt boundary: restart produces one known intent and no
  duplicate dispatch; uncertain external effect stays visibly uncertain.
- Missing store, corrupt checkpoint, failed fsync, stale owner and second writer all refuse.
- Replaying identical inputs reproduces decisions; no clock or network inside the reducer.
- Missing or stale citation/evaluation head never admits an effect.
- Disconnect during a delta, restart server, reconnect client: client fold equals fresh snapshot.
- Live event plus transcript for one provider session produces one run and one usage total.
- Governance unavailable appears unavailable, not permitted; owner approval/release actions
  cannot be inferred from a green technical gate.
- Complete proof with fixture home paths and synthetic sessions; publish no operational snapshots.

## Owner forks and spikes

F1. Production durable-store deployment: use an atomic local file journal on a persistent volume
or a service-backed transactional store? Recommendation: first prove the store port with local
persistence; leave production choice for the owner after deployment constraints are documented.
Cost if wrong: migration and operational recovery work. This fork blocks production activation,
not the interface, reducer, fake-driver or crash tests.

F2. Live mutation rollout: which repository/task is authorized as the first canary, and what
human merge policy applies? Recommendation: harness-only opt-in task with explicit effects and
manual merge. Cost if wrong: duplicate agents or unauthorized changes. Existing owner release
and governance decisions remain blocking for those effects. No live canary is implied here.

Spikes before locking C/E: verify stable dsh lifecycle and remote.mux transport APIs from the
installed published version; prove provider recovery/readback capabilities; specify durable
storage flush/lock semantics on the actual target filesystem; retrieve unavailable prior art.
These are unverified integration facts, not claims of already-working behavior.
