# issue-agent-ancestry--alpha — context pack

Summary: this branch implements validated Orchid observed-field reasons as an additive public agent-observation field. It does not establish live alpha proof.

Baseline `origin/main` `f5f8803`; branch `fix/issue-agent-ancestry--alpha`. The change touches the contract decoder, the Orchid receipt reader, the agent projection and focused tests. Read `research.md` and `plan.md` for source citations and the coordinator's route-budget decision, which Eric can overrule. Run `pnpm exec tsc -b packages/contracts packages/subagents packages/telemetry`, then the contracts and telemetry package tests. The coordinator must inspect the PR and merge; this seat must not merge, label a proof issue, or restart Orchid.
