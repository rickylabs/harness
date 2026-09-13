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

## 2026-09-13 — plan delivered

Second session of the day, on baseline `e7af112`, branch `docs/274-capability-detection-plan`. Read
the locked charter, issue 274, `research.md` as the input rather than the task, then `AGENTS.md` and
`doctrine/WORKFLOW.md`. `research.md` merged as PR 308 earlier today; nothing in it was re-measured.

Wrote `plan.md`: ten ordered steps, each naming the file it changes and the existing function it
calls, plus the acceptance map for 274's six items, the netscript dependency and its interim, six
numbered owner forks, five spikes, a dependency DAG, an eight-row risk register and an explicit
non-goals section.

The two shaping findings of this session, both of which changed the plan from what the research left
open:

- **The interim for netscript#2015 already has a shipping precedent in this repository.**
  `packages/telemetry/adapters/opencode-usage-probe.ts` is a Deno service entry outside `src/` and
  outside the Node project, launched by `usageCommand` (`packages/telemetry/src/cli.ts:682-694`)
  through an in-memory import map into an operator-configured netscript checkout, under `--no-remote`
  and one narrow permission. `packages/telemetry/README.md:456` names the status that establishes:
  an operational service dependency, never a build dependency — ratified decision 2 exactly. So the
  interim resolve view calls the *same exported function* netscript#2015 will expose, and retiring it
  is one deleted file and one changed argv. No capability row, precedence list or authority rule is
  copied, so there is nothing to un-fork later.
- **The bounded reader cannot be used as-is, and the reason is one of checkbox 6's cases.**
  `runUsageProbe` (`cli.ts:713-738`) is JSON-only and collapses a non-zero exit into `spawn-failed`,
  so a missing binary and a logged-out account are the same code — and those are two separate
  required tests. Step 1 extracts the spawn body and keeps `runUsageProbe`'s contract byte-identical
  rather than writing a second subprocess reader.

Four gates were located by reading the scripts, and each is named in the step it can stop, because
`pnpm run build` is a twelve-stage chain whose compile is stage 7: `check:graph` (stage 1) requires
the manifest dependency and the tsconfig reference together; `check:compiled-policy` (stage 6) fails
any non-test string-literal assignment to `model`, `effort`, `tier`, `lane`, `family`, `profile`,
`preset` or `harness`; `check:snapshots` (stage 5) refuses a tracked `.json` carrying `observedAt`
unless it is in the exact path-and-digest fixture inventory, and refuses any data file named
`*quota*` on the name alone; `STRUCTURAL_FIELDS` in `schema.ts:124-130` must gain every new key or
the strict validator refuses the document it just learned to describe.

Gates were run individually, not as an aggregate. Stage 7 — `pnpm -r run build`, the actual compile —
exit 0 with fifteen packages reporting `Done`. Stage 6 exit 0 with its mutation self-test passing.
Stage 5 exit 0. Stage 3 exit 0, and recorded as saying nothing about `plan.md`, since
`scripts/check-links.mjs` excludes `.llm/runs/` deliberately.

Absence claims were made with the aim shared by construction: one enumerated input set of 308 tracked
`packages/**/*.ts` files written to a file, two controls over that file, then the real queries over
the same file. Zero references to `resolveWorkloadRoute`, `routing-policy` or
`ResolvedDelegationRoute` anywhere in `packages/`; zero `capturedAt` and zero `installed` /
`authenticated` / `entitled` in the fourteen tracked `packages/routing` files.

No product code, no package, no schema file, no configuration file, no test. No vendor CLI invoked,
nothing spent, no account touched, and no credential, account identifier or session identifier
printed or written. `plan.md` must pass independent evaluation before any step in it is executed;
that is 274's own execution rule and `doctrine/WORKFLOW.md` Stage G, not a preference.

[owner — deliver `plan.md` for 274; plan only, no product code, no mutation under `packages/`, branch
 from origin/main, and no abstraction where an existing function would do; received 2026-09-13]
[observed — build stages 7, 6, 5 and 3 run individually with their exit codes, and one enumerated
 308-file input set with a passing control before each absence query; topic: gate results that name
 the stage, and absence claims whose instrument was demonstrably aimed; executed 2026-09-13]
