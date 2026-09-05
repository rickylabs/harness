# Adversarial review — PR #105

## Verdict

**`FAIL_FIX`.** PR #105 builds and its 116 tests pass, but it does not hold the three load-bearing
claims in [issue #106](https://github.com/rickylabs/harness/issues/106): a crafted telemetry record
rejects at the caller and poisons all later writes; a hung tee leg hangs the caller; malformed
vendor records crash the offline status command; independent writers break the byte bound; and
machine output publishes prompt text and transcript paths. The claimed byte-identical purity also
depends on the host locale.

Reviewed target: PR [#105](https://github.com/rickylabs/harness/pull/105) at immutable head
[`96350ce`](https://github.com/rickylabs/harness/commit/96350cebd4dd727cb522be463adb3ceec04da6e7),
against base `f9e0c08085cc6f2d7046b0b94f29d94dcb68dbf3`. All dynamic evidence below used synthetic stores
inside an isolated detached worktree. No operator store was read.

## Findings

### F-1 — Blocking: the file sink can reject and permanently poison its queue

`step()` serialises before its `try` boundary is visible to the caller, then the catch handler reads
`event.runId` again
([`sink.ts:93-132`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/sink.ts#L93-L132)).
An enumerable `runId` getter that throws therefore makes both the work and the error handler throw.
Because the next write is chained with `queue.then(...)` and no rejection handler, that first
rejection poisons every subsequent write:

```text
node review-probes.mjs
# first write:  rejected: Error: runId getter exploded
# second valid write: rejected: Error: runId getter exploded
# notes: []
# no output file
```

This is a normal JavaScript object accepted by the runtime API, not a filesystem fault. BigInt and
circular details, a missing parent directory, a directory target, a mode-0444 file, `/sys`, and
`/dev/full` were also exercised; those resolved and produced notes where appropriate. Make the
public boundary total over arbitrary input, keep error reporting from re-reading untrusted
properties, and recover the queue after a rejected operation.

### F-2 — Blocking: tee failure containment excludes sync throws and hung promises

`createTeeSink` evaluates every `s.write(event)` inside `Array.map` before `Promise.allSettled`
receives the promises, and then waits for all of them
([`sink.ts:161-172`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/sink.ts#L161-L172)).
The three required transport failures produced:

```text
node review-probes.mjs
# synchronous throw, [disk, transport]: caller rejected; disk wrote; no tee note
# synchronous throw, [transport, disk]: caller rejected; disk did not write; no tee note
# rejected promise: caller resolved; disk wrote; tee note present
# never-settling promise: still pending after 100 ms; disk wrote; no tee note
```

Wrap invocation of each leg and detach/timeout transport completion from the run-critical write.
The disk leg must be invoked regardless of array order, and the returned promise must settle even
when a transport never does.

### F-3 — Blocking: rotation can exceed the bound and silently lose records

The promise queue coordinates only one sink instance. Thirty-two instances writing the same live
path concurrently all observed an empty file and appended, producing a 3,478-byte live file under a
220-byte policy with no note. A single instance running 60 concurrent writes stayed within the same
bound, which isolates the missing cross-instance/process coordination.

Rotation also catches and discards every eviction/rename error, then truncates the live file
([`sink.ts:102-119`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/sink.ts#L102-L119)).
Making `events.1.jsonl` a directory caused the live-to-generation rename to fail; the sink silently
truncated the first record, wrote the second, and returned with `notes: []`. Finally, archive names
use only `Date.now()`
([`sink.ts:74-90`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/sink.ts#L74-L90));
fixing the clock to one millisecond across five rapid rotations retained only runs 2–4 and silently
overwrote runs 0–1.

```text
node review-probes.mjs
# one sink: max observed 214, bound 220
# 32 sinks: wave-one live bytes 3478, bound 220; 64/64 records happened to survive this run
node rotation-loss-probe.mjs
# firstStillPresent=false, secondPresent=true, notes=[]
node archive-collision-probe.mjs
# expectedRecords=5, retainedRunIds=[run-2,run-3,run-4], notes=[]
```

The rotation protocol needs cross-process exclusion, failure-atomic moves, collision-proof archive
names, and notes for every failed filesystem operation. The documented oversized-record exception
also produced a 590-byte live file under a 100-byte bound; either narrow the “holds a byte bound”
claim or choose a bounded representation for oversized records.

### F-4 — Blocking: valid-but-unexpected JSON crashes the offline reader

Both JSONL parsers cast `JSON.parse` output to an object and dereference it without checking that it
is non-null
([`claude.ts:71-109`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/claude.ts#L71-L109),
[`codex.ts:82-149`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/codex.ts#L82-L149)).
A one-line `null` file is valid JSON of an unexpected shape and throws from each seam. The outer
backfill loop calls the parser outside a catch
([`backfill/index.ts:100-110`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/index.ts#L100-L110)),
so one file takes down all three seams. A finite but out-of-range Codex `resets_at` also throws
`RangeError` from `toISOString()`
([`codex.ts:39-42`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/codex.ts#L39-L42)).

```text
node malformed-record-probe.mjs
# claude null: TypeError reading sessionId
# codex null: TypeError reading timestamp
# backfill with either file: same uncaught TypeError
# Codex resets_at=Number.MAX_VALUE: RangeError: Invalid time value
node packages/telemetry/dist/cli.js status --home <synthetic-null-home> --json
# dsh-telemetry failed: TypeError ... ; exit 1
```

Malformed records must be contained per file/seam and surfaced as notes, never abort the status
command.

### F-5 — Blocking: transcript content and paths are emitted, especially under `--json`

Claude copies the first user message into `title`
([`claude.ts:91-100`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/claude.ts#L91-L100));
Codex does the same
([`codex.ts:117-120`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/codex.ts#L117-L120));
and the opencode query deliberately selects `title` and `directory`
([`opencode.ts:43-50`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/opencode.ts#L43-L50)).
Every reader then retains `title`, `cwd`, and the store path as `origin`. `status --json` serialises
the whole snapshot without a public/redacted projection
([`cli.ts:169-190`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/cli.ts#L169-L190)).

Synthetic sentinel prompts/titles and paths from all three seams were present verbatim in parsed
JSON, including the exact `opencode.db` path. Human `runs` output also prints `run.title`
([`cli.ts:173-183`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/cli.ts#L173-L183)).
This directly violates issue #106's privacy constraint. Extract issue numbers without retaining
message text, omit transcript titles and working/store paths from public records, and make machine
output an explicit allowlist.

### F-6 — Blocking: snapshot bytes depend on the host locale

The purity search found four ambient-locale comparisons in `buildSnapshot`
([`snapshot.ts:60-63`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/snapshot.ts#L60-L63),
[`snapshot.ts:75-84`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/snapshot.ts#L75-L84),
[`snapshot.ts:112-145`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/snapshot.ts#L112-L145)).
The requested counterexample used identical runs and epic keys `ä` and `z`:

```text
LC_ALL=en_US.UTF-8 node locale-probe.mjs  # ["ä","z"]
LC_ALL=sv_SE.UTF-8 node locale-probe.mjs  # ["z","ä"]
```

That changes snapshot and rendered bytes without changing function arguments. Use a specified,
locale-independent comparator (for example, code-unit ordering) rather than the host default.

### F-7 — Blocking: CLI bounds and exit states do not mean what they say

`--limit 1` bounded Claude and Codex to one transcript each but returned all three opencode rows,
for five runs total. The SQLite query has no limit
([`opencode.ts:43-50`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/opencode.ts#L43-L50)).
`--since` is applied only after all stores have been scanned
([`cli.ts:140-144`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/cli.ts#L140-L144)),
so it bounds output, not work. It is not parsed as a date: `--since not-a-date` exited 0 and silently
returned zero runs.

Exit 0 also covered three unreadable stores and an unparseable `--items` file; both survived only as
notes. Exit 1 covered both a normal `why` miss and an internal malformed-store crash
([`cli.ts:146-155`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/cli.ts#L146-L155),
[`cli.ts:198-207`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/cli.ts#L198-L207)).
Consumers cannot distinguish success, incomplete evidence, bad data, and internal failure. Define
and document disjoint status classes, validate `--since`/`--now`, push time bounds into each reader,
and apply `--limit` to SQLite.

### F-8 — Narrow: ambiguous issue evidence is silently assigned to the lowest number

All unambiguous requested branches were handled correctly. A branch with two explicit issue forms
and a title containing `#39` and `#105` both produce `[39, 105]`. Snapshot attribution then chooses
the first resolving number
([`model.ts:191-216`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/model.ts#L191-L216),
[`snapshot.ts:51-58`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/snapshot.ts#L51-L58)).
With #39 in E9 and #105 in a review epic, the synthetic run was silently assigned to E9. Ambiguous
evidence should remain unattributed with a note unless an explicit precedence contract identifies
the work item.

### F-9 — Narrow: tolerated truncation/unknown records are silent, and unknown records move activity

Mid-JSON and mid-UTF-8 tails preserved the valid prefix for both JSONL seams, but neither produced a
note. A future/unknown record type was also ignored without a note while its timestamp still became
the run's `updatedAt`, because timestamps are accepted before record-type dispatch
([`claude.ts:81-105`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/claude.ts#L81-L105),
[`codex.ts:91-122`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/codex.ts#L91-L122)).
That can make an old run appear recently active from a record the package does not understand.
Surface per-seam degradation and update activity only from understood record types.

### F-10 — Narrow: `runs --json` discards incompleteness notes

`status --json` parsed and retained notes, but `runs --json` emits the raw array and drops every
backfill note
([`cli.ts:169-190`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/cli.ts#L169-L190)).
The synthetic `--limit 1` result was an array of five runs with no `notes` field even though both
JSONL scans were truncated. Machine consumers therefore receive a result shaped like complete
evidence. Return a stable envelope containing runs and notes.

## Required checklist

The host had Node 26.8.1 and no global pnpm. The exact pin was installed without scripts into an
ephemeral prefix and invoked with its bin directory on `PATH`:

```text
npm install --prefix "$TOOL_DIR" --ignore-scripts --no-save pnpm@11.25.0
node "$TOOL_DIR/node_modules/pnpm/bin/pnpm.cjs" install --frozen-lockfile
PATH="$TOOL_DIR/node_modules/.bin:$PATH" node "$PNPM_CLI" run typecheck
PATH="$TOOL_DIR/node_modules/.bin:$PATH" node "$PNPM_CLI" run build
node "$PNPM_CLI" --filter @rickylabs/telemetry test
# install, graph check, typecheck, build: exit 0; telemetry: 116/116 pass
```

The probes below were an ephemeral reviewer script against the built detached checkout. Inputs and
observations are recorded so no real-store data is needed to reproduce them.

### Sink

- **Caller failure — FAIL.** Command: `node review-probes.mjs`. Missing parent created and wrote;
  directory target, mode-0444 target, `/sys`, and `/dev/full` resolved with EISDIR/EACCES/EROFS/ENOSPC
  notes. BigInt and circular values resolved with serialisation notes; an `undefined` property was
  omitted and wrote valid JSON. A 590-byte record under a 100-byte policy resolved, wrote 590 bytes,
  and noted the breach. An enumerable throwing `runId` getter rejected two consecutive calls and
  emitted no note. See F-1.
- **Tee degradation — FAIL.** Command: `node review-probes.mjs`. A synchronous throwing transport
  rejected the caller; ahead of disk it prevented the disk invocation. An asynchronously rejected
  transport resolved with a note and preserved disk. A never-settling transport was still pending
  after 100 ms although disk had written. See F-2.
- **Rotation — FAIL.** Commands: `node review-probes.mjs`, `node rotation-loss-probe.mjs`, and
  `node archive-collision-probe.mjs`. One-instance concurrency held 214 ≤ 220 bytes; 32 independent
  instances produced 3,478 > 220. A failed generation rename silently lost the preceding record;
  two same-millisecond archive names silently overwrote two of five records. See F-3.
- **No socket or credential — PASS.** Command:
  `grep -Eni 'fetch|https?\b|node:(http|https|net|tls)|process\.env|authorization|credential|token|\bkey\b' packages/telemetry/src/{sink,rotation}.ts`.
  No matches. The same added-line scan over the package found only prose and credential-shaped test
  fixtures, no runtime network import/call, environment read, auth header, or credential access. Any
  runtime network module/API, environment-secret read, auth header, or credential path would have
  been a counterexample.

### Backfill readers and units

- **Truncation and malformed shape — FAIL.** Commands: `node review-probes.mjs`,
  `node malformed-record-probe.mjs`, and `node unknown-record-probe.mjs`. Mid-JSON and mid-codepoint
  tails preserved valid prefixes but emitted no note; empty and one-byte files returned null; arrays,
  numbers, and objects without identity returned null; valid JSON `null` threw from Claude and Codex
  and aborted backfill; unknown types silently advanced `updatedAt`. SQLite empty/one-byte/JSON files
  became notes rather than throws. See F-4 and F-9.
- **Claude deltas — PASS with a documented reverse risk.** Command: `node review-probes.mjs`. Turns
  `10/2` and `20/3` produced `30/5`, as required by issue #106. Feeding running totals 100 then 150
  produced 250, confirming there is no shape-level discriminator. The committed test asserts the
  per-turn convention, but this vendor store is not a contract; a format change needs a fixture/gate.
- **Codex totals and seconds — PASS.** Command: `node review-probes.mjs`. Running totals 100/10 then
  150/15 produced 150/15, not 250/25. `resets_at=1788566400` produced
  `2026-09-05T00:00:00.000Z`, confirming Unix seconds were multiplied by 1,000. The out-of-range
  finite counterexample still crashes; see F-4.
- **opencode milliseconds/read-only/lifecycle — PASS.** Command: `node review-probes.mjs`. Values
  `1788566400000`/`1788566460000` produced 00:00/00:01 UTC. A read-only connection saw the committed
  row while another connection held `BEGIN IMMEDIATE` in WAL mode, did not see the uncommitted row,
  and rejected an insert as read-only. Missing, empty, one-byte, and non-SQLite stores became notes.
  The query failure path closes in `finally`
  ([`backfill/index.ts:119-128`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/index.ts#L119-L128)).
- **Mixed totals — PASS.** Command: `node review-probes.mjs`. Hand calculation:
  Claude 30/5 + Codex 150/15/6 reasoning + opencode 7/8/9 reasoning/$1.25 =
  **187 input, 28 output, 15 reasoning, $1.25**. `sumUsage` returned exactly those values.
- **Absent versus zero — PASS.** Command: `node review-probes.mjs`. `[{}]` summed to `{}` while
  `[{inputTokens: 0}]` summed to `{inputTokens: 0}`; `humanTokens` rendered them as `—` and `0`.

### Output

- **Purity — FAIL.** Commands:
  `grep -En 'Date\.now|new Date\(|Math\.random|readFile|process\.|localeCompare|toLocaleString|Intl' packages/telemetry/src/{snapshot,render}.ts`
  plus the two `LC_ALL=... node locale-probe.mjs` runs. Only four `localeCompare` calls matched, and
  they changed identical-input epic order from `["ä","z"]` to `["z","ä"]`. Any wall clock,
  filesystem/network/process read, randomness, host-locale formatter, or differing bytes from equal
  arguments counted as a counterexample. See F-6.
- **`--now` controls ages — PASS.** Command: `node review-probes.mjs`. A fixed now rendered both quota
  observation age (`read 6h 0m ago`), quota reset (`resets in 1h 0m`), and run update age; the purity
  grep found no clock read in snapshot/render. The CLI default uses the clock only when `--now` is
  absent ([`cli.ts:52-58`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/cli.ts#L52-L58)).
- **Stale governance — PASS.** Command: `node review-probes.mjs`. A six-hour-old reading rendered
  visibly as `(read 6h 0m ago)`; no reading rendered
  `governance: no seam reported a quota window in this scan`.
- **Notes — PASS for supplied notes; FAIL for parser degradation.** Command:
  `node review-probes.mjs`. A render with Claude, Codex, and opencode failures showed all three in one
  notes section; one missing store also remained visible. Parser truncation/unknown-type notes never
  exist to carry forward; see F-9.
- **Run-to-issue attribution — FAIL only when ambiguous.** Command: `node review-probes.mjs`.
  `release/2.1.0→[]`, `v3→[]`, `orch/divybot-39→[39]`, `issue-42→[42]`,
  `feat/issue/7-x→[7]`, and `hotfix/2026-09-05→[]`. A branch with explicit 39 and 105 and a title
  with `#39` and `#105` each produced `[39,105]`; with both board items present the run was silently
  credited to the lower-numbered E9 item. See F-8.
- **Without `--items` — PASS.** Command: `node review-probes.mjs`. Human status contained the
  unattributed section and `no --items given` note.

### CLI

- **Exit codes — FAIL.** Commands: `node review-probes.mjs` and direct CLI invocations against a
  synthetic malformed home. Unreadable stores, invalid items JSON, and invalid `--since` all exited
  0. A malformed store/internal crash and a normal missing `why` target both exited 1. Usage errors
  exit 2. The codes are not disjoint. See F-7.
- **`--home` — PASS.** Command:
  `HOME=/definitely/not/a/real/home node --test 'packages/telemetry/dist/**/*.test.js'`.
  All 116 tests passed. Every integration call supplies a synthetic `--home`; source search found
  the chosen value passed once through `defaultRoots` to all three exact roots
  ([`cli.ts:127-143`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/cli.ts#L127-L143),
  [`backfill/index.ts:138-144`](https://github.com/rickylabs/harness/blob/96350cebd4dd727cb522be463adb3ceec04da6e7/packages/telemetry/src/backfill/index.ts#L138-L144)).
- **JSON — FAIL.** Command: `node review-probes.mjs`. `status --json` parsed and retained status
  notes, but leaked every synthetic privacy sentinel (F-5). `runs --json` returned a bare array and
  discarded truncation notes (F-10).
- **`--limit` and `--since` — FAIL.** Command: `node review-probes.mjs`. `--limit 1` returned five
  runs (one per JSONL seam plus all three SQLite rows); `--since` filters only after reading all
  stores and accepts invalid values. See F-7.

### Privacy

- **No transcript content emitted — FAIL.** Commands: the privacy grep and
  `node review-probes.mjs`. The grep found both message-to-title copies, opencode title/directory
  selection, retained `cwd`/`origin`, human title output, and raw JSON snapshot output. Synthetic
  prompt/title/path sentinels from all seams appeared in `--json`; no real transcript was used.
- **No credential read/write — PASS.** Command:
  `grep -Eni 'auth\.json|credential|readdir|glob' packages/telemetry/src/backfill/*.ts` plus inspection
  of `SESSION_QUERY`. The implementation opens the exact `opencode.db` path and queries only named
  `session` columns; it does not glob the opencode directory, touch `auth.json`, query a credential
  table, or list directory contents in output. The SQLite write probe was rejected as read-only.
- **`--json` dangerous surface — FAIL.** Command: `node review-probes.mjs`. The output parsed, but
  exposed all three synthetic titles/prompts, all three working-directory sentinels, and the DB
  origin. A machine-readable allowlist is required before this surface is safe to pipe elsewhere.
