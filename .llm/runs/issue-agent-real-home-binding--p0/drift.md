# Drift

- Stage F finding, 2026-09-27 23:10 UTC: The coordinator's rerun helper prints a heuristic count, not an ancestry proof. Execution gate amended: inspect its private raw JSON locally and assert #387 `complete:true`, one dispatch, exactly two agents, one `confirmed-root`, one `known-parent` whose value equals that root's opaque public agentId. Print only booleans and counts. The synthetic head must exceed the measured live maximum (24 KiB), and a separate >64 KiB head must fail closed. No product code changed before this amendment.
