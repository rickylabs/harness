# issue-agent-ancestry--alpha — adversarial review

Summary: separate-session verdict `FAIL_FIX`, then `PASS AFTER NARROW FIXES` on re-review. The narrow fixes were applied; Stage G evaluation is pending.

1. Valid Orchid receipts may have requested and effective effort differences (`cmd/divybot/matrix.go:383,726-728`). The first reader compared them. Disposition: fixed the comparison, added a positive unequal-effort fixture and a model-correlation negative.
2. The initial budget owner fork treated `budget_unset` as an option despite [#381](https://github.com/rickylabs/harness/issues/381) acceptance. Disposition: coordinator decided 2026-09-27; Eric can overrule. The plan now records route-default implementation as a gate.
3. The plan omitted a named live proof spike and likelihood/impact/gate risk entries. Disposition: added S1/S2 and a risk table to `plan.md`.
4. Receipt symlink, mode and size guards lacked targeted negative tests. Disposition: added all three fixture cases; each corresponding guard break made the focused test exit 1 with `unknown` instead of `unavailable`.
5. Re-review found the selected physical model check lacked its own negative. Disposition: added a selected-model-only mismatch to a full Orchid-shaped receipt fixture. Weakening the check made the focused test exit 1 with `unknown` instead of `unavailable`.
6. Stage G lacked `plan-eval.md`. Disposition: independent plan evaluation requested; no PASS is claimed yet.
