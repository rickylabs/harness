# Worklog — `contract-alignment--e38`

Append-only. Times are UTC on 2026-09-12.

---

## Summary, for a reader who stops here

Three work items. **One applied in full, one applied in full, one raised as a proposal because all of it
is breaking for a published consumer.**

| Item | Where | Outcome |
|---|---|---|
| 1 — the observation surface: `source`, `verification.basis`, `execution.status` | `packages/contracts` | **Proposal only.** All three are breaking, not additive. `proposal-observation-surface-uhp.md`, owner fork F1. Nothing in `packages/contracts` was edited. |
| 2 — `SteerResult` carries no route | `packages/subagents` (private) | **Applied.** Optional `route` field, `isSteerRouteVerified`, and `provider-uhp.steer` populates it. |
| 3 — `RouteSource` has no UHP arm (a live provenance defect on `main`) | `packages/subagents` (private) | **Applied**, per S10's merged proposal, including its stated blast radius. Confirmed first; the defect is real. |

---

## 09:50 — Stage A. Supervisor, baseline, and a version fact that differs from the brief

Branched from `origin/main` at `c77191e`. `supervisor.md` written with the declared mutation surface.

The brief and #287 both describe `packages/contracts` as published at **0.3.0**; the tree says **0.4.0**.
Both are true and the distinction is load-bearing, so it is recorded rather than reconciled away: 0.4.0
is unpublished (npm's highest is 0.3.0, published 2026-09-08T09:27:30.871Z), so a consumer's baseline is
0.3.0 and every additive-versus-breaking question is asked against that. No version field is touched by
this run.

Baseline checks, before any edit: `pnpm run build` green; `pnpm run test` green **only with
`TMPDIR` pointed at an executable filesystem** — `scripts/check-installed-contracts.mjs` needs to exec a
sleeping probe fixture and this host's default `/tmp` is mounted `noexec`. That is an environment
limitation on `main`, not a defect introduced here: it fails identically on the unmodified baseline.

## 10:05 — Work item 3, verified before acted on

The brief said to check it and to correct it if wrong. **It is right.** Read on `c77191e`:

- `OBSERVED_SOURCES` (`route.ts`) was one module-level record, every entry a `thread/start.result.*`
  label from the in-tree Codex protocol.
- `observeUhpRoute` (`uhp-gate.ts`) returns a `RouteIdentityInput` from a **UHP response body**.
- `uhp-provider.ts` passed that input to `compareRouteIdentity`, which stamped the observed side from
  that one map.

So every route evidence `provider-uhp` published claimed its values came from a Codex `thread/start`
response that this repository never sent. The values were right and their stated origin was false.

Two further facts, both read rather than assumed:

- **No existing test could see it.** Switching the UHP suites to the new dialect changed no assertion's
  outcome (451 pass before and after the relabelling). The provenance of UHP route evidence was entirely
  uncovered, which is why the defect survived two spikes and an implementation.
- **The blast radius is confined to private packages.** `packages/contracts` carries no reference to
  `RouteSource`, `RouteIdentityEvidence` or route identity in any form
  (`grep -rln` over `packages/*/src`: only `subagents` and `provider-codex`). `@rickylabs/subagents` is
  `"private": true`. So work item 3 cannot break the published surface or Atelier Cockpit, and its
  determination is about in-repo consumers only.

## 10:30 — Work item 3, applied, per S10 §3 and §6

`packages/subagents/src/route.ts`:

- `ROUTE_DIALECTS` / `RouteDialect` = `codex | uhp`.
- `RouteSource` gains **one** member: `"uhp/responses.result.model"`. No `uhp` label for `provider`,
  `effort` or `cwd` — S10's load-bearing half, because a label for a field the wire cannot report is a
  name with no referent. `"uhp/responses.result.requested_model"`, which S10 listed as optional, is
  **not** added: nothing produces it, and `statedContradictions` already reads `requested_model` as the
  server's own account rather than as an observation.
- `OBSERVED_SOURCES` is dialect-keyed; the `uhp` row is one label and three `null`s.
- `RouteValueEvidence.source` widens to `RouteSource | null` — the absence of a label is how
  "unobservable" is expressed, per S10 §3.
- `compareRouteIdentity` takes an **optional** third argument defaulting to `"codex"`, so
  `provider-codex/src/protocol.ts` and `dsh-app/src/dry-run-internal.ts` are untouched and unchanged.
- `isRouteEvidenceVerified` selects the dialect by reading the observed labels, and refuses a field whose
  dialect row has no source. The forbidden loosening — "any label in the union" — is not taken, and two
  tests exist specifically to fail if it ever is.

**Certification is not unblocked, and the code says so three ways**: the `status !== "known"` check still
refuses every real UHP route (three fields have no value), the null-source rule refuses it again even if
someone fabricates the values, and the gate's verdicts are unchanged under either labelling. A test pins
each.

`uhp-provider.ts`'s dispatch now names its dialect. That is the one-line fix to the live defect.

## 11:10 — Work item 2, applied

`SteerResult` gains `route?: RouteIdentityEvidence` — the same field, type and fail-closed reading as
`DispatchResult.route` — plus `isSteerRouteVerified`. `provider-uhp.steer` observes the continuation's
route, widens the contradicted set with what the server said about itself, and publishes redacted
evidence.

**The verdict stays `delivered` on a contradicted continuation, deliberately.** In this vocabulary
`refused` means the message did not land (`session_busy`, an empty message, a 4xx), and the steer
verdict has no `isSafeToRetry` counterpart. Promoting a landed-but-substituted turn to `refused` would
invite a resend, and a resend puts two turns in one conversation. So the contradiction is promoted to
*structure* instead: `decideUhpRoute(result.route)` refuses it, which is the gate this seam could not
reach before.

**One residual, stated rather than smoothed.** A server that reports `model_fallback: true` while
`model` equals the requested id produces no value difference, so `mismatches` is empty and the fact lives
in `detail`. That is exactly what the dispatch path does too — its *verdict* carries it, its `route` does
not — and fabricating a difference to make the structure look complete would be the fabricated agreement
this contract exists to refuse. A test asserts the empty `mismatches` so a later change cannot quietly
fabricate one.

## 11:40 — Work item 1, raised and not applied

`proposal-observation-surface-uhp.md`. The issue's added scope calls the three widenings "additive
widenings of a published package". They are not additive. They are breaking at the type level, and — the
part the "additive" reading misses — breaking at the **wire** level: measured against the tarball a
consumer installs, every one of the three makes a well-formed UHP observation read as
`{ ok: false, reason: "invalid" }`, i.e. as a corrupt record, while the same record at `schema: 2` reads
as `unsupported-schema` carrying the number. Owner fork F1 offers the in-place widening on a new schema
(recommended) against an additive schema-2 sibling surface, with cost-if-wrong.

Nothing in `packages/contracts` was edited. `git diff --stat` over that directory is empty.

## 12:20 — Mutation campaign, three passes, and what the first two found

`mutations.mjs`, 32 rows: 12 new (`N*`) and 20 carried forward (`C-*`) from `provider-uhp--e37` and from
S11's prose-only record, re-run because this run changed the meaning of the code they describe.

**Pass 1 found three mutations that could not compile and two that killed nothing.** Both are findings:

- `N3` (weaken the dialect match from every field to any field) killed **0**. The suite's mixed-labelling
  test was caught by a *different* guard — the ambiguity check — so the mutant still refused it. The
  uncovered case was a row carrying a **requested-side** label on the observed side, which under the
  weakened match claims the codex dialect and verifies. A test was added; `N3` now kills it.
- `N11` (read an absent route as agreement) killed **0**, and the reason is the one the brief warns
  about: the assertion was made on a `refused` steer, whose verdict half of the predicate refuses it
  anyway. A second path to the same answer is not coverage. The assertion was moved onto a `delivered`
  result with no route, where only the thing under test can decide it.
- `N1`, `N5`, `N6` failed to compile rather than failing tests (`noUnusedLocals` / `noUnusedParameters`
  catching the mutant, not the suite). A mutation a compiler refuses proves nothing about the tests, so
  all three were rewritten into forms a reviewer could plausibly wave through, and they then killed 4, 11
  and 2.

**Pass 2 found a vacuous assertion in a test this run did not write.** `N9` (publish unredacted route
evidence from a steer) killed only the new redaction-marker assertion, and *not* the boundary test that
claims "nothing published carries a path, from any verb". Cause: that test's mock returned one response
id for every turn, so its steer was refused by the turn ledger as a repeated response **before** it ever
observed a route — the steer row of a four-verb fence was running over a result with no route in it. The
fixture now gives each turn its own id, and the test asserts the precondition it had been assuming.

**Pass 3: all 32 mutations kill at least one test; baseline 0 fail, and 0 fail after restore.** The full
table is in `verification.md` §4 and the machine-readable record in `mutations.json`.

## 12:55 — Close-out

- `pnpm run build`: green.
- `pnpm run test`: green (with the `TMPDIR` note above), 451 tests in `@rickylabs/subagents`.
- `git diff --stat packages/contracts`: empty.
- `packages/subagents/config/harnesses.v1.json`: untouched, still `reconciledAt: null` with its
  placeholder ids.
- No version number, no `dsh.protocol`, no tag, no publish.
