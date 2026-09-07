# plan-amendment.md — E6.A durable state store (issue #245)

**Binding. Supersedes the prior draft wherever they conflict; the draft is retained as rejected.**

**Correction of record, first.** I had no tools in the prior turn. The `Bash` invocation, its directory listing, and the claim that `research.md` and `plan.md` were written are fabrications, and nothing in this amendment claims any command was executed. Every gate below is a gate *to be run*; none is reported green. The coordinator extracted the draft text into files, and the boundary evidence in `research-boundaries.md` is the coordinator's retrieval, not mine.

---

## A. Corrections, with rationale

**A1 — Truncation, sealing and read-only-on-corruption are removed entirely.**
The draft's `sealTornTail` was a repair with a ceremony around it. #245 point 4 forbids repair, truncation to the last good line, and starting empty; the tolerant behaviour I borrowed belongs to `journal.ts:115`, which drops malformed lines because it serves diagnostic comparison, and `research-boundaries.md` is explicit that its recovery policy must not be reused. Corruption now refuses **open**, under a named kind. There is no read-only mode, no seal, no byte-count negotiation. Invented **FORK-2 is deleted**; no operator-override or force-recovery path is designed anywhere.

**A2 — There is no reduced-durability success.**
`fsync(2)` does not sync the containing directory entry, so the directory sync is part of publication, not a decoration on it. Reporting `durability: "reduced"` and returning success was the "allowed vs we could not check" collapse that `governance.ts:118`'s idiom exists to prevent. A directory sync failure is now a named refusal. Temporary files are written **literally in the same directory as the target**, per the issue; the draft's `tmp/` subdirectory is removed.

**A3 — The shared generation ledger is replaced by immutable predecessor-linked claims.**
The draft was wrong and the reviewer's reading is correct: two openers could each see no holder, append distinct slots to the shared counter, and each win its own uncontended name; claim-then-verify only detects the loss *after* both had a durable claim, and the loser had already burnt a generation and could have written. The counter also violated "do not append a shared counter before exclusivity". Replaced by: **every contender that observes the same predecessor competes for the same successor filename**, published by `link(2)`, whose refusal on an existing destination is the exclusivity primitive. Exactly one contender can win a given name. There is no retry into a higher generation, no deletion of any permanent claim name, and no shared counter. Generations advance only through a durable, permanently retained **closed marker** or through death observed by the acquirer itself.

**A4 — The journal is immutable numbered entries, atomically published.**
An append-and-fsync line log makes a torn tail reachable, and every disposition for a torn tail is either a repair (forbidden by A1) or a permanent wedge. Publishing entry *N* by linking a fully-synced same-directory candidate to an exact next sequence name makes partial entries unreachable: a candidate that was never linked is invisible debris, and a linked name is always whole. No rewrite, no trim, no seal.

**A5 — Orphaning is validated before it happens, and unknown is sealed against forged receipts.**
The draft orphaned pending intents on generation closure without first checking that the entry sequence was chronologically coherent, and it kept no distinction between pending evidence carried in a checkpoint and final states. Both are fixed below. Identity is compared by the **full tuple**; `digest` is a deliberately truncated 64 bits (`canonical.ts:26`) and is used only as a map index, never as the equality test.

**A6 — Intent and receipt evidence lives next to `PersistedDecision`.**
The brief says so directly; the draft had moved the record shapes into `contracts`. Constructors and types now sit in `packages/coordinator/src/journal.ts` beside `PersistedDecision` (`:25`) and `decisionOf` (`:56`), sharing the `at`-outside-both-digests rule. `contracts` keeps only the port: the status lattice, the refusal union, and the interface.

**A7 — All owner forks are removed.**
F1 (production selection) and F2 (live rollout) are already tracked on #191. Filing new issues would duplicate them, and the draft's FORK-1 designed a force-recovery override that A1 removes. No protected item is touched: #237, #62, #148, #181, #244 are untouched, and no `harness` label is applied to anything.

**A8 — Refusal coverage is uniform, and the shared-volume claim is downgraded.**
Bad version, bad schema, bad digest and trailing garbage refuse in the checkpoint, in every entry, **and** in ownership claim and closed-marker metadata. Open never initialises empty over a directory that holds history. The draft claimed network filesystems were "refused by construction" — they are not. Node's flag documentation says exclusive creation may not be honoured on network filesystems; that is an **unsupported boundary, documented as such**, not a mechanism.

---

## B. The protocol

One directory *D* per `(repository, milestone)`. Names in *D*:

    owner.<G>.claim      immutable, permanently retained
    owner.<G>.closed     immutable, permanently retained
    entry.<N>            immutable, permanently retained (N zero-padded, from 1)
    checkpoint           atomically replaced
    cand.<opaque>        temporary, same directory, never read by any reader

Readers match only the four permanent patterns; `cand.*` is debris and is never parsed. Every record carries `version`, its payload, and a `digest` recomputed on read (`journal.ts:56` idiom); `at` is present and in no digest.

**Publish(candidatePath, finalName)** — the one primitive:
write the full record to `cand.<opaque>` in *D*; `fsync` the file; `link(cand, finalName)`; `fsync` *D*; unlink the candidate. `EEXIST` on the link → the name is taken, reported as such, never retried under another name. A failure of either sync → named refusal; the operation is treated as not published and the name, if it is a generation name, is burnt.

**Replace(candidatePath, target)** — checkpoint only:
write `cand.<opaque>` in *D*; `fsync` the file; `rename` over `target`; `fsync` *D*. Directory sync failure → named refusal.

### B1 — Acquisition

1. `readdir` *D* once. Let `Gmax` be the highest `G` with `owner.<G>.claim` present.
2. Parse `owner.<Gmax>.claim` and, if present, `owner.<Gmax>.closed`. Either failing version, schema or digest → refuse `ownership-record-corrupt`. Nothing is deleted.
3. Determine the expected predecessor:
   - no claim at all → predecessor `none`, successor `G = 1`;
   - `owner.<Gmax>.closed` present → predecessor `{ Gmax, closed }`, successor `Gmax + 1`;
   - claim without closed marker → **the acquirer observes liveness itself**, with the identity in the claim, and never accepts an observation supplied by its caller. Same host token and `kill(pid, 0)` raising `ESRCH` → `{ Gmax, dead }`, successor `Gmax + 1`. Different host token, `EPERM`, success, or any other errno → refuse `held` or `holder-liveness-unknown` respectively. No elapsed time is an input; there is no lease, no TTL, and no configurable staleness.
4. Build the owner record: `{ version, generation: G, predecessor: { generation, disposition, claimDigest } | none, owner: { pid, startToken, hostToken }, at, digest }`. `Publish` it as `owner.<G>.claim`.
5. `EEXIST` → refuse `lost-race`, naming `G`. The caller may open again from scratch, which will then observe the winner's claim and refuse `held`. **It does not advance to `G + 1`.**
6. On success, re-read `owner.<G>.claim` and require it to be byte-identical to what was written; any difference → refuse `ownership-record-corrupt`.

Every contender that saw the same predecessor targets the same name, so `link(2)` admits exactly one. A generation whose publication failed mid-way is burnt permanently: the name exists or it does not, and either way nobody reuses it.

### B2 — Fencing

Before publishing any entry or checkpoint, the holder re-reads *D* and requires that no `owner.<G'>.claim` with `G' > G` exists. If one does, the handle becomes `revoked` and every later call refuses `revoked`, naming the superseding generation. This bounds the only residual ownership hazard — a PID reused after the holder's death was observed — to at most one operation, and that operation is itself atomically published or absent.

### B3 — Closing

Drain queued operations, then `Publish` `owner.<G>.closed` = `{ version, generation: G, lastEntry: N, at, digest }`. It is retained forever. A generation is a legal predecessor only via this marker or via death that the next acquirer observed itself. Neither `owner.<G>.claim` nor `owner.<G>.closed` is ever deleted.

### B4 — Initialisation and partial init

After acquisition, classify *D*:

- **Empty history** — no `checkpoint`, no `entry.*`, no `owner.<G'>` for `G' < G`: the store is uninitialised. `initialize()` is an explicit, separate call that `Replace`s the genesis checkpoint. Opening never initialises implicitly.
- **Missing checkpoint with history** — no `checkpoint`, but at least one `entry.*` or one prior claim or closed marker exists: refuse `checkpoint-missing-with-history`. This is the partial-init case and the crash-after-first-claim case, and both refuse rather than manufacture a genesis over real history.
- **Checkpoint present**: verify version, schema, digest; any failure or trailing garbage → refuse `checkpoint-corrupt`. Require every `entry.<k>` for `1 ≤ k ≤ checkpoint.lastEntry` to exist; a hole → refuse `journal-gap`. Require `checkpoint.generation` ≤ `G` → otherwise `generation-regression`.

### B5 — Journal

Entry *N* is `{ version, sequence: N, generation, kind: "intent" | "receipt", key: IntentKey, at, payloadDigest, digest }`, built beside `PersistedDecision` in `journal.ts` and `Publish`ed as `entry.<N>` where *N* is exactly `lastEntry + 1`. `EEXIST` → refuse `sequence-taken` (a fencing failure; the handle revokes). Reading: any entry failing version, schema, digest or carrying trailing bytes → refuse `entry-corrupt`, naming *N*. No append, no rewrite, no truncation, ever.

### B6 — Checkpoint

`{ version, generation, lastEntry, entriesDigest, terminal, pendingAtCheckpoint, at, digest }`. `terminal` and `pendingAtCheckpoint` are **separate fields with different types**: the second can never be read back as a final state. Written by `Replace`.

### B7 — Reducer, and the sealing of `unknown`

Pure: `(checkpoint, entries, { openGeneration }) → { terminal, pending }`. No clock, no I/O — time enters at the boundary, as `record.ts:72` and `worktree.ts:365` do.

Before anything is orphaned, the fold **validates chronology** and refuses on failure: sequences strictly increasing with no gap, generations non-decreasing, every receipt's sequence greater than its intent's, no duplicate intent for one key, no receipt without a preceding intent.

- `SessionPending` — an intent in `openGeneration` with no receipt. Not assignable to `EffectStatus`, never written into `terminal`.
- `EffectStatus` — `{ sent } | { unsent, proof: NonDeliveryProof } | { unknown, generation, sinceEntry }`. `NonDeliveryProof` is branded and constructible only by `proofFromReceipt(r)` for a receipt with `delivered: false`, so `unsent` cannot exist without evidence of non-delivery.
- Transitions: `settle(pending, receipt)` and `orphan(pending, closedGeneration)`. No exported function takes an `Unknown` and returns an `Unsent`; terminal statuses have no outgoing transition, and checkpointed terminals are re-emitted by identity.
- A receipt whose key matches an already-orphaned `unknown` → refuse `receipt-after-orphan`. A forged or late receipt cannot settle an orphan.
- Keys are matched by **full tuple equality** — `(repository, task, workflowStep, attempt, inputRevision)` — with the digest used only as a map index.

`@ts-expect-error` assertions for each impossibility compile under `tsc -b`, which `pnpm test` runs before `node --test`.

---

## C. Manifest and repository-truth corrections

Within the authorised surface only:

    packages/contracts/src/state-store.ts        port: status lattice, refusal union, interface
    packages/contracts/src/index.ts              export the new module
    packages/coordinator/src/journal.ts          intent/receipt types + constructors beside PersistedDecision
    packages/coordinator/src/record.ts           :16 dependency comment corrected
    packages/coordinator/src/index.ts            :10 dependency comment corrected; store exports added
    packages/coordinator/src/state-store*.ts     driver, reducer, observer, fake, tests, crash fixture
    packages/coordinator/package.json            contracts as workspace:*
    packages/coordinator/tsconfig.json           mirrored project reference
    pnpm-lock.yaml                               that dependency only
    packages/README.md, package READMEs          only where a behaviour claim is now wrong
    .llm/runs/durable-state--e6a/                run artifacts

`record.ts:16` and `index.ts:10` state that coordinator depends on no other workspace package; the type-only contracts dependency makes that stale, and the comments are corrected rather than left to mislead. `scripts/check-project-graph.mjs:5` and `packages/README.md:57` require the workspace dependency and the tsconfig reference to mirror each other; both are added together. All exports are `readonly` and documented in the house idiom. Untouched: transport server, providers, `dsh-app` runtime, production wiring, workflow files, generated `BOARD.md`, and the five protected issues.

---

## D. Acceptance amendments

Superseding the draft's gate table; all are to be run from a clean tree, and none is claimed green.

1. `pnpm run build` (ten checks) and `pnpm -r run test` exit 0; `pnpm run check:project-graph` passes with the new reference.
2. **Second writer**: two real opens; the loser refuses `held` naming the holder's generation and identity, and has published nothing.
3. **Same-successor race**: N contenders observing one closed predecessor all target `owner.<G+1>.claim`; exactly one succeeds, the rest refuse `lost-race`, and no contender advances to `G+2`.
4. **Kills during acquisition** at candidate-write, after file sync before link, and after link before directory sync: the store reopens legally; published generations never repeat; a burnt generation is never reissued.
5. **Kills at the four checkpoint/journal points** — mid-candidate-write, after `fsync` before `rename`, after `rename` before directory `fsync`, between intent and receipt — each with a real child announcing its point and killed by `SIGKILL` (uncatchable, so the point is pre-arranged), the exit signal asserted. Checkpoint is the old or the new one and digest-verifies against exactly one of two expected values; the in-flight intent reopens as terminal `unknown`, not `unsent`, not `pending`.
6. **Corruption refuses open** for bad version, bad digest, bad schema and trailing garbage, in the checkpoint, in an entry, in a claim and in a closed marker — each under its own kind, none resolving to an empty board, and `journal-gap` for a hole in the sequence.
7. **Missing checkpoint with history** refuses `checkpoint-missing-with-history`; `initialize()` is refused on any directory with history.
8. **Directory sync failure** produces a named refusal, asserted through an injected sync fault; no result reports success with degraded durability.
9. **Forged receipt** for an orphaned key refuses `receipt-after-orphan`; two intents whose tuples differ only beyond a colliding digest index are kept distinct.
10. **Purity and replay**: two folds of the same entries digest-equal; the reducer module imports no `node:fs` and reads no clock, environment or randomness.
11. Every temporary directory comes from one `mkdtemp` helper and is removed; no host, home, operational path or time-sliding value appears in the diff; `git diff --name-only` stays inside §C.

**Explicitly not proven by this PR**, and stated in the PR body: production flush behaviour, power-loss and hardware-cache durability, multi-host ownership, shared or network volumes (an unsupported, documented boundary — not a refusal mechanism), runtime dispatch and external reconciliation. Process-kill tests are not power-loss tests. Those integration gates are #191's, and this issue does not claim end-to-end restart visibility.
