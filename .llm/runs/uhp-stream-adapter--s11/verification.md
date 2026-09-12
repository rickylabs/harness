# Verification — `uhp-stream-adapter--s11`

Spike S11, issue [#289](https://github.com/rickylabs/harness/issues/289), the buildable half.

**The split this document exists for.** §1 is what the mock proved. §2 is what only a live
HarnessRouter can prove and therefore remains **unproven**. Nothing in §1 may be read as evidence for
anything in §2, and issue [#294](https://github.com/rickylabs/harness/issues/294) — the live
clone/branch/commit/push/pull-request round-trip — is not advanced by a single line of this run.

Verdict on the buildable half: **PASS**, on the evidence in §1 and subject to §2 and §3.

---

## 0. Gates

| Gate | Result |
|---|---|
| `pnpm run build` | green |
| `pnpm run test` | green — 3,026 tests across 12 packages, 0 fail |
| `packages/subagents` suite | 344 tests, 0 fail (252 before this run, 92 added) |
| `check:compiled-policy` | green; no new allowlist entry was needed |
| `check:publish` | green; `packages/contracts` unchanged, no proposal required |
| Container runtime | none started, none installed, none required |
| Credentials | none. The mock never reads an `Authorization` header; no fixture contains a token |

`pnpm run test` ends in `check:installed`, which packs `@rickylabs/harness-contracts` and runs a
sleeping probe from a temporary directory. On this host that step needs an **executable `TMPDIR`** and
unsandboxed process control: under the default sandbox it fails at `offline pack`, and unsandboxed with
the default `TMPDIR` it fails at `sleeping probe startup (requires executable TMPDIR)`. With
`TMPDIR` pointed at an executable directory it reports `"status":"PASS"` for both of its checks. That
is an environment property of this host, it is unrelated to anything in this run — the check touches
only `packages/contracts` and `packages/telemetry` — and it is recorded here rather than left as an
unexplained red line. The full green run was `TMPDIR=<executable dir> pnpm run test`.

---

## 1. What the mock proved

Every item is proven by a test in `packages/subagents/src/uhp-*.test.ts` against fixtures in
`uhp-mock.ts`, which were written from the published specification (see `research.md` for the
retrievals). Several run over a real loopback socket on `127.0.0.1:0`, which proves the codec survives
a socket; it does not make the peer a router.

### 1.1 SSE consumption

- Incremental frames, the terminal frame and assembled output text, in order.
- Identical results for any chunking of the same bytes, including seven-byte chunks that split frames,
  the blank-line separator and JSON string tokens.
- An open stream reports itself open with honestly partial text; only a terminal frame closes it.
- SSE keep-alive comment blocks are ignored without consuming a sequence number.
- Event types the protocol does not define are counted and otherwise ignored — never growth, never
  terminal. (A reading, not a rule: the chapter is silent. See `research.md` §1.2.)
- All five lifecycle statuses. `cancelled` is read from `response.status` on a frame whose event name
  is `response.failed`, because "the status field, not the event name, is authoritative" and there is
  no `response.cancelled` event.
- Partial output is retained on a cancelled and on an incomplete task, per Lifecycle §4.

### 1.2 Fail-closed stream handling

Thirteen malformed, truncated or reordered bodies, each refused with its own named refusal, and the
partial state unreachable in the returned type:

| Fixture | Refusal |
|---|---|
| `truncatedBetweenFrames` | `truncated` |
| `truncatedMidFrame` | `truncated` |
| `outOfOrder` | `sequence-broken` |
| `droppedFrame` | `sequence-broken` |
| `duplicatedFrame` | `sequence-broken` |
| `malformedJson` | `unparseable-frame` |
| `jsonNotObject` | `unparseable-frame` |
| `untypedFrame` | `untyped-frame` |
| `createdNotFirst` | `created-misplaced` |
| `frameAfterTerminal` | `frame-after-terminal` |
| `terminalStillRunning` | `non-terminal-status` |
| `errorWithoutTerminal` | `error-without-terminal` |
| `deltaWithoutText` | `frame-unreadable` |

Also proven: the text a truncated stream did carry appears nowhere in the refusal, not even under
`JSON.stringify`; a refusal is sticky against a later frame that would have been valid in sequence; an
empty stream is `truncated` rather than finished; an `error` event *followed* by a terminal event is
accepted and the error retained.

### 1.3 Freshness (requirement A)

- `uhpFreshness(evidence, now, windows)` has no status parameter, no response parameter and no
  boolean. Two `@ts-expect-error` assertions in the suite fail the **build** if that widens.
- Evidence carries a module-private `Symbol` brand. Only a delta or an output-item frame mints one, and
  a forged object that got past review is dropped at runtime.
- A `completed` run that produced no growth and an `in_progress` run that produced no growth return
  **deep-equal** freshness verdicts. A status-derived implementation cannot satisfy that equality.
- The same evidence yields `live`, `recent` and `quiet` under three different clocks; a finished run
  with eleven-day-old growth is `quiet`; an unfinished run with five-second-old growth is `live`.
- `stalled` is unreachable — it needs a running *claim*, which is `RunLiveness`'s question and
  `@rickylabs/telemetry`'s join (#206).

### 1.4 Lifecycle mapping (#287)

Every row of the table, transcribed from the issue into the test rather than from the implementation:
`in_progress`→`running`, `completed`→`finished`, `failed`→`failed`, `cancelled`→`finished` +
`stop: "stopped"`, `incomplete`→`failed` + `limit: "budget"`, and unreachable / 404 / other HTTP
failure / unreadable stream → `unknown`. Plus: `queued` is never produced, no server-sent status ever
maps to `unknown`, and the three collapses that cost something (cancelled≠failed, incomplete≠failed,
unknown≠failed) are each asserted as a difference and not as a negation.

### 1.5 Continuation (requirement: three turns)

- Three turns chained on `previous_response_id`, both in-process and over the socket with streamed
  responses, with the chain asserted as `[null, resp_turn_1, resp_turn_2]` rather than by turn count.
- The continuation key comes from the ledger; the first request omits the field entirely.
- `session_id` lands in `RunRef.external`; it is `null` before the first response.
- The ledger is keyed on `runId`: two runs sharing one `session_id` stay separate entries, and
  recording into one leaves the other byte-identical.
- One turn observed twice while it runs (`in_progress`, then terminal) advances that turn rather than
  appending a second.
- Seven named refusals, asserted pairwise distinct: `chain-broken`, `session-changed`,
  `session-unreported`, `prior-turn-open`, `replayed-response`, `unidentified-response`,
  `run-mismatch`. A refused turn leaves the ledger unchanged.

### 1.6 The substitution gate (requirements B and C)

- `decideUhpRoute` returns **`refused`** for the `modelSubstituted` fixture and **`unknown`** for the
  conformant one, while `evidence.status` is `unknown` for both.
- Both defective implementations are written into the suite by name and run on the same evidence:
  `substitutionDetectedByStatus` returns `false` where the correct reader returns `true`, and
  `verdictByCodexLadder` returns `unknown` where this gate returns `refused`.
- The weak assertions are written out and shown to pass for both, immediately above the assertions that
  discriminate.
- The gate is still correct in the codex dialect: with all four fields observable, status is `mismatch`
  and the ladder and this gate agree.
- The extension-field fixtures move nothing — not to accepted, and not to refused either.
- Absent evidence is `unknown`, never agreement.
- Readers for `provider`, `effort` and `cwd` are kept and asserted to return `null`. S10's finding is
  treated as an unevaluated generator verdict, so no capability was deleted on its strength.

---

## 2. What only a live HarnessRouter can prove — UNPROVEN

Each of these is a claim this run **does not make**. They are the boundary of §1, and they are why
issue #289 stays open for its gate and issue #294 exists.

1. **That a real HarnessRouter emits the frame sequence the mock emits.** The fixtures come from the
   specification. A conformant server is required to match; whether any deployed one does is untested.
2. **That a real server closes a cancelled task with `response.failed` + `status: "cancelled"`.** The
   chapter says so. No server was asked.
3. **That `metadata.session_id` is in fact stable across a real continued chain**, and that a real
   branch produces two runs in one session. Both are read from Sessions §1.
4. **That `previous_response_id` gives a real harness the earlier context and the same working
   directory.** This run can prove that we chain correctly, not that chaining works.
5. **Any workspace round-trip.** No clone, no branch, no commit, no push, no pull request, no
   `HarnessRouter` Community Edition instance. There is no container runtime on this host and none was
   started. **Issue #53 retires only on a PASS at #294, and nothing here contributes to it.**
6. **That the real 404 codes are `response_not_found` and `session_expired`** in the situations the mock
   produces them for.
7. **Whether `provider`, `effort` and `cwd` are truly unobservable over UHP.** S10's answer is an
   unevaluated generator verdict awaiting a non-Claude evaluator. If it is wrong, the readers are
   already in place and only the observation adapter changes.
8. **Artifact recovery.** `uhpObservation` returns the artifacts its caller passes and derives none from
   a response's output items. Parsing a branch name or a pull request url out of agent prose has its own
   failure modes and a fabricated url on a run record is worse than an empty list. #294 owns it.

---

## 3. Mutation testing

Every new suite was mutation-tested: the behaviour was broken on purpose, the suite was re-run, and the
red tests were recorded. A mutation that kills nothing is an uncovered behaviour, and one of these did
exactly that on the first pass.

Driver: patch one source file, run `pnpm --filter @rickylabs/subagents run test`, restore the file
byte-for-byte. Baseline for all rows: 344 pass, 0 fail.

| # | Mutation | File | Tests failed | Killing tests |
|---|---|---|---|---|
| M1 | mint freshness evidence from a lifecycle frame (breaks A) | `uhp-stream.ts` | **6** | mints growth evidence from deltas and output items; completed and running share freshness; moves to live only on a delta or item; newest-timestamp; counts an undefined event type; streamed socket read |
| M2 | trust unbranded freshness evidence (defeats A's brand) | `uhp-stream.ts` | **1** | does not compile a lifecycle status into freshness evidence |
| M3 | decide the outcome from the event name, not `response.status` | `uhp-stream.ts` | **4** | cancelled is not failed; reads cancelled from the response object; streamed cancelled over the socket; lifecycle of a real exchange |
| M4 | return the last-seen response when a stream never terminated | `uhp-stream.ts` | **7** | three truncation refusals; partial text kept out of the refusal; `in_progress` is not an outcome; `decodeUhpStream` returns nothing; error-without-terminal |
| M5 | stop checking that `sequence_number` increases by exactly one | `uhp-stream.ts` | **6** | out-of-order, dropped and duplicated frames; sequence skip (S10's test); stickiness; `decodeUhpStream` |
| M6 | let a later valid frame clear an earlier refusal | `uhp-stream.ts` | **1** (0 before the test was strengthened) | stays refused when a frame that would have been valid arrives after the damage |
| M7 | detect a substitution from `status` instead of `mismatches` (defect B) | `uhp-gate.ts` | **7** | refuses where the ladder reports unknown; contradicted vs silent; status explains not decides; negatives; weak-assertion demo; extension fixtures; absent model |
| M8 | check the incomplete comparison before the contradiction (defect C) | `uhp-gate.ts` | **8** | the seven above plus the codex-dialect test |
| M9 | map `cancelled` to `failed` | `uhp-lifecycle.ts` | **3** | the table row; cancelled vs failed; the streamed exchange |
| M10 | drop the `budget` detail from `incomplete` | `uhp-lifecycle.ts` | **2** | the table row; incomplete vs failed |
| M11 | map a 404 to `failed` instead of `unknown` | `uhp-lifecycle.ts` | **2** | the socket 404 test; transport vs failed |
| M12 | accept any `previous_response_id` (drops the chain check) | `uhp-session.ts` | **5** | wrong parent; no parent; first turn with a parent; distinct refusals; ledger untouched |
| M13 | accept a response reporting a different `session_id` | `uhp-session.ts` | **3** | session-changed in process and over the socket; distinct refusals |
| M14 | key the ledger on `session_id` instead of `runId` | `uhp-session.ts` | **4** | two runs one session; `external` and the key; the three-turn socket walk; ledger untouched |

**M6 is the finding of this section.** Its first version killed zero tests. The stickiness test pushed a
*fresh* stream after the damage, and because the sequence counter stops at the point of failure, the
mutant refused the new bytes for a second reason and still looked refused — the test passed on both
sides of the distinction, which is the exact failure mode the brief warns about, found in this run's own
suite by this run's own mutation. The test was rewritten to push a frame numbered to fit the stopped
counter, with a control asserting that the same frame *is* accepted by an undamaged reader; it then
killed the mutation. Both halves are load-bearing and the test says so in a comment.

No other mutation survived, and no mutation failed to compile — each is a change a reviewer could
plausibly have waved through.

---

## 4. Acceptance, against the issue

| #289 acceptance item | Status |
|---|---|
| SSE consumption covers incremental frames, the terminal frame and all five lifecycle statuses | met — §1.1 |
| Continuation by `previous_response_id` across at least three turns in a fixture | met — §1.5, in process and over the socket |
| `session_id` lands in `RunRef.external`; runs keyed on `runId` | met — §1.5 |
| Lifecycle to `RunLiveness` matches #287 | met — §1.4 |
| Freshness cannot be derived from a lifecycle status, and a test proves it | met — §1.3, and M1/M2 kill the violation |
| Substitution detected through `mismatches`, yielding a refusal rather than unknown | met — §1.6, and M7/M8 kill both defects |
| Truncated, out-of-order and malformed frames fail closed | met — §1.2, thirteen fixtures |
| Every new suite mutation-tested | met — §3, fourteen mutations, one survivor fixed |
| `pnpm run build` and `pnpm run test` green | met — §0, with the host's `TMPDIR` note |
| Run artifacts under `.llm/runs/uhp-stream-adapter--s11/` | met |
| No credentials, no secrets | met |
| Do not implement `provider-uhp` | met — not created |
| `packages/contracts` unchanged | met — and #287 Decision 9 means none was needed |
| No container runtime | met |
| Nothing claimed about a live router | met — §2 |
