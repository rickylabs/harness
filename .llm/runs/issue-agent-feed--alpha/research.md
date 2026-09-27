# issue-agent-feed--alpha — research

Summary: #385 already joins dispatcher-confirmed issue roots to native parent chains and exposes separate cost rows, but only through one-shot `runs --json`; budget and trustworthy running state are absent from the dispatch record.

- Public `AgentObservation` already carries repo, issue number, opaque assignment and agent IDs, explicit parent state, location references, route evidence, and subscription/spend/token rows. `packages/contracts/src/agent-observations.ts:55-80,260-296`.
- Telemetry builds the root/child join from confirmed native identity and withholds a partial native tree. `packages/telemetry/src/agent-observations.ts:31-102`.
- Orchid's current `dispatch.json` reader admits launch state, route, pane and workspace, and no token budget or quota regime. Dispatch acknowledgement is explicitly not a liveness claim. `packages/telemetry/src/orchid-dispatch.ts:113-160`; `packages/telemetry/src/dispatch-evidence.ts:19-20`.
- `runs --json` computes the joined observation once and exits. `packages/telemetry/src/cli.ts:601-612`. Existing `codex-threads --watch` demonstrates stdout JSONL and backpressure handling but does not join issues. `packages/telemetry/src/codex-threads-cli.ts:1-43`.
- Contracts 0.4.0 is the working version; reviewed merge precedes an owner-authorized release tag. `packages/contracts/package.json:1-4`; `packages/contracts/README.md:292-315`.
- Coordinator's budget decision is in `the private coordinator decisions (2026-09-27)`: route default, issue override wins, null only if neither. Attribution: coordinator decided 2026-09-27; Eric can overrule.
