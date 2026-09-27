# Research

## Summary
A single stale unmatched receipt blanks a fresh, bound issue. The current feed scans the whole native session tree before reading receipts.

- Coordinator decision log, 2026-09-27 22:11 UTC: four receipts; #378 has no matching Codex rollout; #387 alone binds one parent and one child; full `issue-agents` emits `complete:false`, `ancestry_unavailable`, `issues:[]`. The observed sanitized frame is 2026-09-27T22:08:58.134Z.
- `packages/telemetry/src/issue-agent-feed-cli.ts:23-46` scans every native store before reading dispatch records, then builds one observation collection. `packages/telemetry/src/agent-observations.ts:31-83` makes an unmatched root set global `ancestry_unavailable` and drops all agents.
- `packages/telemetry/src/backfill/index.ts:87-130,137-225` recursively enumerates every Codex session directory and reads up to a global limit; `sinceMs` filters only after traversal. Today's local Codex date directory confirms eight `rollout-YYYY-MM-DDThh-mm-ss-<id>.jsonl` names, without reading their contents.
- `packages/contracts/src/issue-agent-tree.ts:65-105,235-315` has only top-level completeness; each issue currently requires nonempty dispatches and complete-collection validation. The public decoder needs additive per-issue completeness and independent ancestry validation.
- `packages/telemetry/src/orchid-native-binding.ts:42-76` binds an exact private Codex root; failed binding returns unavailable, which is the correct #378 result without exposing native identity.
