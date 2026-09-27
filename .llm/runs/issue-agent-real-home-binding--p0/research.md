# Issue agent real-home binding — research

Summary: The receipt source is healthy. The rollout source is present and its matching pair parses cleanly, but the 16 KiB `session_meta` head cap rejects every candidate before the private identity join.

- `packages/telemetry/src/issue-agent-feed-cli.ts:30-75` reads Orchid receipts, then per-issue Codex windows. A degraded scan becomes `source_unavailable` unless its notes identify a limit.
- `packages/telemetry/src/backfill/index.ts:80-149` caps head reads at 16,384 bytes, records an unreadable candidate when the first line exceeds that cap, and selects native roots and children by private ids.
- Private local diagnostic at 23:08 UTC: Orchid read reported reason=null, degraded=false, four dispatches, one for #387. The #387 Codex scan reported `candidate head could not be read`, 131,080 head bytes, zero runs. No private path or id is recorded here.
- Private local structural diagnostic: eight canonical heads were 18.6–22.9 KiB, all valid `session_meta`; the matching root and child full files were 0.58 and 0.15 MiB and parsed with no notes. This is local runtime evidence; raw output remains private.
- The existing real-shape test in `packages/telemetry/src/issue-agent-feed-cli.test.ts:96-149` uses short first lines, so it did not exercise modern heads with embedded base instructions.
