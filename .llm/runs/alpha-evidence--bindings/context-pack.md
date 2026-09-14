# Per-issue observation source handoff

The follow-up to PR 350 adds the relayed bounded agent collection to the existing telemetry
read. The coordinator owns the real issue 316 / leaf dispatch; this lane does not execute it.

Read surface: `dsh-telemetry runs --json`, member `agentObservations`, with private
`DSH_TELEMETRY_DISPATCH_ROOT` configuration unchanged. Decode using `readAgentObservations`
from `@rickylabs/harness-contracts` before filtering by repository and issue number. Never
forward the legacy private runs or dispatches arrays as the public collection.

The collection carries opaque agent/assignment identities, dispatcher-confirmed issue linkage,
parent evidence, nullable location/running evidence, canonical requested-versus-observed route,
and three independent cost rows. The decoder rejects unsupported schema, invalid fields,
more than 256 agents, encoded content over 1 MiB, incomplete reads, duplicate identities, cycles,
missing parents and cross-assignment ancestry as a whole. It returns no accepted prefix.
Consumers must bound command or HTTP bytes before JSON parsing.

Source ownership: `packages/telemetry/src/agent-observations.ts` projects existing evidence;
`packages/telemetry/src/orchid-dispatch.ts` reads private dispatcher receipts and only binds
explicit same-source native references. `packages/contracts/src/agent-observations.ts` owns
the exported decoder. The canonical route implementation moved to contracts; the original
subagents path re-exports it. No second route model, collector or native observer was added.

A receipt with no explicit native reference makes ancestry incomplete. A workspace or pane
acknowledgment is historical location evidence, never running evidence. All three cost rows
remain unavailable with source_not_bound until their own sources are enrolled. Provider-wide
subscription headroom never becomes per-run spend. No live alpha acceptance is claimed.

Typecheck, build, full tests and installed-consumer validation passed. Source changes are
authorized; independent evaluation and the owner's supervisor sign-off remain pending.
The mailbox remains a pilot under issue 349 and its existing RFC, awaiting owner brainstorm.
