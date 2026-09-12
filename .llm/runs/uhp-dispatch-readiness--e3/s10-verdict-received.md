# S10 returned FAIL, and the FAIL is the deliverable

Delegate completed 2026-09-12. PR #292 on `chore/route-identity-uhp--s10`, CI green, #288 advanced
to `status:impl-eval`. Run artifacts under `.llm/runs/route-identity-uhp--s10/`.

## The answer

Established from the published UHP 2026-08-11 specification, its OpenAPI document and its
conformance suite. The delegate deliberately escalated past the rendered chapter pages, on the
reasoning that those return through a summarising retrieval model and are a weak citation for a
spike about not believing convenient answers. That is the right instinct and it is why the verdict
is worth something.

| Field | Requestable | Echoed | Verdict |
|---|---|---|---|
| `model` | yes | yes, required | observable |
| `provider` | no | no | unobservable |
| `effort` | no | no | unobservable |
| `cwd` | no | no | unobservable and unrequestable |

So `invalid[]` is always non-empty, `RouteStatus` is pinned to `unknown`, and
`isRouteEvidenceVerified` is `false` on every UHP route, permanently. All eight lanes in
`routing.v1.json` carrying `purpose: "evaluation"` declare an effort, so none may run over UHP. The
ruling is preventive rather than a repair, since no `uhp` transport exists yet.

**The gate fails and the repository's behaviour under that answer is refusal, which is proven.**
That is the deliverable. A spike that returns FAIL with the fail-closed path demonstrated has done
its whole job.

## The finding that was not in the brief, and matters most

`compareRouteIdentity` gives `unknown` precedence over `mismatch`. Because three fields are
permanently absent over UHP, **a model substitution is collapsed into `unknown` by the missing
fields.** The substitution signal does not survive in `evidence.status`; it survives in
`evidence.mismatches`.

A fail-closed gate keyed on `status === "mismatch"` will therefore never fire over UHP, and will
look correct while never firing. Written into #286 as a requirement to read `mismatches`, and
relayed to the Cockpit seat as the first thing to change on their side.

The irony is worth recording. This run spent the day pinning `mismatch` apart from `unknown` at the
consuming boundary, with assertions on both sides of the wire — while the producer's own status
field merges them for UHP by design precedence. The boundary discipline was right and was aimed one
layer too high.

Corollary, so nobody optimises it away later: three unobservable fields are not merely three lost
signals. **They suppress the fourth**, which is the only one the protocol reports and the only one
the substitution gate depends on.

## `RouteSource`, and why fixing it alone would have changed nothing

The suspected defect is confirmed, and it is the **second** of two independent blockers rather than
the first. With a perfect dialect map, three fields would still be `null` and the status check at
`route.ts:176` returns false before the source comparison is reached.

**Believing otherwise is precisely the error this spike existed to catch**, and the brief's framing
invited it by naming `RouteSource` as deliverable two. The delegate caught it anyway.

Decision: a narrow additive `uhp/responses.result.model` arm, and deliberately **no** `uhp` label
for `effort`, `cwd` or `provider`, because a provenance label for a field the protocol cannot
report is a name with no referent. Additive, breaking no published package, shipped as a proposal
with acceptance criteria for #286 rather than applied.

## `model_fallback` — the mid-run addition, answered as far as it can be

**The specification is silent.** Typed `boolean`, no description, no default, not required, one
prose mention inside the substitution example. Conformance check T-03 asserts it only inside the
substitution branch, so a server that emits `false` unconditionally passes conformance, and so does
one that omits it entirely. The suite authors do write the negative half when they mean one — T-10
exists purely as the other half of T-09 — and wrote no equivalent here.

Keep presence-as-signal: it errs toward refusal. The always-refuses risk the Cockpit seat raised is
real and this run cannot retire it. But there is a better trigger available: the spec-endorsed
substitution signal is `model` versus `metadata.requested_model`, which is exactly how T-03 models
it, and presence there **is** spec-backed rather than a fail-closed guess.

One detail relayed to Cockpit: the value they described as `model_fallback: "false"` is a string
where the schema types the field `boolean`, so that shape is non-conformant, and it is truthy in
JavaScript, tripping a presence test and a truthiness test alike.

## Verification, and the drift approved

`pnpm run build` and `pnpm run test` green, 252/252 in subagents, CI green on the exact head.

Both new suites are **mutation-tested rather than asserted to cover**: collapsing `mismatch` into
`unknown` fails 16 tests, making the adapter credulous fails 3, and nothing else in the repository
notices either mutation — which is the argument for the suites existing. The mock ships two
adapters, one conformant and one deliberately credulous, handed the same fixture and returning
opposite verdicts. The "all three present and agreeing" fixture does **not** produce a verified
route, and a test asserts that it must not.

One out-of-scope change was declared and is approved: a single allowlist entry in
`scripts/check-compiled-policy.mjs` for the mock, mirroring the existing `dry-run-test-fixtures.ts`
precedent, with no guard logic changed. Verified here — `uhp-mock.ts` is not exported from
`index.ts` and is imported only by its test, the branch is additive at 2031 insertions and no
deletions, and neither `packages/routing` nor `packages/contracts` was touched.

**What was rejected matters more than what was added.** The delegate declined to rename the mock to
`*.test.ts` to slip past the guard's suffix check, on the grounds that it dodges the guard rather
than answering it. That is the exact inverse of the pattern this run has been cataloguing: it would
have produced a green check by arranging for nothing to look.

## What this is not

**It is not a passed gate.** The generator is Claude Opus 5, Generator != Evaluator requires a
non-Claude independent evaluation, and every non-Anthropic privileged route is out of budget until
2026-10-04T10:07Z. PR #292 stays at `status:impl-eval` and must not merge on green CI: CI proves
the suites pass and says nothing about whether the specification was read correctly, which is the
entire load-bearing content of a FAIL.

Seven items the run could not prove are kept in a separate column of its `verification.md` rather
than summed into the verdict, including whether a real router volunteers the three fields as
extensions and which UHP version Community Edition actually serves. All seven concern whether UHP
reports *more* than promised, so none could make the proven behaviour less safe.

[observed — PR #292 labels and check conclusion, branch diffstat, allowlist entry, index.ts exports
 and the mock import graph; verified 2026-09-12]

## The precedence rule, named properly by the consuming seat

The Cockpit coordinator sharpened the second finding into its general form, and the form is better
than the instance: **absence outranks contradiction.**

Three fields the protocol cannot report pin `status` to `unknown`, and that `unknown` then swallows
a real, observed, contradicted model. The presence of a genuine contradiction is erased by the
absence of unrelated fields. So **the more the wire fails to tell you, the more confidently the
status reports that nothing is wrong.**

That is one level deeper than every other instance catalogued in `dispatch-primitive-failure.md`.
Those were surfaces rendering absence as normality. This is a comparison function *ranking* absence
above a positive finding.

Neither seat could have found it alone. The producing side sees the precedence rule and not the
consumer's dependence on `status`; the consuming side sees the dependence and not the rule.

## A correction to how this run stated the permanence, adopted from the consuming seat

This run told Cockpit that their readers for `effort`, `provider` and `cwd` "are not landing", and
the #286 amendment said "permanently" as settled fact. That overreaches, and the Cockpit seat
declined to fully act on it for the right reason.

The S10 verdict is **an unevaluated generator verdict**. It is Opus-generated, awaiting a non-Claude
evaluator that cannot run before 2026-10-04. It is probably right and its citations are strong, and
it remains a reading of a specification that no independent evaluator has checked.

This is the same rule this run applied to itself earlier, about claims concerning code that had not
been read, pointed now at a claim about a specification this coordinator has not read.

The operative distinction, and the reason the correction is not merely cautious:

- **Hardening a gate on an unchecked reading is reversible.** Reading `mismatches` rather than
  `status`, and refusing certification while a route is unverified, are correct whether the three
  fields are permanently absent, temporarily absent, or present tomorrow. They cost nothing if the
  reading is wrong.
- **Deleting capability on an unchecked reading is not reversible in practice.** A reader returning
  `null` costs nothing; re-adding one after a comment declared the field dead costs another spike,
  because nobody re-derives a capability that the code says does not exist.

Both seats now keep their readers and record the finding with its provenance rather than as fact.
#286 carries the same qualification, so an implementer building from that brief inherits the
uncertainty rather than a confident sentence.

## The same defect, found here, in the file a UHP provider would be copied from

Prompted by the Cockpit seat reporting that the precedence rule had caught a **second** defect on
their side: their down-conversion refusal, the predicate deciding whether a UHP run may be
published as a `RepositoryRunObservation`, was also keyed on `status`. Over UHP that refusal never
fires, so a run with a contradicted model would have been **published as a readable observation**
rather than refused — a false provenance claim in a published contract, arriving by a completely
different route than the missing-verification-basis hole both seats were watching.

Checking whether that had a mirror here found one, in the most natural place to copy from.

`packages/provider-codex/src/protocol.ts` refuses in this order:

- line 235, `if (evidence.status === "unknown")` returns `verdict: "unknown"`
- line 238, `if (evidence.status === "mismatch")` returns `verdict: "refused"`

Correct for the in-tree codex protocol, where all four fields are observable through
`thread/start.result.*` and `mismatch` is reachable. **Over UHP the first branch always wins and
the second is dead code**, so a substituted model returns `verdict: "unknown"` — "we could not
tell" — rather than `verdict: "refused"` — "the server contradicted the request".

Same defect as the status-keyed gate, relocated from the status into the verdict. Both sit outside
`accepted` so neither certifies, but they are not interchangeable: one says the wire was silent and
the other says the server contradicted us, and collapsing them discards the only thing UHP does
report.

**It is the version most likely to ship**, because adapting the existing provider is the obvious
way to write a new one and that ladder looks transport-neutral. Filed on #286 as a requirement,
with a test that fails if a substitution returns `unknown` — noted there for the third time that
asserting the result is not `accepted` does not cover it, because it passes while the bug is
present.

The counter-example is already in this tree. `packages/dsh-app/src/dry-run-internal.ts:97` refuses
on `!isRouteEvidenceVerified(route)`, failing closed for `unknown` and `mismatch` alike, and
reports `status` only as refusal detail rather than branching on it.

## Unrun gates: checked here, and this repository is clean of that shape

The Cockpit seat diagnosed one of its two standing environment failures: `aspire` is pinned in
`.mise.toml`, installed, and simply **not on `PATH`**, so `test:toolchain` has never executed in
these sessions rather than failing on its merits. Their formulation is the sharper one: **an unrun
gate and a failing gate are indistinguishable in the output.** It is the strongest instance of the
class found today, because it was actively emitting a signal pointing at the wrong thing rather
than merely staying silent.

Checked here. Every script referenced from `package.json` resolves to a file that exists — all
thirteen. An initial pass suggested three were missing; that was a wrong guess at their filenames,
verified before it was reported anywhere.

The hole this repository does have is the one already recorded in `boundary-answers.md`:
`pnpm -r run test` silently skips any package declaring no `test` script, and `@rickylabs/governance`,
`@rickylabs/netscript-bridge` and `@rickylabs/provider-acp` declare none. Same class, milder shape,
since a skipped package at least shows as a smaller test count while an unrun gate shows as nothing.

[observed — protocol.ts branch ordering and the `unknown` helper's verdict at
 packages/provider-codex/src/protocol.ts:170-176 and 235-248; package.json script target census;
 verified 2026-09-12]

## Two rules generalised out of the afternoon, and a doctrine candidate

Both were sharpened by the Cockpit coordinator from instances found on each side of this boundary.
Recorded here and written into #286, which is where an implementer will read them.

**1. Derive the decision from the strongest available negative, and let the specific status explain
rather than decide.** A ladder branching on `status` must enumerate every status correctly, on
every transport, forever. A predicate refusing on not-verified is already correct for statuses that
do not exist yet and transports nobody has written. `dry-run-internal.ts:97` is the instance; this
is the thing to carry.

**2. The weak assertion is the one that feels like it tests the thing.** `assert(!accepted)`,
`assert(!verified)`, `grep -i verdict` — three different people wrote a version of this today, on
three codebases, each reading like coverage of the distinction it sits next to, each passing while
that distinction is broken, because both sides of the distinction fall outside what is asserted.
If an assertion holds equally for the correct and the defective behaviour, it is not covering that
behaviour however close the words are. Where a distinction is load-bearing, assert the distinction
itself and then break it on purpose to confirm the test goes red.

Rule 1 is doctrine-shaped and belongs in `doctrine/PRINCIPLES.md` rather than in one issue. It is
**not** added here: doctrine is portable and changed deliberately, and a coordinator adding to it on
the strength of one good afternoon is the wrong instinct. Raised as a candidate for the owner.

## The absent-signal catalogue gains a second tier

The Cockpit seat's `aspire` diagnosis forced a distinction the earlier catalogue missed. Everything
in `dispatch-primitive-failure.md` was **silent absence**: the reader concludes nothing because
nothing was said. The toolchain gate is **absence wearing a misleading signal**: it reported red,
for a reason that was false, and so recruited two delegates into correctly recording a wrong
diagnosis. Both wrote "pre-existing environmental failure" in their pull requests, which is accurate
as a description and wrong as a cause.

The second tier is worse, because a silence invites investigation and a confident wrong signal
closes it.

## #272 is unaffected by the evaluator amendment, checked rather than assumed

The owner has chosen the upstream matrix amendment, filed as `rickylabs/netscript#2011`, adding
`deepseek_v4_pro` at **complex** implementation evaluation rather than a flash-class model, on the
reasoning that dropping to flash at the tier most needing a strong adversary is a real reduction in
evaluator strength, and that `pro` already declares an Ollama capability so only the matrix edit is
required. `muse_spark_1_3` stays first candidate, so nothing changes when its budget returns in
October.

**This does not reach #272.** That issue is architecture-tier plan evaluation, whose cell is
`[muse_spark_1_3 @ max, grok_4_6 @ xhigh]`, read directly from `delegation-matrix.ts` earlier in
this run. The amendment touches complex, not architecture. #272 remains on the 2026-10-04 wall and
its two-branch Monday plan stands unchanged.

It may move Cockpit's PR #98, which is complex implementation evaluation, off that wall. If it
lands, the agreed Monday ordering changes and the Cockpit seat will say so.

[source — netscript#2011 and the Mobile seat's verification, relayed by the Cockpit coordinator
 2026-09-12; architecture cell re-read here rather than taken on report]
