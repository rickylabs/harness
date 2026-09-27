# issue-agent-ancestry--alpha — worklog

- 2026-09-27 20:02 UTC — Read coordinator common and Harness briefs, doctrine and board.
- 2026-09-27 20:07 UTC — Fetched fresh Harness and Orchid main, made isolated worktrees, located existing Codex goal and native ancestry code.
- 2026-09-27 20:10 UTC — Added a failing test for missing route reason field; TypeScript exited 2 with three missing-property errors.
- 2026-09-27 20:12 UTC — Added private reader and public decoder. Deliberately weakened receipt guard; focused test exited 1 (`unknown` instead of `unavailable`). Restored. Deliberately weakened decoder; focused test exited 1 (accepted canary). Restored.
- 2026-09-27 20:13 UTC — Contracts and telemetry test suites exited 0; telemetry reported 601/601 passing. Runtime source unverified.
- 2026-09-27 20:25 UTC — Coordinator decided route-default budget semantics; Eric can overrule. Separate-session adversarial review returned FAIL_FIX, identifying requested/effective effort mismatch and missing negative controls. Fixed the reader comparison, updated the plan, and added symlink/mode/size cases. Re-review pending.
- 2026-09-27 20:29 UTC — Guard mutation controls: removing receipt mode, symlink and size checks individually made the focused test exit 1 (`unknown` instead of `unavailable`); all checks restored. Re-review returned PASS AFTER NARROW FIXES, asking for a selected-model-only negative. Added it and a full Orchid-shaped receipt; weakening the selected model check made the focused test exit 1 (`unknown` instead of `unavailable`). Restored. Contracts 233/233 and telemetry 601/601 passed after the fixes. Independent Stage G evaluation requested.
