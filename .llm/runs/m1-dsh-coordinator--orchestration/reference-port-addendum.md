# Owner correction — ground the existing plan in the shipped references

The durable-loop draft continues; its dispatch slice now explicitly depends on the Codex port
tracked by #53 under #33. The port must adapt existing protocol, identity, ownership and recovery
patterns to Node/pnpm. No source repository is modified and no stub implementation is authorized
by this research note. Source inspection is not a live transport proof.

## Source record

Read-only host checkouts inspected on 2026-09-06:

- netscript `08f581e8334485c29c845b39615276c59b48cc35`: all six Codex files named in the owner
  addendum; framework ROADMAP, runtime-state/failure doctrine, and milestone-run/tooling/
  agent-handoff/canary workflow sections. Its older lane-policy is not dispatch authority;
  retain the already-pinned current matrix at `8ba53bc50ca02aab29e99ba5362728839b8f1713`.
- eis-chat `90b6d866d1f0b078a82fce5b1851275647c982af`: decision/boundary sections of RFCs
  0001, 0004, 0005, 0006 and 0010; actual operations-contract re-export and sharing plugin.
- ledgerline `5cbb38a88328911b672a3d314055804db79405b4`: design/architecture opening sections
  and construction reference. These supply product and presentation boundaries, not cockpit
  code for this repository. Framework/product docs contain proposals as well as implementation;
  an RFC decision is not by itself proof that its implementation ships.

`milestone-reporting` was not found under the named local workflow directory. Resolve its
current location before claiming that reporting convention was inspected. No source tool was
executed against real sessions, credentials, containers or daemon state.

## Structural decisions added to the draft

1. **Thread identity before work.** Translate initialize → initialized → thread/start →
   turn/start. Resolve model_reasoning_effort in thread/start config, then compare returned
   provider/model/effort/cwd against the request before authorizing useful work. Reason: a
   turn-only setting can leave launch evidence showing the default.
   [observed - netscript .llm/tools/agentic/codex/app-server-message.ts threadStartRequest and parseThreadStart, lines 33-83]

2. **One durable sender per worktree.** Port exclusive lease acquisition and thread-id binding;
   subsequent steering resumes that recorded thread. A second dispatch into the same worktree
   must not create a rival. Reason: process-local deduplication cannot survive restart.
   [observed - netscript .llm/tools/agentic/codex/launch-codex-slice.ts sender ownership before spawn, lines 390-475]
   [observed - netscript .llm/tools/agentic/codex/codex-resume.ts explicit thread resume, lines 3-14 and 143-174]

3. **Progress is not completion.** Keep git activity separate from end-of-turn evidence.
   task_complete/turn completion permits an idle observation; it does not certify the whole
   issue shipped. DONE/BLOCKED, artifact gates and bounded quota handling belong to supervision.
   Reason: a turn can commit while still running, or finish without committing.
   [observed - netscript .llm/tools/agentic/codex/codex-watch.ts git versus turn modes, lines 2-22]
   [observed - netscript .llm/tools/agentic/codex/run-codex-slice.ts parseDoneContract and quota backoff, lines 132-207]
   [observed - netscript .llm/tools/agentic/codex/codex-status.ts buildCodexStatusSession]

4. **Use the existing harness vocabulary conservatively.** Persist thread identity as
   RunRef.external. Accepted means an identified dispatch; definitive pre-send rejection can
   be refused; uncertain send/observation remains unknown. Preserve isSafeToRetry only for
   refused. A dead observer is not proof of a failed agent, and a stalled agent is not finished.
   Reason: the public seam already encodes retry-on-unknown as unsafe.
   [observed - harness packages/subagents/src/provider.ts RunRef, DispatchVerdict, Liveness and isSafeToRetry, lines 66-108 and 174]

5. **Intent and receipt are distinct durable facts.** Keep the loop's pending intent, bounded
   claim, checked executor receipt and revision transition. Unknown Codex sends must reconcile,
   not blindly retry merely because another executor supports idempotency keys. Reason: EIS
   explicitly describes a two-write protocol, not transactional exactly-once dispatch.
   [observed - eis-chat docs/rfcs/0006-durable-operations-workers-sagas-triggers.md acceptance/dispatch protocol, lines 142-165 and 198-214]

6. **Ports own behavior; composition binds adapters.** Keep coordinator decisions pure, protocol
   code in provider-codex, and app lifecycle wiring in dsh-app. Retain published contracts as
   the cockpit boundary and netscript as a service; do not import Deno launchers into this build.
   Reason: the references distinguish application ports, contracts, adapters and thin hosts.
   [observed - eis-chat docs/rfcs/0004-modular-netscript-workspace.md layer table, lines 35-44]
   [observed - eis-chat contracts/versions/v1/operations.contract.ts canonical identity re-export]
   [observed - eis-chat plugins/sharing/mod.ts definePlugin composition]

7. **Live observation cannot dispatch.** Expose typed snapshot/stream state, including unavailable
   and unknown, without turning telemetry into a second command channel or absence into zero.
   Reason: consumers need honest progress even when authoritative reads fail.
   [observed - eis-chat docs/rfcs/0010-dashboard-contract-first-boundaries.md event classification, lines 51-60]
   [observed - ledgerline CONSTRUCTION-REFERENCE.md unavailable reads and absent measures, lines 44-56 and 138-141]

## Integration gates before provider-codex implementation

- #53 requires attachment to an existing daemon. The reference sendAppServerMessage explicitly
  spawns `codex app-server` with Deno.Command (`app-server-message.ts:116-128`). Port its protocol
  rules, not that process topology. Prove the supported existing-daemon transport through a
  read-only API/source spike; do not restart or repair the protected codex-daemon session.
- Several reference launch/status/resume files mark themselves deprecated. Trace their current
  runtime successors and compare behavior before fixing the Node adapter's contract. In
  particular, the reference launcher checks route mismatch after child completion; the planned
  harness gate must prove mismatch refusal before sending the useful task, not merely report it
  afterward. [observed - netscript .llm/tools/agentic/codex/launch-codex-slice.ts lines 1 and 480-525]
- Freeze daemon disconnect, partial JSONL, duplicate ownership, unknown send, route mismatch,
  git-progress-with-active-turn, completion-without-commit and same-thread resume fixtures.
  A missing thread or malformed reply must never yield a passing launch check.

## Effect on the current DAG

A/B remain the durable-state/intent slices. Add P: #53 protocol/ownership/resume port under E3,
with the integration gates above. C (the live driver) depends on A/B and P rather than an
unnamed configured provider. D/E/F retain telemetry consistency, snapshot delivery and the
restart proof. Existing owner forks F1/F2 and #62 remain; no production activation is inferred.
[observed - harness issue 53 attach-only acceptance and packages/provider-codex/README.md stub contract]
