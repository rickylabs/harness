# Issue agent real-home binding — supervisor

Summary: Repair the bounded Codex head reader so the verified #387 dispatch can bind its native parent and child on the real home.

- Seat: Harness; baseline: c42f9aa (contains #390 merge 09341af).
- Authorized by coordinator's 2026-09-27 23:08 UTC DECISIONS.md entry and user's direct instruction to loop until #387 binds.
- Mutation surface: `packages/telemetry/src/backfill/index.ts`, its focused tests, and this run directory. Private runtime captures stay in the coordinator's private briefs directory.
- No issue-label dispatch, service restart, merge, or release tag.
