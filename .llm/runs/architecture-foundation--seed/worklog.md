# Worklog — architecture-foundation--seed

Append-only. Timestamps are local (CEST).

---

## 2026-08-14

**15:47 — Run opened.** Brief received: build a standalone agentic harness and toolchain
product on NetScript, generalising a pattern already proven in three repositories. Explicitly a
rethink, not a mirror. Reference points given: t3.codes for the surface, Linear for the
direction.

**15:50 — Stage A.** Repository `rickylabs/harness` created, private. Doctrine sources pinned:
`netscript@f7898dba` (main), `eis-chat@a9b31d4` (master), `website@d77bcaf` (main). Mutation
surface declared in `supervisor.md`.

**15:52 — Stage B, repo leg.** Three parallel exploration passes over the pinned sibling
repositories. Findings recorded in `research.md` §2–§4.

Load-bearing outcomes:

- "Harness" names two distinct systems in the existing evidence base — runtime and process.
  The product cannot inherit the ambiguity. (§2)
- NetScript already supplies the runtime spine: `TaskDefinition` spans
  `deno | python | shell | powershell | dotnet | executable` with explicit per-task permissions;
  `JobDefinition` carries `correlationId`, `topic`, idempotency and retry; sagas provide
  versioned envelopes with transitions and compensation; `deploy up bare-metal` installs a
  supervised OS service via `OsServicePort`. (§3)
- The doctrine ported across Deno→Next/React/Sanity/bun with mechanics transferring cleanly and
  domain knowledge not at all. That asymmetry is the product seam. (§4)

**15:58 — Stage B, external leg started.** t3.codes and Linear characterised and cited. The
process substrate between them is owned by neither. Six further comparables named as
outstanding in §7; document leg not begun.

**16:05 — Contradiction surfaced.** The two live implementations disagree on run-state
ownership — ephemeral and gitignored in the `website` doctrine, durable and PR-reviewed in
PR #14, which logged it as accepted drift rather than resolving it. For a documentation-only
harness this is a preference; for a product with a daemon and a dashboard it is the central
data-communication decision. Recorded in `research.md` §6 with three candidate positions and
no preference expressed. Escalated to become Decision D-1 at Stage E.

**16:10 — Six spikes filed.** F-1…F-6 in `research.md` §5. Each is a load-bearing claim that
could not be verified at this baseline. F-1, F-2 and F-6 gate Stage D.

**16:15 — Seed commit.** Entry points, doctrine transcription, and Stage A/B artifacts
committed. Drift D-1, D-2 and D-3 recorded. Handing off at a clean stage boundary with Stage B
partial, per D-3.

**Gate status at handoff: mutation of the world BLOCKED.** Stage G has not run.

---

### Next session starts here

Read `context-pack.md`. Then close Stage B — external leg, then document leg. Do not open
Stage C until it closes. Do not design the control plane before D-1 is locked.
