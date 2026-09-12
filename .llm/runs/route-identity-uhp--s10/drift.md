# Drift — `route-identity-uhp--s10`

Deviations from the declared plan or from doctrine, each with a disposition. Per
`doctrine/WORKFLOW.md`, drift is recorded rather than folded back into history.

---

## D-1 — one line added outside the declared mutation surface

**What.** `supervisor.md` declared a mutation surface of the run directory plus two new files under
`packages/subagents/src`. A third file was edited: one allowlist entry added to
`scripts/check-compiled-policy.mjs`.

**Why.** That guard (owned by #271) refuses literal `model`, `effort`, `tier`, `lane`, `family`,
`profile`, `preset` and `harness` assignments in any source file not ending in `.test.ts`. A UHP wire
fixture set consists of exactly such assignments — `model: "claude-opus-5"` is the whole point of the
fixture. The guard scanned `uhp-mock.ts` and reported nine violations, correctly by its own rules.

**Disposition: accepted, and it is the sanctioned mechanism rather than a workaround.** The guard
ships an explicit allowlist with per-entry ownership and reason, and already carries the precedent
this case matches exactly: `packages/dsh-app/src/dry-run-test-fixtures.ts`, allowed with the reason
"Test-only fake dispatch fixture, not imported by production entry points". The new entry mirrors it
in form and in reason, names issue #288, and is scoped to `['model', 'effort']` rather than the full
identifier set. No guard logic was changed, no existing entry was touched, and the guard's own
self-mutation test still runs and passes on every invocation.

**Alternative rejected.** Renaming the mock to `uhp-mock.test.ts` would have slipped past the
scanner's suffix check without the guard ever considering the file. That dodges the guard rather than
answering it, and it would leave #286 importing a file named like a test in order to get a fixture.
The allowlist entry is visible, reviewable and attributable; the rename would have been none of those.

---

## D-2 — external sources escalated beyond what the brief asked for

**What.** The brief asked for the published specification at `unifiedharnessprotocol.org`, cited per
field. This run additionally retrieved the OpenAPI document and the conformance suite from the
upstream repository and cites all three layers.

**Why.** The rendered chapter pages are returned through a summarising retrieval model. For a spike
whose stated purpose is to avoid reporting a convenient answer, "a summariser told me the field is
absent" is a weaker citation than "the request-field table is exhaustive and here is its line
number". The escalation also surfaced the layering rule that changed how the whole note is
structured — the OpenAPI document states in its own `info.description` that prose is normative for
behaviour and that conformance is defined by the suite, not by the schema.

**Disposition: accepted.** It strengthens the citation bar rather than relaxing it, and it is what
produced the decisive `model_fallback` answer in `research.md` §5, which neither the prose nor the
schema settles alone.

---

## D-3 — a deliverable's expected shape did not survive contact with the specification

**What.** Deliverable 3 requires a fixture with "all three fields present and agreeing". A reader may
expect that fixture to produce a verified route. It does not, and the test asserts that it must not.

**Why.** `provider`, `effort` and `cwd` are undefined by UHP. A server that volunteers them in
`metadata` is exercising `additionalProperties: true`, not implementing a protocol feature.
Agreement on a field the specification does not define is not evidence: any server can write anything
there, and a conformant server writes nothing at all. Treating that fixture as a PASS would be
exactly the fabricated PASS the brief names as the failure this spike exists to prevent.

**Disposition: accepted, and named in the artefacts rather than left for a reader to trip over.** The
fixture is called `allThreeAgreeingExtended`, its docblock states the reasoning, and the credulous
adapter beside it demonstrates what the alternative reading would have produced from identical bytes.

---

## D-4 — the verdict is `FAIL`, and that is the finding rather than a shortfall

**What.** The S10 gate "certification lanes over UHP" fails.

**Why.** Three of the four route fields cannot be observed over UHP `2026-08-11`, so no UHP route can
be verified, so no certification lane can run over UHP with its declared effort evidenced.

**Disposition: accepted as the correct answer.** Recorded here because a `FAIL` verdict on a spike is
easy to misread as work not finished. The work is finished: the question was answered from the
specification, the repository's behaviour was proven correct for that answer, and the behaviour is
refusal. `verification.md` states what a live router could still change and what it could not.
