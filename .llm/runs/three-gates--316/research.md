# Three gates — research

Earlier implementation already exists; this is a bounded correction, not a replacement.

- Issue and owner clarification retrieved 2026-09-15: https://github.com/rickylabs/harness/issues/316 and https://github.com/rickylabs/harness/issues/316#issuecomment-5657697632 . Missing test declarations intentionally fail because the configuration audit ran. Preserve this policy.
- `scripts/inconclusive.mjs:37` probes execution but labels every refusal noexec and drops the actual location.
- `scripts/check-test-scripts.mjs:36` returns an empty package list for an absent directory; no inconclusive path exists for inability to enumerate.
- `scripts/run-stages.mjs:95` counts every attempted stage as having run, including a spawn error; empty/partial successful result sets report all green.
- `scripts/run-stages.mjs:89` interprets exit 2 as inconclusive, including a compiler returning its native diagnostics exit 2. This needs explicit distinction at the compile boundary.
- Prior art read: NetScript `.llm/harness/README.md:3` keeps generator and evaluator separate; local `doctrine/GATES.md:24` requires a named deciding stage, compile execution and unreached stages. No runtime subsystem work is required.
