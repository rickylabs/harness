PASS

- Guard `(rootStat.mode & 0o7777) !== 0o700` (orchid-dispatch.ts:29) enforces exact 0700 including special-bit rejection: 0700 accepted, 0500 and 01700 refused to degraded `source_unavailable` with empty dispatches; restored 0700 reaccepted.
- No other guards changed: single-line diff, absolute/realpath/.git/reservation/receipt paths all intact — 43/43 reader-check cases pass, 462/462 tests pass.
- Measurement discriminates: reverted guard → exact-mode FAIL (0500 accepted, proving the check is load-bearing); restored guard → PASS.
