# dry-run-driver--e6c — adversarial review

# Independent adversarial PLAN EVALUATION — issue 253 dry-run-driver (complex matrix, Muse Spark 1.3 max, different family from Opus author)

**Verdict: `FAIL_FIX`**

Read-only session under `` (date: 2026-09-07): read `plan-amendment.md` (governing), `research.md`, `brief.md`, `supervisor.md`; `plan.md` treated as REJECTED history. Relevant product code read at the same root. No shell, writes, network, subagents. No execution claimed; no route attestation claimed. Heads `3eceb3a` / `fe278bc` taken as supplied, not independently verified here. Plan direction is sound; narrow textual corrections suffice — same author, return here.

## Blocking findings (fix in plan, then re-evaluate)

**1. `drove:false // zero entries` and "fails before attempt = zero entries" are false for store refusals after the first durable write.**
Plan states `drove:false` means `// zero entries` (`.llm/runs/dry-run-driver--e6c/plan-amendment.md:120-124` · driver outcome · 2026-09-07) and "anything that fails before the attempt produces … zero store entries" (`:9-12`). But `intent` precedes `attempt` in the plan's own order (`:52-58`), and the store's `publish` faults `publication-uncertain` after the link is durable (`packages/coordinator/src/state-store-fs.ts:119-128` · publication · 2026-09-07), a named refusal in the port union (`packages/contracts/src/state-store.ts:101-108` · refusals · 2026-09-07) that poisons the handle with no clean close. Correction: qualify the comment by failure stage — pre-`intent` refusals (source, admission, dispatch-inadmissible, route-unverified, executor-not-data) = zero entries; `store-refused` on `intent`/`receipt`/`checkpoint` = entries unknown, possible `publication-uncertain`, handle poisoned, reopen-and-fold required. Same correction to the `:11` summary sentence.

**2. "Negative receipt only when intent exists and no attempt has happened" contradicts the plan's own outcome table.**
Plan line 60 (`plan-amendment.md:60` · route gate · 2026-09-07) bars negative receipts after any attempt, yet lines 63-65 settle fake-`refused` (a post-attempt answer) as `delivered:false → unsent`, which is the correct rule (only an answered refusal licenses a negative record per `packages/subagents/src/provider.ts:259-271` · retry safety · 2026-09-07, via `proofFromReceipt` at `packages/coordinator/src/journal.ts:246-271`). Correction: reword to "pre-attempt refusals write no receipt; post-attempt `refused` settles negative; post-attempt `unknown`/malformed/`throws` writes no receipt."

**3. Admission reconstruction must state pending / already-settled / forked / blocked handling explicitly; reuse of `settle` itself is correct.**
Reuse is right: walk `prerequisites` in declaration order (`packages/coordinator/src/workflow.ts:92-107`), apply caller outcomes through real `settle` (`packages/coordinator/src/plan.ts:196-275`), finish with `admit` where transitive `ungated-effect` lives (`:118-181`, esp. `:154-166`), `parseCitation` as reference-only (`packages/coordinator/src/citation.ts:65-73`). No duplicated citation grammar — endorsed. Missing piece (`plan-amendment.md:39-47`): "start from empty … apply the recorded outcome" does not say pending prerequisites are carried as pending (no `settle` call), forked/blocked keep their own rules rather than collapsing to `needs-unmet`, the step-for-step equality in `:47` covers extra caller ids, and `dispatch-run`'s own prior state is checked via `admit`'s `already-settled` (`plan.ts:123-132`) before any assembly. Correction: add those four sentences; do not add a second citation checker.

**4. Explicit exclusions missing from the governing draft: no store-format change; protected issues untouched.**
Supervisor forbids store-format redesign and names protected `62,148,181,237,244` (`.llm/runs/dry-run-driver--e6c/supervisor.md:10` · scope · 2026-09-07); brief requires one rule per PR and unknowns-stay-unknown (`brief.md:51-56`). The amendment implies no schema change and touches no protected issue, but never states it (contrast REJECTED `plan.md:171-177`). Correction: add one commitment line — no edits to `contracts/state-store.ts` shapes, `journal.ts` intent/receipt constructors, or `state-store.ts` reducer; issues 62/148/181/237/244 untouched; one PR. No new owner fork is needed for this (live C waits for #62 per `plan-amendment.md:26`).

**5. Load-bearing marker gaps (narrow).**
Owner mandates source/topic/date markers dated 2026-09-07; parent DAG lines carry them (`plan-amendment.md:19-26`), but the D3 outcome table (`:61-69`), D5 snapshot/retry paragraph (`:86-88`), and interface block (`:97-126`) assert behavior without per-section markers. Correction: append the same `· source · topic · 2026-09-07` form to those three blocks. Also clarify D4 (`:71-72`): `body (non-empty)` is an offline GitHub observation, not the board projection, since board issues deliberately omit `body` (`packages/board/src/model.ts:39-46` · projection boundary · 2026-09-07).

## What is met (no change required)

- Ordering with route-last-before-intent, `compareRouteIdentity` + re-deriving `isRouteEvidenceVerified` (`route.ts:142-192`), fake two-phase prepare/attempt (`plan-amendment.md:50-60`).
- Key binds mode/source/lane/workflow/dispatch/cwd/provider/fake/admission with `mode:"dry-run"` in digest; branded `dry-run:` reference, never fake prose (`:71-84`, via `journal.ts:24,58`).
- `unknown`/malformed/`throws` → no receipt, pending → `unknown` on recovery defended by `receipt-after-orphan` (`state-store.ts:139-153`, esp. `:143,:151-153`; `contracts/state-store.ts:82-87`; `contracts/README.md:286-289`); malformed-input refusals via `OUTCOMES`/`readStates` asymmetry (`plan.ts:354,390-437`).
- Scope honesty on milestone scope (`state-store-memory.ts:71`; `state-store.ts:134`); sync snapshot before first await; no auto-retry (`:86-88`).
- Two real forked-child SIGKILL tests (assembly→intent with re-drive same key; attempt→receipt yielding `unknown` with sent/unsent controls + forged-pending refusal), idiom reused not imported (`state-store-crash.test.ts:38-49`; `state-store-test-helpers.ts:19-60`; `plan-amendment.md:137`).
- `detail` never persisted (paths in `route.ts:44-55`), `describeAdmission` only (`routing/admit.ts:522-538`); live parity explicitly unverified (`plan-amendment.md:153`, via `contracts/state-store.ts:116-119`); missing-citation existence stays `unknown` (`:48`).

Re-entry: apply findings 1–5 as plan-text edits only; no rescope, no new forks, no code yet.
