# dry-run-driver--e6c — binding plan corrections

# plan-corrections.md — E6.C (#253)

**Binding.** Supersedes the named clauses of `.llm/runs/dry-run-driver--e6c/plan-amendment.md` (· governing plan · 2026-09-07). Everything not named below stands unchanged. Planning only: nothing was executed, no route attested, no gate run. Date 2026-09-07.

---

## C1 — Refusal stages, and what a store refusal does *not* authorize

**Supersedes** `plan-amendment.md:9-12` and the `// zero entries` comment at `:120-124`.

Refusals are classified by stage, not by verdict:

- **Pre-`intent` refusals — `source-unusable`, `admission-failed`, `dispatch-inadmissible`, `route-unverified`, `executor-not-data`: zero store entries.** These are decidable before the first durable write and the driver asserts nothing was appended.
- **`store-refused` on `intent`, `receipt` or `checkpoint`: entries unknown.** The outcome may be `publication-uncertain` after the link is already durable (`packages/coordinator/src/state-store-fs.ts:119-128` · publication · 2026-09-07), which is a named member of the port's refusal union (`packages/contracts/src/state-store.ts:101-108` · refusals · 2026-09-07) and leaves the handle poisoned with no clean release (`packages/contracts/src/state-store.ts:110-123` · handle sealing · 2026-09-07). The truthful record is *unknown*, never *nothing happened*.

**A store refusal alone never authorizes reopening the store.** The driver does not call `recover` on the strength of an error. Two paths only, both the port's own:

1. the handle is closed cleanly and a fresh `open()` is attempted (`packages/contracts/src/state-store.ts:124-129` · acquisition · 2026-09-07); or
2. the previous owner's **death has been established by the adapter**, and recovery is invoked explicitly with the expected holder identity, which the port checks (`packages/coordinator/src/state-store-memory.ts:22-26` · holder identity · 2026-09-07).

A live or poisoned owner is refused (`held`, `revoked`, `poisoned`), and the driver surfaces that refusal. **No auto-recovery, no auto-retry, no re-drive.** Re-driving is a caller decision under a new attempt number; the key derivation in D4 makes that a different key.

## C2 — Negative receipts are post-attempt and definitive

**Supersedes** `plan-amendment.md:60`.

Replacement rule, in three clauses:

- **Pre-attempt refusals write no receipt at all.** Route `mismatch`/`unknown` and every other pre-`intent` refusal stop before the attempt; the attempt phase is provably not entered.
- **Post-attempt `refused` settles negative.** The fake's `refused` contract means **definitive non-delivery**: the executor was reached, answered no, and no useful work was sent. It is not a generic negative or a stand-in for failure. This is the only outcome that licenses a negative record (`packages/subagents/src/provider.ts:259-271` · retry safety · 2026-09-07), and the branded proof is built by `proofFromReceipt` from the validated receipt (`packages/coordinator/src/journal.ts:246-271` · non-delivery proof · 2026-09-07).
- **Post-attempt `unknown`, malformed or `throws` writes no receipt.** The intent stays pending; recovery yields terminal `unknown` (`packages/coordinator/src/state-store.ts:151-153` · orphan close · 2026-09-07), defended by `receipt-after-orphan` (`packages/coordinator/src/state-store.ts:143` · orphan defence · 2026-09-07).

## C3 — Admission reconstruction: order of the two passes

**Supersedes** `plan-amendment.md:39-47`.

`admissibleDispatch` runs two passes over the caller's states, in this order:

1. **Terminal propagation on the original validated shapes.** Before any reconstruction, run `admit(MILESTONE_WORKFLOW, states, "dispatch-run")` on the caller's states as given (`packages/coordinator/src/plan.ts:118-181` · admission rules · 2026-09-07). This is what surfaces `upstream-forked` and `upstream-blocked` with the halting step's own note (`packages/coordinator/src/plan.ts:134-152` · terminal propagation · 2026-09-07) rather than collapsing them into `needs-unmet`, and it is what catches `dispatch-run`'s own prior state as `already-settled` (`packages/coordinator/src/plan.ts:123-132` · own state · 2026-09-07). A refusal here ends the call; nothing is replayed.
2. **Evidence replay of the `done` prerequisites only.** Walk `prerequisites` in declaration order (`packages/coordinator/src/workflow.ts:92-107` · prerequisite order · 2026-09-07) and apply each `done` outcome through the real `settle` (`packages/coordinator/src/plan.ts:196-275` · evidence enforcement · 2026-09-07). **Pending prerequisites are carried as pending with no `settle` call** — a pending step has nothing to prove. **Forked and blocked prerequisites are not replayed either**; pass 1 already ruled on them, and re-applying them would ask `settle` to accept states pass 1 has already refused. Nothing downstream of the step and nothing in an invalid future state is replayed.

Then: the replayed `done` set must equal the caller's `done` set step for step, and the caller's own recorded state for each pending prerequisite is preserved unchanged. Finally re-run `admit` on the reconstructed states and require `admitted: true`.

**Helper scope, narrowed.** The helper accepts only `MILESTONE_WORKFLOW` and runs `checkWorkflow` on it first (`packages/coordinator/src/workflow.ts:120-173` · workflow shape · 2026-09-07). Across the **full** caller state, ids not belonging to the workflow, duplicate ids, and outcomes outside the four are rejected (`packages/coordinator/src/plan.ts:354` · outcome vocabulary · 2026-09-07). **Pending states for downstream steps are permitted** — they are the normal shape of a partly-run workflow. No second citation checker is introduced; `parseCitation` remains reference-only and asserts nothing about existence (`packages/coordinator/src/citation.ts:65-73` · citation purity · 2026-09-07).

## C4 — Standing commitments

Added to `plan-amendment.md`. No change to the shapes in `packages/contracts/src/state-store.ts`, to the intent/receipt constructors in `packages/coordinator/src/journal.ts:222-244`, or to the reducer in `packages/coordinator/src/state-store.ts:114-156`. Issues 62, 148, 181, 237 and 244 are untouched. One rule, one PR. Evidence not gathered stays `unknown`. No new owner fork; live C is filed only after #62 lands.

## C5 — Marker and source corrections

The D3 outcome table (`plan-amendment.md:61-69`), the D5 snapshot/retry paragraph (`:86-88`) and the interface block (`:97-126`) each carry the marker form used here. D4's `body (non-empty)` (`:71-72`) is an **offline GitHub observation supplied by the caller**, not a board projection value: `SourceIssue` omits issue bodies deliberately (`packages/board/src/model.ts:39-46` · projection boundary · 2026-09-07). `url` likewise remains offline metadata, unattested.

## Test requirements added

- **Failure after the intent is durable.** A store fault raised on `receipt` leaves the terminal state unresolved; the driver reports `store-refused` with entries unknown, and does not reopen or retry.
- **Uncertain publication.** A simulated `publication-uncertain` on `intent` yields no acknowledgement, no attempt, and a poisoned handle; the only permitted continuation is explicit recovery after established death, asserted to refuse while the holder is live.
- **Acknowledgement ordering.** No success is returned to the caller before the receipt is durable; a test asserts the acknowledgement follows the durable write, per `packages/contracts/src/state-store.ts:116-119` · write ordering · 2026-09-07.