# Verification — `route-identity-uhp--s10`

Deliverable 7. **The two columns below are never summed.** One records what a mock on this host
proved. The other records what remains unproven until a real HarnessRouter is reachable. A verdict
that adds them together is the failure this spike exists to prevent.

---

## Verdict

### Gate: "certification lanes over UHP" — **FAIL**

Not a failure of this run's work. A failure of the gate, correctly detected, and the correct answer.

**Why.** Certification means an evaluator ran at a declared effort, on a declared route. All eight
`purpose: "evaluation"` lanes in `packages/routing/config/routing.v1.json` declare an effort on
every step (`research.md` §8). UHP `2026-08-11` defines no wire field for reasoning effort, none for
working directory and none for provider (`research.md` §2–§4, from the published specification). A
UHP route can therefore evidence exactly one of the four fields in `ROUTE_FIELDS`. Three arrive
`null`, `invalid` is non-empty, `RouteStatus` is pinned to `unknown`, and `isRouteEvidenceVerified`
returns `false` — on every UHP route, permanently, as the protocol stands.

`FAIL` here means: **UHP must not be admitted as a transport for any certification lane.** Nothing is
currently mis-certifying — there is no `uhp` transport in the configuration today, only `native` and
`openrouter` — so the ruling is a preventive gate on [#286](https://github.com/rickylabs/harness/issues/286),
not a repair of something already broken.

The repository's behaviour under that answer is **correct and proven**: it refuses, it refuses for the
stated reason, it refuses over both a JSON response and a real SSE stream, and no fixture written for
this run could talk it into agreeing.

### Secondary verdicts

| Question | Verdict |
|---|---|
| Is the `isRouteEvidenceVerified` provenance defect real? | **Confirmed.** `route.ts:180-181` demands equality against a single-dialect `OBSERVED_SOURCES`. Pinned by a test. |
| Is it the reason UHP routes are unverifiable? | **No.** It is the second of two independent blockers, and the protocol-level one is upstream of it. `research.md` §6.3. |
| Does `RouteSource` grow a UHP arm? | **Yes, narrow, and additive.** Proposal only, not applied. `proposal-routesource-uhp.md`. |
| Is `metadata.model_fallback` emitted unconditionally? | **Specification is silent.** Both behaviours pass conformance. Keep presence-as-signal, fail-closed, with a named risk. `research.md` §5. |

---

## Column A — what the mock proved

Evidence about **this repository's coordinator behaviour**. Nothing here is evidence about a server.

Command: `pnpm --filter @rickylabs/subagents run test` → **252 tests, 252 pass, 0 fail.**
Full gauntlet: `pnpm run build` → **green** (all 15 packages, all 11 `check:*` scripts).
Full suite: `pnpm run test` → **green** across all packages.

| # | Proven | Where |
|---|---|---|
| A1 | A conformant UHP response yields `model` only; `provider`, `effort` and `cwd` are `null`, appear in `invalid[]` on the observed side, and are never inferred. | `route.uhp.test.ts`, "observes the model and nothing else"; one `it` per unobservable field |
| A2 | An absent `model` yields `null`, not a guess — a non-conformant server does not get to crash or mislead the client. | "keeps model null rather than inferring one" |
| A3 | **A server volunteering all three missing fields, in exact agreement with the request, is still refused.** Agreement on a field the protocol does not define is not evidence. | "refuses a route even when the server volunteers all three missing fields in agreement" |
| A4 | The same extension fields *contradicting* the request produce no fabricated `mismatch` either. An undefined key can no more contradict than agree. | "does not see a contradiction on an undefined extension field either" |
| A5 | A credulous adapter reading those same bytes produces a fully verified route. Identical bytes, opposite verdicts — the fabricated PASS, kept as a named artefact so the mistake is documented rather than available. | "demonstrates the fabricated PASS a credulous adapter would produce from the same bytes" |
| A6 | A spec-conformant model substitution (Tasks §1.3) is recorded as a difference, never as agreement, and `metadata.requested_model` is never reported as the observation — which would launder the swap into a match. | "records a substituted model as a difference"; "never reports metadata.requested_model as the observation" |
| A7 | **`mismatch` never serialises, renders or compares equal to `unknown`.** Six assertions: pairwise-distinct statuses, JSON round-trip, whole-object inequality, three non-overlapping rendered diagnostics with non-swappable operator instructions, and `describeRouteEvidence` re-rendered directly. | `describe("RouteStatus — \`mismatch\` must never be \`unknown\`")` |
| A8 | Over UHP specifically, `status` collapses to `unknown` even for a substitution, so `mismatches` is what carries the safety signal: benign absence → `mismatches: []`, server contradiction → `mismatches: ["model"]`. | "collapses the substitution's STATUS to unknown, so `mismatches` is what carries the signal" |
| A9 | The current predicate refuses a UHP provenance label on otherwise-identical, otherwise-verified evidence. The defect, pinned as a tripwire for #286. | `describe("RouteSource — the UHP provenance defect, pinned")` |
| A10 | The verdicts are identical over a real socket: `application/json` and `text/event-stream` both fail closed, on an ephemeral loopback port, with no container runtime. | `describe("mock UHP loopback server — the same verdicts over a real socket")` |
| A11 | A truncated stream yields no response rather than a partial one, and a stream with skipping `sequence_number`s is rejected. A killed run is not reported as a finished one. | "treats a truncated stream as no response"; "rejects a stream whose sequence numbers skip" |

### A12 — the tests were proven to fail under the bugs they claim to catch

A passing test proves nothing until it has been shown to fail. Two mutations were injected into the
working tree, run, and reverted. `git diff` confirms both reverts are clean.

**Mutation 1 — collapse `mismatch` into `unknown`.** `route.ts:159-163` changed so that
`mismatches.length > 0` yields `"unknown"` instead of `"mismatch"`. This is the exact defect
deliverable 5 names.

- Result: **16 of 252 tests fail.**
- **All six** tests in `describe("RouteStatus — \`mismatch\` must never be \`unknown\`")` fail,
  including "shows why a not-verified assertion is insufficient coverage".
- Ten pre-existing `route.test.ts` mismatch tests also fail, which is the repository's prior coverage
  doing its job.

**Mutation 2 — make `observeUhpRoute` credulous.** The conformant adapter rewritten to read
`metadata.provider`, `metadata.effort` and `metadata.cwd`, i.e. to become the deliberately-wrong
adapter.

- Result: **3 of 252 tests fail**, exactly the three in
  `describe("route identity over UHP — extension fields cannot manufacture agreement")`.
- No other test in the repository notices. That is the point: without this suite, turning the adapter
  credulous would have been a silent, fully green change that made every UHP route report `known`.

---

## Column B — what only a live HarnessRouter can prove

Unproven here. Not partially proven, not probably fine. **Unproven.** Each line is a question for the
day a HarnessRouter Community Edition instance is reachable, which it is not from this host.

| # | Unproven | Why the mock cannot settle it |
|---|---|---|
| B1 | **Whether a real HarnessRouter returns any of `effort`, `cwd` or `provider` as a vendor extension in `metadata`.** The specification defines none of them; a shipping implementation may volunteer them anyway. | Every fixture in `uhp-mock.ts` was written by this run from the schema. A fixture cannot report what an implementation does. |
| B2 | **Whether `metadata.model_fallback` is emitted unconditionally.** The specification is silent and both behaviours pass conformance check T-03. Presence-as-signal is kept as the fail-closed reading and carries a live "always refuses" risk that this run cannot retire. | Silence in a specification is settled by observation, not by reasoning. One request against a live instance answers it. |
| B3 | Whether a real router honours an undefined `effort` extension field on the request, and whether it names it in `metadata.ignored_fields` as Tasks §1.1 requires. No conformance check covers arbitrary extensions — T-09/T-10 cover only `tools` and `include`. | Requires a server that has an opinion. The mock has only the opinion written into it. |
| B4 | Whether HarnessRouter's `Harness.base` values are stable enough to be worth the owner fork in `proposal-routesource-uhp.md` §4 — a fork this run recommends declining regardless. | Catalogue behaviour, observable only from a catalogue. |
| B5 | Whether the real SSE framing matches Streaming §1 in practice — monotonic `sequence_number`, exactly one terminal event, no end-buffered stream. The spec itself calls proxy buffering "the single most common deployment error for UHP servers". | A mock that emits correct frames proves the decoder reads correct frames. It says nothing about what a proxy in front of a real router does to them. |
| B6 | Whether the fail-closed path holds against a **non-conformant** real server, as opposed to the non-conformant shapes this run imagined (missing `model`, truncated stream, skipped sequence). Real non-conformance is more inventive than fixtures. | By construction: unknown unknowns are not fixturable. |
| B7 | Whether UHP `2026-08-11` is what HarnessRouter Community Edition actually serves, or whether it serves a superset, a subset or a later draft. | Version negotiation is observable only against a deployment. |

### The one thing Column B does **not** put at risk

Every open question above concerns whether UHP might turn out to report **more** than the
specification promises. None of them could make the repository's behaviour *less* safe, because the
proven behaviour is refusal. If B1 resolves favourably, a future spike may promote fields from
`unknown` to observable — and that promotion must come with its own evidence, its own provenance
labels and its own tests. **`FAIL` is the safe direction to be wrong in, and it is the direction this
run is wrong in if it is wrong at all.**

---

## Acceptance checklist, from issue #288

- [x] Research note cites the UHP specification per field, with URLs retrieved during the run — `research.md` §0–§5, three source layers, all retrieved 2026-09-12
- [x] The `RouteSource` question is answered rather than deferred — `proposal-routesource-uhp.md` §1, with the additive question answered in §2
- [x] Mock server or fixtures live in the test suite, not a scratch directory — `packages/subagents/src/uhp-mock.ts`
- [x] Fail-closed behaviour proven by a test that fails if it regresses — mutation-tested, A12
- [x] A test fails specifically if `mismatch` equals `unknown` — A7, proven to fail under mutation 1
- [x] Affected certification lanes enumerated from `routing.v1.json` by name — `research.md` §8.1, eight lanes
- [x] The verdict separates what the mock proved from what only a live router can prove — Columns A and B, never summed
- [x] `pnpm run build` is green
- [x] Run artifacts under `.llm/runs/route-identity-uhp--s10/`
- [x] No credentials, no `.env`, no secrets. The mock never reads an `Authorization` header and no fixture carries one.
- [x] No container runtime started, installed or required
- [x] `provider-uhp` not implemented — that stays #286
- [x] `packages/routing` read, never written; `packages/contracts` untouched and unaffected
