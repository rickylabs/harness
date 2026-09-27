# Research

## Summary
The merged 0.5.0 feed loses sourced zero and real native router evidence. Both are narrow reader/projection changes. Live #387 proof remains external.

- `packages/contracts/src/issue-agent-tree.ts`: public decoder rejects zero budget and every non-null router; it already validates ancestry via `readAgentObservations` and returns a bounded snapshot.
- `packages/telemetry/src/orchid-dispatch.ts`: bound dispatch reader validates private record/receipt modes, sizes, issue/source/model; zero budget rejected and receipt digest currently unused. Source is explicitly codex, claude or agy; only codex/claude carry the Fork R1 `direct` mapping.
- `packages/telemetry/src/issue-agent-feed.ts`: producer currently writes unavailable router for every agent; known-parent state is available for validated child inheritance.
- Orchid `cmd/divybot/matrix.go:370-385,408-422,745-747` in read-only Orchid checkout: route digest is written in receipt resolution; dispatch binding carries source and token budget/source.
- Coordinator decision log, 2026-09-27 20:25 and 21:50 UTC: coordinator budget and Fork R1 authority. Eric can overrule.
- `packages/contracts/README.md:556-600` records the current 0.5.0 feed and known gaps. `package.json` scripts and `scripts/check-installed-contracts.mjs` provide local gates.
