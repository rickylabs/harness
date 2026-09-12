# Verification — `provider-uhp-relax--e37`

What was run, what it proves, and what it cannot. Read §1 first: the two findings are the reusable part.

## 0. Gates

| Gate | Result |
|---|---|
| `pnpm run build` | green — 12 packages, `check:graph`, `check:lifecycle`, `check:links`, `check:forms`, `check:snapshots`, `check:compiled-policy`, `check:publish`, `check:label-registry`, `check:docs`, `check:skill`, `check:tutorial` all pass |
| `pnpm run test` | green — **3,135 tests, 507 suites, 0 fail** across 12 packages, plus `check:installed` PASS |
| `@rickylabs/subagents` alone | 452 tests, 0 fail (436 on the baseline commit, so **+16**) |
| Mutation campaign | 20 mutations, **every one killed at least one test**, and each killed the test written for it |

**One environment note about `pnpm run test`, which matters if you reproduce it.** The final step
`check:installed` writes an executable probe into `TMPDIR` and runs it. On this host `/tmp` is mounted
without exec permission, so the step fails with `check:installed failed at sleeping probe startup
(requires executable TMPDIR)` — the script's own message, and a limitation it documents itself. Run with a
`TMPDIR` on an exec-capable filesystem **outside the repository** and it PASSes:

    TMPDIR=/home/agent/tmpexec pnpm run test

Outside the repository matters: a `TMPDIR` inside the worktree makes 9 `@rickylabs/forge` tests fail,
because they create temporary checkouts and the guard correctly detects the enclosing GitHub origin. Both
behaviours are pre-existing and unrelated to this change; neither is a test of anything in
`@rickylabs/subagents`.

## 1. Findings — the two places a control did not fire, and why

### 1.1 A test that had been passing for the wrong reason since #297

`uhp-provider.test.ts`, "reports a refused stream as unknown, because an unreadable stream is not a failed
run". It started a mock scripted to truncate its stream before the terminal event, dispatched, and
asserted:

    assert.ok(result.verdict === "unknown" || result.verdict === "refused");

It never read a stream. `uhp-mock.ts` streamed only when the *request* carried `stream: true`, and this
provider always sends `stream: false`, so the JSON path ran and the conformant answer produced `unknown` —
which the disjunction accepted. The truncation was never exercised.

It surfaced only because the relaxation in this run turned that conformant answer into `accepted`, and the
disjunction went red. The disjunction is the tell: **it holds for two of the three verdicts, so it could
not distinguish the behaviour it was named after from an unrelated one.** The fix was to the setup first,
per the rule that a control which does not fire usually has a fixture problem rather than an assertion
problem: `UhpReply.stream` now forces the mock to answer with an event stream regardless of what the
request asked — a shape Tasks §1.1 permits a server to produce if it names the field in `ignored_fields` —
and the assertion is now `assert.equal(result.verdict, "unknown")` with a paired positive control on a
*complete* forced stream, which is accepted. Without the positive control the test would also pass for a
provider that could not read a stream at all.

### 1.2 A mutation that killed nothing on its first run — `R12`

`R12` replaces the row summary in `describeUnrelatedHarnessDrift` with a constant (`const rows = "some"`),
so the signal stops naming which rows disagree. First run: **0 tests killed.**

The assertions looked right — they checked that the signal contained `codex` and `base-changed`. The cause
was in the input, not the assertion: the same message also appends each row's full `kind: detail` sentence,
and *those* contain both substrings. Two paths to the same outcome, so damaging one left the assertion
satisfied. This is the same shape as §1.1 one level down.

Fixed by asserting the summary in the form it is written — `codex (base-changed)` — and by adding a second
test with **two** unrelated rows that asserts both are named and the count is stated, because a signal that
names the first drifted row and a number would read as complete while leaving the second invisible. `R12`
now kills 2.

Both findings are the same rule from #286, twice: *if an assertion holds equally for the correct and the
defective behaviour, it is not covering that behaviour, however close the words are.*

## 2. The mutation campaign

Runnable: `node .llm/runs/provider-uhp-relax--e37/mutations.mjs`, results in `mutations.json`. It refuses
to start unless the suite is already green, restores every file byte for byte, and re-runs the suite after
restoring (`baseline fail 0; after restore fail 0`). `killed` is `node:test`'s own `fail` total, which
counts a failing suite alongside the test inside it; the named leaf tests are recorded per mutation in
`mutations.json` and quoted below.

The five mutations #286 required at minimum are `R1`, `R2`, `R9`, `R10` and `R11`/`R13`.

| # | File | What it breaks | Killed |
|---|---|---|---|
| R1 | `uhp-gate.ts` | the gate accepts when the model itself is unreported — the ruling applied one bullet too far | **10** |
| R2 | `uhp-gate.ts` | the gate returns unknown when the model agreed — the pre-ruling gate, which refuses every UHP route | **19** |
| R3 | `uhp-gate.ts` | the ratified order: absence checked before contradiction (the codex ladder reintroduced) | **11** |
| R4 | `uhp-gate.ts` | a contradiction stops refusing at all | **14** |
| R5 | `uhp-gate.ts` | attestation ignores the requested side, so a model nobody asked for counts as agreed | **1** |
| R6 | `uhp-gate.ts` | the grade stops distinguishing a partly attested route from a complete one | **4** |
| R7 | `uhp-gate.ts` | a contradiction is graded as partly attested, so a substitution reads as attested evidence | **1** |
| R8 | `uhp-gate.ts` | the acceptance stops reporting the owner risk decision it rests on | **2** |
| R9 | `uhp-harnesses.ts` | **the narrowing swallows drift on the harness being dispatched to** | **9** |
| R10 | `uhp-harnesses.ts` | **the narrowing swallows `listing-unreadable`**, so an unreachable console dispatches as an agreeing one | **3** |
| R11 | `uhp-harnesses.ts` | **unrelated drift is reported as nothing at all** — the narrowing turned into silence | **4** |
| R12 | `uhp-harnesses.ts` | the signal stops naming which rows disagree | **2** (0 before §1.2) |
| R13 | `uhp-provider.ts` | the unrelated-drift signal is dropped entirely: neither sink nor result carries it | **2** |
| R14 | `uhp-provider.ts` | the signal reaches the sink but not the result, so a caller with no sink sees nothing | **2** |
| R15 | `uhp-provider.ts` | the signal reaches the result but never the sink, so no operator surface can select on it | **1** |
| R16 | `uhp-provider.ts` | drift on the selected harness is detected and then dispatched to anyway | **8** |
| R17 | `uhp-provider.ts` | the whole-manifest refusal is restored, so one edited console row halts every lane again | **4** |
| R18 | `uhp-provider.ts` | the F10 gate reads only the route comparison, so a declared fallback with an agreeing model is accepted | **3** |
| R19 | `uhp-provider.ts` | the dispatch reports its own prose instead of the gate's, losing the grounds for the acceptance | **2** |
| R20 | `uhp-gate.ts` | route evidence reports itself verified — the branch F2's certification bar hangs on | **3** |

Three mutations kill exactly one test each. That is deliberate rather than thin: `R5`, `R7` and `R15` each
damage one narrow behaviour, and the test that dies is the one written for it —
`R5` → "does not read an agreement off a model that was never requested", `R7` → "derives the verdict from
negatives that do not include a status", `R15` → "reports the drifted row an operator did not dispatch to,
on the result and to the sink".

**The two required kills, quoted from `mutations.json`.**

- `R1` kills, among others, "still says unknown when the model itself is unreported, where the over-relaxed
  gate accepts", "is unknown, not accepted, when the response does not say what model ran", "does not read
  an agreement off a model that was never requested" and "never lets a fabricated status decide the
  acceptance either".
- `R9` kills "blocks on drift for the selected harness and not on drift for another row", "refuses the
  dispatch whose own harness drifted, with the rest of the console agreeing", "dispatches to a confirmed
  harness while another row is drifted, and refuses that other row", and four pre-existing F1 tests
  including "refuses every dispatch through the unreconciled checked-in manifest".

## 3. How the load-bearing assertions are built

Every test pinning a distinction does three things, per #286: it asserts the distinction itself rather than
a superset of it; it runs the defective implementation, transcribed in the test file, on the same input; and
it pairs a negative with a positive on the same input so a control cannot be firing because everything
fails.

The transcribed defects are `verdictByCodexLadder`, `substitutionDetectedByStatus`,
`verdictFromRouteEvidenceAlone`, and two added by this run:

- `verdictBeforeTheRuling` — the gate as it shipped on 2026-09-11. On the same conformant evidence: ours
  `accepted`, theirs `unknown`.
- `verdictIgnoringModel` — the ruling applied one bullet too far. On the same model-absent evidence: ours
  `unknown`, theirs `accepted`.

Weak assertions are written out where they are tempting, and labelled. `!isRouteEvidenceVerified(...)` now
holds for all three verdicts over UHP, so it covers nothing; `!accepted` holds for a refusal and an
unknown alike. Both appear in the suite with a comment saying they pass while the distinction is broken,
next to the assertion that actually discriminates.

**Zero task POSTs** is asserted, by counting the bodies the mock received, on every refusal that must
happen before anything leaves the process: the four pre-existing drift cases, the new selected-harness
drift case, and both unreadable-listing cases. A check that ran after the POST satisfies every verdict
assertion and still launched an agent under a configuration nobody declared, which is why the count is the
assertion rather than the verdict.

## 4. What is proved

1. A conformant UHP response — model reported and agreeing, three fields silent — is `accepted`, and the
   gate as it shipped before the ruling answers `unknown` on the same evidence.
2. That acceptance is not a certification: `isRouteVerified` is `false`, `isRouteEvidenceVerified` on the
   published evidence is `false`, and the `detail` names the risk decision it rests on.
3. A response that does not say what model ran is `unknown`, and so is a response compared against a
   request that named no model. The over-relaxed gate accepts both.
4. A model contradiction is `refused`, from the mismatch set widened by `metadata.model_fallback`, a
   disagreeing `metadata.requested_model` and `model` in `metadata.ignored_fields`; reversing the gate's
   order or disabling either half goes red.
5. A dispatch to a harness the console confirms proceeds while another pinned row is drifted; a dispatch to
   the drifted row is refused with **zero** task POSTs. Same listing, same manifest, opposite verdicts.
6. An unreadable listing refuses every lane, with zero task POSTs.
7. Unrelated drift is reported on the dispatch result *and* to the diagnostic sink under its own label,
   names every drifted row, and still appears when the dispatch it rode along with failed for another
   reason. An agreeing console produces no such signal.
8. `detectHarnessDrift` still answers manifest-wide, for reconciliation and audit.
9. The checked-in manifest still refuses every dispatch, because it is still unreconciled.

## 5. What is not proved, and cannot be here

1. **Anything about a live HarnessRouter.** There is no reachable instance and no container runtime on this
   host; none was started, installed or required. The peer is `uhp-mock.ts` over a loopback socket, written
   from the published specification. The live round-trip is #294.
2. **That `provider`, `effort` and `cwd` are permanently unreportable.** That is S10's reading of the
   specification (#288, PR #292), owner-certified and **not** independently re-derived; PR #292 sits at
   `status:impl-eval` for that reason. The readers are kept and still return `null`.
3. **That the risk the ruling accepts is absent.** It was not measured. The ruling rests on how UHP and
   DeepSeek are written. The two named substitution cases — Codex rerouting Astra to Sol, Fable 5.1
   rerouting to Opus under security policy — are deferred, and if either ever appears on a UHP-hosted
   harness this decision is the thing to revisit.
4. **That any real console's ids match the manifest.** No console has been read into it.
5. **The open forks.** Whether the verdict vocabulary should gain an *identified but unattested* state is
   still open; the gate grades it internally and `DispatchVerdict` is unchanged. What a non-certifying lane
   may do with an accepted-but-unattested route is a question for the lanes, not for this provider.
