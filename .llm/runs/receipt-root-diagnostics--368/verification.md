# Verification — receipt-root-diagnostics--368

## Summary

The executable TypeScript/package-test equivalent passed 469 tests, the targeted restored reader suite passed 12 tests, and the wrong-mode mutation made that dedicated assertion fail. The declared pnpm wrappers are INCONCLUSIVE on this no-exec worktree mount because every generated `tsc` shim exits 126 before compilation.

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm --filter @rickylabs/telemetry test` | 126 | INCONCLUSIVE: `sh: 1: tsc: Permission denied` |
| `node node_modules/typescript/bin/tsc -b packages/telemetry/tsconfig.json && node --test "packages/telemetry/dist/**/*.test.js"` | 0 | 469 passed, 0 failed |
| mutated mode guard: `node node_modules/typescript/bin/tsc -b packages/telemetry/tsconfig.json && node --test packages/telemetry/dist/orchid-dispatch.test.js` | 1 | `wrong_mode`: actual `null`, expected `wrong_mode` |
| restored same targeted command | 0 | 12 passed, 0 failed |
| `pnpm typecheck` | 126 | INCONCLUSIVE at `typecheck:packages`: `tsc: Permission denied` |
| `pnpm build` | 126 | INCONCLUSIVE at `build:packages`: `tsc: Permission denied`; later stages not reached |
| `pnpm test` | 126 | INCONCLUSIVE at `test:packages`: `tsc: Permission denied`; `check:installed` not reached |
| `git diff --check` | 0 | no whitespace errors |

After rebasing onto `273fdea`, `main`'s exact-`0700` guard was retained. The restored targeted command passed 13 tests. Mutating `(rootStat.mode & 0o7777) !== 0o700` to false exited 1 with 9 passed / 4 failed, including both `wrong_mode` (`actual: null`) and `requires exactly 0700`; restoring it returned 13 passed / 0 failed.

The permission failure reproduces even when the shim has mode `0755`; direct execution reports permission denied, while invoking the TypeScript entry point through Node succeeds. It is therefore recorded as a reachability failure, not a failing code verdict.
