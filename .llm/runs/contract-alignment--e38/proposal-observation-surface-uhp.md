# Contract-change proposal — the observation surface for UHP-hosted runs

**Work item 1 of [#287](https://github.com/rickylabs/harness/issues/287)**, added to that issue's scope by
the owner comment of 2026-09-12 ("Scope gap found from the consuming side").
Status: **proposal, not applied. Nothing in `packages/contracts` was edited by this run.**

---

## 1. The answer first

The issue's added scope asks for three widenings of
`packages/contracts/src/repository-run-observation.ts` and describes them as *"additive widenings of a
published package"*.

**They are not additive. All three are breaking for a consumer, at the type level and — more sharply —
at the wire level.** That contradiction is this run's first finding, and it is the reason nothing was
applied. The issue's instinct to raise them as a proposal rather than an edit was right; only the label
was wrong, and the label is what decides whether the change needs an owner's version call.

| Change | For a producer | For a consumer pinned at 0.3.0 | Applied? |
|---|---|---|---|
| `ObservedRepositoryRun.source`: `"codex"` → `"codex" \| "uhp"` | additive | **BREAKING** (type) and **BREAKING** (wire: reads as `invalid`) | no |
| `verification.basis`: add a container-hosted basis | additive | **BREAKING** (type) and **BREAKING** (wire) | no |
| `execution.status`: add an in-flight status | additive | **BREAKING** (type) and **BREAKING** (wire) | no |

A version or protocol decision is the owner's, on
[#283](https://github.com/rickylabs/harness/issues/283). §7 files it as a numbered fork with two
options, a recommendation and the cost of the recommendation being wrong.

---

## 2. What the surface is today, read from the code and from the registry

`packages/contracts/src/repository-run-observation.ts` on baseline `c77191e`:

- `ObservedRepositoryRun.source` is the bare literal `"codex"` — not a `RunSource`, not a string.
- `verification.basis` has exactly one value, `"enrollment-and-local-worktree"`.
- `execution` is a two-arm union: `{ status: "unknown"; observedAt: null }` or
  `{ status: "source-reported-complete" | "source-reported-error"; observedAt: string }`.
- `readRepositoryRunObservation` **enforces all three at runtime**: `if (r.source !== "codex") return bad();`,
  `if (v.basis !== "enrollment-and-local-worktree") return bad();`, and `choice(e.status, [...])`.

And the version facts, because the brief and the issue both say 0.3.0 while the tree says 0.4.0:

| Fact | Value | Read from |
|---|---|---|
| Version in the tree | 0.4.0, unpublished | `packages/contracts/package.json` |
| Highest version on npm | **0.3.0**, published 2026-09-08T09:27:30.871Z | `npm view @rickylabs/harness-contracts time`, 2026-09-12 |
| Is the observation surface in the published 0.3.0? | **Yes** | `npm pack @rickylabs/harness-contracts@0.3.0` → `package/src/repository-run-observation.ts` is **byte-identical** to the tree (`diff`, empty) |

That last row is what makes this a real compatibility question rather than a paper one. #280 added the
file at 09:22:59 UTC and 0.3.0 was published four and a half minutes later, so a consumer pinned at
0.3.0 has these exact literals and this exact validator.

---

## 3. The three changes, exactly, and why each is breaking

### 3.1 `ObservedRepositoryRun.source`

    -  readonly source: "codex";
    +  readonly source: "codex" | "uhp";

Aligned with `RunRef.provider = "uhp"` (`packages/subagents/src/provider.ts`) and with
`LaunchIdentity.harness`, which is `string | null` and already open
(`packages/contracts/src/runs.ts`). **`RunSource` is not touched**: it stays
`claude | codex | opencode` and stays the billing seam, exactly as the issue says.

**Breaking for a consumer, three ways.** A widened literal in a *read* position is not the same change
as a widened literal in a *write* position:

1. `switch (run.source) { case "codex": …; default: assertNever(run.source) }` stops compiling. This is
   not a hypothetical style — this repository's own `retryGuidance` is written that way
   (`packages/subagents/src/provider.ts`), and `noImplicitReturns` plus `strict` make it the idiomatic
   exhaustive form here.
2. `const s: "codex" = observation.run.source` stops compiling; so does
   `Record<ObservedRepositoryRun["source"], Renderer>`, which becomes non-exhaustive.
3. The runtime reader in the consumer's *installed* copy refuses the record. See §4.

Point 3 is the one that matters most, and it is the one the "additive" reading misses entirely.

### 3.2 `verification.basis`

    -  readonly verification: { readonly basis: "enrollment-and-local-worktree"; readonly verifiedAt: string };
    +  readonly verification: { readonly basis: RunVerificationBasis; readonly verifiedAt: string };
    +
    +  export const RUN_VERIFICATION_BASES = ["enrollment-and-local-worktree", "enrollment-and-router-session"] as const;
    +  export type RunVerificationBasis = typeof RUN_VERIFICATION_BASES[number];

Recommended name: **`enrollment-and-router-session`**. It names the two things a container-hosted run
can actually evidence — the enrolled repository binding, and the router session the turn ran in — and it
implies no checkout on this host. The alternative considered and rejected is
`enrollment-and-hosted-session`, which is vaguer about who hosts. The name is the owner's to fix; the
requirement is only that it is distinct and does not imply a local worktree.

**Breaking for a consumer, and in a way a compiler cannot catch.** Beyond the same three type
mechanics as §3.1, there is a semantic break: today `coverage.status === "read"` *entails*
`basis === "enrollment-and-local-worktree"`, so a consumer may read "read" as "verified against a local
worktree" and be right. After the widening that entailment is gone, and any consumer that rendered
"read" as a local-worktree claim is silently wrong on UHP rows while still compiling. Cockpit's current
degradation is built on exactly that entailment — it refuses to claim `read` for a UHP run *because*
`read` means local — so this is the one change that needs a written note to the consumer, not just a
version bump.

### 3.3 `execution.status`

    -  readonly execution: { readonly status: "unknown"; readonly observedAt: null }
    -    | { readonly status: "source-reported-complete" | "source-reported-error"; readonly observedAt: string };
    +  readonly execution: { readonly status: "unknown"; readonly observedAt: null }
    +    | { readonly status: "source-reported-running" | "source-reported-complete" | "source-reported-error"; readonly observedAt: string };

Recommended name: **`source-reported-running`**, matching the existing `source-reported-*` prefix, which
already says the right thing: the *source* reported it, and this record is not independently attesting
it. It belongs on the `observedAt: string` arm, because an in-flight report is observed at a time —
that is what distinguishes it from `unknown`, whose `observedAt` is `null` by construction.

**Breaking for a consumer.** Adding a member to a discriminated union is additive for a producer and
breaking for any consumer that discriminates exhaustively — which, for a status rendered as a badge, is
the normal way to write it. The freshness invariant in #287's original scope is unaffected:
`LivenessState` stays computed from evidence timestamps by telemetry and is not mapped from this field.

### 3.4 What does **not** need to change, and is worth saying

`identity.provider`, `identity.model` and `identity.effort` are already `RunIdentityObservation | null`,
and S10 established that over UHP `provider`, `effort` and `cwd` are unreportable
(`.llm/runs/route-identity-uhp--s10/research.md` §2–§4). So the identity triple already models a
UHP-hosted run honestly, with two nulls and a model. `relationships` is already all-`unavailable`. The
three literals in §3.1–§3.3 are the whole of the blockage.

---

## 4. The wire-level evidence, measured against the published tarball

Not argued from the types — run. `npm pack @rickylabs/harness-contracts@0.3.0`, then each candidate
record through the **published** `readRepositoryRunObservation`, with `schema: 1, protocol: 1` as a
producer on protocol 1 would send it:

| Record | 0.3.0 reader's answer |
|---|---|
| exactly what 0.3.0 defines (control) | `{ ok: true }` |
| `run.source: "uhp"` | `{ ok: false, reason: "invalid" }` |
| `verification.basis: "enrollment-and-router-session"` | `{ ok: false, reason: "invalid" }` |
| `execution.status: "source-reported-running"` | `{ ok: false, reason: "invalid" }` |
| all three together, as the issue requires | `{ ok: false, reason: "invalid" }` |
| the same record at `schema: 2` | `{ ok: false, reason: "unsupported-schema", schema: 2, protocol: 1 }` |

Probe script: `probe-published-0.3.0.mjs` in this run directory. Re-runnable; it fetches the tarball
from the registry and imports its `dist`, so it reads the artifact a consumer installs rather than the
tree.

**What that table says, in one sentence.** Widening any of the three literals inside `schema: 1,
protocol: 1` does not merely fail to compile at a consumer — it makes a *well-formed* UHP observation
read as a *corrupt* one, and the consumer's only vocabulary for it is
`RUN_OBSERVATION_INCOMPLETE_REASONS`, which offers `malformed-record` and `unknown-envelope`. The
producer's new feature would be reported downstream as the producer's data corruption. The last row is
the contrast that makes it a choice rather than a wall: the reader already has a correct answer for
"newer than me" — `unsupported-schema`, carrying the number — and it only reaches that answer if the
schema moves.

---

## 5. The three are one change, and a subset is worse than nothing

From the union itself:

    export type RepositoryRunObservation = ObservationBase & (
      | { coverage: { status: "read"; reason: null }; verification: { basis: "enrollment-and-local-worktree"; verifiedAt: string }; run: ObservedRepositoryRun }
      | { coverage: Exclude<RunObservationCoverage, { status: "read" }>; verification: null; run: null }
    );

The `read` arm requires the local-worktree basis **and** a non-null `run`; the other arm forces both to
`null`. So there is no inhabitant of this type that is a UHP run with `coverage: "read"` unless all
three of §3.1–§3.3 move together. Landing one or two produces vocabulary nothing can use and no
observable difference, while spending the version event that the third one would have needed anyway.

---

## 6. Consumer impact, named

- **`rickylabs/atelier-cockpit` #101 (D11.3)** is the direct consumer, pinned at
  `@rickylabs/harness-contracts@0.3.0`, held at `status:triage` until this lands, and *deliberately
  degraded*: `repositoryRunObservationOf` returns coverage-only for UHP runs with `scope-unverified`,
  `identity-mismatch` or `invalid-evidence` rather than claiming a local-worktree verification that did
  not happen. That degradation is correct and this proposal does not ask for it to be worked around.
- **`rickylabs/atelier-mobile`** consumes Cockpit's generated client, and Cockpit's OpenAPI document is
  generated from this chain, so a rename or reshape after Cockpit integrates surfaces two repositories
  away.
- **What a consumer would have to change**, per option, is in §8.
- **There is no producer of these records in this repository that could emit a UHP one.**
  `packages/telemetry/src/repository-run-observation.ts` reads a local Codex rollout file against a local
  worktree and hard-codes `source: "codex"`, `basis: "enrollment-and-local-worktree"` and the two
  terminal statuses. The UHP producer would be Cockpit, under Decision 5's single read-projection owner
  rule. Applying the widening here alone would add vocabulary with no producer on this side — the same
  objection S10 raised against applying its own `RouteSource` arm early
  (`proposal-routesource-uhp.md` §5.1).

---

## 7. Owner fork F1 — how the three land, given that they are breaking

**Question.** The three changes are required and are breaking against the published 0.3.0. How should
they ship?

**Option A — widen the literals in place, on a new schema and/or protocol.**
Exactly the diffs in §3, plus `REPOSITORY_RUN_OBSERVATION_SCHEMA = 2`, the reader accepting schema 2,
and a version bump that is honest about the break. A 0.3.0 consumer then reads a new record as
`unsupported-schema` with the number — the legible answer, per §4's last row — instead of `invalid`.
One type, one reader, one vocabulary.
*Cost:* every consumer must upgrade before it can read any UHP observation at all, and a 0.3.0 consumer
reads new records as unreadable until it does. `scripts/check-installed-contracts.mjs` has 108 fixtures
over this surface that must be extended rather than edited, or the negative matrix stops proving
what it proves.

**Option B — add a schema-2 sibling surface and leave schema 1 exactly as it is.**
New exported types (`ObservedRepositoryRunV2`, `RepositoryRunObservationV2`) and a new reader, with the
existing ones untouched. Purely additive in exports: no existing type changes, so no consumer breaks at
compile time, and a 0.3.0 consumer still reads schema-1 records as `ok` and schema-2 records as
`unsupported-schema`.
*Cost:* two parallel validators over one concept, in a published package, forever or until a deprecation.
The 0.3.0 → 0.4.x duplication is the exact shape Principle 9 ("each fact has one home") warns about, and
the second validator is ~100 lines of the most safety-critical code in the package. Cockpit gains
nothing until it adopts the V2 reader, so the "no consumer breaks" benefit is partly nominal.

**Recommendation: Option A, on schema 2, shipped in one release with the UHP wire types.**
The break is real either way — a consumer that wants UHP observations must change code in both options —
and Option A pays for it once, in the open, with the reader's own `unsupported-schema` path doing the
degradation it was designed for. Option B's additive-ness buys compile-time peace for consumers that do
not want the feature, at the price of permanently doubling the surface that must stay correct.

**Cost if that recommendation is wrong.** If a consumer exists that must keep reading new records
without changing code, Option A cannot give it that and Option B can; discovering such a consumer after
Option A ships means a second schema anyway, which is Option B arrived at the expensive way. The
mitigating fact is that the only named consumer is Cockpit, which is already held and already expects to
change (#101 at `status:triage`, its fixtures at #102).

**Not decided here, deliberately:** the version number and whether `dsh.protocol` moves. Both are
#283's, and the brief for this run forbids touching either.

---

## 8. What a consumer would have to change

**Under Option A** (recommended), for Cockpit:

1. Bump the dependency, then handle `source: "uhp"` wherever `"codex"` is currently matched — a badge,
   a filter and any exhaustive switch.
2. Stop reading `coverage.status === "read"` as "verified against a local worktree". Read
   `verification.basis` and branch: local worktree, or router session. This is the semantic break of
   §3.2 and it compiles either way, so it needs a human to do it.
3. Handle `execution.status === "source-reported-running"` as in-flight, and stop treating `unknown` as
   "probably running" — that conflation is what the new status removes.
4. Emit `schema: 2` on anything it publishes to durable streams, and keep reading schema 1 for records
   already stored.
5. The sanitization constraint Cockpit asked about is unaffected: nothing in §3 surfaces a raw prompt or
   a raw host filesystem path. `ObservedRepositoryRun` carries no `cwd` and no prompt field, and it
   never did.

**Under Option B**: the same list, except step 1 becomes "import the V2 types and reader", and nothing
breaks until it does.

---

## 9. What this proposal does not claim

- **No live router answered any of this.** There is no HarnessRouter reachable from this host and no
  container runtime on it. The shape of a UHP-hosted run comes from `uhp-mock.ts` and the published
  specification, and the live round-trip is [#294](https://github.com/rickylabs/harness/issues/294),
  which is blocked.
- **No claim that `source-reported-running` is *observable* over UHP for a given run.** It is: UHP
  `in_progress` maps to `RunLiveness: "running"` per this issue's own scope table and
  `packages/subagents/src/uhp-lifecycle.ts`. What is *not* claimed is that any server has ever been
  observed reporting it to this repository.
- **No claim about what Cockpit's code does beyond what #287's comments state.** The Cockpit behaviour
  in §6 is quoted from the owner comment on #287, not read from that repository during this run.
