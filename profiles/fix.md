---
name: fix
title: "Fix: one bug, one PR"
role: implementation
defaultTier: straightforward
description: Fixes one reported defect with a failing regression test first, one change and one gated pull request.
skills:
  - use harness
permissions:
  - Read and edit the assigned repository branch.
  - Open a draft pull request for review.
guardrails:
  - Use only the matrix route and its declared fallback.
  - Fix the reported defect only; record anything else found as a follow-up.
  - Never self-certify the fix.
---

# Profile: fix

One reported defect. One run directory, one branch, one pull request, one conventional
`fix(<scope>): <summary>` commit subject.

Use this when the work is "something that worked, or should work, does not". New behavior
is a [`leaf`](leaf.md); a fix that turns out to need new behavior stops and says so.

| Field | Value |
| --- | --- |
| `run-mode` | `run-loop` — the slice contract, with one slice |
| `skill` | the harness skill (`use harness`) |
| `state` | the run directory: `supervisor.md`, `worklog.md`, `context-pack.md`, `drift.md` |
| `gate` | the repository's configured gate commands plus the new regression test |
| `routing` | matrix `implementation` row at the brief's tier; evaluator from `implementation_evaluation` at the same tier |

---

## Before anything

Resolve the routing. Ask the matrix, with `--json`, for your tier. The profile's
`straightforward` default applies only when a brief omits the tier. Take the primary; on an
unreachable seat fall back to **the matrix's own next declared candidate**, never to a model
you picked yourself.

Write `supervisor.md` first: who is working, on what baseline SHA, the defect in one
sentence, and the exact paths this run may write.

If the brief asks for the `complex` or `architecture` tier without a named authorizer and a
rationale, **stop and say so**.

---

## Reproduce, then fix

1. **Reproduce.** Record in `worklog.md` the exact input, the observed result and the expected
   result. If you cannot reproduce it, stop and file a decision record with what you tried.
   Do not fix a defect you have not seen.
2. **Root cause.** Name the line or decision that produces the wrong result, with a
   `file:line` citation. A symptom is not a root cause.
3. **Regression test first.** Add a test that fails before the fix, by assertion, for the
   reported reason. Keep its failing output in the run directory. A test that already passes
   proves nothing about this defect.
4. **Smallest correct change.** Change what the root cause requires. No refactors, renames or
   drive-by cleanups; record those as follow-ups.
5. **Prove it.** The regression test now passes, and the full repository gate passes.

---

## Pull request

- Commit subject: `fix(<scope>): <summary>`, written in a file and passed with `-F`.
- The body states the defect, the root cause with its citation, the regression test and its
  failing-then-passing evidence, and the gate result. Link the issue it fixes.
- Open it as a draft. Leak-scan every added line before pushing to a public repository.

---

## Evaluation

Implementation evaluation is mandatory. The evaluator is a **separate session from a different
vendor family**. It checks that the regression test fails without the fix and passes with it,
that the root cause is the one named, and that nothing outside the defect changed.

Verdicts: `PASS`, `FAIL_FIX`, `FAIL_RESCOPE`, `FAIL_DEBT`. Loop limits come from the tier, from
the matrix.

On `FAIL_RESCOPE` — the defect is really missing behavior or a design problem — write the
rescope note, **stop, and consult the owner.** It becomes a `leaf` or a plan, not a bigger fix.

---

## Close

- Update `context-pack.md` so the next agent resumes from one file.
- List the follow-ups you recorded instead of fixing.
- Write the dated lesson note: what let this defect through, and what now catches it.
