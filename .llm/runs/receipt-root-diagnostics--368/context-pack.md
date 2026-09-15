# Context pack — receipt-root-diagnostics--368

## Summary

Issue #368 is implemented, locally verified, and independently evaluated `PASS`. The reader returns its supplied root and one of six nullable refusal reasons without changing its accepted roots, fixed notes, or degraded semantics. Six defects plus a healthy-empty root are tested; wrong-mode and independently git-ancestor classification were mutation-proven red and restored green. Declared pnpm wrappers are INCONCLUSIVE on the no-exec mount; their direct Node-invoked TypeScript equivalent passed all 469 telemetry tests. Commit, push, draft PR creation, and ready transition remain.

Baseline is `ade559bef2c8a8d8f4356d6c580b69e455e4cd48` on `orch/divybot-368`. The exact permitted paths are in `supervisor.md`; decisions and risks are in `plan.md`.
