# issue-agent-feed--alpha — locked plan

Summary: add a versioned per-issue tree snapshot and a continuous JSONL producer, preserving the existing ancestry and cost evidence boundaries. The cockpit seat is reviewing the proposed shape in `the private Harness contract proposal (2026-09-27)`.

## Decisions

1. Group the existing opaque `AgentObservation` by repository/issue and stable opaque assignment. A flat parent ID per agent permits complete ancestry without duplicating subtrees. Source: `packages/contracts/src/agent-observations.ts:55-80,260-296`.
2. Each new agent row adds bounded typed history, harness, budget/quota regime, liveness and times. Every unobserved field stays explicit unknown/null. Dispatch acknowledgement does not mean running. Source: `packages/telemetry/src/dispatch-evidence.ts:19-20`.
3. The CLI emits full snapshots as JSONL at bounded intervals, sequence-numbered within a process generation. A reconnect starts with a full snapshot. This is the producer boundary; the cockpit backend persists/replays its client stream. Source precedent: `packages/telemetry/src/codex-threads-cli.ts:1-43`.
4. Prepare package 0.5.0 for review. Publication is a separate owner-authorized tag after merge and CI. Source: `packages/contracts/README.md:292-315`.

## Owner forks

None for implementation. The coordinator's budget decision is recorded in the brief; Eric can overrule. Cockpit shape review is an integration gate, and corrections will be recorded in `drift.md`.

## Spikes and integration gates

- Budget source: current Orchid record lacks a token limit. Output null/unavailable now; verify the separately reviewed Orchid route-default change supplies it before #381 live acceptance. `packages/telemetry/src/orchid-dispatch.ts:113-160`.
- Liveness source: use a first-hand terminal run outcome only to say ended; otherwise unknown until a reliable running observation exists. `packages/telemetry/src/dispatch-evidence.ts:19-20`; `packages/telemetry/src/model.ts:10-20`.
- Cockpit seat confirms snapshot fields and feed handoff in shared status before PR is treated as integration ready.

## Dependency DAG and gates

Contract shape and decoder → producer projection → watch CLI → mutation-negative controls → full contracts/telemetry suites → installed-consumer/build/publish checks → leak scan → PR. Cockpit review can revise additive fields before PR. No release tag.

## Risks

- Private identity or path leak (high impact): validate/project field by field and test canaries; leak scan every push.
- False live/budget claim (high impact): emit unknown/null until source evidence; negative tests remove guards.
- Partial ancestry presented as complete (high impact): reuse existing `readAgentObservations` gate.
- Watch process stalls or emits unbounded data (medium): bound interval/size, await writes, close on signal/error.
