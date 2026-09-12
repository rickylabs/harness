# Context pack — `contract-alignment--e38`

The one file that resumes this run cold. Written for a reader with no history.

---

## What this run was asked to do

Issue [#287](https://github.com/rickylabs/harness/issues/287) — align contracts for UHP-hosted runs —
whose scope was **extended in its comments**, and the comments are the authority. Three work items:

1. The observation surface in the **published** `packages/contracts`: `ObservedRepositoryRun.source` is the
   bare literal `"codex"`, `verification.basis` has one value that implies a local checkout, and
   `execution.status` has no in-flight state. The three are jointly binding: the `coverage: "read"` arm of
   the union requires the local-worktree basis *and* a non-null `run`, so a subset changes nothing.
2. `SteerResult` carries no route evidence while `DispatchResult` does, so a model substitution on a
   continuation turn can only be prose. Over UHP, where continuation is `previous_response_id`, most turns
   are steers.
3. A live provenance defect on `main`: `RouteSource` had no UHP arm, so `provider-uhp`'s route evidence
   claimed its values came from a Codex `thread/start` response.

## What happened

| Item | Outcome | Where to look |
|---|---|---|
| 1 | **Proposed, not applied.** All three changes are breaking for a consumer pinned at the published 0.3.0 — including at the wire level, measured. | `proposal-observation-surface-uhp.md`, owner fork F1; `verification.md` §2.1 and §3 |
| 2 | **Applied.** `SteerResult.route?`, `isSteerRouteVerified`, and `provider-uhp.steer` populates it. Verdict stays `delivered`; the contradiction becomes structure. | `verification.md` §2.2 rows 2a/2b |
| 3 | **Applied**, per S10's merged proposal and its acceptance criteria, with certification still refused three independent ways. | `verification.md` §2.2 rows 3a–3f |

`packages/contracts` is byte-unchanged. No version, no protocol, no tag, no publish — #283 is the owner's.

## The one thing to understand before changing any of this

**A widened string literal is additive for whoever writes it and breaking for whoever reads it.** That is
the whole of why work item 1 is a proposal and work items 2 and 3 are code. And the sharper half, measured
against the tarball a consumer installs rather than argued from the types: inside `schema: 1, protocol: 1`,
the published validator refuses each new value, so a well-formed UHP observation reads as a **corrupt** one
(`reason: "invalid"`), while the same record at `schema: 2` reads as `unsupported-schema` carrying the
number. Re-run `probe-published-0.3.0.mjs` to see it again.

## The shape of the applied change, in one paragraph

`packages/subagents/src/route.ts` gained `RouteDialect` (`codex | uhp`), one new `RouteSource` member
(`uhp/responses.result.model`), and a dialect-keyed `OBSERVED_SOURCES` whose `uhp` row is that one label
and three `null`s — there is deliberately no UHP label for `provider`, `effort` or `cwd`, because the
protocol defines no field for them and a label for an unreportable field is a name with no referent.
`RouteValueEvidence.source` is therefore `RouteSource | null`. `compareRouteIdentity` takes an **optional**
third argument defaulting to `codex`, so no pre-existing call site changed. `isRouteEvidenceVerified` picks
the dialect by reading the labels (a mixed labelling matches no row and is refused) and refuses any field
whose row has no source — so the arm makes UHP provenance honest and leaves every UHP route exactly as
unverifiable as before.

## Where the evidence is

- `supervisor.md` — baseline `c77191e`, declared mutation surface, the surfaces that must not be touched.
- `worklog.md` — what happened, in order, including the three mutation passes.
- `verification.md` — **§2 is the additive-versus-breaking determination per change**, §3 the published-0.3.0
  measurement, §4 the 32-row mutation table and the three findings it produced, §6 acceptance against the
  issue, §7 what is not proved.
- `drift.md` — seven recorded deviations, including one pre-existing vacuous test that this run repaired.
- `mutations.mjs` / `mutations.json` — the campaign, runnable, and its machine-readable record.
- `probe-published-0.3.0.mjs` — the wire-compatibility probe against the registry tarball.

## If you are picking this up to finish it

1. **Work item 1 needs an owner answer to F1** (in-place widening on schema 2, recommended, versus an
   additive schema-2 sibling surface). Until then nothing in `packages/contracts` should move: publication
   is held by #283 and the version decision is not a delegate's.
2. **S10's own owner fork is still open** — may `Harness.base` be read as `provider`? No `provider`
   observation is populated over UHP and `readUhpProvider` still returns `null`, so nothing is blocked on
   it, but it must be ratified before anything populates that field.
3. **Do not claim anything about a live HarnessRouter.** There is none on this host; that is
   [#294](https://github.com/rickylabs/harness/issues/294) and it is blocked. Every UHP byte in this run
   came from `uhp-mock.ts`.
4. `pnpm run test` needs `TMPDIR` on an executable filesystem on this host. Baseline behaviour, not a
   regression — see `drift.md` D7.
