# research.md — E6.A durable state store (issue #245)

**Conclusion first.** The repository already contains every idiom this issue needs, in four
files, and none of them opens a file. `journal.ts` fixes the shape of persisted evidence and
the `at`-outside-both-digests rule; `canonical.ts` gives a byte-stable serialisation and a
digest; `governance.ts` fixes how a refusal is named as data instead of thrown; `replay.ts` and
`record.ts` fix the fold-and-replay shape and the "pass the timestamp in, do not read the clock"
discipline. What is genuinely new in #245 is (a) an ownership record with a monotonic generation,
(b) an atomic checkpoint replace, and (c) a status lattice in which `unknown` is terminal. Only
(a) and (b) rest on filesystem behaviour that no supplied source documents, and those are
isolated into a single spike, **S1**, for coordinator verification.

Sources are numbered. Every load-bearing claim below cites one, per PRINCIPLES §3 [S3:19-23].

## Numbered sources

| # | Path |
|---|---|
| S1 | `AGENTS.md` |
| S2 | `doctrine/WORKFLOW.md` |
| S3 | `doctrine/PRINCIPLES.md` |
| S4 | `packages/coordinator/src/journal.ts` |
| S5 | `packages/coordinator/src/canonical.ts` |
| S6 | `packages/coordinator/src/record.ts` |
| S7 | `packages/coordinator/src/replay.ts` |
| S8 | `packages/contracts/src/governance.ts` |
| S9 | `packages/contracts/package.json` |
| S10 | `packages/coordinator/package.json` |
| S11 | `packages/coordinator/tsconfig.json` |
| S12 | `packages/README.md` |

(The issue body, `docs/concepts/05-determinism.md` and `docs/concepts/04-the-run.md` are named in
the brief but were not supplied as numbered sources; nothing below is load-bearing on them, and
where the plan echoes the determinism failure mode it is attributed to the issue text, not to a
file I have read.)

## R1 — Persisted evidence has a fixed shape, and `at` is outside both digests

`PersistedDecision` carries `id`, `kind`, `at`, `inputs`, `output`, `inputDigest`, `outputDigest`
[S4:25-40]. `at` is documented as "deliberately outside both digests" [S4:34-35], with the reason
stated in the header: a digest that moves with the clock reports drift on every check and teaches
everyone to ignore it [S4:18-20]. `planDigest` hashes the sequence *as a sequence*, excluding `at`
[S4:67-71].

**Consequence for #245.** Intent and receipt records get `at` in the entry and in neither digest.
The checkpoint digest likewise covers state and lineage, never a timestamp — otherwise reopening
the same store twice produces two digests and the corruption check fires on healthy data.

## R2 — Digests are recomputed, never trusted

`readDecision` rebuilds both digests via `decisionOf` rather than reading the persisted ones,
because "a journal is a file, files are edited, and a determinism check that believes a digest it
was handed can be made to pass by editing it" [S4:93-101].

**Consequence.** The checkpoint's stored digest is a *claim to be checked*, not an input. Open
recomputes over the canonical form and compares; mismatch is a named refusal, not a repair.

## R3 — Canonical serialisation exists and is order-sensitive for arrays

`canonicalJson` sorts object keys, drops `undefined`, writes non-finite numbers as `null`, and
writes `Date` as ISO [S5:36-79]. Arrays keep insertion order deliberately: "a plan that dispatches
B before A is a different plan" [S5:13-17]. `digest` is `sha256:<16 hex>` [S5:82-84], 64 bits,
chosen to be readable in a terminal column [S5:21-26]. `differences` names differing paths, capped
at `DIFF_PATH_CAP = 12` [S5:87-139].

**Consequence.** The store reuses these; it does not introduce a second hashing scheme. Journal
entry ordering is semantically significant and is hashed as a sequence, as `planDigest` already
does [S4:67-71].

## R4 — Failure kinds are data, discriminated, and closed only where closure is affordable

`governance.ts` models `RegimeStatus` as a discriminated union on `regime` so that "adding a
fourth kind of budget is a new member rather than four more optional fields on a shared shape, and
a client that cannot draw it fails at the switch instead of rendering an empty gauge" [S8:111-117].
It closes `REGIMES`, `REGIME_STATES` and `APPROVAL_VERDICTS` [S8:36, 46, 181] but deliberately
leaves approval `kind` an open string, because refusing to display an unrecognised kind is "how a
fleet stalls waiting on a decision nobody was shown" [S8:138-147].

It also encodes the exact distinction #245 point 1 needs: an unread regime reports `allow` with
`observedAt: null` and a note, and is never omitted, because "'allowed' and 'we could not check'
look identical" otherwise [S8:16-27].

**Consequence.** Every refusal in #245 — second writer, stale lock, corrupt checkpoint, corrupt
journal, unknown intent — is a member of one closed discriminated union with the holder's identity
carried in the `held` member. And *"we could not determine whether the holder is alive"* gets its
own member; it is not folded into "gone". This is S8:16-27 applied one layer down.

## R5 — Clocks and identity enter at the boundary; the core is pure

`recordOf` takes `at` as a parameter rather than reading a clock, and the header says why: it makes
the record a pure function of its inputs, "which is what lets the replay test in #71 compare two
records for equality instead of comparing them field by field with the timestamp carved out"
[S6:65-73]. `replay.ts` extends the same argument to nondeterminism generally: a clock, filesystem,
environment variable or `Math.random` "arrives as an innocent-looking convenience inside a decider,
never as a line of code labelled 'nondeterminism'" [S7:5-9]. The brief names `worktree.ts` as the
clock-injection precedent; I did not read that file, so the citation for the *pattern* is S6/S7
and the `worktree.ts` attribution is carried as unverified.

**Consequence.** The reducer takes `(checkpoint, entries)` and returns state. Clock, host identity
and process-liveness observation are all injected ports, which is also what keeps machine-specific
values out of the diff (S1:118-121 citation bar; the "no operational path" rule comes from the
issue's acceptance, not from a supplied file).

## R6 — Replay already distinguishes "clean" from "could not check"

`ReplayVerdict` has three members and `unchecked` exists specifically because "a determinism check
that returns 'clean' for a journal it could not read is worse than no check, because somebody will
cite it" [S7:151-157, 167-174]. Entries with no registered decider are named, excluded from
`checked`, and do not count as passes [S7:184-201].

**Consequence — this is the direct ancestor of `unknown`.** #245's `unknown` is the same move:
absence of evidence is reported under its own name and is never rounded down to the benign value.
The reducer should be recognisable as a sibling of `replayJournal`, and the type must make the
rounding-down impossible rather than merely absent from today's branches.

## R7 — A parser that keeps going is the wrong model for a checkpoint

`parseJournal` drops unreadable lines, names the first `JOURNAL_NOTE_CAP = 5` and counts the rest
[S4:47-48, 104-144]. That is correct for a *diagnostic* comparison artefact and it is exactly wrong
for an *authoritative* checkpoint: the same code applied to run state would silently produce a
smaller board. The issue's point 4 forbids it. So #245 inherits the *shape* of `ParsedJournal`
(a value with notes, not a throw) but inverts the disposition: a malformed entry inside the store
is a refusal to open, not a note.

## R8 — Package boundaries constrain where the port and the driver may live

`contracts` is the only non-private package [S12:25, S9:19-22], published as
`@rickylabs/harness-contracts` [S9:2], with `dsh.protocol: 1` [S9:23-25], subpath exports `.` and
`./server` [S9:29-39], and `files` shipping `dist` **and** `src` while excluding tests [S9:40-45].
Decision 4 of #30 makes that publication load-bearing: contracts "must be a *published* package,
not a workspace import" [S1:100-106].

`coordinator` is private [S10:5], ESM, `test` = `tsc -b && node --test "dist/**/*.test.js"`
[S10:29-30] — **tests run from `dist/`, so any test fixture spawned as a child process must be
compiled output, and any `@ts-expect-error` assertion is enforced by the same `tsc -b`.** Its
tsconfig has `rootDir: src`, `outDir: dist`, and today **no `references` array** [S11:1-10].

`record.ts` states that "Coordinator depends on no other workspace package" and justifies it by the
transport being "one line of JSON on a pipe … a structural shape, not an import" [S6:11-19]. Read
precisely, the property being defended is a *runtime* dependency: the paragraph is about telemetry
transport. A type-only import erased at compile time does not create one. This is the sharpest
structural question in the plan and is taken as D2 with the alternative recorded.

Workspace convention: deps are declared `workspace:*` **and** mirrored as a tsconfig project
reference; "pnpm orders `pnpm -r` topologically from the former; `tsc -b` orders emit from the
latter. Keep both in sync" [S12:57-59]. Base config turns on `composite`, `strict`, `NodeNext`,
`verbatimModuleSyntax`, `noUncheckedIndexedAccess` [S12:53-56].

`board` and `coordinator` are E6's, and E6 is #36 [S12:23] — #245 is labelled `epic:e6`, so both
touched packages are inside the owning epic.

## R9 — Doctrine constraints that shape the artefacts, not just the code

- Stage A declares an explicit **mutation surface**; "anything later found outside the declared
  surface is drift, not scope" [S2:31-38]. Hence the bounded manifest in plan.md §7.
- Stage E requires numbered decisions with the alternative rejected, numbered owner forks with
  question/options/recommendation/cost-if-wrong, spikes for unverified load-bearing claims, a DAG,
  and a risk register with the gate that catches each risk [S2:57-69].
- Once locked, changes go in `drift.md`, not in-place edits [S2:69, S2:98-102].
- Stage F is a *separate session* [S2:71-78]; Stage G gates all mutation [S2:80-86]; verdict
  vocabulary is the four in [S2:109-118].
- "Gates must be able to run… a gate that cannot execute in the current repository is **unproven**"
  [S3:36-39]. Hence every gate in §6 is a command with an expected exit code.
- "No silent owner decisions" [S1:122-125] and PRINCIPLES §4 [S3:24-28]: an agent that quietly
  picks the reasonable-looking option "has destroyed the one thing the owner was needed for".
- The repository is a live dispatch inbox; the `harness` label starts a real agent, and there is no
  draft state [S1:37-54]. Nothing in this plan applies a label.

## R10 — What no supplied source establishes → **spike S1** (coordinator verification)

The ownership and atomic-replace algorithm rests on POSIX/Linux filesystem semantics that appear in
**none** of S1–S12. Per PRINCIPLES §3, these are findings for a spike, not inputs to a locked
decision [S3:19-23], and per the citation bar a claim I believe but cannot cite is exactly that
[S1:116-121]. They are load-bearing, so they are gated by an executable check rather than an
argument.

Claims requiring verification:

1. `open(path, "wx")` / `O_CREAT|O_EXCL` is atomic against a concurrent creator on the local
   filesystem the tests run on.
2. `link(tmp, target)` fails with `EEXIST` atomically and never publishes a partially-written
   target — the basis for "the owner record is complete before it is visible".
3. `rename(tmp, target)` within one directory is atomic: a reader sees the old inode or the new
   one, never a blend.
4. `fsync` on a file handle, then `fsync` on the *directory* handle, is what makes a rename
   durable; and whether a directory handle can be opened and synced on the test platform.
5. `process.kill(pid, 0)` throwing `ESRCH` means no process with that pid exists **now**; success
   or `EPERM` means *some* process exists and may be a pid reuse.
6. SIGKILL is uncatchable, so a crash point must be pre-arranged before the signal.

**S1's discharge is mechanical, not argumentative:** each of 1–4 is asserted by a test in this PR
(§6 G4–G7), so if the platform disagrees the build fails rather than the design being wrong in
prose. 5 and 6 are used only conservatively — 5 can only ever *refuse*, never grant (D6), and 6
shapes the test harness (D11). Behaviour on network or shared filesystems is **explicitly out of
scope** (D5) and is not claimed anywhere.
