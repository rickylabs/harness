# Verification — `observation-schema-2--e38`

Issue [#300](https://github.com/rickylabs/harness/issues/300), owner fork **F1 option 1**: widen in
place on `schema: 2`, and bump. Option 2, the additive schema-2 sibling, was not taken.

Baseline `08d0be5` (`origin/main`). Branch `feat/300-observation-schema-2`.

---

## 1. What shipped

All three widenings of `packages/contracts/src/repository-run-observation.ts`, together, because the
`coverage: "read"` arm requires a non-null `run` **and** a verification basis, so any subset leaves
that arm unreachable for a UHP-hosted run and delivers nothing observable.

| Widening | Before | After | New export |
|---|---|---|---|
| `ObservedRepositoryRun.source` | bare literal `"codex"` | `OBSERVED_RUN_SOURCES` = `codex \| uhp` | `OBSERVED_RUN_SOURCES`, `ObservedRunSource` |
| `verification.basis` | bare literal `"enrollment-and-local-worktree"` | `RUN_VERIFICATION_BASES` = that, plus `enrollment-and-router-session` | `RUN_VERIFICATION_BASES`, `RunVerificationBasis` |
| `execution.status` | `unknown` / `source-reported-complete` / `source-reported-error` | plus `source-reported-running`, on the timestamped arm | `RUN_EXECUTION_REPORTED_STATUSES`, `RunExecutionReportedStatus` |

`REPOSITORY_RUN_OBSERVATION_SCHEMA` is **2**. `REPOSITORY_RUN_OBSERVATION_READ_SCHEMAS` is `[1, 2]`,
with `RepositoryRunObservationSchema` = `1 | 2`.

**`RunSource` was not touched.** It is still `claude | codex | opencode` in
`packages/contracts/src/runs.ts` and still strictly the billing seam. `packages/routing` was not
touched. `packages/subagents/config/harnesses.v1.json` is untouched and still unreconciled with
`reconciledAt: null`; no ids were invented.

Two names were chosen as the proposal recommended, and the alternatives it recorded are now mutation
rows rather than prose: `enrollment-and-router-session` over the vaguer `enrollment-and-hosted-session`
(mutation N15, 5 kills), and `source-reported-running` matching the existing `source-reported-*`
prefix, which already says the right thing — the *source* reported it, and this record is not
independently attesting it.

**`source` and `verification.basis` are independent fields, by decision.** No cross-field entailment
was added — a schema-2 record with `source: "codex"` and the router-session basis is accepted, and so
is the reverse. The owner decided three widenings; a reader that refused a combination would be
enforcing a policy no decision authorizes, and this decoder is a shape validator, not a policy
engine. That is asserted, so nothing later "fixes" it silently.

---

## 2. The protocol answer: **protocol stays 1.**

`dsh.protocol` in the manifest and `PROTOCOL_VERSION` in the package both remain `1`. Four reasons,
in the order that decides it:

1. **Nothing semantic changed.** Schema is the record shape; protocol is the semantic contract. Every
   one of the three widenings adds a member to a literal set. No existing value changed meaning:
   `"codex"` still means codex-hosted, `enrollment-and-local-worktree` still means exactly enrollment
   plus a local worktree, `source-reported-complete` and `source-reported-error` are untouched, and
   `unknown` still means "no status was reported at a time". No verb moved, no message, no frame, no
   state machine, and the reader's three answers — accept, `invalid`, `unsupported-schema` with the
   numbers — are the same three answers.
2. **The new basis is added precisely so that no existing value has to lie.** Overloading
   `enrollment-and-local-worktree` to cover a container-hosted session *would* have been a protocol
   change, because it would redefine a published value. Adding a distinct one preserves the meaning of
   the value that already exists. The same argument holds for `source-reported-running` against
   `unknown`.
3. **Decision 9 of [#287](https://github.com/rickylabs/harness/issues/287) already defines protocol-1
   semantics for exactly this traffic.** Verbatim: *"Protocol 1 maps UHP `cancelled` ⇒ `RunOutcome:
   complete` and `incomplete` ⇒ `RunOutcome: failed`. The stop verdict and budget detail are carried
   on the versioned observation resource introduced by D1.4/D1.5, not as a new `RunView` field."* A
   UHP-hosted run riding this resource is anticipated protocol-1 behaviour, not new semantics. Nothing
   in this change contradicts that mapping or adds a second one.
4. **`protocol` is package-wide, and bumping it would destroy the thing this change protects.** One
   number covers governance, events, hub delivery, tasks, runs, connection recovery and this
   resource. Moving it to describe one resource's shape change would falsely invalidate all the
   others — and, decisively, the reader rejects any record whose protocol is not its own, so a
   protocol-2 reader could not read a schema-1 record at all, since every persisted schema-1 record
   carries `protocol: 1`. Bumping protocol would make read-both impossible.

**The one thing that is genuinely semantic, and why the schema number is still the right carrier.**
Under schema 1, `coverage.status === "read"` *entailed* `basis === "enrollment-and-local-worktree"`,
and a consumer could read `read` as "verified against a local worktree" and be right. From schema 2
that entailment is gone, and it breaks with no compile error. That is exactly the hazard the schema
number is for: a consumer pinned below 0.5.0 does not mis-read a schema-2 record under schema-1
assumptions, because it refuses the record outright and says why. The entailment was a property of the
schema-1 *shape*, so the shape number is what must move for a reader to notice. It is written into
`packages/contracts/README.md` as well as here, because a consumer that only reads the types will not
see it.

---

## 3. Reader compatibility: **read both, write 2.**

`readRepositoryRunObservation` accepts `schema: 1` and `schema: 2`. `REPOSITORY_RUN_OBSERVATION_SCHEMA`
is 2, so that is what any producer writes.

**Consequence for already-persisted records: they stay readable, and they stay honest.** Every
observation persisted by `packages/telemetry` before this change is `schema: 1, protocol: 1`, and every
one of them still reads `ok: true`. The alternative — read-newest-only — would have turned durable
evidence into `unsupported-schema` overnight, which destroys it for no gain, since a schema-1 record is
trivially interpretable: its source is always `codex` and its basis is always the local-worktree one.

Two properties make read-both honest rather than merely permissive, and both are asserted:

- **The schema is preserved, never relabelled.** A record read at `schema: 1` comes back at
  `schema: 1`. Rewriting it to 2 would make stored evidence claim a vocabulary it was never written
  under, and `observation.schema` is what tells a consumer which vocabulary applies (mutation N9,
  2 kills).
- **Schema 1 is read under exactly the vocabulary schema 1 promised.** `SCHEMA_1_SOURCES`,
  `SCHEMA_1_VERIFICATION_BASES` and `SCHEMA_1_REPORTED_STATUSES` are enforced when `schema === 1`, so a
  record claiming `schema: 1` while carrying schema-2 vocabulary is `invalid` — malformed, not merely
  newer. Accepting it would be this package blessing exactly the lie that a pinned consumer's
  assumptions rest on (mutations N3–N8).

**A record from a future schema returns `unsupported-schema` with the numbers, never `invalid`.** The
version fence is reached before any field validation, so a schema-3 record with defects this reader has
no standing to judge still answers `unsupported-schema, schema: 3, protocol: 1` rather than being
downgraded to "corrupt" (mutations N10, N11, N16, N17 — 3 kills each). A schema that is not a usable
version number (`"2"`, `null`, `1.5`, `-1`, `NaN`) answers `unsupported-schema` with `schema: null`,
still not `invalid`.

---

## 4. Version: **0.5.0**, and the target moved mid-run.

| Fact | Value | Read from |
|---|---|---|
| Published versions | 0.1.0, 0.2.0, 0.3.0, **0.4.0** | `npm view @rickylabs/harness-contracts versions`, 2026-09-13 |
| `dist-tags.latest` | 0.4.0 | same |
| Manifest at baseline `08d0be5` | 0.4.0 | `packages/contracts/package.json` |
| Manifest on this branch | **0.5.0** | same |
| `dsh.protocol` | 1, unchanged | same |

The brief opened with 0.4.0 as the target, on the belief that the manifest read 0.3.0. It did not: the
tree had been at 0.4.0 since `3e70d37` (PR 282, connection recovery for #265), unpublished and held by
the owner ruling on [#283](https://github.com/rickylabs/harness/issues/283) of 2026-09-12 — *"hold the
0.4.0 publication at 0.3.0 until the S10 contracts are ready … so it can ship inside one version bump
rather than two."*

That hold was discharged during this run. The owner authorized the 0.4.0 publication and the
`harness-contracts-v0.4.0` tag was pushed against `main` **without** this change in it; 0.4.0 was
observed on the registry from this host before the measurement in §5 was taken. So 0.4.0 is now an
immutable published artifact whose contents are the recovery fix and nothing from here. Shipping this
breaking change under the same number would make one version denote two different artifacts, and the
release workflow's own guard — the tag version must equal the manifest version — exists because
publishing the wrong content under a version number burns it permanently with no revert. Hence 0.5.0.

A minor bump in 0.x is the breaking signal by convention, and this is breaking: a consumer that wants
UHP observations must change code, and a consumer that changes nothing stops reading new records.

**Nothing was published.** No `npm publish`, no `npm version`, no tag, no release-workflow trigger
armed. Only the `version` field in the manifest moved. Publication of 0.5.0 is a separate owner
decision and is not held by any issue yet; #283 was about 0.4.0 and is now discharged.

### Release automation, checked rather than assumed

`.github/workflows/release-contracts.yml` has **no `push: branches` trigger**. It fires only on a tag
matching `harness-contracts-v*`, or on a manual `workflow_dispatch` whose `dryRun` input defaults to
`true`. Merging this pull request therefore publishes nothing. `.github/workflows/ci.yml` has no
publish step and says so in its own header; `board.yml` "publishes" only a rendered markdown board
commit. **No release automation would fire on merge, and none was armed by this run.**

The `harness-contracts-v0.4.0` tag is unaffected by this branch: the workflow checks out the tagged
commit, so the manifest it reads is 0.4.0 at that commit regardless of what `main` later says, and the
tagged commit stays an ancestor of `main` after this merges.

---

## 5. Measured: the published readers against the shape this run ships

`node .llm/runs/observation-schema-2--e38/probe-published-readers.mjs` — fetches the registry tarballs
and imports their `dist`, so it reads the artifact a consumer installs, not the tree. Both published
readers were measured: 0.3.0, the pin the proposal used, and 0.4.0, the pin a consumer holds today.
`src/repository-run-observation.ts` is **byte-identical** across published 0.3.0, published 0.4.0 and
this run's baseline (`diff`, empty), which is why the two tables agree exactly.

| Record through published 0.3.0 **and** 0.4.0 | Answer |
|---|---|
| exactly what the published version defines (control) | `ok: true` |
| `run.source: "uhp"` alone, inside `schema: 1` | `ok: false, reason: "invalid"` |
| `verification.basis: "enrollment-and-router-session"` alone, inside `schema: 1` | `ok: false, reason: "invalid"` |
| `execution.status: "source-reported-running"` alone, inside `schema: 1` | `ok: false, reason: "invalid"` |
| all three widenings together, inside `schema: 1` | `ok: false, reason: "invalid"` |
| **all three widenings at `schema: 2` — what a UHP producer writes** | **`ok: false, reason: "unsupported-schema", schema: 2, protocol: 1`** |
| **a plain codex observation at `schema: 2` — what telemetry now writes** | **`ok: false, reason: "unsupported-schema", schema: 2, protocol: 1`** |
| a `schema: 1` record persisted before this change | `ok: true` |

The premise of the decision holds, against both published artifacts. The shape this run ships produces
`unsupported-schema` carrying both numbers, not `invalid`. Had that last pair come back `invalid`, this
would have been a blocking finding and nothing would have shipped; the probe asserts it rather than
printing it, so it cannot pass by being unread.

---

## 6. What the pinned consumer sees, precisely, before and after upgrading

`rickylabs/atelier-cockpit` (#101, product pack D11.3) is pinned at `@rickylabs/harness-contracts@0.3.0`
per #287's owner comment, and is **deliberately degraded**: `repositoryRunObservationOf` returns
coverage-only for UHP runs with `scope-unverified`, `identity-mismatch` or `invalid-evidence` rather
than claiming a local-worktree verification that did not happen. That degradation is correct and this
change does not ask for it to be worked around. Published 0.4.0's observation surface is byte-identical
to 0.3.0's, so a consumer that has since moved to 0.4.0 sees the same thing.

**Before it upgrades — the part that costs it something, stated plainly.**

| Record it is handed | What it sees at 0.3.0 or 0.4.0 |
|---|---|
| A schema-1 record already in its store | `ok: true`. Unchanged. Nothing it has persisted becomes unreadable. |
| A UHP observation at schema 2 | `unsupported-schema, schema: 2, protocol: 1`. Correct and actionable: too old, and by how much. |
| **A codex observation newly written by `packages/telemetry`** | **`unsupported-schema, schema: 2, protocol: 1`.** This is the cost. Telemetry writes the newest schema, so from this change onward a pinned consumer cannot read *any* new observation, including codex ones it reads fine today. It is not silent and it is not `invalid` — the record is refused with both numbers, which is the answer the reader was designed to give. |
| A UHP observation inside schema 1 | Would have been `invalid` — a pinned consumer calling well-formed data corrupt, with `malformed-record` and `unknown-envelope` as its only vocabulary for it. **This is what the schema bump avoids, and it is the reason option 1 was taken over widening in place.** |

**After it upgrades to 0.5.0,** five things, four of them mechanical and one not:

1. Handle `source: "uhp"` wherever `"codex"` is matched — a badge, a filter, any exhaustive switch.
   `OBSERVED_RUN_SOURCES` is exported so the list has one home.
2. **Stop reading `coverage.status === "read"` as "verified against a local worktree."** Read
   `verification.basis` and branch: local worktree, or router session. This compiles either way and is
   the one step a compiler will not demand. It is the step its current degradation logic rests on.
3. Handle `execution.status === "source-reported-running"` as in-flight, and stop treating `unknown` as
   "probably running" — removing that conflation is what the new status is for.
4. Emit `schema: 2` on anything it publishes to durable streams, and keep reading schema 1 for records
   already stored. The package does both; a consumer should mirror it.
5. Nothing new is surfaced that needs sanitizing. `ObservedRepositoryRun` carries no `cwd`, no prompt
   and no host path, and it never did. Over UHP, `identity.provider` and `identity.effort` stay `null`
   because the protocol defines no field for either (S10).

`rickylabs/atelier-mobile` consumes Cockpit's generated client, and Cockpit's OpenAPI document is
generated from this chain, so item 1 and item 3 surface two repositories away. Neither repository was
read during this run; the Cockpit behaviour above is quoted from #287 and #300, not observed.

### Related: a mirrored vocabulary with no type-level link

On coordinator instruction, the `RUN_SOURCES` doc comment in `packages/contracts/src/runs.ts` now
records that a known consumer mirrors that list in a Prisma `MessageCli` enum with no type-level link
between the declarations, that widening `RUN_SOURCES` therefore requires notifying that consumer
*before* publication, and that the drift is silent because no compile error is possible across two
languages in two repositories. Comment-only, additive, and unrelated to the schema-2 widening — this
change does not touch `RUN_SOURCES`. It is written at the declaration so that whoever proposes a
widening reads it there rather than discovering the obligation from a changelog.

---

## 7. Additive or breaking, per change

| Change | Package | Producer | Consumer |
|---|---|---|---|
| `ObservedRepositoryRun.source` widened | contracts (**published**) | additive | **BREAKING** — type and wire |
| `verification.basis` widened | contracts (**published**) | additive | **BREAKING** — type, wire, and semantic with no compile error |
| `execution.status` widened | contracts (**published**) | additive | **BREAKING** — type and wire |
| `REPOSITORY_RUN_OBSERVATION_SCHEMA` 1 → 2 | contracts (**published**) | behaviour | **BREAKING** — every new record refused by a pinned reader |
| reader accepts schema 1 and 2 | contracts (**published**) | additive | strictly more accepting; nothing previously accepted is refused |
| schema-1 vocabulary enforced when `schema === 1` | contracts (**published**) | additive | strictly more refusing; only refuses records no honest producer wrote |
| six new exports (three const lists, four types) | contracts (**published**) | additive | additive |
| `packages/telemetry` writes schema 2 | telemetry (**private**) | behaviour | **BREAKING** for its pinned reader — §6 row 3 |
| `RUN_SOURCES` doc comment | contracts (**published**) | none | none — comment only |
| `check-snapshots` fixture inventory grows by one | scripts (private) | additive | n/a |

---

## 8. Gates

| Gate | Result |
|---|---|
| `pnpm run build` | **green**, exit 0. 15 packages, plus `check:graph`, `check:lifecycle`, `check:links` (344 relative links, 0 broken), `check:forms`, `check:snapshots` (9 exact synthetic fixtures), `check:compiled-policy`, `check:publish`, `check:label-registry`, `check:docs`, `check:skill`, `check:tutorial`. |
| `check:publish` | `@rickylabs/harness-contracts@0.5.0, protocol 1, 78 files, no tests` |
| `pnpm -r run test` | **green**, exit 0. 12 package suites, **3,125 tests, 0 fail**. Contracts 220 (was 213 at baseline: 7 new tests). |
| `pnpm run test` → `check:installed` | **blocked on this host, at baseline too**, then **green in CI.** Locally it fails at `sleeping probe startup (requires executable TMPDIR)` in its *governance* half — measured on the unmodified `origin/main` baseline first, with the same message and the same exit code (`worklog.md` D1). On the GitHub runner it passes: the `ci` workflow runs `pnpm test`, which is `pnpm -r run test && pnpm run check:installed`, and it reported `typecheck · build · test` **SUCCESS** on PR 301 at `a35076c`. So the gate is intact and the limitation was this host's. |
| `probe-installed-decoder.mjs` | **green.** The run-observation half of that gate, run standalone: packs the real 0.5.0 tarball, installs it offline, checks `dsh.protocol 1` and 78 files, compiles an exhaustive consumer against the installed `.d.ts` (and confirms it refuses `'claude'` as a source, `3` as a schema, and the rejected basis name), and drives all **108** synthetic fixtures from the actual CLI through the **installed** decoder. |
| `probe-published-readers.mjs` | **green**, §5. |
| `mutations.mjs` | **30 mutations, every one compiled and killed at least one test.** Baseline 0 fail, 0 fail after restore. §9. |

---

## 9. Mutation campaign — 30 mutations, every kill count

`node .llm/runs/observation-schema-2--e38/mutations.mjs`, full record in `mutations.json`. Each row
damages one behaviour by an exact string replacement, runs **both** the `@rickylabs/harness-contracts`
and `@rickylabs/telemetry` suites, records the summed `fail` count, and restores the file byte for byte.
Every mutant is written in a form that still **compiles**: a mutant caught by an unused-variable check
rather than by an assertion is not evidence, so `compiled: false` is reported as a finding, not a kill.
One mutant was rewritten for exactly that reason — see §9.1 finding 1.

**N — this run's new behaviour**

| # | Kills | What it breaks |
|---|---|---|
| N1 | 2 | the write number goes back to 1, so nothing produced carries the new schema |
| N2 | 7 | read-both becomes read-newest, so every already-persisted schema-1 record becomes unreadable |
| N3 | 6 | source vocabulary bound to the wrong schema: schema 1 admits UHP, schema 2 refuses it |
| N4 | 5 | basis vocabulary bound to the wrong schema, so `read` loses its local-worktree entailment inside schema 1 |
| N5 | 4 | status vocabulary bound to the wrong schema, so an in-flight report is legal inside schema 1 |
| N6 | 2 | schema 1 retroactively told it always admitted a UHP source |
| N7 | 1 | schema 1 retroactively told it always admitted the router-session basis |
| N8 | 1 | schema 1 retroactively told it always admitted an in-flight status |
| N9 | 2 | the schema read is overwritten with the schema written, so stored evidence claims a vocabulary it never had |
| N10 | 3 | an unread schema answers `invalid` instead of `unsupported-schema` — the whole reason this decision went the way it did |
| N11 | 3 | `unsupported-schema` reports a number it does not carry |
| N17 | 3 | the two numbers on `unsupported-schema` are swapped, so the consumer is told the wrong distance |
| N12 | 2 | the in-flight arm decided by the timestamp rather than the status |
| N13 | 1 | the reported-status vocabulary grows a fourth member nothing produces |
| N14 | 1 | the observed-source vocabulary absorbs a `RunSource` member, overloading the billing seam |
| N15 | 5 | the new basis renamed to the alternative the proposal rejected |
| N16 | 3 | the version fence lets a future schema through to field validation |

**T — the producer side, `packages/telemetry`**

| # | Kills | What it breaks |
|---|---|---|
| T1 | 1 | the producer keeps writing schema 1, so the bump exists in the type and in nothing published |
| T2 | 1 | a local-worktree reader claims the router-session basis — the new vocabulary used to lie rather than to be honest |
| T3 | 1 | a local Codex rollout published as a UHP-hosted run, which the widened source now makes expressible |

**C — carried forward: pre-existing decoder behaviour, re-run because this run restructured the
function that implements it.** A mutation record describes the code as it was; change the meaning and
it silently stops describing it while still looking like coverage. `run()` gained a parameter, the
version fence was rewritten, and three literal comparisons became `choice` calls, so the whole record
was re-run rather than carried on trust.

| # | Kills | What it breaks |
|---|---|---|
| C1 | 8 | the observation interval may run backwards |
| C2 | 1 | evidence may be timestamped after the last observed envelope |
| C3 | 7 | a verification may be stamped after the collection it belongs to |
| C4 | 1 | the relationships fence accepts a record in which some relationship is claimed |
| C5 | **1, after a repair — was 0** | a non-read coverage may carry a run or a verification |
| C6 | 1 | a usage record with no count at all is accepted as usage |
| C7 | 1 | the accessor fence: a getter-backed property is read instead of refused |
| C8 | 1 | negative zero survives normalization, so two equal counts are not equal |
| C9 | 1 | an identity leaf may carry twice the bounded length |
| C10 | 2 | the unknown arm may carry a timestamp, collapsing the distinction the in-flight status was added to make |

### 9.1 Two findings came out of the campaign rather than out of reading

**1. A mutant that was caught by the compiler, not by the suite.** The first form of N11 replaced the
`unsupported-schema` return with `schema: null, protocol: null`, which left the local `version` helper
unused and failed `noUnusedLocals`. Reported as `compile-error — not evidence` rather than as a kill,
and rewritten into two forms a reviewer could plausibly have written: N11 makes `version` return `0`
for every valid number, and N17 swaps the two arguments. Both compile, and both kill 3.

**2. C5 killed nothing, and the behaviour was genuinely uncovered.** Relaxing
`if (r.run !== null || r.verification !== null) return bad();` to `&&` killed **zero** tests. The cause
was the setup, as the standard predicts: every fixture that exercised a degraded coverage set `run` and
`verification` to `null` *in the same statement*, so either operand answered and the `||` was never
distinguished from the `&&`. A record whose coverage says nothing was read, while still carrying a
`run`, would have passed the guard and had its run silently dropped — publishing a shape the decoder
denies rather than refusing it. One test was added,
`"a degraded coverage carries neither a run nor a verification"`, with a positive control (both null is
accepted) paired with two negatives on the same input (one non-null at a time). C5 now kills 1. This is
**pre-existing** behaviour: the defect was in the test, not in the reader.

---

## 10. What this run does not claim

- **No live `HarnessRouter` answered any of this.** There is none reachable from this host, there is no
  container runtime on it, and none was installed or required. Every UHP shape comes from the published
  specification and `packages/subagents/src/uhp-mock.ts`. The live round-trip is
  [#294](https://github.com/rickylabs/harness/issues/294) and is blocked.
- **No claim that any server has been observed reporting an in-flight status to this repository.** That
  UHP `in_progress` maps to a running liveness is #287's own scope table and
  `packages/subagents/src/uhp-lifecycle.ts`; that some server did it is not claimed.
- **No producer of a UHP observation exists in this repository.**
  `packages/telemetry/src/repository-run-observation.ts` reads a local Codex rollout against a local
  worktree and still writes `source: "codex"` with the local-worktree basis, which is what it can
  evidence. The UHP producer would be Cockpit, under Decision 5's single read-projection owner rule.
  This change ships vocabulary, not a second producer — and a test asserts that the local reader never
  mints the UHP vocabulary (T2, T3).
- **`check:installed` could not be made to pass on the run host**, on baseline as well as here, so the
  run-observation half it would have exercised was extracted and run standalone (§8). It then passed
  **in CI**, which is where the gate that matters runs, so the sleeping-probe reaping assertions are
  covered there rather than here — but they were not observed from this host.
- **No claim about `rickylabs/atelier-cockpit`'s code** beyond what #287 and #300 state. That
  repository was not read.
- **No publication, no tag, no arming.** §4.
- `docs/concepts/06-the-three-layers.md` still says the published package is at 0.3.0. That went stale
  when the 0.4.0 tag was pushed during this run, not from this change; correcting it needs the 0.4.0
  release receipt, which belongs to whoever cut the tag. Recorded rather than guessed at.
