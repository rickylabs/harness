# Running the control is the mechanism. Writing it is not.

Two coordinators, two repositories, one day. Both wrote a mutation control specifically to satisfy a
rule against weak assertions, and **both controls initially killed nothing, for the same structural
reason.** Neither was found by review. Both were found by actually running the mutation.

This is the strongest result of 2026-09-12 and it did not come from either repository's code.

## The two instances

**Harness, in the S11 suite (PR #295).** A stickiness test damaged the stream reader, then pushed a
fresh stream to prove the reader stayed refused. But the sequence counter stops at failure, so the
mutant refused those bytes for a *second* reason. The assertion held on both sides of the
distinction. Rewritten to push a frame numbered to fit the stopped counter, plus a control proving
that same frame **is** accepted by an undamaged reader. It then went red. Fourteen of fourteen
mutations now kill.

**Atelier Cockpit, earlier the same day.** A deletion control did not go red, because the test moved
the conversation in both the probe and the guarded read, so the store denied it before the re-check
was ever reached.

## Why they are the same failure

In both cases the mutation was genuinely applied and the defect genuinely present, and the test
still passed — because the test's setup had introduced a **second, independent reason** for the same
observable outcome. The assertion could not distinguish "refused because the guard works" from
"refused because something else already refused". It held on both sides of the distinction it was
written to pin.

That is the weak-assertion trap this run had already recorded twice, from `assert(!accepted)` and
`assert(!verified)`. What is new is where it was found: **inside the suite written to satisfy the
rule against it, by an author who had the rule in front of them.** Knowing the rule is not
protection. Two of us proved that independently, on the same day, in the specific code written to
honour it.

## The rule

**Writing a mutation control is a hypothesis. Running it is the test of that hypothesis.**

A control that has never been executed against the mutated code is worth no more than a comment
asserting the behaviour is covered. So:

- For every assertion that pins a distinction, break the behaviour on purpose and **confirm the test
  goes red**. Report the mutation and the number of tests it killed.
- **A mutation that kills zero tests is a finding, not a formality.** It means either the behaviour
  is uncovered or the test is passing for an unintended reason. Both need the test rewritten, not the
  count noted.
- When a control does not fire, suspect the **setup** before the assertion. The usual cause is a
  second path to the same outcome, introduced by the fixture rather than by the code under test.
- Pair a negative control with a **positive** one on the same input: prove the input that must be
  refused by the damaged code **is** accepted by the undamaged code. That is what closes the second-
  reason gap, and it is what fixed the Harness instance.

## Doctrine candidates from this run, neither applied

Both belong in [`doctrine/PRINCIPLES.md`](../../../doctrine/PRINCIPLES.md) rather than in an issue
that closes. **Neither is added by this seat.** Doctrine is portable and changed deliberately, and a
coordinator writing into it on the strength of one good day is the wrong instinct. Raised for the
owner.

1. **Derive the decision from the strongest available negative, and let the specific status explain
   rather than decide.** A ladder branching on a status must enumerate every status correctly, on
   every transport, forever. A predicate refusing on the strongest negative is already correct for
   statuses that do not exist yet and transports nobody has written.
2. **Running the control is the mechanism; writing it is not.** As above.

The second is the better candidate of the two, because the first can be complied with by reading it
and the second cannot.

[observed — the S11 stickiness mutation and its rewrite, reported by that delegate with its
 fourteen-mutation table; PR 295, 2026-09-12]
[source — the Cockpit seat's deletion control failing for the symmetrical reason, reported to this
 seat 2026-09-12]
