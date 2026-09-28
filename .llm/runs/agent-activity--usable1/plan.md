# USABLE-1 agent activity feed

## Summary

Expose bounded per-agent work steps, measured token use against that agent's budget, and sourced timeline events in the issue tree. Keep the existing exact Orchid/native ancestry join and strict public decoder. This run follows the coordinator's 2026-09-28 USABLE-1 checkpoint.

## Source facts and design

- Codex `token_count.info.total_token_usage` is cumulative; assigning the latest count is the parser's existing rule (`packages/telemetry/src/backfill/codex.ts`).
- Claude assistant usage is per message and accumulated by its parser (`packages/telemetry/src/backfill/claude.ts`). Deduplicate a repeated message UUID before adding.
- The issue feed joins an Orchid dispatch to one native root and child parent chain (`packages/telemetry/src/issue-agent-feed.ts`, `packages/telemetry/src/orchid-native-binding.ts`). It currently binds Codex only, so a Claude issue claim awaits a separate validated binding.
- Stop and teardown termination require independent absence observations (`packages/telemetry/src/issue-agent-feed.ts`). An action receipt is delivery evidence only (`packages/telemetry/src/action-receipt-cli.ts`).
- The producer's action receipt scan is bounded at 128 operation directories and marks timeline truncated when unavailable. Each included receipt is read through the strict 0700/0600 private reader.
- The 0.11.0 fields are additive for new readers. Published 0.10.0 readers reject extra agent keys, so consumers upgrade before the new producer is deployed (`packages/contracts/src/issue-agent-tree.ts`).

## Gates

Contracts and telemetry package tests, a mutation that removes exact action-agent binding, full typecheck/build/test, public diff/body leak scan, then draft PR and CI. Mark READY only after all pass. Publish the approved minor release from the merge commit after coordinator merge.

## Owner fork

None for this implementation: the coordinator explicitly approved the contract minor and field shape. Goal timeline notifications are withheld because the existing private record lacks a verified goal event; an Orchid writer is a separate measured gap.
