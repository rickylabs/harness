# Context pack

P0 after #388 merge. Full runtime capture on 2026-09-27 returned incomplete ancestry with no issues because stale #378 had no Codex rollout; coordinator proved #387 alone has a parent and child. This run adds per-issue completeness and receipt-window-bounded Codex scanning. See plan.md, research.md, worklog.md, drift.md and independent review. Baseline origin/main 0751c76. Runtime rerun belongs to coordinator.
