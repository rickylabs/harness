# Informative current step for USABLE-1

## Summary

Refine the already published 0.11.0 `activity.steps` producer. Read one in-progress plan item from Codex `update_plan` or Claude `TodoWrite`, publish one screened assistant sentence, and unwrap only an exact shell `-lc` command array before extracting its safe command head. This changes no public type or decoder.

## Source and privacy basis

- Codex's official `UpdatePlanArgs` declares `plan: Vec<PlanItemArg>` with `step` and `status` and `in_progress` as a status: https://github.com/openai/codex/blob/main/codex-rs/protocol/src/plan_tool.rs .
- Claude Code's own tool discussion records TodoWrite `todos[]` with `content`, `status`, `activeForm`: https://github.com/anthropics/claude-code/issues/66391 .
- The existing producer reads only assistant-origin Codex `response_item` and Claude assistant content, keeps at most 20 rows, and publishes no raw arguments (`packages/telemetry/src/native-activity.ts`, `packages/telemetry/src/backfill/codex.ts`, `packages/telemetry/src/backfill/claude.ts`).
- A candidate string is rejected in full if it exceeds 120 chars or fails printable, secret, address/path and long opaque-token screens. No substring is published. For a message, sentence selection happens before the screen; unsafe first sentences become a fixed generic label.
- Shell arrays are accepted only for a three-element `bash` or `sh`, `-lc`, string command tuple. The inner command still passes the fixed executable/subcommand allowlist, so flags and arguments never enter the public row.

## Gates and proof limit

Focused telemetry tests; compileable mutants for plan status, length, character/secret screen, sentence boundary, shell flag and executable; full workspace typecheck/build/test; public diff/body leak scan; draft PR and CI before READY. A read-only replay of an older bound run may have no plan tool call and many generic tool rows; that is not live proof of this new producer branch.
