# Implementation review (ra776c)

Reviewer: a separate Claude session given only the diff `b82bbb835..9623d11`, the two review items,
and read-only instructions. It had no access to this session's reasoning. This is a same-family
reviewer: the cross-family seat (Codex) is out of weekly quota and no matrix CLI was available to
name a fallback, so the cockpit's cross-family re-review on PR #777 remains the external evaluator.

Verdict: **PASS**. Its findings:
- Item 1 fixed at both reads. Item 2: every native row is incomplete; skipped duplicated-receipt,
  conflicting-seat and identity-mismatch runs now list their issue; refusals are incomplete on the
  native path; the legacy producer is unchanged; the catch path is never complete.
- The contract split is mechanical (helpers gained `export`, not re-exported from `index.ts`); the
  only behavior change is the partial-forest reason set. It rebuilt the 0.41 decoder at `b82bbb835`
  independently: default frames decode, opted-in uncovered forests are rejected.
- No leaks found.

Non-blocking findings and what was done:
1. Hidden-run test passes without `hiddenRun()`, because every row is incomplete by design:
   comment added saying exactly that.
2. No test reached the receipt-identity-mismatch skip: added "a receipt whose native identity
   disagrees with Orchid leaves its issue uncovered"; it fails when that `unattached.push` is
   removed (0 pass, 1 fail) and passes when restored.
3. The projection copied the contract's repository regex: removed; the contract decoder now
   decides whether an unattached issue row is publishable (doctrine 2).
4. The older-reader control assumes different reader versions in two tests: recorded in
   `worklog.md`; no CI lane pins the control.
5. Default frames carry no native agents until consumers read 0.42 with `--partial-trees`:
   intended, stated in the guide and PR body.
6. Missing final newline in `issue-agent-tree-rows.ts`: fixed.
