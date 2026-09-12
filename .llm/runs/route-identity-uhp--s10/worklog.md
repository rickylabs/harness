# Worklog — `route-identity-uhp--s10`

Append-only. Times are UTC, 2026-09-12.

---

**00:44 — Stage A opened.** Read issue #288 in full, then `AGENTS.md` and `doctrine/WORKFLOW.md`
before any mutation, per the brief's explicit ordering. Baseline
`538d63cf5cb7c5569520dda2aa6d1075aef4fc93`.

**00:45 — Package correction applied at the start, not discovered late.** The steering that reached
this run named `@rickylabs/routing` as the home of the UHP route-identity contract. It is not. The
contract is `packages/subagents/src/route.ts` (`@rickylabs/subagents`). `packages/routing` consumes
the fleet matrix as data under E11 and is a different seam. All work done in `packages/subagents`;
`packages/routing` read once, for `config/routing.v1.json`, and never written. Recorded here because
the correction says it has been wrong three times on this program, and a worklog entry is how it
stops being a verbal correction.

**00:46 — Host constraint confirmed, not tested.** No container runtime on this host. Per the owner
ruling and the brief, no attempt was made to start, install or require one. Mock-first from here.

**00:47 — External leg opened.** `unifiedharnessprotocol.org` confirms `2026-08-11` as the current
published version, with an eleven-chapter index.

**00:50 — Escalated from rendered chapters to primary sources.** The rendered chapter pages are
summarised by a retrieval model, which is a weak citation for a spike whose entire purpose is to
avoid believing a convenient answer. Retrieved instead:

- the OpenAPI document, `uhp-2026-08-11.openapi.yaml`, 40,505 bytes — normative for structure;
- all eleven prose chapters from `protocol/versions/2026-08-11/` — normative for behaviour;
- the conformance suite `checks.py`, 1,306 lines — which the OpenAPI document says, in its own
  `info.description`, is what actually defines compliance.

Line numbers in `research.md` refer to these retrieved files. This upgrade is the difference between
"a summariser told me `effort` is absent" and "the request-field table is exhaustive and here is its
line number".

**00:55 — Field-by-field answers land, and they are lopsided.** `model` observable and required.
`provider`, `effort`, `cwd` all absent from both `CreateResponseRequest` and `Response`. `cwd` is the
sharpest: the working directory is a first-class concept the spec discusses in four chapters and
never once names on the wire.

**00:58 — The finding that reframes the spike.** If three of four fields are `null` on the observed
side, `compareRouteIdentity` pins `status` to `unknown` on every UHP route, so
`isRouteEvidenceVerified` is `false` before the provenance check is ever reached. The `RouteSource`
defect the brief suspected is real — and it is the *second* blocker, not the first. Fixing it changes
no outcome. This ordering is the thing a reader must not get backwards, so it became `research.md`
§6.3 and the spine of the `RouteSource` proposal.

**01:02 — Second finding, from the code rather than the spec.** Because `unknown` takes precedence
over `mismatch` (`route.ts:159-163`), a UHP model substitution — the one contradiction the protocol
reports loudly and on purpose — is collapsed into `unknown` by the three absent fields. The signal
survives in `evidence.mismatches`, not in `status`. This makes deliverable 5 sharper than the brief
framed it: over UHP the `mismatch` *status* is unreachable, so any consumer discriminating on
`status` alone reads a model substitution as a benign silence.

Cross-checked against the consuming seam: `dsh-app/src/dry-run-internal.ts:97-98` computes its
refusal `fields` as `new Set([...mismatches, ...invalid.map(i => i.field)])`, which unions a
contradicted field with an absent one. `status` is the only thing on that refusal that separates
them.

**01:08 — Certification consequence read from data.** All 23 lanes and all 40 chain steps in
`routing.v1.json` declare an effort — there is no lane without one. Eight carry
`purpose: "evaluation"` and are the certification lanes. No `uhp` transport exists in the
configuration, so the ruling is preventive rather than a repair. `packages/routing` was read and not
written.

**01:12 — Coordinator added `metadata.model_fallback` to the research scope mid-run.** Answered under
the same rule as the other four. The specification is silent on the non-substitution case: no
description, no default, not required, one prose mention inside the substitution example, and
conformance check T-03 asserts it only inside the substitution branch. The suite authors demonstrably
write the negative half when they mean one — T-10 exists purely as "the other half of T-09" — and
wrote no equivalent here. Answer: silent, keep presence-as-signal as the fail-closed reading, with
the "always refuses" risk named rather than buried. Recorded as `research.md` §5. The F10 gate itself
stays in #286 and was not touched.

**01:20 — Mock written from the schema, with the trap built in deliberately.** `uhp-mock.ts` carries
two adapters. `observeUhpRoute` reads only spec-defined fields. `observeUhpRouteCredulous` reads
undefined extension keys and is documented as wrong. The second exists because the brief names the
fabricated PASS as the natural mistake under a mock-first instruction, and a failure mode with a name
and a test is harder to make twice than one described in prose.

Consequence worth stating plainly: the fixture required by deliverable 3 as "all three fields present
and agreeing" **does not produce a verified route**, and must not. Agreement on a field the protocol
does not define is not evidence.

**01:35 — Tests green.** 252 pass, 0 fail in `packages/subagents`, including the 24 pre-existing
route tests.

**01:40 — Mutation testing, because a green suite proves nothing until it has been shown to fail.**
Two bugs injected into the working tree, run, reverted, reverts verified clean by `git diff`:

1. `mismatch` collapsed into `unknown` at `route.ts:159-163` — **16 failures**, including all six
   tests of the deliverable-5 suite.
2. `observeUhpRoute` made credulous — **3 failures**, exactly the extension-field suite, and nothing
   else in the repository noticed.

The second result is the more interesting one: without this suite, making the adapter credulous would
have been a silent, fully green change that reported every UHP route as `known`.

**01:48 — `check:compiled-policy` refused the fixture file.** Expected in hindsight: the guard
forbids literal `model`/`effort` assignments in any non-`.test.ts` source, and a wire fixture set is
nothing but those. Resolved with one allowlist entry mirroring the existing
`dry-run-test-fixtures.ts` precedent in form and reason. No guard logic changed. Recorded as drift
D-1 rather than folded into the original mutation surface.

Rejected alternative: renaming the mock to `*.test.ts` to slip past the scanner's suffix check. That
would have dodged a guard instead of answering it, and would have made the file un-importable by
#286 without looking like a test.

**01:52 — `pnpm run build` green.** All 15 packages, all 11 `check:*` scripts. `pnpm run test` green
across the workspace.

**01:55 — Verdict written as FAIL, deliberately.** The gate "certification lanes over UHP" cannot
pass while three of four route fields are unobservable. `FAIL` is the correct answer, and the
repository's behaviour under it is proven correct. `verification.md` keeps Column A (what the mock
proved) and Column B (what only a live router can prove) as two lists that are never summed.
