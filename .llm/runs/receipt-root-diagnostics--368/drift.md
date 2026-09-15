# Drift — receipt-root-diagnostics--368

## 2026-09-15 — base-branch integration

Latest `main` added an exact-`0700` root guard and its own negative control while this run was open. The rebase preserved that stricter accepted set by classifying `(mode & 0o7777) !== 0o700` as `wrong_mode`; retaining the run's earlier `0o077` predicate would have widened acceptance. The rebased 13-test reader suite passed, the exact guard was mutation-proven red, and restoration passed. This is compatible upstream integration, not a scope change.
