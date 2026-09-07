# plan-corrections.md — E6.A durable state store (issue #245)

**Binding. Supersedes `plan-amendment.md` wherever they conflict; both prior drafts are retained as rejected.** No tool ran and nothing here is executed or reported green; every gate is a gate to be run.

---

## 1. `open()` never advances; `recover()` is the only path past a holder

Split the entry points. **`open()`** reads the directory, finds the highest published `owner.<G>.claim`, and — whether the holder is live, dead, or unobservable — **refuses**: `held` when the internal observer sees the holder live, `stale-lock` when it sees it dead, `holder-liveness-unknown` otherwise. All three name the holder's generation and identity. `open()` never observes its way into an advance, never waits, never retries.

**`store.recover(expectedHolder)`** is the explicit call. The caller passes the holder it saw — generation and identity — as an *expectation to be checked*, not as evidence. `recover()` re-observes death itself with its internal observer, requires the current claim to still match `expectedHolder` exactly (else `holder-changed`), and only then publishes the successor. It never accepts a caller-supplied liveness verdict.

Exclusivity rests on identity the adapter owns: the claim records the adapter's own `process.pid`, a per-open `startToken`, and a host token, none of them caller-supplied. The internal observer returns `gone` **only** for a same-host claim whose `kill(pid, 0)` raises `ESRCH`; `EPERM`, success, a different host, or any other errno yields `unknown`, which refuses. No elapsed time is ever an input.

Successor publication is unchanged and stays the exclusivity primitive: every contender that observed the same predecessor publishes to the **same filename** `owner.<G+1>.claim` via `link`, and `EEXIST` yields `lost-race` with no advance to a further generation. The old claim is retained forever.

## 2. `initialize()` is reachable after a crash before genesis

`initialize()` is permitted **iff** no `checkpoint` and no `entry.*` exist — claim and closed-marker history alone are not data history — **and** the caller holds the current generation. So the wedge is gone: a crash between the first claim and genesis leaves claims but no entries, the next `recover()`/`open()` succeeds in taking a generation, and `initialize()` is legal.

Once any `entry.*` exists, a missing `checkpoint` refuses `checkpoint-missing-with-history`, permanently and with no override. Entries are **never compacted, trimmed or deleted**, which is what makes this safe: `initialize()` cannot erase data, because data being present is exactly what forbids it.

`open()` on an uninitialised directory that the caller now holds returns a handle in an explicit `uninitialised` state; reads and writes refuse until `initialize()` publishes genesis.

## 3. A generation fork is a named corruption refusal; entries are never ignored

The protocol admits **no two live holders**. Fencing — the re-read of the claim directory before every publication — is defence in depth, not a licence for one concurrent write, and the amendment's "at most one operation" framing is withdrawn.

If, despite that, the directory ever contains authoritative entries published under two generations that were not ordered by a closed marker or an observed death, the reader **refuses `generation-fork`**, naming both generations and the first divergent sequence. It does not ignore, prefer, or filter entries: ignoring entries is the silent data loss #245 point 4 forbids, wearing a different name.

`sequence-taken` on an entry `link` always revokes the losing handle immediately, and a revoked handle refuses everything thereafter.

## 4. The fold replays the whole tail before orphaning anything

`fold = checkpoint.terminal, re-emitted by identity` + `pendingAtCheckpoint`, settled by replaying **every** entry in `(checkpoint.lastEntry, ∞)` in sequence order, **before** any orphaning. Only what is still receipt-less at the end of the tail, under a generation that is closed, becomes terminal `unknown`.

An intent before the checkpoint cut whose receipt lands after it therefore folds to `sent`, never `unknown`. Chronological validation (no gaps, non-decreasing generations, receipt after its intent, no duplicate intent, no orphan receipt) runs before orphaning and refuses on failure. `receipt-after-orphan` remains, and now only fires on genuinely illegal data: an `unknown` sealed at the end of the tail can never be settled by a later-arriving receipt, and no receipt can be published into a closed generation.

## 5. `contracts` owns every public structural type; `coordinator` owns constructors

`packages/contracts/src/state-store.ts` defines, once: `IntentKey` (the full five-tuple of #191 point 4), `EffectStatus` (`sent | unsent | unknown`), `NonDeliveryProof`, `SessionPending`, the checkpoint and entry envelope shapes, and the refusal union — all `readonly`, in the `governance.ts:118-136` idiom. Nothing in `contracts` imports from `coordinator`; the private package is never a dependency of the published one.

Constructors and validators live in `coordinator`: the intent and receipt evidence constructors sit **beside `PersistedDecision`** in `packages/coordinator/src/journal.ts` (`:25`, `:56`), sharing its digest construction, and `proofFromReceipt` is the sole constructor of `NonDeliveryProof`. `coordinator` imports the contracts types type-only.

Key equality is **full-tuple**; `digest` (`canonical.ts:21-26`, truncated to 64 bits) is a map index only.

**`at` rationale, corrected.** `at` is outside every digest because the digest must identify the evidence, not the moment it was written — two folds of the same entries must agree. This is not a claim that reading changes a stored `at`; stored `at` is immutable, supplied by an injected clock at the boundary (`record.ts:65-73`, `worktree.ts:365`), and the reducer reads no clock at all.

## 6. Generation reuse, publication uncertainty, gates and the exact manifest

**Candidate versus published.** A generation number whose candidate was written but **never linked** was never published and never returned to a caller; that number may be reused by a later contender. A generation whose `owner.<G>.claim` is published is permanent and is never reused, never deleted.

**Publication errors after the mutating step.** A failure of the directory `fsync` *after* a successful `link` or `rename` means the write is **uncertain**, not absent. The adapter never returns a success-coded failure and never reports reduced durability: it returns a named `publication-uncertain` refusal and **poisons the handle** — every further write refuses until the handle is closed or ownership is recovered. Failures *before* the `link`/`rename` are definite non-publication.

**Close.** `close()` drains queued operations, marks the handle permanently closed so no write can follow, and only then publishes `owner.<G>.closed`, which is retained forever and is the sole clean predecessor for `G+1`.

**Command fix.** `pnpm run check:graph` (root `package.json:13`, invoked by `build` at `:25`). `check:project-graph` does not exist and is struck.

**Exact manifest** — no globs:

    packages/contracts/src/state-store.ts               port: public structural types + refusal union
    packages/contracts/src/index.ts                     export it
    packages/coordinator/src/state-store.ts             pure reducer/fold — no clock, no I/O
    packages/coordinator/src/state-store-fs.ts          local adapter: claims, entries, checkpoint
    packages/coordinator/src/state-store-memory.ts      in-memory driver behind the same port
    packages/coordinator/src/state-store-types.test.ts  @ts-expect-error impossibility gates
    packages/coordinator/src/state-store.test.ts        reducer, fold, chronology, orphaning
    packages/coordinator/src/state-store-fs.test.ts     ownership, init, corruption, fork
    packages/coordinator/src/state-store-crash.test.ts  real SIGKILL cases
    packages/coordinator/src/state-store-child.ts       crash fixture, spawned from dist
    packages/coordinator/src/state-store-test-helpers.ts  the single mkdtemp+cleanup helper
    packages/coordinator/src/journal.ts                 intent/receipt constructors beside PersistedDecision
    packages/coordinator/src/index.ts                   store exports; :10 dependency comment corrected
    packages/coordinator/src/record.ts                  :16 dependency comment corrected only
    packages/coordinator/package.json                   contracts as workspace:*
    packages/coordinator/tsconfig.json                  mirrored project reference
    pnpm-lock.yaml                                      that dependency only
    packages/README.md, packages/contracts/README.md, packages/coordinator/README.md  behaviour claims only
    .llm/runs/durable-state--e6a/                       run artifacts

**Test hygiene.** Every temporary directory comes from `state-store-test-helpers.ts`, which owns `mkdtemp` and its removal; no real home, no operational path, no host value, no time-sliding value. The clock is injected in every test.

**Added and amended gates** (to be run; none claimed green):

1. `open()` against a **dead** holder refuses `stale-lock` naming the holder and does not advance; `recover(expectedHolder)` then advances. `recover()` with a mismatched expectation refuses `holder-changed`.
2. N contenders on one observed predecessor race the **same** successor filename: exactly one wins, the rest refuse `lost-race`.
3. **Crash before genesis**: kill between claim publication and `initialize()`; reopen, recover, `initialize()` succeeds and produces a legal genesis. `initialize()` refuses when any `entry.*` or `checkpoint` exists.
4. **Straddling checkpoint cut**: intent before the cut, receipt after it → `sent`, never `unknown`; and a checkpointed `terminal` unknown is re-emitted by identity, with any later receipt for it refused `receipt-after-orphan`.
5. **Generation fork**: entries fabricated under two unordered generations → refuses `generation-fork` naming both and the first divergent sequence; no entry is dropped from the refusal's account. `sequence-taken` revokes the loser.
6. **Publication uncertainty**: an injected directory-sync fault after `link` and after `rename` each yields `publication-uncertain` and a poisoned handle whose next write refuses; a fault before the mutating step yields definite non-publication.
7. **Checkpoint-cut kills** and the four SIGKILL points from the amendment, unchanged, with the exit signal asserted.
8. `pnpm run build` (which runs `check:graph`) and `pnpm -r run test` exit 0.

Unchanged and still binding: no seal, no truncate, no compaction, no read-only-on-corruption; corruption of version, schema, digest or trailing garbage refuses open in checkpoint, entry, claim and closed marker; network volumes are an unsupported documented boundary, not a mechanism; no new owner forks — #191 F1 and F2 stay where they are.

## Coordinator clarification for re-evaluation

The opening phrase “open never advances” applies to an **unclosed holder**. A valid closed marker is a clean release: ordinary open may contest the single successor generation after that marker, without pretending the still-running former process is dead. A brand-new directory similarly contests generation 1. A dead but unclosed holder requires explicit recover, as section 1 requires. Open on a held uninitialised store returns no second handle; only the current owning handle may initialize. Runtime owner identity may be derived by the adapter and written only to the supplied store root; the public diff contains no actual host identity values. Host identity does not turn a network filesystem into a supported deployment.
