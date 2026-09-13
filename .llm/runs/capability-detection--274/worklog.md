# Capability detection — worklog

## 2026-09-08 — scope and discovery

Started from b38d68a. Committed scope319ad15 and bounded-execution/source-identity prior art
b59af7d. Fresh architecture.plan selected Fable5.1/xhigh; native init confirmed
claude-fable-5-1 in the preserved planner session. Planning remained active,
with no final research.md or plan.md delivered before the owner requested a pause.

## 2026-09-08 — owner pause

Stopped the verified owned native child gracefully; wrapper82847 returned exit0 after
interrupt. Verified the three recorded owned processes absent. This is an interrupted plan,
not a successful result. Wrote reset-checkpoint.md and context-pack with exact state and
resume instructions. No new expensive checks or dispatches. Goal remains incomplete.

[owner — pause until reset and checkpoint in each tracked run folder; received2026-09-08]
[observed — run inventory and process verification; topic: truthful checkpoint; verified2026-09-08]

## 2026-09-13 — research delivered

Resumed from the 2026-09-08 pause on a new baseline, `aa06a6c`, after reading the locked charter
and decisions 0003 and 0004. The preserved planner session was **not** resumed: the
operator brief assigned this session directly and restricted it to research, and re-steering a
paid planner seat would have spent capacity the checkpoint was written to preserve. Recorded as a
deviation from the checkpoint's resume step 3, deliberately.

Queried the matrix CLI fresh at NetScript `155dbbe90` and confirmed by measurement what the
predecessor recorded by inspection: the export carries no capability mapping, and the documented
flag surface has no way to ask for one. Then found the thing that changes the shape of the fix —
`resolveWorkloadRoute` at `routing-policy.ts:190` already completes the resolution and already
takes detection results as input. The upstream request is therefore to expose the existing
resolver, not to export the 41-row table, because exporting the table would move five rules across
the repository boundary.

Measured all seven transports for installed, version, authenticated, entitled, quota headroom and
live model availability, using only free read-only commands. Two of them — `opencode auth list`
and `opencode models` — cover four transports between them. Found three defects worth an upstream
request each: netscript's doctor reports `agy` missing from a hardcoded foreign home directory
while the binary answers and authenticates; the one `agy` capability id is absent from the live
catalogue, which breaks all 8 `agy` primaries; and `usage_unproven` covers eight causes with one
of its error strings naming the wrong one.

Audited every populated matrix cell's primary against the live catalogues: 38 resolutions, 19
verified servable, 8 naming a model the transport does not have, 11 undetectable because `claude`
and `codex` ship no catalogue command, and 6 silently coercing `provider_default` to `high`.

Measured that `claude`, `agy` and `codex` all bind effort as a real argument, with three different
mechanisms and two different vocabularies. That is evidence against the known gap recorded in
`ARCHITECTURE.md` §5. It is filed as evidence for a numbered decision under §13 and **not** as an
amendment; an agent may not amend the charter.

Wrote `research.md` and `verification.md`; appended this and the supervisor section. Brought the
six paused artifacts forward from `feat/274-capability-detection` unmodified so the run directory
is coherent on `main`. `pnpm run build` exit 0. No product code, no package, no schema, no plan —
`plan.md` remains owed, and it is owed to an evaluation gate, not to this session.

[owner — research-only deliverable for 274 with a standing no-slop, measure-or-cite rule; received
 2026-09-13]
[observed — 30 commands across the matrix CLI, the netscript doctor, the canary, the Copilot
 preflight, the expense watcher and four vendor CLIs, with results recorded in verification.md;
 topic: per-transport detection, resolution completeness and effort binding; executed 2026-09-13]
[observed — `pnpm run build` exit 0 at this branch's head; topic: the documentation-only change
 leaves the repository green; executed 2026-09-13]
