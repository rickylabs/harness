# Profile: leaf

One scoped change. One run directory, one branch, one pull request.

This is the default. If a brief does not name a profile, this is the shape it gets.

| Field | Value |
| --- | --- |
| `run-mode` | `run-loop` — the slice contract |
| `skill` | the harness skill (`use harness`) |
| `state` | the run directory: `supervisor.md`, `plan.md`, `worklog.md`, `context-pack.md`, `drift.md` |
| `gate` | the repository's configured gate commands; **the scoped wrappers alone are not sufficient** |
| `routing` | matrix `implementation` row at the brief's tier; evaluators from `plan_evaluation` and `implementation_evaluation` at the same tier |

---

## Before anything

Resolve the routing. Ask the matrix, with `--json`, for your tier. Take the primary; on an
unreachable seat fall back to **the matrix's own next declared candidate**, never to a model
you picked yourself.

Write `supervisor.md` first: who is working, on what baseline SHA, and the exact paths this run
may write. Anything later found outside that declared surface is drift, not scope.

If the brief asks for the `complex` or `architecture` tier without a named authorizer and a
rationale, **stop and say so**. Do not downgrade quietly and do not proceed.

---

## Design checkpoint

Before writing code, `worklog.md` carries seven items. All seven, or the plan is not ready:

1. **Public surface** — what a caller can see when this is done.
2. **Domain vocabulary** — the words this change introduces, and what they mean.
3. **Ports** — what it depends on, as interfaces.
4. **Constants** — what replaces the string literals.
5. **Commit slices** — ordered. Each one names what it introduces, which gate proves it, and
   which files it touches. Target: fewer than thirty.
6. **Deferred scope** — what you decided not to do, and why.
7. **Contributor path** — the one file someone reads to extend this.

The plan PR enters review as **"Plan & Design — READY FOR REVIEW"**.

Plan evaluation is risk-selected. When it is selected it is a hard stop, not an advisory. Two
`FAIL_PLAN` verdicts escalate rather than loop a third time.

---

## Per slice

Run them one at a time. Never start the next before the previous is terminal.

1. Implement the slice.
2. Run **that slice's** gate.
3. **Slice review gate** — a supervisor substantively reviews. No lane self-certifies.
4. The **sign-off commit is the supervisor's**, not the implementer's.
5. Push, and comment on the draft PR with the scope, the commit hash and the gate evidence.
6. Update `worklog.md` and `context-pack.md` **in the same slice**. A slice whose commit does
   not touch the run directory is incomplete.
7. Reconcile against the current head, and write one reconcile note.

### Concept of done, per slice

- Every file is reachable from the public surface or from a test.
- No files that exist only to make a folder look right.
- Constants replaced the string literals.
- One-line doc comments on what a reader would otherwise have to infer.
- A contributor can extend this by reading one file.
- The slice's gate passes.

---

## Gate

The scoped check, lint and format wrappers are **necessary but not sufficient**. They pass
permissive types and they honour inline suppressions. Where the repository configures a
broader quality or architecture scan, that scan is part of the gate.

Gate evidence comes from the wrappers the repository declares. A raw type-check invocation or
a hand-rolled registry request is **not a verdict**.

If a gate cannot execute in this repository, record it **unproven**. "CI will catch it" is a
statement about a future repository, not this one.

---

## Evaluation

Implementation evaluation is mandatory. The evaluator is a **separate session from a different
vendor family**, re-steered across rounds — never a fresh evaluator per round.

Verdicts: `PASS`, `FAIL_FIX`, `FAIL_RESCOPE`, `FAIL_DEBT`.

Loop limits come from the tier, from the matrix. They are not overridable by the brief.

**Two consecutive terminal failures on one leaf ends the loop.** Release the evaluator lease
and surface both verdicts to the owner as a decision record. Do not try a third time.

On `FAIL_RESCOPE`: write the rescope note, update the phase registry, **stop, and consult the
owner.** Do not proceed to the next group.

---

## Close

- Leak-check when ownership of a resource is unclear. Report foreign and unknown-owner
  resources; **never mutate them.**
- Update `context-pack.md` so the next agent resumes from one file.
- Record architectural debt you accepted, as debt, with its cost.
- Write the dated lesson note.
