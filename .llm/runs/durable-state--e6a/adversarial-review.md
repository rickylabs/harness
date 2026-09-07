# Stage F/G independent evaluation — durable-state--e6a (issue #245)

**Verdict: `FAIL_FIX`**

Protocol direction is sound and the amendment's big corrections must stand. But §§B1/B4 as written contradict the owner contract on the two points the issue names explicitly, and §B2 admits a two-writer window. An implementer following the amendment literally would build the wrong API and a permanently wedged store. Same scope, fix the plan — no rescope, no new owner forks.

Parent attests planning-only tree; manifest lists only future paths. Taken as read — tools here permit source reading only, no shell/network. All citations below were retrieved this run.

## What to keep (amendment is right)

- A1 (no seal/truncate/read-only), A2 (no `durability: "reduced"` success), A4 (immutable `entry.<N>` via `link`), A8 (network volumes unsupported-boundary, not "refused by construction") — each matches #245 point 4 and `research-boundaries.md:13-18` (Node flags docs: exclusive creation may not be honoured on network filesystems; `fsync(2)` does not sync the directory entry).
- Predecessor-linked claims + `link(2)` `EEXIST` as the exclusivity primitive (§B1:57-67) — correct replacement for the draft's shared ledger race (drift.md:7).
- `at` outside all digests, `digest` reuse (`packages/coordinator/src/canonical.ts:26,82-84`; `packages/coordinator/src/journal.ts:18-20,34-35,56-57`), refusal union in `governance.ts:118-136` idiom, reducer purity (`packages/coordinator/src/record.ts:65-73`, `packages/coordinator/src/worktree.ts:365` boundary-injected `at`).

## Blocking findings (fix in plan, then re-evaluate)

**1. B1 auto-recovers inside open — violates the explicit-call contract. — plan-amendment.md:55-67 vs issue #245 point 1.**
Issue: "recovering from it is an explicit call rather than a timeout that quietly steals the lease"; "A second opener does not wait, retry, or win: it fails closed." B1 step 3 makes acquisition itself observe liveness (`kill(pid,0)` → `ESRCH` → successor `Gmax+1`), and step 5's only non-`held` path is `lost-race`. There is no `open` that reports a dead holder as a refusal and no separate `recover()` entry point — worse, §B1:62 states the acquirer "never accepts an observation supplied by its caller," which explicitly forbids the explicit-call shape. Normal open must refuse stale (`held`/`stale-lock` naming holder generation + identity); a separate explicit `recover()` (self-observing, same-host + `ESRCH` only, new higher generation, old claim retained) performs the advance. Binding correction: split §B1 into `open()` (never advances past a live *or* dead holder) and `recover()` (the only path that advances past death); keep the "same successor name, `link` admits exactly one" rule unchanged.

**2. Initialization deadlocks after crash-before-genesis — no reachable correct API. — plan-amendment.md:77-84 + D.7.**
B4: empty-history → `initialize()` explicit; missing-checkpoint-with-history → refuse `checkpoint-missing-with-history`; D.7: "`initialize()` is refused on any directory with history." Crash between first claim (`owner.<1>.claim`) and genesis checkpoint leaves history (a claim) with no checkpoint: every later open refuses missing-with-history, and `initialize()` refuses because history exists. Permanent wedge; generations burn forever with no forward path. Also underspecified what `open` returns on empty history (holding-uninitialised handle?). Binding correction: `initialize()` is permitted iff no `checkpoint` and no `entry.*` exist (claims/closed markers alone do not count as data history) **and** the caller holds the current generation; otherwise refused. Add gate: kill between claim and `initialize()`, then `open` → `initialize()` → legal genesis.

**3. B2 legalises one concurrent write — incompatible with "one writer, provably." — plan-amendment.md:69-72 vs issue #245 point 1.**
"Bounds the only residual ownership hazard … to at most one operation, and that operation is itself atomically published" still leaves two live holders with one durable entry each, permanently retained (no deletion, §B1:64-67). Check-before-publish re-read is TOCTOU: two holders can pass the re-read, then both `link` (same `entry.<N>` → one gets `sequence-taken`; different `N` views → both succeed and the journal forks). Binding correction: state the fork rule explicitly — fold ignores entries from superseded generations *or* refuses `generation-fork` on read, `sequence-taken` always revokes the loser, and the generation test asserts no two published entries from different live generations are both folded as authoritative. Do not ship "at most one" as the guarantee.

**4. Checkpoint cut can invent `unknown` despite a committed receipt. — plan-amendment.md:89-105 vs review-focus.md:8.**
B6's separate `terminal` / `pendingAtCheckpoint` types are good; B7's `receipt-after-orphan` refusal is good. Missing: the ordering rule that the fold replays entries after `checkpoint.lastEntry` **before** orphaning anything carried in `pendingAtCheckpoint`, and that checkpointed `terminal` is re-emitted by identity. As written, a literal implementation orphans at the cut, then trips `receipt-after-orphan` on legal data (or worse, reports `unknown` where a receipt committed one entry later). Binding correction: add "fold = checkpoint.terminal (identity) + settle pendingAtCheckpoint through entries `(lastEntry, ∞)` in sequence order; orphan only what remains receipt-less at a closed generation" plus a straddling-checkpoint gate (intent before cut, receipt after cut → `sent`, never `unknown`).

**5. IntentKey ownership inverts the publish boundary. — plan-amendment.md:24-27 vs Decision 4 of #30.**
A6 puts intent/receipt "types + constructors" in `packages/coordinator/src/journal.ts` (private) while `packages/contracts/src/state-store.ts` holds "the interface." But §§B5/B7's interface names `IntentKey`, `NonDeliveryProof`, `EffectStatus`. `contracts` is the published package (`packages/contracts/package.json:2,19-25`); `coordinator` is `private: true` (`packages/coordinator/package.json:6`) with "depends on no other workspace package" still stated at `packages/coordinator/src/record.ts:15-18` and `packages/coordinator/src/index.ts:10-14`. Contracts cannot import from coordinator. Binding correction: define `IntentKey` (full 5-tuple, #191 point 4), the status lattice, and the refusal union once in `contracts`; constructors/validators live in `coordinator`. Note `digest` is truncated 64-bit (`packages/coordinator/src/canonical.ts:21-26`) — full-tuple equality (already in §B7:103) must stay, digest as map index only.

**6. Wrong graph command + glob manifest. — plan-amendment.md:125,133.**
`§C` correctly cites `scripts/check-project-graph.mjs:5`, but `D.1` orders `pnpm run check:project-graph`, which does not exist. Root `package.json:13` defines `check:graph` (invoked by `build`, `:25`). Correction: `pnpm run check:graph`. Also `§C` lists `state-store*.ts` — a glob is not a bounded Stage-A surface; enumerate exact files.

## Non-blocking notes

- `docs/concepts/05-determinism.md:17-22` confirms the empty-board failure the corruption refusal guards against; `packages/contracts/src/server.ts:124-135` confirms transport reuse is untouched. Both cited correctly.
- `packages/coordinator/tsconfig.json:1-10` (no `references`) + `packages/README.md:57-59` (workspace dep mirrored as project reference) confirm the D2/C type-only wiring work is real; `verbatimModuleSyntax` + `tsc -b` (`packages/coordinator/package.json:29-30`, `tsconfig.base.json:19-21,25`) confirm the `@ts-expect-error` gate mechanism is available. D2's comment updates to `record.ts:16` / `index.ts:10` are correctly scoped.
- Deletion of FORK-1/FORK-2 is endorsed: explicit recovery and init reachability are #245's own contract, not new owner decisions. No new forks.

## Re-entry criteria

Re-submit with: (a) `open` vs `recover()` split per finding 1; (b) reachable `initialize()` precondition + crash-before-genesis gate per finding 2; (c) fork rule per finding 3; (d) checkpoint-cut replay rule + straddling gate per finding 4; (e) IntentKey owned by `contracts` per finding 5; (f) `check:graph` + enumerated manifest per finding 6. Then `PASS` / `PASS AFTER NARROW FIXES` is reachable without rescope.
