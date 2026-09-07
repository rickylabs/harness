# plan.md — E6.A durable state store (issue #245)

**Status: draft for Stage F/G. No mutation of the world is permitted until `plan-eval.md`
reads `PASS` [WORKFLOW §G].** No labels, no issues, no code until then.

---

## 0. Summary

Ship three things and nothing else:

1. **A port** in the published `contracts` package: the store interface, the intent/receipt/
   checkpoint record shapes, and every refusal named as data in one discriminated union, in the
   idiom of `governance.ts`.
2. **A local filesystem driver** in `coordinator`, Node-only, no dependencies: ownership by
   generation-stamped hardlink claim over an append-only fixed-width generation ledger; checkpoint
   by temp→fsync→rename→dir-fsync; journal by whole-line append with fsync.
3. **A pure reducer**: `(checkpoint, entries) → state`, no clock, no I/O, in which `unknown` is
   terminal and *structurally* cannot become `unsent`.

The two load-bearing algorithms are stated below as algorithms, not as filesystem promises. Every
filesystem semantic they depend on is spike **S1** (research.md R10) and is discharged by an
executable test in §6, not by argument.

Three things this plan refuses to do, all of them boundaries from the issue: it does not choose a
production store (#191 F1), it does not dispatch, and it does not touch the transport, findings 5
and 6, or a live canary.

---

## 1. Decisions

Each is numbered, with the alternative rejected [WORKFLOW §E].

### D1 — The port lives in `contracts/src/state-store.ts`; the driver lives in `coordinator/src/store/`

The issue's first acceptance item asks for a port in `contracts` with failure kinds as data and "a
local filesystem implementation behind it". `contracts` is the published package (S9:19-22, S12:25)
and Decision 4 of #30 makes that publication load-bearing (S1:100-106). A port is a type; a driver
opens files.

*Rejected:* putting the driver in `contracts`. It would put `node:fs` behaviour into a package whose
job is types and wire shape, and would ship an operational implementation to every external
consumer of a published protocol.
*Rejected:* a new `packages/state` package. Real cost (root tsconfig references, workspace wiring,
a README, an owning epic) for no boundary that D1 does not already draw; `coordinator` is E6's and
#245 is `epic:e6` (S12:23).

### D2 — `coordinator` gains a **type-only** dependency on `contracts`

`coordinator` today has no workspace dependency and no tsconfig `references` (S10, S11:1-10), and
`record.ts` states the property explicitly (S6:11-19). Read precisely, the property defended there
is a *runtime* coupling — the paragraph's argument is that the telemetry boundary is "one line of
JSON on a pipe … a structural shape, not an import". Every import added here is `import type`,
erased under `verbatimModuleSyntax` (S12:53-56), so the emitted `dist/` gains no `require`/`import`
of contracts. The dependency is declared `workspace:*` **and** mirrored as a tsconfig project
reference, per the stated convention (S12:57-59), and `packages/coordinator/package.json` keeps
`private: true`.

*Rejected:* duplicating the port's types inside `coordinator`. Two copies of a published contract
drift silently — the exact failure `replay.ts` guards against by keeping writer and replayer ten
lines apart (S7:93-98).
*Rejected:* moving the driver into `contracts` to avoid the edge (see D1).
**This is a structural change to a stated package property and is called out in the PR body.** If
the owner reads S6:11-19 as a compile-time claim too, the fallback is the rejected duplication or a
`packages/state` package, and the fork is cheap to reverse because it is one `import type` line per
file.

### D3 — Reuse `canonical.ts` for every digest; introduce no second hashing scheme

`canonicalJson` and `digest` already give one byte sequence per value with sorted keys and
order-preserving arrays (S5:36-84). The store's checkpoint digest, journal entry digests and
intent-key digest all go through `digest` (S5:82-84).

*Rejected:* `JSON.stringify` + `createHash` locally. S5:5-8 documents precisely why that produces
false drift.
*Consequence:* the driver lives in `coordinator`, where `canonical.ts` is, which independently
supports D1.

### D4 — `at` is in every entry and in **no** digest

Copied verbatim from `journal.ts` (S4:34-35, and the rationale at S4:18-20). Applies to intent
records, receipt records, the checkpoint envelope and the owner record: reopening the same store
twice must recompute the same digest, or the corruption check (D8) fires on healthy data.

*Rejected:* including `at` for tamper-evidence. It converts every reopen into a false corruption
report, which is the "cries wolf, switched off within a week" failure of S5:5-8.

### D5 — Scope boundary: one local filesystem, one host

The store is correct for concurrent processes on **one host** against a **local** filesystem. The
owner record carries an injected opaque host token; a holder whose host token differs from the
opener's is **never** observed as gone (D6), so a shared or network filesystem degrades to "always
refuse", never to "two writers".

*Rejected:* claiming network-filesystem correctness. `O_EXCL` and `link` semantics over NFS/SMB are
not established by any supplied source (research.md R10) and asserting them would be a claim
without a citation (S3:19-23).
*Rejected:* silently allowing cross-host recovery. That is the two-writer bug wearing a hat.

### D6 — Liveness is a three-valued **observation**, and only `gone` unlocks recovery. A timeout is never evidence.

`LivenessObservation` = `{ kind: "live" } | { kind: "gone", because } | { kind: "unknown", because }`,
supplied by an injected `ProcessObserver` port (clock-injection idiom, S6:65-73). The default local
observer:

- holder's host token ≠ this host's token → **`unknown`** ("different host");
- `process.kill(pid, 0)` throws `ESRCH` → **`gone`** (no process with that pid exists now);
- returns, or throws `EPERM` → **`live`** (some process exists; it may be a pid reuse — we
  conservatively refuse rather than guess);
- anything else → **`unknown`**.

There is **no** elapsed-time input to this function. The store has no heartbeat, no lease
expiry, and no `staleAfterMs` option — an option that exists will eventually be set.

*Rejected:* a lease TTL with silent steal. The issue names it: "a stale lock … recovering from it
is an explicit call rather than a timeout that quietly steals the lease." A hung holder and a dead
holder look identical to a clock.
*Rejected:* collapsing `unknown` into `gone`. That is R4's "allowed vs we could not check"
(S8:16-27) at the ownership layer, with two live writers as the payout.

### D7 — Ownership: a monotonic generation ledger plus a generation-stamped claim file

State layout under `<root>/<slug(repository, milestone)>/`:

    generations.log      append-only, fixed-width records, one slot per generation ever begun
    owner.<G>.json       the claim for generation G — created by link(), never by write-in-place
    checkpoint.json      atomically replaced
    journal.jsonl        append-only
    tmp/                 temp files, same filesystem, same directory tree; debris is never read

**Generation is derived from the ledger's byte length, not from its contents.** Each record is
exactly `RECORD_BYTES` (a fixed-width, zero-padded ASCII line carrying the generation number and a
short digest of it). Therefore:

    nextGeneration = ceil(size(generations.log) / RECORD_BYTES) + 1

A record begun and torn by a kill still consumes its slot, so the generation it *might* have
claimed can never be reissued. The last fully-parsed record must equal its own slot index; a
mismatch is `generation-ledger-corrupt` and refuses. This is the answer to *kill during
acquisition*: the ledger is extended and fsynced **before** any claim file is created, so the worst
outcome of a kill at any point in acquisition is a burnt generation number, never a reused one.

**Acquire(recover: false):**
1. Scan for the highest `G` with `owner.<G>.json` present. If one exists → read it; readable →
   refuse `held` naming the holder's identity and generation; unreadable → refuse
   `owner-record-corrupt`. **Do not delete anything.**
2. Otherwise claim slot `G = nextGeneration`: append the fixed-width record, `fsync` the file,
   `fsync` the directory.
3. Write the owner record to `tmp/`, `fsync` it, then `link()` it to `owner.<G>.json`, `fsync` the
   directory, unlink the temp. `link` fails `EEXIST` atomically and never exposes a partial file,
   so a claim is either wholly absent or wholly readable. `EEXIST` → someone raced onto our slot →
   retry from step 1, bounded at 8 attempts, then refuse `contended`.
4. **Claim-then-verify.** Re-scan. If any `owner.<G'>` with `G' > G` exists, we lost: unlink *our
   own* `owner.<G>.json` (a name no other process can have created — no race) and refuse
   `superseded`.

**Recover(observedGeneration, observation):** identical to Acquire, except step 1 requires the
holder's generation to still equal `observedGeneration` (else `holder-changed`, caller re-observes)
and the observation to be `{ kind: "gone" }` (else `holder-live` or `holder-liveness-unknown`).
Recovery then claims a **new, higher** generation by the same steps 2–4. It **never unlinks the old
holder's claim to take ownership.** Superseded claim files may be tidied afterwards, and
*correctness never depends on that deletion*: ownership is "highest present generation", and
generations only ever increase.

*Rejected:* one `lock.json` created with `wx` and removed on release. Two failure modes: a kill
between `open` and `write` leaves an empty lock file with no safe recovery path (the store wedges),
and stale recovery becomes unlink-then-create, where two recoverers can both unlink and both
create — the unsafe race the issue names.
*Rejected:* `flock`/`fcntl` advisory locks. Not reachable from Node core without a native
dependency, and an advisory lock evaporates on process death, which erases exactly the evidence
"there was a holder and it is gone" that D6 needs to distinguish from "there was never a holder".

### D8 — Fencing: a revoked handle refuses, it does not write

Before every mutation (append or checkpoint) the handle re-reads the claim directory. If a higher
generation exists, the handle transitions to `revoked` and every subsequent call refuses
`revoked`, naming the superseding generation. This bounds the damage from a wrong `gone`
observation (pid reuse; D6 makes that path narrow but not impossible) to *at most* one in-flight
operation, and that operation is itself atomic (D9/D10), so the store is never torn.

*Rejected:* trusting the acquisition check for the process's lifetime. A recovered-from holder that
was in fact alive would then append under a dead generation forever.
*Rejected:* fencing only on checkpoint. Journal appends are the ones that record intents.

### D9 — Checkpoint: temp → fsync → rename → dir-fsync, and the envelope carries its own lineage

Envelope: `{ version, generation, journalLength, journalDigest, state, digest }` where `digest`
covers everything except itself and except `at` (D4). `journalLength` is the byte offset of the
journal the checkpoint folded, and `journalDigest` is the digest of the entries up to it — so a
checkpoint paired with a journal that has been rewritten under it is detectable, not merely
unlucky. Write path is exactly the four steps, all in one directory on one filesystem, with the
temp file in `tmp/` under the same root.

On a platform where a directory handle cannot be synced, the driver reports
`durability: "reduced"` on the open result rather than pretending; it never silently skips a step
it claims to have taken (S8:16-27 applied to durability).

*Rejected:* write-in-place with a trailing checksum. A kill mid-write leaves a file that is neither
the old one nor the new one, which is the state the issue says this store cannot be in.
*Rejected:* two alternating checkpoint files with a pointer. Same guarantee, one more file and one
more failure mode (a torn pointer), for no gain.

### D10 — Journal: one whole line per append, fsynced; interior corruption refuses; a torn tail is named, never silently dropped

Each entry is one canonical-JSON line plus `\n`, written in a single `write` and fsynced before the
call resolves. On open:

- an interior line that fails JSON parse, schema or recomputed digest (R2) → refuse
  `journal-corrupt`, naming the line number. No truncation, no skip, no note-and-continue. This is
  where the store deliberately **inverts** `parseJournal`'s disposition (research.md R7): dropping
  lines is right for a diagnostic diff and catastrophic for authoritative state.
- **trailing** bytes after the last `\n` at EOF → a `torn-tail` of exactly `n` bytes. The store
  opens **read-only**: it folds every complete entry, reports the torn tail, and **refuses to
  append** until the owner explicitly calls `sealTornTail({ bytes: n })`, which re-verifies the
  length and the absence of a newline, truncates exactly those bytes, and records a
  `torn-tail-sealed` entry naming the byte count and the generation that wrote them.

The torn tail is safe to discard *only because of a documented port precondition*: **a caller must
not attempt an effect before `recordIntent` resolves.** An append that never resolved therefore
precedes any attempt. That precondition is stated in the port's doc comment and is structurally
enforced in the fake driver, which returns the token an attempt requires only after the append has
been fsynced.

*Rejected:* silently truncating the torn tail on open. Indistinguishable, from the outside, from
truncating away a real entry — and the issue names both truncation and starting fresh as bugs that
"look like robustness".
*Rejected:* refusing to open at all on a torn tail. Every kill during an append would permanently
wedge the store; the resulting operational pressure produces a `--force-truncate` flag within a
month, which is the silent version by another name.

### D11 — `unknown` is terminal, and the type makes rounding-down impossible

Two disjoint types, deliberately non-interchangeable:

- `SessionPending` — an intent recorded in the **currently open** generation with no receipt yet.
  Mutable-in-the-fold, session-local, **never** persisted into the checkpoint's terminal map, and
  **not assignable** to `EffectStatus`.
- `EffectStatus` — terminal:
  `{ kind: "sent" } | { kind: "unsent", proof: NonDeliveryProof } | { kind: "unknown", generation, sinceEntry }`.

The impossibility is structural, in three parts:

1. `NonDeliveryProof` is a branded type whose sole constructor is `proofFromReceipt(r)`, which
   accepts only a receipt entry with `delivered: false`. There is no other exported value of that
   type, so `unsent` **cannot be constructed** without a receipt that proves non-delivery.
2. There is **no** exported function whose parameter type includes `Unknown` and whose return type
   includes `Unsent`. The only transitions are `settle(pending, receipt) → Sent | Unsent` and
   `orphan(pending, closedGeneration) → Unknown`. Terminal statuses have no outgoing transition at
   all: the checkpoint loader re-emits stored terminal statuses by identity.
3. The fold's signature keeps the two apart:
   `fold(checkpoint, entries, { openGeneration }) → { terminal: Map<IntentKey, EffectStatus>, pending: Map<IntentKey, SessionPending> }`.
   An intent whose generation is closed can only leave the fold through `orphan`.

`@ts-expect-error` assertions for each of the three are compiled by `tsc -b`, which `pnpm test`
already runs before `node --test` (S10:29-30), so the type-level claim is a build gate and not a
comment.

*Rejected:* a boolean `acknowledged` with `unknown` as `undefined`. Optionality is the round-down:
every `?? false` in every consumer is a re-dispatched live agent.
*Rejected:* enforcing it only in the reducer's branches. The issue is explicit — "make it
impossible in the type, not just in the branch."

### D12 — Intent identity is the five-tuple, digested; the store records, it does not adjudicate

`IntentKey = { repository, task, workflowStep, attempt, inputRevision }` (#191 point 4), with a
digest via D3 used as the map key. The store never decides whether an intent may be retried; it
records enough for the reducer to answer `sent` / `unsent` / `unknown`.

*Rejected:* a store-side retry policy. That is step B/C's, and putting it here would make the
"deliberately not in this issue" boundary unenforceable.

### D13 — The reducer is pure and replay-equal; time and identity enter at the boundary

No clock, no I/O, no environment inside the fold (S6:65-73, S7:5-9). Same entries fold to the same
state, asserted by digesting two independent folds and comparing, with `differences` (S5:101-139)
naming the divergent path when they disagree — the shape `replayJournal` already uses (S7:196-197).

*Rejected:* letting the reducer read the current time to decide staleness. That is D6's timeout by
another route, and it would make the fold non-replayable.

### D14 — Every temporary home in a test comes from one helper

A single `withTempStore(fn)` helper owns `mkdtemp` and its removal; no test calls `mkdtemp`
directly. Host token, pid and clock are injected fakes, so no machine-specific or time-sliding
value can reach the diff. Gate G8 enforces the single home by grep.

*Rejected:* per-test `mkdtemp` with `after()` cleanup. Fifteen chances to forget one; the gate
would have to be a convention rather than a check.

---

## 2. Owner forks

Raised, not resolved [PRINCIPLES §4, S3:24-28; S1:122-125]. Per the rule shipped in #242, the half
that does not depend on the answer is built now, and each fork below is filed as its own issue
carrying `flag:owner-decision` with these options and recommendations. **No `harness` label is
applied to any of them** (S1:37-54).

### FORK-1 — What happens when a holder is neither provably live nor provably gone

**Question.** `ProcessObserver` returns `unknown` (cross-host, `EPERM`, or an unexpected errno).
The store refuses. How does a human ever get the store back?
**Options.** (a) Refuse permanently; the operator deletes the claim file by hand, out of band.
(b) An explicit `forceRecover({ acknowledgement })` call that records the override as a journal
entry naming who overrode and what was observed. (c) A configurable stale-after duration.
**Recommendation:** (b). It keeps the override auditable and inside the evidence trail, and it
keeps (c) — the timeout D6 exists to refuse — off the table.
**Cost if wrong.** With (b) and a careless operator, two writers. With (a), a host crash where the
pid was reused needs manual filesystem surgery on a live system. (c) is the failure the issue
already rules out.
**Blocks nothing in this PR:** the store ships with (a)'s behaviour — refuse, name the holder, name
why the observation was `unknown` — which is a strict subset of (b).

### FORK-2 — Who may seal a torn tail (D10)

**Options.** (a) Explicit `sealTornTail` by the acquiring owner, as planned. (b) Automatic on open
when the tail is shorter than one maximum entry. (c) Operator-only, via a separate entry point.
**Recommendation:** (a), because it is the only one that is both unattended-recoverable and
recorded. **Cost if wrong:** (a) requires the caller (step B, not this PR) to handle one extra
refusal on first open after a crash.
**Blocks nothing:** the refusal and the explicit call ship either way; (b) would only remove a call.

### FORK-3 — Production store choice

**Not taken. #191 F1, the owner's.** Restated here only to record that it was recognised and left
alone: it "blocks production activation, not the interface, reducer, fake-driver or crash tests".
No file in this PR names a deployment target.

---

## 3. Spikes

| # | Claim | Discharge |
|---|---|---|
| S1 | `O_EXCL`/`link` atomicity, `rename` atomicity, file+directory `fsync` durability, `ESRCH` semantics, SIGKILL uncatchability (research.md R10) | **Gates G4–G7 in §6.** Each is asserted by a test that kills a real child. If the platform disagrees, the build fails. |
| S2 | `worktree.ts` injects a clock at the boundary (asserted in the brief; that file was not among the supplied sources) | Read it before implementing `ProcessObserver`/`Clock`; match it. If it differs, follow it and record the difference in `drift.md`. Non-blocking: D13 stands on S6:65-73 regardless. |
| S3 | `docs/concepts/05-determinism.md` opens with the empty-board failure | Read before writing the corruption refusal's message. Nothing structural depends on it. |
| S4 | `pnpm run build` is ten checks and `check:tutorial` is among them | Run it first, from a clean tree, before writing anything. This PR adds no tutorial fence, so the interpreter in `scripts/check-tutorial.mjs` should not be engaged; if it is, read that script before changing a block. |

---

## 4. Dependency DAG

    N0  read: worktree.ts, 05-determinism.md, 04-the-run.md, board-process SKILL  (S2,S3,S4)
     └─> N1  contracts/src/state-store.ts — port, record shapes, refusal union
          ├─> N2  coordinator/src/store/keys.ts — IntentKey + digest (D3, D12)
          │    └─> N3  reducer.ts — fold, EffectStatus, SessionPending, brand (D11, D13)
          │         └─> N4  reducer tests + @ts-expect-error type gates
          ├─> N5  ledger.ts — fixed-width generation ledger (D7)
          │    └─> N6  ownership.ts — acquire / recover / fence (D6, D7, D8)
          │         └─> N7  observer.ts + host identity port (D5, D6)
          ├─> N8  checkpoint.ts — temp/fsync/rename/dir-fsync + digest check (D9)
          └─> N9  journal-file.ts — append+fsync, interior refusal, torn tail (D10)
     N6,N8,N9 ─> N10 fs-store.ts — the driver composing them, with hook seam
                  ├─> N11 fake.ts — in-memory driver behind the same port
                  ├─> N12 test/temp-dir.ts — the single withTempStore helper (D14)
                  └─> N13 crash-child fixture (compiled to dist; S10:29-30)
                       └─> N14 crash tests at four points (G4–G7)
     N4,N11,N14 ─> N15 second-writer + corruption + recovery tests (G3, G9)
     N15 ─> N16 gates §6 green from a clean tree ─> N17 PR

Critical path: N1 → N5 → N6 → N10 → N13 → N14. N3/N4 (the type work, the part the issue says the
whole thing fails on) is independent of the filesystem work and is done first if time is short.

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Gate that catches it |
|---|---|---|---|---|
| R1 | A consumer rounds `unknown` down to `unsent` → re-dispatched live agent | Low after D11, catastrophic if it happens | Highest in the issue | G2 (`@ts-expect-error` compiled by `tsc -b`) + G9 |
| R2 | Wrong `gone` observation (pid reuse) → two writers | Low (D6 refuses on `EPERM`/success) | High | G3, G10; damage bounded by fencing (D8) |
| R3 | Crash-point tests are flaky — child killed before it reached the point | Medium | Medium (a flaky gate gets deleted) | Child announces the point on stdout and blocks; parent kills only after reading it, and asserts the exit signal was `SIGKILL` (G4–G7) |
| R4 | A crash test's assertion is "old **or** new checkpoint", which a bug can also satisfy | Medium | Medium | Assert *both* legality and that the digest verifies, and that at least one of the two exact expected digests matches — a torn file matches neither |
| R5 | Filesystem semantics differ on the test platform (S1) | Low on Linux, unknown elsewhere | High | G4–G7 fail rather than the design being wrong in prose; `durability` is reported, not assumed (D9) |
| R6 | Kill during acquisition reuses a generation | Low after D7 | High | G10 asserts strict monotonicity across 3 killed acquisitions |
| R7 | D2's type-only dependency is read as violating S6:11-19 | Medium | Low (one import line per file) | Called out in the PR body with the fallback named |
| R8 | Torn-tail sealing quietly drops a complete entry | Low | High | G9 asserts the sealed byte count equals the observed tail and that no complete entry's digest disappears from the fold |
| R9 | Scope creep into dispatch, transport, findings 5/6, or a store choice | Medium (adjacent code is tempting) | High — a boundary the issue calls a boundary | §7 manifest; `git diff --name-only` against it is G11 |
| R10 | A machine-specific or time-sliding value lands in the diff | Low | High (public repository, every commit is a publication) | G8 |

---

## 6. Acceptance gates — executable, with expected exit codes

Run from a clean tree. "Unproven" is a legitimate outcome and must be recorded as such
[PRINCIPLES §6, S3:36-39]; nothing below is assumed green.

| # | Gate | Command | Expect |
|---|---|---|---|
| G0 | Baseline is green **before** any change | `pnpm run build && pnpm -r run test` | 0 |
| G1 | Full build, ten checks incl. `check:tutorial` | `pnpm run build` | 0 |
| G2 | Type-level impossibility of `unknown → unsent` | `pnpm --filter @rickylabs/coordinator run typecheck` with the `@ts-expect-error` assertions present | 0; and, verified once by hand and recorded in the test's comment, **non-zero** when any one `@ts-expect-error` is removed |
| G3 | Second writer refuses and names the holder | `node --test packages/coordinator/dist/store/ownership.test.js` | 0 — asserts kind `held`, holder generation and identity present, and that the loser wrote nothing |
| G4 | Crash mid-temp-write | `node --test packages/coordinator/dist/store/crash.test.js` (case 1) | 0 — child exits on `SIGKILL`; reopened checkpoint digest-verifies and equals the **previous** one; temp debris present and unread |
| G5 | Crash after `fsync`, before `rename` | same file, case 2 | 0 — checkpoint equals the previous one, digest verifies |
| G6 | Crash after `rename`, before directory `fsync` | same file, case 3 | 0 — checkpoint equals **exactly one of** the two expected digests; never a third value |
| G7 | Crash between intent and receipt | same file, case 4 | 0 — the intent folds to terminal `unknown` under the closed generation; asserted **not** `unsent` and **not** `pending`; a second intent whose receipt did land folds to `sent` |
| G8 | No temp-path sprawl, no machine-specific value | `grep -rn "mkdtemp" packages/coordinator/src \| grep -v "test/temp-dir"` → empty; `grep -rniE "os\.homedir\|/Users/\|/home/\|hostname\(\)" packages/*/src` → empty | grep exits 1 (no match) |
| G9 | Corruption refuses and never resolves empty | `node --test packages/coordinator/dist/store/corruption.test.js` | 0 — bad version, bad digest and trailing garbage each refuse under their own kind; each asserts the result is a refusal and **not** a state with zero entries; torn tail reports the exact byte count and refuses to append until sealed |
| G10 | Generation is monotonic across killed acquisitions | `node --test packages/coordinator/dist/store/generation.test.js` | 0 — three children killed at three points inside acquisition; the next successful generation is strictly greater than every number ever observed, and no number repeats |
| G11 | Diff stays inside the declared surface | `git diff --name-only main...HEAD` compared to §7 | no path outside §7 |
| G12 | Whole workspace | `pnpm -r run test` | 0 |
| G13 | Purity of the reducer | in `reducer.test.js`: two independent folds of the same entries digest-equal; the module's source contains no `Date`, `Math.random`, `process.env` or `node:fs` import | 0 |

---

## 7. Bounded mutation manifest (Stage A surface)

Anything found outside this list is drift, not scope [S2:31-38]. Compatible with the supervisor's
declared-surface check; G11 is the assertion.

**May write:**

    packages/contracts/src/state-store.ts                    (new)
    packages/contracts/src/index.ts                          (export the new module only)
    packages/coordinator/src/store/                          (new directory, all files)
    packages/coordinator/src/store/test/temp-dir.ts          (the single mkdtemp home)
    packages/coordinator/src/store/test/crash-child.ts       (compiled fixture; spawned from dist)
    packages/coordinator/package.json                        (contracts as workspace:* — D2)
    packages/coordinator/tsconfig.json                       (references: contracts — D2)
    .llm/runs/durable-state--e6a/                            (run artifacts)

**Must not touch:**

    packages/contracts/src/server.ts        transport is step E, reused as it stands
    packages/telemetry/**                   sink behaviour is not this issue
    packages/dsh-app/**                     no composition change
    packages/board/**, packages/forge/**    no board or GitHub surface
    docs/tutorials/**                       adds no fence; keeps check:tutorial uninvolved
    BOARD.md, .claude/skills/**             generated; not hand-edited here
    issues #237, #62, #148, #181, #244      owner decisions in flight — untouched

**Must not do:** apply the `harness` label to anything; dispatch; call a provider; write to GitHub
from the runtime; add a live canary; choose a production store; merge the PR.

---

## 8. What will remain unverified when this PR is ready

Stated now so the write-up cannot quietly omit it.

1. **Filesystem semantics beyond the test platform** (S1). G4–G7 prove them where the tests run.
   Behaviour on network or shared filesystems is not claimed and is refused by construction (D5).
2. **Pid-reuse safety in full.** D6 refuses on anything short of `ESRCH`, and D8 bounds the damage,
   but the residual — a pid that does not exist, whose holder is on a filesystem shared with a host
   we cannot see — is closed only by D5's single-host boundary, which is a boundary, not a proof.
3. **FORK-1 and FORK-2** — owner's, filed with `flag:owner-decision`, blocking nothing here.
4. **The production store choice** — #191 F1, owner's, untouched.
5. **D2's package-property change** — a reviewer decision, called out in the PR body with the
   fallback named.
