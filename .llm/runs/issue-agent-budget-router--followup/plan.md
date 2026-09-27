# Issue agent budget/router follow-up — plan

## Summary
A small additive 0.5.x follow-up to #386. Coordinator decided 2026-09-27; Eric can overrule: preserve sourced zero token budgets, and expose the actual request gateway separately from `netscript-matrix` policy and its digest. This run does not claim #381 live proof until the runtime feed frame for #387 is captured.

## Supervisor and discovery
Baseline `origin/main` 92ae1ae, fresh worktree `feat-issue-agent-budget-router`. Mutation surface: `packages/contracts/src/issue-agent-tree*`, `packages/contracts/package.json`, `packages/contracts/README.md`, `packages/telemetry/src/{dispatch-evidence,orchid-dispatch,issue-agent-feed}*`, this run directory. No issue labels, private receipts, deployments or restarts. Current decoder rejects zero and all known routers (`packages/contracts/src/issue-agent-tree.ts`); Orchid reader rejects zero (`packages/telemetry/src/orchid-dispatch.ts`); producer always returns unavailable router (`packages/telemetry/src/issue-agent-feed.ts`). Coordinator decision is coordinator decision log (2026-09-27, 20:25 and 21:50 UTC entries) 21:50 UTC. Orchid's current private dispatch binding stores token budget/source, and matrix route has a digest (`cmd/divybot/matrix.go` in Orchid, read-only for this run).

## Decisions and implementation
1. Sourced safe-integer zero is a real budget, negative values remain invalid. Null means no issue override or route default. Test reader and public decoder.
2. A root router is `direct` only when the validated Orchid `dispatch.json.source` explicitly names the native codex or claude CLI transport. The existing `harness` field carries that transport name. Do not infer `direct` for agy or a provider/model value; opencode provider-prefix support waits for a separately validated dispatch source. Children inherit only through validated `known-parent` ancestry, with the same router as their immediate parent. Any unbound router remains typed unavailable.
3. `routePolicy` is a separate object with fixed `netscript-matrix` value and 64-hex digest, sourced from the bound private `receipt.json.resolution.digest` after the existing schema/source/model/selected-model receipt validation. Children have policy unavailable because their native calls are not proven matrix-routed. Decoder accepts old 0.5.0 frames missing this additive field, normalizing them to unavailable; producer emits it. No policy or router is inferred from model/provider.
4. Version `@rickylabs/harness-contracts` to 0.5.1, update README, keep schema/protocol 1 and no private fields in public frames.

## Forks, spikes, dependencies, risks
No open owner fork: coordinator decided R1 and budget; Eric can overrule. Integration gate S1: a production runtime record must confirm that the Orchid dispatch and matching receipt are collocated with the feed. Integration gate S2: #387 runtime frame must prove parent/child rows and time fields before #381 closes. Risk: forged child router; strict decoder compares against validated parent. Risk: private data leak; inspect diff, canary tests and leak scan before push. Risk: backward compatibility; decoder reads 0.5.0 frames without `routePolicy`.

## Gate
Independent plan review, red mutation controls for zero/router ancestry/policy digest, Node 24 contracts and telemetry suites, installed-consumer decode, leak scan, independent implementation review. Plan evaluation: pending independent review.
