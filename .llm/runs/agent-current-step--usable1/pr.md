## Summary

Make per-agent activity steps more useful while keeping the published 0.11.0 wire contract. Extract the single `in_progress` step from Codex `update_plan` or Claude `TodoWrite`, publish one safe first assistant sentence, and read a safe command head from an exact `bash`/`sh -lc` command array.

## Scope

USABLE-1 current-step follow-up to the merged activity feed. No contract field or version change, no dispatch, no new issue.

## Validation

- `pnpm typecheck` — PASS.
- `pnpm build` — PASS, including after the documentation move.
- `pnpm test` — PASS with executable TMPDIR; the full workspace suite completed.
- Eight compileable mutants killed: plan status, length, character/secret/domain screen, sentence boundary, shell flag, shell executable.
- Public diff and PR body leak scan — PASS.

## Drift / Debt

An older bound run replay had no observed plan tool call and remained mostly generic because its tool rows were `functions.exec`. This PR proves the requested extraction in focused tests; it does not claim the full current-step bar is live-proven on that older run.
