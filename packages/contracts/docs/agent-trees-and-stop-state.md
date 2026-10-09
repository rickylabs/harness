# Contracts: agent trees, placement and stop state (0.5.3 to 0.12.0)

Part of the [`@rickylabs/harness-contracts` README](../README.md), split out to keep each page
under the 500-line cap. Each section states the release that introduced it.

## Per-issue agent trees in the 0.5.3 candidate

`IssueAgentTreeSnapshot` groups the validated `AgentObservation` collection by repository and
issue, then by opaque stable dispatch ID. Each agent keeps its existing parent evidence, location,
route evidence, and separate cost rows. New fields name harness, provider, router, model,
token budget and its source, quota regime, liveness with explicit unknown, start/end times, and a
bounded typed history. The decoder rejects native IDs, extra fields, invalid budgets, and partial
ancestry passed off as complete. A native child provider is not renamed to router, and a root budget
is not inherited by a child.

Liveness is `running`, `idle`, `ended` or `unknown`. `idle` is a runtime observation that the agent
has stopped at its prompt: it is not running, and it is not ended, because it can be prompted
again. Its observation carries `running: false` with the same time and a validity at least as
long as the frame's. A `false` running bit is accepted only beside `idle`.

Each agent and history event repeats the enclosing dispatch ID so the cockpit can join only to its
accepted dispatch receipt. The snapshot has a 30-second `validUntil` bound (0.25.0; earlier
producers used 15 seconds, and the decoder still accepts either exact bound). Host, container and seat
are individually nullable and distinguish dispatch placement from runtime observation; 0.6.0 adds
verified dispatch-host placement while container and seat remain unavailable. A terminal
native outcome reports succeeded, failed or cancelled only when its exact cause is known; an
ambiguous failure remains unknown. `endedAt` stays unavailable until an exact terminal timestamp
exists. Missing budget, route, model, quota, time and sanitized transcript
evidence each carry typed reasons. This shape incorporates the cockpit seat's 2026-09-27 written
contract agreement; that agreement is coordination evidence, not a runtime source.

`harness-telemetry issue-agents --watch` emits full JSONL snapshots every five seconds, including
heartbeats, with a process generation and increasing `sequence`. On restart the source emits a new
generation beginning at sequence zero. The cockpit backend owns persistence and replay. An
unreadable source produces an incomplete snapshot with a reason. `--json` gives one diagnostic
snapshot. Neither command exposes native session IDs or source paths.

Each issue now carries `complete` and a typed `reason`. A complete issue retains its whole
dispatch tree even when a different issue cannot bind; an incomplete issue has an empty
`dispatches` array and its own reason. The top-level snapshot remains incomplete while any issue
is incomplete. The 0.5.2 decoder accepts older 0.5.1 issue rows without these two fields:
complete rows stay complete, while validated dispatch-only ancestry rows become typed incomplete
issues with an empty tree. The producer only
scans Codex rollout files in bounded receipt time windows: receipts older than 24 hours become
`scan_limit` rows, and recent issues have an eight-dispatch, 20-file, 8 MiB-per-file and 32 MiB
per-frame read bound. Other native transports report `binding_unavailable` until their Orchid
binding is implemented.

`--interval-ms` defaults to 5000 and is capped at 10000 so a normal watch cadence stays within
the 30-second validity bound, three intervals at the default cadence. A scan that crosses its own validity deadline emits an incomplete
snapshot. Public display labels reject slash paths; slash-bearing model IDs remain unavailable
until a safely attributed grammar is defined.

A `running` row requires a validated native running observation with the same evidence timestamp.
The observation's own `validUntil` must cover the entire snapshot validity interval;
otherwise the 0.5.3 decoder rejects the frame. An unknown or ended row cannot carry a current
`running=true` observation. The current Codex producer uses a native active
task and last recognized event within 90 seconds of capture, then expires that observation 120
seconds after the event. A missing or stale event remains explicitly unknown; a native terminal
event reports ended. This is a bounded transcript inference, so an abrupt exit without a terminal
event can leave running visible until the two-minute deadline.

The Orchid dispatch record supplies `tokenBudget` and `budgetSource`; a sourced zero is retained as
zero, while null means neither an issue override nor a route default was set. A validated Codex or
Claude dispatch source reports `router: direct` with the transport in `harness`; `agy` and
opencode remain unavailable until a validated gateway source is bound. A child inherits `direct`
only through validated parent ancestry. The separate
`routePolicy` is `netscript-matrix` for a historical matching private receipt whose source
identity fields are both absent. In 0.23.0, it is `harness-matrix` only when the Orchid
dispatch and immutable receipt both name `rickylabs/harness` and the digest is valid.
One-sided, conflicting or unknown source identities leave the policy and matrix revision
typed unavailable. The decoder accepts older
0.5.0 frames without `routePolicy` and normalizes that field to unavailable.
The coordinator decided 2026-09-27 that the route default applies unless the issue overrides it;
Eric can overrule. Child budgets and nonnative router identity need their own attributed evidence. `endedAt`
remains null because the current native run record has last activity, not an exact terminal time.
The 0.5.3 package was published after its owner-authorized tag.

## Host placement and capacity in 0.6.0

The issue tree now reports a configured short dispatch host only after `dispatch.json` and
private `binding.json` agree on it and the binding matches the reservation. Root and native
children of that dispatch share the placement. Missing or inconsistent host evidence remains
`source_not_bound`. SSH targets and addresses are never public placement evidence.

`AgentCost.localCapacity` is an additive fourth row with `scope: host`; the existing
subscription, metered USD and run-token rows remain separate. An available capacity
measurement must name the exact placed host and remain valid for the full issue-tree frame.
The cgroup reader cannot certify the dispatch host. The issue feed instead reads
`MemTotal` and `MemAvailable` from local `/proc/meminfo` and every local AMD DRM card's
`mem_info_vram_used` and `mem_info_vram_total` from sysfs. It publishes a measured row
only when the operator sets `HARNESS_TELEMETRY_PLACEMENT_HOST` (legacy alias `DSH_TELEMETRY_PLACEMENT_HOST`) to the exact verified placement
name. With no configured name it reports `host_identity_unset` without reading local files.
Missing or malformed files and a host mismatch retain named unavailable reasons. A missing
GPU never becomes a zero reading. Version 0.7.0 adds optional per-card VRAM readings whose
sum must equal the aggregate. The decoder accepts 0.5.x observations without the fourth row
and normalizes it to unavailable. Version 0.6.0 was published from its tagged merge.

## Activity lifecycle and coverage in the next minor

The epic 701 coordinator assigns the version at merge. Three optional, additive fields:

- `AgentActivityStep.state`, on `tool`, `command` and `file` steps only. Its values are one of
  `AGENT_ACTIVITY_STATES`: `completed`, `failed`, `cancelled` or `unknown`. It is the end the native
  store recorded for that step. `completed` means the native step ended, not that a tool succeeded.
  `unknown` never means running, failed or zero, and a step without the field makes no claim.
- `AgentActivity.coverage` (`AgentActivityCoverage`), on the `available` branch only. It holds
  `gaps`: unique `AGENT_ACTIVITY_GAPS` codes in canonical order. Empty `gaps` means the published
  window is fully covered. A gap names why activity is narrower than the native run:
  - a missing, invalid, budget-skipped, truncated, holed or vendor-truncated descriptor source;
  - call lifecycle that cannot be correlated to its result (`call-lifecycle-unproven`);
  - results whose in-progress status is not attributed to current execution
    (`in-progress-unattributed`).
- `NativeToolCallDescriptor` and `NativeToolCallRead` are type-only. They form the read seam between a
  provider adapter and the telemetry producer, and are never published in a frame.

An older reader rejects a whole snapshot holding `state` or `coverage`, because the decoder
refuses unknown keys. Telemetry therefore emits both, and the unnamed result steps they describe,
only under `issue-agents --activity-lifecycle`. A consumer bumps this package first and passes the
flag after. Without the flag, frames keep their earlier keys exactly.

## Bounded issue trees in 0.37.0

An issue row may now be `complete: false` with reason `scan_limit` and still carry dispatches: the
closed, verified tree a producer read from the dispatched roots before a bound on descendants. Its
agents are validated exactly like a complete row's, and the snapshot is never complete around it.
Every other incomplete reason still carries no dispatches, and an incomplete row with no
dispatches decodes as before. Schema and protocol remain 1.

A 0.36 or older reader rejects a whole snapshot that holds a bounded row. Telemetry emits one only
under `issue-agents --partial-trees`, so a consumer bumps this package first (or with the same
change) and passes the flag after; without it a bounded issue is `scan_limit` with no agents.

## Cost source compatibility in 0.36.0

The strict observation and issue-tree readers accept canonical `harness-telemetry.*` cost
sources alongside their legacy `dsh-telemetry.*` names. Each row accepts only the source for
its evidence class. Available and unavailable rows preserve the exact received source,
measurements, timestamps and revision; mixed names in a frame are valid during rollout.
`AGENT_COST_SOURCE_NAMES` exports a deeply frozen per-row vocabulary, and
`AgentCostSource<K>` provides the corresponding source union in installed declarations.

This release prepares readers. `unavailableAgentCost()` and telemetry producers still emit
legacy names, including the absent-capacity default for older three-row frames. The
schema/protocol remain 1 and the npm package name and exports remain unchanged. A producer
switch requires compatible cockpit schemas, generated client validators and mobile captures
first.

## Native child depth in 0.8.0

`IssueAgentTreeAgent.nativeDepth` reports a positive integer only when the native Codex child
rollout measured `source.subagent.thread_spawn.depth` with a matching parent identity. The
root's depth and a child's missing or invalid measurement remain typed unavailable; tree
position is never used as a substitute. The decoder accepts older frames without this field
and normalizes them to `source_not_bound`.

## Verified stop state in 0.9.0

`actionState` distinguishes a stop whose seat has disappeared (`stopping`) from one whose
seat and captured native process tree are both verified absent (`stopped`). A stop delivery
receipt alone leaves the action state unknown. While stopping, liveness is unknown because
the previous runtime observation is stale. Only both independent observations permit
`liveness: ended`, `endedBy: stop`, and a cancelled terminal outcome sourced from the stop
observation. Each observation has a separate bounded history event. Older frames without
`actionState` and `endedBy` decode to unknown and null. A separately verified native terminal
outcome remains valid while stop verification is still in progress.

## Verified timeout and teardown state in 0.10.0

The feed clears an old running claim to unknown once Orchid verifies that the exact pane and
workspace are absent. It reports `liveness: ended` with `endedBy: timeout` or `teardown` only
after Orchid separately verifies that the captured native process tree is gone. The terminal
outcome is then `cancelled`, sourced from `teardown-observation`; the later observation supplies
`endedAt`. A timeout comment, issue closure, teardown intent, or either observation alone never
proves termination. The two measurements have separate bounded history events. Native terminal
outcomes and verified cockpit stops keep their existing precedence.

## Recent agent work and timeline in 0.12.0

Each bound issue-tree agent has three additive fields. `activity` contains at most 20 recent
assistant-origin steps, newest first, with an opaque stable ID, source, time, kind, and a small
description. Codex rollout `response_item` tool calls and assistant messages, and Claude transcript
assistant tool-use and text blocks, are reduced before projection. Tool names and command heads use
fixed allowlists; paths must be repository-relative. A single screened plan step or assistant
first sentence can appear; text that fails the shared producer/decoder privacy screen becomes the
fixed `Agent message` or tool label. The screen rejects code-like credentials as well as paths,
addresses and long opaque strings. Prompts, tool output, raw arguments, native IDs and local paths never enter
the frame. A missing bound run reports typed unavailable rather than an empty claim of activity.

`tokenUsage` reports every input token the bound agent's model processed, plus its output tokens,
and that same agent's budget. Codex uses the latest cumulative `token_count`, whose input already
contains cached input; reasoning is a subset of output and is not added again. Claude counts each
assistant response once, and adds its cache reads and cache writes to input, because Claude
reports both beside an input count that excludes them. The two figures therefore mean the same
thing. Missing counts and child budgets remain null with a reason, never zero. The existing quota,
metered cost, run-token (each token kind as its own field) and local capacity rows stay
separate.

`timeline` carries at most 32 chronological events with opaque stable IDs. Dispatch, native start,
measured native child spawn, validated action receipt, and verified terminal state have distinct
sources. An accepted stop receipt is a delivery event, never proof of termination; ending still
requires native terminal evidence or both Orchid absence observations. `truncated` flags a bounded
or unavailable action receipt scan, including after a native child spawn decorates the root. Goal update and complete kinds are reserved for a future
verified Orchid notification writer; the current issue feed does not emit them. The issue-scoped
native reader presently binds Codex only. Claude parsing is available, while Claude issue-tree
publication waits for a validated native binding and bounded scoped reader.

In 0.12.0, timeline events add an optional closed `reason` code. Validated action receipts supply
delivery or rejection reasons; an `ended` event names the verified native outcome, stop, timeout,
or teardown. Receipt delivery by itself does not produce `ended`. The decoder accepts older events
without `reason`, but checks new terminal reasons against the agent's measured terminal source.

In 0.13.0, each agent can add `effort` and `parentAgentId`. Root effort comes only from its bound
requested dispatch route and is a closed thinking-level value; children remain explicitly unavailable
until their own route is measured. `parentAgentId` is null for a confirmed root and equals the
verified opaque parent ID for a child. The decoder checks it against the existing ancestry evidence;
older frames without either field still read. Activity steps can add `target` with a closed kind:
an allowlisted command head, a repository file basename, or a screened search query. Targets are
rejected whole when unsafe; repository-relative path segments pass that screen too. No flags, raw
paths, arguments, or unbounded transcript text are copied.

In 0.14.0, an issue can add `launchRefusal` even when no agent row exists. It carries an opaque
dispatch ID, Orchid source, observation time, and one closed pre-launch reason. A later launch
attempt clears the refusal in Orchid's issue launch state. Inconclusive post-launch outcomes are
never projected as refusals. Older frames without this optional issue field remain decodable.

In 0.30.0, an issue can add `launchBlock` with state `blocked`, reason
`goal-prompt-unconfirmed`, canonical `at`, opaque `dispatchId`, and source `orchid`.
This verified post-launch receipt is independent of native ancestry: an issue without a proven
tree stays `complete:false` with a typed coverage reason and `dispatches:[]`. A verified full
tree can coexist with the block. Root activity never clears it; only replacement of the
authoritative Orchid launch observation does. Absence of this optional field on an unavailable
or older frame is not affirmative clearance. A block and a refusal cannot coexist on an issue.
The reader accepts only schemaVersion 2 blocked receipts for this reason; schemaVersion 1
refused/launching/launched receipts remain unchanged. No prompt, native identity, path or raw
error enters the public block. Older frames without the field still decode; producers emitting
it require a 0.30.0 consumer. Upgrade consumers before deploying the new producer.

Older frames without these optional fields remain decodable. A producer emitting 0.12.0 timeline
reasons requires a 0.12.0 consumer because earlier decoders reject unknown event keys. Upgrade
consumers before deploying the new producer.

