# Verification — `contract-alignment--e38`

Issue [#287](https://github.com/rickylabs/harness/issues/287), under E3
([#33](https://github.com/rickylabs/harness/issues/33)). Baseline `c77191e`.

---

## 1. Verdict

| Work item | Outcome |
|---|---|
| 1 — the observation surface (`source`, `verification.basis`, `execution.status`) | **PROPOSED, not applied.** All three are breaking for a consumer pinned at the published 0.3.0, so a version or protocol decision is required and that is the owner's on #283. `proposal-observation-surface-uhp.md`, owner fork F1. |
| 2 — `SteerResult` carries no route evidence | **APPLIED.** Additive. |
| 3 — `RouteSource` has no UHP arm; UHP route evidence claimed a Codex origin | **APPLIED**, per S10's merged proposal and its acceptance criteria. Breaking-in-a-private-package in one respect, stated in §2. |

`packages/contracts` is byte-unchanged by this run: `git diff --stat origin/main -- packages/contracts`
prints nothing.

**The issue's own framing is contradicted on one point, and this is a finding rather than an obstacle.**
The added scope says the three observation-surface widenings are *"additive widenings of a published
package"*. They are not additive. §2 gives the determination per change and §3 measures it against the
tarball a consumer installs.

---

## 2. Additive or breaking, per change, with the consumer impact

The question is asked against **`@rickylabs/harness-contracts@0.3.0`**, which is what a consumer can
install (npm's highest; the tree's 0.4.0 is unpublished). For private packages the question is asked
against every in-repo consumer, enumerated by `grep` rather than assumed.

### 2.1 Proposed and NOT applied — `packages/contracts`, published

| # | Change | Producer | Consumer | Applied |
|---|---|---|---|---|
| 1a | `ObservedRepositoryRun.source`: `"codex"` → `"codex" \| "uhp"` | additive | **BREAKING** | no |
| 1b | `verification.basis`: add `enrollment-and-router-session` | additive | **BREAKING** | no |
| 1c | `execution.status`: add `source-reported-running` | additive | **BREAKING** | no |

**Why breaking, precisely.** Three mechanisms, and the third is the one that makes the word "additive"
unusable here:

1. **Exhaustive narrowing stops compiling.** `switch (run.source) { case "codex": …; default: assertNever }`,
   `const s: "codex" = run.source`, and `Record<ObservedRepositoryRun["source"], Renderer>` all break.
   Adding a member to a discriminated union is additive in producer position and breaking in consumer
   position; `execution` is exactly such a union, and `source`/`basis` are literal-typed read fields.
2. **A semantic break no compiler catches** (1b only). Today `coverage.status === "read"` *entails*
   `basis === "enrollment-and-local-worktree"`, because the union's `read` arm requires it. After 1b it
   does not, so a consumer that renders `read` as "verified against a local worktree" keeps compiling and
   starts being wrong on UHP rows. Cockpit's current, correct degradation is built on that entailment.
3. **A wire break inside protocol 1 / schema 1.** The published validator enforces all three literals at
   runtime. Measured, not argued — §3.

**Consumer impact, named.** `rickylabs/atelier-cockpit` #101 (D11.3) is pinned at 0.3.0, held at
`status:triage`, and deliberately degraded for exactly these gaps; `rickylabs/atelier-mobile` consumes
Cockpit's generated client, and Cockpit's OpenAPI document is generated from this chain. What a consumer
would have to change, per option, is in the proposal's §8. Note also that **this repository has no
producer that could emit a UHP observation**: `packages/telemetry/src/repository-run-observation.ts` reads
a local Codex rollout against a local worktree and hard-codes all three literals. So applying 1a–1c here
would add published vocabulary with no producer on this side.

**Jointness.** The `coverage: "read"` arm requires the local-worktree basis *and* a non-null `run`; the
other arm forces both to `null`. No inhabitant of the type is a UHP run with `coverage: "read"` unless all
three change together, so a subset delivers nothing observable and still spends the version event. All
three are proposed; none is applied.

### 2.2 Applied — `packages/subagents`, `"private": true`

`@rickylabs/subagents` is private (`packages/subagents/package.json`), and `packages/contracts` contains
**no** reference to `RouteSource`, `RouteValueEvidence`, `RouteIdentityEvidence` or route identity in any
form — verified by `grep -rln "RouteIdentityEvidence\|RouteValueEvidence\|RouteSource\|RouteIdentityValues"`
over `packages/*/src`, which matches only `subagents` and `provider-codex`. **Nothing below can reach the
published surface or Atelier Cockpit.**

| # | Change | Producer | Consumer | Notes |
|---|---|---|---|---|
| 3a | `RouteSource` gains `"uhp/responses.result.model"` | additive | **breaking in principle, safe in fact** | Widening a string-literal union is breaking for any consumer that switches exhaustively over it. `RouteSource` appears in consumer position in exactly one place — `RouteValueEvidence.source`, compared by equality in `isRouteEvidenceVerified` — and is switched over nowhere. Applied, and `route.ts` now records in a comment that the enumeration is open-ended by design and no consumer may switch it exhaustively. |
| 3b | `RouteValueEvidence.source`: `RouteSource` → `RouteSource \| null` | additive | **BREAKING for in-repo consumers**, all four fixed in this diff | `const s: RouteSource = ev.observed.model.source` stops compiling. Every consumer is in-tree (`route.ts`, `uhp-redact.ts`, and the suites), and each was updated in the same commit. This is applied because the package is private and the whole consumer set is enumerable; it would **not** be applicable to `packages/contracts` on the same reasoning. |
| 3c | `OBSERVED_SOURCES` becomes dialect-keyed | internal | none | Not exported, before or after. |
| 3d | `compareRouteIdentity` gains a third parameter | additive | additive | Optional, defaults to `"codex"`. `provider-codex/src/protocol.ts` and `dsh-app/src/dry-run-internal.ts` are unmodified, and a test asserts the two-argument call produces byte-identical evidence to `"codex"`. |
| 3e | `isRouteEvidenceVerified` refuses a null-sourced field and selects the dialect by label | behaviour change | **strictly more refusing** | No input that was refused becomes accepted. Inputs that were accepted are unchanged (codex-labelled, fully valued); a new class is refused (uhp-labelled, however valued). A consumer's fail-closed default cannot regress. |
| 3f | `ROUTE_DIALECTS`, `RouteDialect`, `isSteerRouteVerified` exported | additive | additive | New exports only. |
| 2a | `SteerResult.route?: RouteIdentityEvidence` | additive | additive | **Optional**, so no implementer of `SubagentProvider.steer` breaks: `provider-claude`, `provider-opencode` and `dsh-app`'s wrapper compile unmodified, and each keeps returning a result with no `route`, which reads as unverified. A **required** field here would have been breaking for every producer, which is why it is optional. |
| 2b | `provider-uhp.steer` returns route evidence and a differently-worded detail on a contradiction | behaviour change | see note | `detail` is documented as a diagnostic, not a parse target. One existing test asserted a phrase in it; that test is the one the change is about and it was rewritten deliberately, with its mutation re-run (§4, N8/N10). |

### 2.3 Nothing else was touched

`packages/routing`: untouched. `packages/subagents/config/harnesses.v1.json`: untouched, still
`reconciledAt: null` with placeholder ids. No `version`, no `dsh.protocol`, no tag, no publish. No
container runtime was started, installed or required.

---

## 3. The wire-level measurement against the published 0.3.0

Script: `probe-published-0.3.0.mjs` (re-runnable; `npm pack`s the registry tarball and imports its
`dist`, so it reads what a consumer installs, not the tree). Output, 2026-09-12:

    control: exactly what 0.3.0 defines          -> {"ok":true}
    source: uhp                                  -> {"ok":false,"reason":"invalid"}
    basis: enrollment-and-router-session         -> {"ok":false,"reason":"invalid"}
    execution.status: source-reported-running    -> {"ok":false,"reason":"invalid"}
    all three together, as the issue requires    -> {"ok":false,"reason":"invalid"}
    the same record at schema 2 (option B)       -> {"ok":false,"reason":"unsupported-schema","schema":2,"protocol":1}

A pinned consumer would therefore report a **well-formed** UHP observation as a **corrupt** one, with
`malformed-record` or `unknown-envelope` as its only vocabulary for it — the producer's new feature read
downstream as the producer's data corruption. The last line is the contrast that makes F1 a choice: the
reader already has a correct answer for "newer than me", and it only reaches it if the schema moves.

Corroborating fact, also measured: the published 0.3.0 tarball contains
`package/src/repository-run-observation.ts` **byte-identical** to the tree (`diff`, empty output), so this
is a real pinned surface and not a paper one.

---

## 4. Mutation testing

Driver: `mutations.mjs` in this directory, machine-readable results in `mutations.json`. Each row damages
one behaviour by one exact string replacement, runs `pnpm --filter @rickylabs/subagents run test`, records
the failures, and restores the file byte for byte. **Baseline 0 fail; 0 fail after restore; 451 tests.**

Two halves, because the brief requires the second: **N** rows are this run's new behaviour, **C** rows are
carried forward from `.llm/runs/provider-uhp--e37/mutations.mjs` (M1–M19) and from S11's prose-only record
(defect B), re-run because this run changed the meaning of the code they describe. Every carried row still
applied and still killed, which is the evidence that the carried record still describes this code.

### 4.1 This run's behaviour

| # | File | What it breaks | Killed | Killing tests |
|---|---|---|---|---|
| N1 | `route.ts` | the null-source rule: a UHP route with values written beside its three absent labels verifies | **4** | verifies a codex route and refuses the identical values labelled as uhp; refuses a uhp route whose unreportable fields have been given values anyway; cannot be talked into a verified route by a credulous adapter once the dialect is honest; still refuses a codex label presented among UHP ones |
| N2 | `route.ts` | an unexplainable labelling falls back to codex instead of refusing | **3** | refuses a mixed labelling; refuses an observed side labelled with a requested-side source; still refuses a codex label presented among UHP ones |
| N3 | `route.ts` | one matching label is enough to claim a dialect (the forbidden any-label-in-the-union loosening) | **1** | refuses an observed side labelled with a requested-side source |
| N4 | `route.ts` | the uhp row mints labels for the three fields UHP cannot report — the defect, as vocabulary | **10** | the six dialect tests, the two provenance tests, the dispatch refusal test, and the published-diagnostic test |
| N5 | `route.ts` | the dialect argument is accepted and then discarded for uhp | **11** | the N4 set plus both gate-indifference tests and the steer evidence test |
| N6 | `route.ts` | a missing provenance renders as the word `null` | **2** | renders a missing source as an absence rather than as the word null; republishes a missing provenance as an absence, and never as a codex label |
| N7 | `uhp-provider.ts` | dispatch stops naming its dialect, so its published evidence claims a codex origin again | **1** | refuses where the codex ladder and the status-keyed gate both say unknown |
| N8 | `uhp-provider.ts` | a steer carries no route evidence, so a substitution on a continuation is prose again | **4** | publishes no path from any verb; carries a substitution on a continuation as structured route evidence; reports a continuation that was honoured as delivered with no contradiction; names a declared fallback on a continuation |
| N9 | `uhp-provider.ts` | a steer publishes **unredacted** evidence, so the requested cwd crosses the boundary | **2** | publishes no path from any verb; carries a substitution on a continuation as structured route evidence |
| N10 | `uhp-provider.ts` | a steer ignores what the server said about itself, so a declared fallback with an agreeing model is missed | **1** | names a declared fallback on a continuation, and says plainly that the route cannot carry it |
| N11 | `provider.ts` | a steer with no route evidence at all reads as verified | **1** | carries no route on a steer that never reached a response, and reads that as unverified |
| N12 | `provider.ts` | a steer that never landed is verified by the evidence of a turn that did not happen | **1** | carries no route on a steer that never reached a response, and reads that as unverified |

### 4.2 Carried forward, re-run against the changed behaviour

| # | File | Killed | | # | File | Killed |
|---|---|---|---|---|---|---|
| C-S11-B | `uhp-gate.ts` | **9** | | C-M10 | `uhp-provider.ts` | **1** |
| C-M1 | `uhp-gate.ts` | **15** | | C-M11 | `uhp-provider.ts` | **1** |
| C-M2 | `uhp-provider.ts` | **3** | | C-M12 | `uhp-transport.ts` | **1** |
| C-M3 | `uhp-provider.ts` | **1** | | C-M13 | `uhp-gate.ts` | **4** |
| C-M4 | `uhp-redact.ts` | **5** | | C-M14 | `uhp-lifecycle.ts` | **5** |
| C-M5 (with C-M4) | `uhp-provider.ts` | **5** | | C-M15 | `uhp-provider.ts` | **1** |
| C-M6 | `uhp-redact.ts` | **5** | | C-M16 | `uhp-provider.ts` | **6** |
| C-M7 | `uhp-redact.ts` | **6** | | C-M17 | `uhp-gate.ts` | **17** |
| C-M8 | `uhp-provider.ts` | **5** | | C-M18 | `uhp-redact.ts` | **1** |
| C-M9 | `uhp-harnesses.ts` | **2** | | C-M19 | `uhp-redact.ts` | **1** |

### 4.3 The findings the campaign produced, which are the point of running it

Three passes. The first two were red in ways the suite could not see, and all three are recorded because
a campaign that only reports its final green is indistinguishable from one that was never run.

1. **`N3` killed zero on pass 1 — an uncovered behaviour.** The mixed-labelling test was being caught by a
   *different* guard (the ambiguity check), so the weakened mutant still refused it. The genuinely
   uncovered case was an observed side carrying a **requested-side** label, which under the weakened match
   claims the codex dialect and verifies. A test was added; `N3` now kills it.
2. **`N11` killed zero on pass 1 — a fixture-introduced second path, exactly as the brief predicts.** The
   absence assertion was made on a `refused` steer, and the predicate's verdict half refuses that anyway,
   so the mutant passed. The assertion moved onto a `delivered` result with no route, where nothing but
   the behaviour under test can decide it. The test says so in a comment so the next reader does not
   "simplify" it back.
3. **`N9` killed only the new assertion on pass 2 — a vacuous assertion in a test this run did not
   write.** `uhp-provider.test.ts`'s boundary test claims "nothing published carries a path, from **any**
   verb", but its mock returned one response id for every turn, so its steer was refused by the turn
   ledger as a repeated response *before* it observed a route. The four-verb fence was running its steer
   row over a result with no route in it — vacuous since it landed, and invisible until this run gave
   `steer` something to leak. The fixture now gives each turn its own id and the test asserts the
   precondition it had been assuming; `N9` then killed it too.

Also recorded: `N1`, `N5` and `N6` first failed to **compile** (`noUnusedLocals` / `noUnusedParameters`
catching the mutant rather than the suite catching the defect). A mutation a compiler refuses proves
nothing about test coverage, so all three were rewritten into forms a reviewer could plausibly wave
through.

---

## 5. Gates

| Gate | Result |
|---|---|
| `pnpm run build` | **green** (17 packages, `check:graph`, `check:lifecycle`, `check:links`, `check:forms`, `check:snapshots`, `check:compiled-policy`, `check:publish`, `check:label-registry`, `check:docs`, `check:skill`, `check:tutorial`) |
| `pnpm run test` | **green, exit 0**, 12 package suites, 0 fail; `@rickylabs/subagents` 451 pass |
| `node .llm/runs/contract-alignment--e38/mutations.mjs` | 32 mutations, every one kills ≥ 1 test, baseline and post-restore both 0 fail |
| `node .llm/runs/contract-alignment--e38/probe-published-0.3.0.mjs` | ran against the registry tarball; output in §3 |

**One environment caveat, recorded rather than worked around.** `pnpm run test` ends in
`scripts/check-installed-contracts.mjs`, which execs a sleeping probe fixture from `TMPDIR`. This host
mounts the default `/tmp` `noexec`, so the check reports
`check:installed failed at sleeping probe startup (requires executable TMPDIR)` unless `TMPDIR` points at
an executable filesystem. **This is true of the unmodified baseline** — it was measured there first — and
is not caused by this run. With `TMPDIR=<executable dir>` the whole suite is green and exits 0, and both
installed-contract checks report `"status":"PASS"` at version 0.4.0, protocol 1.

---

## 6. Acceptance against #287

| Scope item | State |
|---|---|
| `RunSource` unchanged, still the billing seam | **held.** `packages/contracts/src/runs.ts` untouched. |
| Transport identified via `RunRef.provider = "uhp"`, harness on `LaunchIdentity` | already true on `main`; nothing needed. |
| Lifecycle mapping `RunLiveness`, freshness invariant, Decision 9 `RunOutcome` | already delivered by S11 in `uhp-lifecycle.ts`; unchanged and re-verified by C-M14 (5 kills). |
| Widen `ObservedRepositoryRun.source` | **proposed, not applied** — breaking (§2.1). |
| Add a truthful `verification.basis` | **proposed, not applied** — breaking (§2.1). |
| Add an in-flight `execution.status` | **proposed, not applied** — breaking (§2.1). |
| Treat the three as one change | **held.** All three proposed together; no subset landed. |
| `SteerResult` gains route evidence of the shape `DispatchResult` carries | **applied**, additive. |
| S10's `RouteSource` UHP arm, model only, no label for effort/cwd/provider | **applied.** |
| `OBSERVED_SOURCES` dialect-keyed, `compareRouteIdentity` gains an **optional** dialect argument | **applied**, existing call sites untouched. |
| `isRouteEvidenceVerified` still rejects a codex label on a UHP route; no loosening to "any member of the union" | **applied and pinned** by two tests and by mutations N2 and N3. |
| S10's tripwire test updated deliberately, not deleted | **done.** `route.uhp.test.ts`'s "RouteSource — the UHP provenance defect, pinned" is now "the UHP provenance arm, and the guard it must not lose", with a comment saying what it replaced and why. |
| Adding the arm must not unblock certification; `isRouteEvidenceVerified` still false over UHP | **held, three independent ways**, each pinned by a test (§2.2 row 3e). |
| S10 owner fork §4 (`Harness.base` read as `provider`) ratified before a `provider` observation is populated | **not touched.** No `provider` observation is populated over UHP; `readUhpProvider` still returns `null`. The fork remains open and this run does not resolve it. |

---

## 7. What this run did not prove

- **Nothing about a live HarnessRouter.** No reachable instance, no container runtime on this host, none
  started or installed. Every UHP byte came from `uhp-mock.ts` over a loopback socket. The live
  round-trip is [#294](https://github.com/rickylabs/harness/issues/294) and is blocked; no claim here
  depends on it.
- **That a real server ever substitutes a model on a continuation turn.** Work item 2 closes a gap in
  *expressiveness*, on a reading of the specification's fallback semantics that is owner-certified and not
  independently re-derived. No observed failure motivated it.
- **That S10's unobservability reading is correct.** `provider`, `effort` and `cwd` having no UHP wire
  representation is S10's reading of the specification, owner-certified and not independently re-derived
  in this run. The three `null`s in the `uhp` row inherit exactly that status. If the reading is wrong,
  the row grows labels — and the null-source rule means nothing silently starts verifying in the
  meantime.
- **That Cockpit behaves as §2.1 describes.** That is quoted from the owner's comments on #287, not read
  from `rickylabs/atelier-cockpit` during this run.
- **Anything about publication.** No version, no protocol, no tag, no publish. #283 is the owner's.
