# Supervisor

Draft plan and research are in progress. Product mutation awaits independent plan evaluation.

The owner assigned charter section 11 items 1–2, section 7 invariants, and a measured dual-agent
pilot. The owner specified Codex Astra at high effort. This is requested identity, not an
independently observed launcher receipt; admission provenance for the already-running session
is unproven. No live session identifiers or operational locations are published here.

Baseline: harness main at `a0f681c`. Charter authority: `ARCHITECTURE.md:131–165` and
`ARCHITECTURE.md:238–257`. The charter remains unchanged. Divybot remains the executor;
UHP stays parked.

Proposed mutation surface after the plan gate: this artifact directory; .llm/tools/harness/ receipt checker plus the existing cluster
validator and renderer under `.llm/tools/harness/`; their template and Node tests; the root
package test script; one profile reference to the executable invariant check. Dispatcher work
belongs in `rickylabs/orchid`, `cmd/divybot/`, and needs its own reviewed change. NetScript is
read-only authority, never a new build dependency. Existing unrelated working-tree changes
are outside this surface.
