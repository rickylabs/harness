# GATES

What a chain of checks must be able to say when it stops.

Portable, like the rest of `doctrine/`: requirements on a report, not an implementation. Every claim
below was measured in this repository on 2026-09-14 and the measurement is shown.

---

## The defect

`a && b && c` exits non-zero whichever link fails, and the lines a reader or a CI summary actually
sees carry no stage name. So one exit code covers every stage, and "the build failed" is compatible
with a broken markdown link and with code that does not compile.

The worse half is silent. When an early check trips, the later checks **never execute**, and nothing
says so. A reader scores the result as "the gate ran and refused" when most of the gate never ran.
Nine unasked questions are reported as a single answer.

That is the general form of a rule this repository already holds: **a check that cannot run reports
inconclusive, never negative.** A chain that stops at stage four of thirteen and prints only
"failed" is reporting negative for nine stages it never asked.

## Three things a stopping chain must say

Requirements on the report. Testable independently of whatever runs the stages.

1. **Which stage decided.** Its name and its position, `4 of 13`. Not only that something failed.
2. **Whether the designated compile stage ran.** Named as a stage, not inferred. A chain whose
   compile sits in the middle can fail without ever invoking a compiler, and "did it build" is the
   question a reader is usually actually asking.
3. **Every stage that never started, by name.** Not a count. A reader cannot check a count against
   what they expected to be covered, and a name is what tells them whether the thing they cared
   about was among the casualties.

Measured here, by breaking one markdown link on purpose:

    build FAILED at stage 4 of 13: check:links
      compile (build:packages, stage 8): DID NOT RUN
      never reached: check:forms, check:snapshots, check:compiled-policy, build:packages, check:publish, check:label-registry, check:docs, check:skill, check:tutorial

Quoted unwrapped, on one line, because that is how it is emitted. A transcript a reader cannot
compare byte for byte against their own output is the defect this document is about.

## The designated stage must be named and validated

This is the transferable part, and it is not the code.

A report that says the compile ran is worthless if the name it checked can drift. Take the compile
stage as an explicit argument, and **refuse to run at all when that name is not one of the stages.**
Otherwise a renamed stage produces a report that confidently says the compile did not run, on every
future build, because a string nobody validated stopped matching anything — and a permanent,
confident, wrong answer is worse than no answer.

Measured, the refusal:

    run-stages configuration error — no stage was run: --compile-stage does-not-exist is not one of the stages, so its report would be a lie

Two properties of that refusal matter as much as its existence. It says **no stage was run**, so it
cannot be read as a stage verdict. And it is a sentence rather than a stack trace, because a reader
who sees a trace goes looking for a bug in a stage when the fault is in the argv that named them.

## Three states, and inconclusive is not zero

A stage can pass, fail, or fail to reach a verdict, and the aggregate needs all three.

    exit 0    every stage ran and passed
    exit 1    a stage ran and refused
    exit 2    a stage did not reach a verdict

Inconclusive is deliberately **not** exit zero. A gate that cannot execute is unproven and is never
assumed green, so a green inconclusive would satisfy the word and invert the rule. A real failure
outranks an inconclusive when both occur: never trade a negative down to an absence.

An inconclusive report must name what was not established, in words. A status string can be skimmed
past; a sentence saying nothing was established cannot.

## What a spawned stage actually returns

Measured, because the first attempt at this got it wrong and the wrong version passed its tests.

Three conditions are not failing stages and all three are easy to report as one:

    the runner process killed by a signal     status null, signal set
    the stage runner missing from PATH        status null, error ENOENT
    the stage's own child killed              status 128 + signal, signal null

The third is the common one and it does not arrive as a null status, because a script runner catches
its child's death and exits `128 + signal` rather than propagating. Measured identically through
both `sh` and `pnpm`. A fix handling only the null cases looks complete, passes its tests, and leaves
the everyday path misreporting.

Enumerate the signal codes rather than treating every high exit as a signal, because not every signal
death comes from outside the process:

    129 SIGHUP   130 SIGINT   137 SIGKILL   143 SIGTERM     imposed from outside -> inconclusive
    134 SIGABRT  139 SIGSEGV                                the code failing     -> FAIL

A stage that aborts or segfaults has told you something true about the code. Calling that
inconclusive suppresses a real failure, so the set is a classification and not a threshold.

## The shape that makes it cheap to adopt

Put the whole report in a **pure function** over the stage list, the results, and the designated
stage. Then every requirement above is testable without spawning anything, and the executable half
stays small enough to read in one sitting.

Measured here: 149 lines total, of which the executable half is 14 non-comment lines, covered by 20
tests.

The tests must drive the pure function *and* the mapping from a real spawn result to a stage code.
Measured mistake: a suite that fed the pure function codes chosen by hand covered it well and never
executed the one line that produces a code, which was the line every other line depended on. Not
undertested — unexecuted.

## Run each gate's guard before the gate

A gate paired with the test that proves it fires must run the test first.

Gate first: the gate fails, its guard never runs, and you learn the concrete problem while learning
nothing about whether the guard that found it works. Survivable, because a failure announces itself.

Guard first: you learn the verdict is worthless before a verdict is delivered. That is the direction
that matters, because a gate whose guard is unproven can produce a **false pass**, and nobody
investigates green.

So gate-first protects against nothing.

## What this does not solve

It makes concealment visible. It does not make a red gate get read.

A chain that correctly reports "failed at stage two of nine, seven never started" is still a chain
nobody has acted on, and a repository can sit in that state for as long as the failure is tolerated.
Coverage reporting and neglect are different problems and only the first is addressed here. Fixing
the first tends to expose how long the second has been running, which is uncomfortable and is the
point.

It also does not make a chain correct. Naming the stage that failed says nothing about whether the
stages are the right stages, in the right order, or whether one of them is passing vacuously.
