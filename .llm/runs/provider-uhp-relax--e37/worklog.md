# Worklog — `provider-uhp-relax--e37`

Append-only. Timestamps are UTC on 2026-09-12.

## 1. What was decided before this run started, and by whom

Nothing in this run is a design decision. Both changes are owner decisions recorded on
[#286](https://github.com/rickylabs/harness/issues/286) on 2026-09-12, and the two most recent
comments on that issue are the authority:

- **Owner risk ruling — "unattested effort is not blocking."** Quoted in full in the module comment of
  `packages/subagents/src/uhp-gate.ts`. A route whose `model` was reported and agreed may be `accepted`
  even though `provider`, `effort` and `cwd` are unreported; a reported model that contradicts the
  request still yields `refused`, still derived from the mismatch set; "no evidence at all" must remain
  expressible and remain a failure; and the deferral must be recorded where an implementer will see it.
- **Owner decision — "narrow the drift check to the selected harness."** A dispatch refuses only when
  drift affects the harness it selected; unrelated drift stays visible as a distinct non-blocking signal;
  `listing-unreadable` still blocks everything; the manifest-wide check stays available for
  reconciliation and audit.

The predecessor run is `.llm/runs/provider-uhp--e37/` (PR #297, merged). This run changes two behaviours
in what that shipped and leaves the rest alone.

## 2. Change 1 — the gate, `packages/subagents/src/uhp-gate.ts`

**Before.** `uhpRouteVerdict` refused on contradiction, then returned `unknown` if `unverified` **or**
any field was unreported, then accepted. Over UHP three fields are always unreported and `unverified` is
always true, so the third branch was unreachable and the provider refused every conformant response.

**After.** Three branches, in this order:

    if (negatives.contradicted.length > 0) return "refused";
    if (uhpRouteAttestation(negatives) === "none") return "unknown";
    return "accepted";

The first branch and its position are untouched. That was a separately ratified ruling and it is where
the codex-ladder trap lives; `R3` and `R4` in the mutation campaign exist to keep it that way.

**The distinction the third bullet of the ruling required.** "No usable evidence at all" had to be told
apart from "evidence that cannot attest three fields", because the second is now accepted and the first
must not be. Two additions carry it, and neither widens `DispatchVerdict`:

1. `UhpRouteNegatives.unattested` — the fields this repository cannot say agreed, for **any** reason:
   contradicted, unreported by the wire, or never stated in the request. It is a set of fields like the
   other two, so the structural guarantee holds: there is still no `status` field on the parameter type,
   and a ladder cannot be reintroduced without widening the interface in a diff that says so.
2. `UhpRouteAttestation` — `none | partial | complete`, internal to the gate. It is **not** exported from
   `index.ts` and it is not a verdict. Whether the public vocabulary should gain an *identified but
   unattested* state is an open owner question on #286; the grade lets the gate state the distinction in
   its own reasoning and in its `detail` without answering that question by implementation.

**Why the requested side had to be covered.** A request that named no model produces no mismatch (nothing
to differ from) and no unreported observation (the wire did report one), so a gate reading only
`contradicted` and `unreported` would read "model agreed" off a comparison that never happened. `agrees()`
reads both sides. `R5` damages exactly that and kills the test written for it.

**What was not changed.** `isRouteEvidenceVerified`, `compareRouteIdentity`, the mismatch set, the four
readers (three of which still return `null` by design), `RouteStatus`, `DispatchVerdict`, and the
redaction boundary. An `accepted` UHP dispatch still has `isRouteVerified === false`, so F2 still bars
certifying evaluator use: "may this turn proceed" and "may it certify" are now two answers instead of one
verdict standing for both.

**Recorded for whoever revisits this.** The acceptance rests on how the execution layer is written, not on
evidence from a run. The `detail` of every accepted-but-unattested route says so in those words — "accepted
by the owner risk ruling of 2026-09-12 … not because the risk was shown to be absent" — and `R8` proves
that sentence is covered. The two substitution cases the ruling names (Codex rerouting Astra to Sol, Fable
5.1 rerouting to Opus under security policy) are deferred, not dismissed; both occur on transports where
these fields *are* observable, which is why the comparison machinery stays.

## 3. Change 2 — the drift narrowing, `uhp-harnesses.ts` and `uhp-provider.ts`

- `detectHarnessDrift` is unchanged and still manifest-wide. That is the reconciliation and audit view:
  #294 has to see every stale row to repair the file.
- `selectHarnessDrift(drift, harness)` returns `{ blocking, unrelated }`. Blocking is
  `harness === selected || harness === null`. The null arm is `listing-unreadable`, and it is the
  exception the decision names: a listing this adapter could not read cleared no pinned id, including the
  selected one. Two lists rather than a filtered one, so the discarded half cannot be dropped by
  convenience at a call site.
- `describeUnrelatedHarnessDrift` returns the non-blocking signal, or `null` when there is nothing —
  because a warning that fires on every dispatch is one nobody reads by Friday. Its prose differs from the
  refusal prose deliberately: a reader who sees refusal wording on a dispatch that proceeded learns to
  distrust both.
- `dispatch` refuses on `selected.blocking`, before the task POST, and emits the unrelated signal twice on
  purpose: as a diagnostic row labelled `UHP_UNRELATED_DRIFT` (a distinct event an operator surface can
  select on) and appended to whatever the dispatch reports, via `publish`, so it survives for a caller that
  configured no diagnostic sink. It is joined **before** redaction, so a console `base` that happens to look
  like a path meets the same fence as everything else.
- The signal is carried in a `Map` keyed on `runId` rather than threaded through the dozen return
  statements after the check. The obligation is that the narrowing did not make drift silent, and an
  obligation discharged at eleven of twelve exits is discharged at none. `R14` and `R15` prove each of the
  two surfaces independently.

## 4. One thing deliberately removed rather than added

The first draft widened the provider's `unattested` with `stated.fields` alongside `contradicted`. It is
provably dead: every stated field is already in `contradicted`, and a contradiction decides first. It has
been removed, with a comment saying why, because unreachable code that reads like a safeguard is
maintained as one. The single widening is the contradiction — which is also what the ratified ruling asks
for.

## 5. Proposal, not an edit — `packages/contracts`

Unchanged from the predecessor run and still not made here, because that package is published:
`SteerResult` has no `route` field, so a substitution observed on a continuation is prose where the same
fact on a dispatch is structured data. Recorded again so it is not lost: it is a non-breaking addition and
it belongs to whoever opens the next contracts version.

## 6. What this run did not touch

- `packages/subagents/config/harnesses.v1.json` — still `reconciledAt: null`, still placeholder ids. Every
  dispatch through it still refuses, correctly. `reconciledAt` is the only field in that file that claims
  anything about a server and inventing one would fabricate the claim. #294 owns reconciliation.
- `packages/contracts`, `packages/routing`.
- No container runtime was started, required or installed; none exists on this host. Every test runs
  against `uhp-mock.ts` over a loopback socket, and nothing here is evidence about a live HarnessRouter.
