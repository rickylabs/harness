# Context pack — `route-identity-uhp--s10`

The single file that resumes this run cold. Written for a reader with no history.

---

## What was asked

Spike S10, issue [#288](https://github.com/rickylabs/harness/issues/288), child of #286, part of #33.

> Determine whether reasoning effort, working directory and provider can be requested and observed
> fail-closed over the Unified Harness Protocol (UHP `2026-08-11`) wire contract, and make this
> repository's behaviour correct for every possible answer.

Two hard constraints shaped everything. There is **no container runtime on this host** and no
reachable HarnessRouter, so the work is mock-first by owner ruling. And a mock proves only what this
repository does with a wire shape — never what a server returns — so the observability question had
to be answered from the published specification, per field, with retrieved URLs.

## What was found

**One of four route fields is observable over UHP.**

| Field | Requestable | Echoed | Answer |
|---|---|---|---|
| `model` | yes | yes, and **required** | observable |
| `provider` | no | no | unobservable |
| `effort` | no | no | unobservable |
| `cwd` | no | no | unobservable **and** unrequestable |

Two consequences follow, and the second is the one people get backwards:

1. **Every UHP route is `unknown`, permanently.** Three `null` observations make `invalid[]`
   non-empty, which pins `RouteStatus` to `unknown` and `isRouteEvidenceVerified` to `false`.
2. **The `RouteSource` provenance defect is real but is not the binding constraint.** It is the
   *second* of two independent blockers. Fixing it changes no outcome, because there is nothing on
   the wire for three of the four labels to point at.

And a third finding that did not come from the brief: because `unknown` takes precedence over
`mismatch` (`route.ts:159-163`), a UHP **model substitution** — the one contradiction the protocol
reports on purpose — is collapsed into `unknown` by the three absent fields. The signal survives in
`evidence.mismatches`, not in `evidence.status`. Any consumer discriminating on `status` alone reads
a model substitution as a benign silence.

## Verdict

**Gate "certification lanes over UHP": FAIL.** Correct answer, not a shortfall. All eight
`purpose: "evaluation"` lanes in `routing.v1.json` declare an effort; effort cannot be evidenced over
UHP; therefore UHP must not be admitted as a transport for any of them. Nothing is currently
mis-certifying — there is no `uhp` transport in the configuration — so this is a preventive gate on
#286.

## Decisions taken

1. **`RouteSource` grows a UHP arm — narrow, additive, and proposed rather than applied.** Add
   `"uhp/responses.result.model"`. Deliberately do **not** mint `uhp` labels for `effort`, `cwd` or
   `provider`: a provenance label for a field the protocol cannot report is a name with no referent,
   and an invitation to fabricate. Additive because `packages/contracts` has no reference to route
   identity at all, `@rickylabs/subagents` is `private: true`, and `RouteSource` has no exhaustive
   consumer. The real work is part B — making `OBSERVED_SOURCES` dialect-aware — which is #286's.
2. **`metadata.model_fallback`: the specification is silent** on whether it is emitted
   unconditionally. Keep presence-as-signal as the fail-closed reading, with the "always refuses"
   risk named. The spec-endorsed comparison is `model` against `metadata.requested_model`.
3. **Owner fork, unratified:** may `Harness.base` be read as `provider`? Recommendation is **no** —
   `base` is the harness identity, not the model provider, and UHP requires clients to treat it as an
   opaque string.

## Where things are

| File | What it holds |
|---|---|
| `supervisor.md` | Stage A: identity, baseline, mutation surface, the epistemic boundary |
| `research.md` | Stage B: the field-by-field answer with citations; the `model_fallback` answer; the certification-lane enumeration |
| `proposal-routesource-uhp.md` | The `RouteSource` decision as a contract-change proposal, with acceptance criteria for #286 |
| `verification.md` | The verdict, plus Column A (what the mock proved) and Column B (what only a live router can prove), never summed |
| `worklog.md` | Timestamped progress |
| `drift.md` | Four deviations with dispositions |
| `packages/subagents/src/uhp-mock.ts` | Mock UHP loopback server, SSE codec, fixture set, and two adapters — one conformant, one deliberately wrong |
| `packages/subagents/src/route.uhp.test.ts` | The fail-closed suite |

## To resume

- Read `research.md` §6.3 first. It is the ordering everything else depends on.
- The mock is reusable: `startUhpMock(fixture)` binds an ephemeral loopback port and serves JSON or
  `text/event-stream` from `POST /v1/responses`. #286 should build against it.
- `route.uhp.test.ts` contains a **tripwire** — "rejects UHP provenance labels under the current
  predicate". When #286 applies the proposal, that assertion flips. Update it deliberately; do not
  delete it. Its replacement must still refuse a codex-dialect label presented on a UHP route.
- `scripts/check-compiled-policy.mjs` carries one allowlist entry for the fixture file. If the mock
  moves or is renamed, that entry moves with it.

## What is still open

- Everything in `verification.md` Column B — all of it needs a reachable HarnessRouter.
- B2 is the one with a live consumer waiting: Atelier Cockpit's F10 gate treats presence of
  `metadata.model_fallback` as the mismatch signal, and if a real router emits the key
  unconditionally that gate refuses every run. One request against a live instance settles it.
