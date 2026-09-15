# RFC 0003: Codex thread reads and goal subscriptions

- Status: implemented and independently reviewed; owner sign-off and deployment pending
- Date: 2026-09-15
- Scope: read-only native thread and goal observation
- Evidence snapshot: Harness `7dfefa38465ddd151a7e29360189a716ea484259`; installed `codex-cli 0.154.0` experimental generated protocol; NetScript `f3324909e0896cedc9729005bac5f508e122d6c6`
- Delivery tracking: [#382](https://github.com/rickylabs/harness/issues/382)

## Claim labels

CURRENT identifies inspected source; CITED identifies a retrieved authority; PLANNED identifies outstanding work; MEASURED identifies an executed receipt, never an inference from an empty response.

## Summary

**CURRENT.** Telemetry exports `openCodexThreadReader`, `reader.read()` and `reader.events()`. The CLI exposes `dsh-telemetry codex-threads --limit 500 --json`, with `--watch` for the initial snapshot followed by goal notification JSONL. `--private` opts into sensitive context for an authenticated consumer. [Published types](../../packages/contracts/src/codex-thread-observations.ts) describe schema 1; existing AgentObservations and cost contracts are unchanged. Cockpit must explicitly bind this additive source; this PR does not change its deployed intake.

## Context and current state

**CITED.** [The official app-server protocol](https://developers.openai.com/codex/app-server) documents JSONL stdio and initialization. Installed generated Thread/ThreadGoal/ThreadList/notification schemas are the exact field authority used here. Thread model and effort are current configuration when loaded, otherwise persisted metadata, explicitly not per-turn execution evidence. Git context is captured metadata. The runtime status belongs to the connected app-server instance.

**CURRENT.** [The existing provider protocol](../../packages/provider-codex/src/protocol.ts) is a pure start/turn port, not an initialized stdio client. NetScript MCP guidance and source inspection did not identify a matching read adapter. This implementation introduces no NetScript build dependency and no parked UHP dependency.

## Read contract and absence

**CURRENT.** [The reader](../../packages/telemetry/src/codex-threads.ts) requests every declared source kind, including subagents, and both archived and nonarchived pages. `useStateDbOnly:true` avoids list-driven rollout repair. Requests, whole reads, frames, pending calls, rows, pages and queued notifications are bounded. `timeoutMs` is both the per-request deadline and the total paged-read deadline (default 30 seconds); exhausting either reports `request_timeout`. Repeated cursors, duplicate identities and malformed pages refuse the read; a row cap returns a partial snapshot. Missing optional fields never erase a valid thread.

**CURRENT.** `complete` describes listing and goal-read coverage, not an atomic store snapshot or fleet ancestry proof. A failed goal RPC preserves the thread with unavailable goal fields and marks coverage incomplete. Parent null is `ancestry_unavailable`, not a confirmed root. Goal null is `goal_absent`. A present goal with no token budget is `budget_unset`. Missing, invalid and reported zero are distinct. Budget, tokens used and time used are separate native goal values, with no sum, currency conversion or quota interpretation. They are not whole-thread lifetime token usage. `notLoaded` and `systemError` leave running unavailable; an active goal never proves a running agent.

## Privacy and identity

**CURRENT.** Native thread identifiers remain inside the connection. Public `threadId` and parent references reuse the existing `agent_` native-child hash namespace from [agent observations](../../packages/telemetry/src/agent-observations.ts). This supplies stable opaque references, not encryption, authorization or a new issue join. Replacement native identities produce different public references; no continuity is guessed. Session IDs, rollout paths, preview and extra data are never projected.

**CURRENT.** Cwd, origin and goal objective default to `unavailable/redacted`. `includeSensitive:true` or CLI `--private` is only for an authenticated private consumer; that payload must not enter logs, issues or commits. [The evidence projector](../../packages/telemetry/src/codex-thread-project.ts) emits only row counts, field availability and closed reason counts, even when given a private snapshot. Provider/model strings, identifiers and all measurement values are excluded from evidence. Synthetic fixtures alone contain test values.

## Subscription and ownership

**CURRENT.** The outbound method set is initialize, initialized, thread/list and thread/goal/get. Inbound goal updated/cleared notifications have separate validation; unrelated notifications are ignored. Matching nested thread identity is required. Raw protocol errors and stderr never become diagnostics. There is no goal set/clear, thread start/resume, turn start, polling loop or dispatcher writer.

**CURRENT.** One bounded async subscriber per reader receives ordered goal changes with a connection-local sequence and source goal timestamp where supplied. Overflow explicitly invalidates buffered events and ends the source; disconnect is an unavailable event. Closing a reader stops only its owned process/port. An injected port belongs to its caller; it is never discovered from a running daemon.

**CURRENT.** Notifications are observations on this connection, not a durable log or replay cursor. The initial paged read is not atomic with notifications; buffered events may predate individual goal reads. Consumers must not treat the snapshot-plus-stream as an atomic replacement protocol. A new connection resets sequence scope. This layer does not apply events to a materialized view or claim cross-process broadcast visibility. Cockpit's durable log remains the downstream owner of persistence.

## Consequences

**MEASURED.** [Run evidence](../../.llm/runs/codex-threads--read-stream/validation.md) distinguishes real native reads, synthetic stream controls, mutation receipts and a live notification observation window. No goal was written to manufacture an event. An empty notification window is INCONCLUSIVE, never PASS. Readable stored threads cannot prove running agents in other processes.

## Revisit triggers

**PLANNED.** Revisit when the native dispatcher writes parent relationships and budgets, when an authenticated consumer binds this source, and when a naturally produced goal event demonstrates live delivery scope. A linearizable snapshot/stream handshake, durable replay, or cross-process event delivery requires an explicit upstream contract; none is invented here.
