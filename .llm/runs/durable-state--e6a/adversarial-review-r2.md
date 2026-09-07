# Stage F/G final verdict — durable-state--e6a

**Verdict: `PASS AFTER NARROW FIXES`**

`plan-corrections.md` is binding and addresses all six prior blockers. Do not implement either prior draft. The protocol is now sound modulo the bounded corrections below. No new owner forks were invented; #191 F1/F2 stay where they are.

## Audit against the six findings

1. **Explicit stale recovery — fixed.** §1: `open()` refuses `held` / `stale-lock` / `holder-liveness-unknown` naming holder, never advances on an unclosed holder; `store.recover(expectedHolder)` is the sole advance path, re-observes death itself, checks exact expectation (`holder-changed` otherwise). Identity (pid, per-open `startToken`, host token) is adapter-owned, `gone` only on same-host `ESRCH`, no elapsed-time input. Coordinator clarification correctly scopes "open never advances" to unclosed holders: clean `closed` marker and brand-new directory are ordinary contention for the single successor via same-filename `link`, `EEXIST` → `lost-race`. Gate 1 asserts it.
2. **Genesis reachability — fixed.** §2: `initialize()` iff no `checkpoint` and no `entry.*` (claims/markers alone are not data history) and caller holds current generation; uninitialised handle is explicit, reads/writes refuse until genesis; crash-before-genesis → `recover()` → `initialize()` succeeds (gate 3). Entries never compacted/trimmed/deleted, so the `checkpoint-missing-with-history` permanence in §2 is safe.
3. **Fork handling — fixed.** §3 withdraws "at most one operation": no two live holders admitted, fencing is defence-in-depth, `sequence-taken` revokes immediately, and a two-generation divergence refuses `generation-fork` naming both generations and first divergent sequence — never ignore/filter. Gate 5 asserts it.
4. **Checkpoint cut — fixed.** §4: fold = checkpoint `terminal` by identity + `pendingAtCheckpoint` settled by replaying **every** entry in `(lastEntry, ∞)` in order **before** any orphaning; chronology validated first; straddling intent→receipt folds `sent`; `receipt-after-orphan` only on genuinely illegal data plus no receipts into closed generations. Gate 4 asserts it.
5. **Type boundary — fixed.** §5: `contracts/src/state-store.ts` owns `IntentKey` (full five-tuple), `EffectStatus`, `NonDeliveryProof`, `SessionPending`, envelope shapes, refusal union (`governance.ts:118-136` idiom); nothing in `contracts` imports from `coordinator`; constructors/validators beside `PersistedDecision` (`journal.ts:25,56`); full-tuple equality, `digest` (`canonical.ts:21-26`, 64-bit) as index only; `at` rationale corrected (immutable stored value, injected clock per `record.ts:65-73` / `worktree.ts:365`, reducer reads no clock).
6. **Generations, uncertainty, manifest — fixed.** §6: candidate-never-linked ≠ published (reusable number, never returned); published claim permanent, never reused/deleted; post-`link`/`rename` dir-sync failure → `publication-uncertain` + poisoned handle, never success-coded, never reduced-durability; pre-mutation failure = definite non-publication; `close()` drains, seals handle, then publishes retained `closed` as sole clean predecessor. Command struck to `pnpm run check:graph`. Manifest is exact, no globs; single `mkdtemp` helper; injected clock.

## Remaining bounded corrections (implement alongside, no re-plan)

1. **Failed-open side effect:** `open` publishes a successor claim *before* data classification, so an open that then refuses (corrupt checkpoint/entry, `journal-gap`, `generation-fork`) still leaves a burnt claim. State explicitly that refused opens may leave one retained claim and that correctness never depends on its absence; or validate read-only (claims, checkpoint, entries) before publishing. Either sentence suffices — but one of them must be in the plan.
2. **`close()` after `publication-uncertain`:** forbid `close()` from publishing `owner.<G>.closed` while the handle is poisoned (close the handle locally, no clean predecessor), otherwise an uncertain write becomes a "clean" predecessor. One-line rule plus a gate asserting it.
3. **`startToken` source:** §1 makes it adapter-owned and non-caller-supplied; state it is injected (test fake) / OS-derived at runtime, outside any digest, so tests stay deterministic with no host values in the diff — consistent with §6 test hygiene and the clarification's host-identity rule.

Subject to those three lines plus their gate assertions, the plan is implementable as written.

