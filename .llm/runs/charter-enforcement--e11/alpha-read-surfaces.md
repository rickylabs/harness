# Alpha read surfaces — discovery

The owner defines alpha as assigning a matrix to an issue, dispatching it, and seeing dispatched agents, location, router and budget over a durable stream. Live session observability and in-flight steering are deferred and are not alpha blockers. This does not turn unknown observations into known ones.

## What exists

- `packages/subagents/src/route.ts:2–56` owns the exact route evidence shape: provider/model/effort/cwd, requested/observed, known/mismatch/unknown, and closed provenance. Provider is the router. `DispatchResult.route` in `packages/subagents/src/provider.ts:110` can carry this evidence.
- `packages/telemetry/src/model.ts:29–37` owns optional token counters and recorded USD cost. `QuotaReading` in the same file carries source, observation time, used percentage and window data. These are distinct measures, not one currency.
- `dsh-telemetry runs --json` is the existing read for source-tagged run usage and quota; `packages/telemetry/src/cli.ts:592` invokes `publicRuns`. It is a bounded scan, not a stable single-run route/cost lookup.
- `dsh-telemetry governance --observations-from <descriptor>` is the existing separate governance read. The published decoder is `readGovernanceSnapshot` from `@rickylabs/harness-contracts`. Provider-wide metered spend must not be attributed as the cost of an individual run.
- Forge's existing issue-body `/swarm` writer and subagents' parser remain the assignment path. No new dispatcher or UHP dependency is justified.

## What needs writing

A stable route read keyed by the dispatch run identity is absent. `packages/dsh-app/src/instrument.ts:235–242` currently writes a dispatch verdict but drops `DispatchResult.route`; telemetry's live fold keeps a flat identity and cannot recreate honest requested/observed evidence. In particular, its `provider` detail is a provider implementation identifier and must not be silently relabeled as router evidence.

A per-run row projection with explicit source and unit also needs writing. Reuse telemetry collection. Missing USD is unknown, not free; subscription window use is not attributable spend; token categories must not be blindly summed because reasoning/cache counters can overlap their parent counts.

The join between dispatcher run identity and telemetry's vendor-native RunRecord.id needs an explicit existing binding; an equal-looking string or issue mention is not that binding. The read contract must not guess it. The route shape must retain its current provenance semantics rather than labeling transcript observations as thread/start results.

## Handoff state

No new read operation name is claimed to exist. Source and docs were checked after fresh NetScript MCP guidance. The three queued questions named by the coordinator are not visible in the active handoff or the counterpart's current answer file; the coordinator was asked to supply them, and the counterpart was asked for any previously agreed read transport/run-identity binding. No matching new answer has been observed.

Previous lane commitments remain delivered: Orchid draft PR #2 has green source CI; Harness PRs #342/#345 remain drafts at their reviewed heads. The pin default discrepancy is recorded in plan.md. The mailbox remains a pilot, with draft discussion #349 and mailbox-rfc.md for the separate brainstorm.
