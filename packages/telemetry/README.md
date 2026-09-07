# @rickylabs/telemetry

`SessionTelemetrySink` and `dsh-telemetry` — the "status ?" killer.

Owned by epic E9 · #39. See [`packages/README.md`](../README.md) for workspace conventions.

## Why this exists

> I'm constantly spamming `status ?` to my current orchestrator because I have zero visibility
> across the board.

Asking an agent for status has three failure modes, and all three happen: the agent is busy, the
agent is the thing that broke, or the agent answers from a context window rather than from the
board. This package answers the question without an agent in the loop.

That constraint drives every decision below. **The command reads files, and that is all it does.**
No token, no socket, no daemon, no agent — because a status command that needs the fleet to be
healthy is a status command that fails exactly when it is needed.

## Two halves and the join

**Forward** — `SessionTelemetrySink` is what a run writes to as it works. One method, one record, no
return worth branching on: a run must never fail because telemetry did, and an orchestrator must
never be able to make progress conditional on the sink having accepted something. Every
implementation swallows its own IO errors into a note rather than throwing at the caller.
`createFileSink` holds a byte bound with rotation to a cold tier; `createTeeSink` fans out so a run
writes to disk and to a transport at once, and the disk copy survives when the transport is the
thing that is down. Nothing here opens a socket — E8's `/api/remote.mux` push plugs into this shape
later, and the file sink is what works today with no transport at all.

**Backward** — `backfillFromDisk` reads what the three vendor CLIs already wrote, so the board is
populated from history the moment this lands rather than from the next run onward:

| seam | store | identity | usage | quota |
| --- | --- | --- | --- | --- |
| claude | `~/.claude/projects/<slug>/<id>.jsonl` | `message.model` + `effort` | per-turn deltas, summed | — |
| codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `turn_context` | `total_token_usage`, a running total | `rate_limits` |
| opencode | `~/.local/share/opencode/opencode.db` | `session.model` / `agent` | `tokens_*` columns + `cost` | — |

Vendor formats are not a contract. Each reader is written to survive a half-written last line, an
unknown record type, and a store that is not there at all — and to say so when it does.

**Joined** — neither half answers the question alone. Look at the table above: only one of the three
seams records anything about how a run ended. The Claude and opencode stores write no completion
marker at all, so a run recovered from either of them reads `unknown` forever — the transcript stops,
and a transcript that stopped looks identical whether the run finished, wedged, or was killed. The
sink can say, because whatever launched the run watched it stop.

`live.ts` merges the log back over the backfill by run id, and `tree`, `status`, `runs` and `why`
all answer from the merged view. Keying on the run id is what makes it safe to re-read the whole log
every time: replaying it over an already-merged view is a no-op, so there is no ingestion cursor to
keep, and none to lose when the box goes down mid-write.

Three rules decide what the log is allowed to do to a transcript:

1. **A live outcome fills in a transcript that could not say, and never overrules one that could.**
   `complete` and `failed` on disk are the vendor's own assertion about its own run; `unknown` is an
   admission, and an admission is what the log is here to answer.
2. **A run only the log knows about becomes a run** — with the log itself as the file `why` hands
   over, since on that box there is nothing else to open.
3. **A live-only run that names no seam is counted and reported, never guessed at.** `RunSource`
   carries governance meaning — two of its three values are subscription windows that can be
   exhausted — so attributing a run to the wrong seam is worse than attributing it to none. It
   raises status 3 like any other gap.

The `detail` keys the merge reads are `source`, `outcome`, `parentId`, `branch`, `model`, `effort`,
`provider` and `profile`. Anything else in a recorded event is carried and ignored: the sink is a
pipe, not a schema authority, and a merge that inferred an outcome from an event's `kind` would be
guessing at a vocabulary nobody has agreed on. `startedAt` takes the earlier of the two and
`updatedAt` the later; identity fields fill only empty slots, because a transcript saw the model the
run actually used and a launcher only saw the one it asked for. `usage` and `quota` stay
transcript-only — those are counted by the vendor, and a launcher is not in a position to count them.

## Three properties the output holds

1. **Governance goes first.** "Why is nothing running" is a status question. Typed account windows,
   provider spend, local RAM/VRAM capacity, and item-scoped admission refusals appear above the work.
   Each observation carries its own age and availability: stale values stay visible as stale, null
   measurements read "unknown / never read", and absent input is explicit rather than looking like
   "all clear".
2. **Notes are never dropped, and a gap is machine-readable.** Every store that could not be read
   becomes a note on the same screen as the work that was found. An unreadable seam is never an
   exception and never a silent absence, because a run that is missing looks exactly like a run that
   never happened. Prose is not something a script can branch on, so the same fact is also carried as
   an exit status (3) and as `complete: false` in every `--json` envelope.
3. **An absent count is not a zero.** `sumUsage` reports a field only if some seam reported it.
   Rendering `0 tokens` for a seam that does not report cost is a lie about the seam, not about the
   run.

`buildSnapshot` and `renderSnapshot` are pure functions of their inputs — no clock, no filesystem,
no network — so two people looking at the same snapshot are looking at the same thing. `--now` makes
even the ages reproducible.

## Using it

```bash
pnpm --filter @rickylabs/telemetry build
node packages/telemetry/dist/cli.js status --items board-items.json
```

```
dsh-telemetry tree [options]       milestone → epic → task → subagent, the whole board
dsh-telemetry status [options]     runs grouped by epic
dsh-telemetry runs [options]       one line per run, newest first
dsh-telemetry why <run-id>         which log to open first for that run
dsh-telemetry record [options]     append events to the observability log
dsh-telemetry where [options]      where that log is, and the layers below a run

--home <path>          home directory the stores live under (default: this user's)
--items <path>         board items to join runs to: "dsh-board snapshot" output, or a
                       JSON array of {number, title, epic, milestone, phase} refs
--observations <path>  governance observation JSON for tree/status
--limit <n>            runs to read per seam, most recent first (default: 500)
--since <iso>          only runs with activity at or after this time
--now <iso>            reference time for ages, so output is reproducible
--json                 machine-readable output
--run <id>             with "record": the run one event belongs to
--kind <name>          with "record": write that one event instead of reading stdin
```

### Synthetic governance fixture

The commands below create a synthetic display fixture entirely from the literal values shown. It is
not telemetry from this host and it is not a production authority. The repository deliberately does
not commit the generated JSON because `check:snapshots` forbids time-sliding allowance data. Use an
isolated temporary home and remove any telemetry location overrides when exercising it:

```bash
fixture_home="$(mktemp -d)"
node - "$fixture_home/governance.json" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
const observedAt = "2026-09-07T11:55:00.000Z";
const observation = {
  observedAt,
  validUntil: "2026-09-07T12:05:00.000Z",
  provenance: "synthetic:test",
  state: {
    generatedAt: observedAt,
    regimes: [
      { regime: "subscription", state: "throttle", accounts: [{
        seam: "codex", account: "primary", state: "throttle", observedAt,
        windows: [{ label: "5h", windowMinutes: 300, usedPercent: 63,
          resetsAt: "2026-09-07T13:00:00.000Z", binding: true }],
      }], note: "paced against the binding window" },
      { regime: "metered", state: "allow", providers: [{
        provider: "openrouter", spentUsd: 12.5, ceilingUsd: 50,
        windowLabel: "monthly", observedAt,
      }], note: null },
      { regime: "capacity", state: "allow", hosts: [{
        host: "n5-fixture", vramUsedBytes: 8 * 1024 ** 3, vramTotalBytes: 24 * 1024 ** 3,
        ramUsedBytes: 32 * 1024 ** 3, ramTotalBytes: 128 * 1024 ** 3, observedAt,
      }], note: null },
    ],
    pending: [],
    notes: [],
  },
  admissions: [{
    item: { number: 205 }, regime: "subscription", state: "throttle",
    observedAt: "2026-09-07T11:54:00.000Z", validUntil: "2026-09-07T12:01:00.000Z",
    provenance: "synthetic:dispatcher",
    outcome: { accepted: false, reason: "quota-paced",
      detail: "waiting for the next subscription slot" },
  }],
};
fs.writeFileSync(path, `${JSON.stringify(observation, null, 2)}\n`);
NODE

env -u DSH_TELEMETRY_DIR -u DSH_TELEMETRY_ARCHIVE \
  -u DSH_TELEMETRY_MAX_BYTES -u DSH_TELEMETRY_GENERATIONS \
  node packages/telemetry/dist/cli.js status \
  --home "$fixture_home" \
  --observations "$fixture_home/governance.json" \
  --now 2026-09-07T12:00:00.000Z

env -u DSH_TELEMETRY_DIR -u DSH_TELEMETRY_ARCHIVE \
  -u DSH_TELEMETRY_MAX_BYTES -u DSH_TELEMETRY_GENERATIONS \
  node packages/telemetry/dist/cli.js tree --json \
  --home "$fixture_home" \
  --observations "$fixture_home/governance.json" \
  --now 2026-09-07T12:00:00.000Z
```

To exercise a changed decision, copy the fixture into the temporary home, edit the copy, and point
`--observations` at it. Change `admissions[0].outcome.reason` or `.detail` to see the actual refusal
beside item `#205`; change `vramUsedBytes`, `vramTotalBytes`, `ramUsedBytes`, or `ramTotalBytes`
under the capacity entry in `state.regimes`; then run the same command again. The CLI reads the file
on every invocation, so the next result reflects the edited admission and capacity without a daemon
or cache.

This continuation changes both the admission and local capacity, then re-reads the fixture:

```bash
node - "$fixture_home/governance.json" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
const observation = JSON.parse(fs.readFileSync(path, "utf8"));
observation.admissions[0].outcome.reason = "capacity-held";
observation.admissions[0].outcome.detail = "fixture VRAM headroom reserved";
const capacity = observation.state.regimes.find((entry) => entry.regime === "capacity");
capacity.hosts[0].vramUsedBytes = 20 * 1024 ** 3;
fs.writeFileSync(path, `${JSON.stringify(observation, null, 2)}\n`);
NODE

env -u DSH_TELEMETRY_DIR -u DSH_TELEMETRY_ARCHIVE \
  -u DSH_TELEMETRY_MAX_BYTES -u DSH_TELEMETRY_GENERATIONS \
  node packages/telemetry/dist/cli.js status \
  --home "$fixture_home" \
  --observations "$fixture_home/governance.json" \
  --now 2026-09-07T12:00:00.000Z
```

With no `--observations`, governance is `UNKNOWN / UNAVAILABLE`. A requested file that cannot be
read or validated also renders unavailable, sets `complete: false` in JSON, and exits 3. A valid but
expired observation remains visible as `STALE`. Producer-authored `reason`, `detail`, pending
`summary`, and `notes` are intentionally public display text; a future producer must supply text
safe for that surface. This fixture meets that obligation and contains no credentials or real host
measurements.

Both bounds are pushed into the readers rather than applied to the answer: `--since` skips a
transcript whose modification time is older than the cutoff without opening it, and reaches the
opencode seam as a `where` clause. A bound on output wearing the costume of a bound on work is worth
nothing on the box this is meant to be run on. When `--limit` is what decides which runs you see,
the scan keeps the *newest* ones — an alphabetical truncation answers "what is running" with
whichever sessions happen to sort first, which for a fleet is the ones that finished weeks ago.

The live log is the exception, and deliberately so: it is read whole, and `--since` is applied to
the merged view rather than to the log lines. A run whose transcript fell outside the window but
whose log line did not is a run that moved, and dropping the line before the merge would hide the
move. The log is bounded by rotation, so "read it whole" is bounded too.

### Exit status

This command is going to be run from scripts and from cron, so the statuses are disjoint and each
one is a different thing to do about it:

| status | meaning |
| --- | --- |
| 0 | the picture is complete |
| 1 | `dsh-telemetry` itself failed |
| 2 | the command line was wrong |
| 3 | the picture is incomplete: a store could not be read, or a scan hit `--limit` |
| 4 | nothing matched, on a scan that could see everything |

3 is the one that matters. The answer printed above it is real but partial, and a caller that treats
it as complete concludes the board is quiet when in fact the scan could not see. 3 outranks 4 for the
same reason: "I did not find it" and "I could not see everywhere" are different answers, and when
both are true the second is the one to act on.

A store that is simply not on this box is *not* status 3. A machine that does not run Codex has no
Codex store, and saying so is a complete answer — if that were a gap, every laptop in the fleet would
report a permanent fault.

### What leaves the machine

`--json` output is piped into other tools, pasted into issues and read by the board projection, so
it is a published surface rather than a debug dump. Both `status --json` and `runs --json` return an
envelope that states its own completeness:

```json
{ "generatedAt": "...", "complete": false, "runs": [], "notes": ["claude: 900 transcript(s) match — only the 500 most recent were read"] }
```

Every published field is listed by hand in `public.ts`. `JSON.stringify(record)` publishes whatever
the record happens to carry, which means the next field added to `RunRecord` would be published the
moment it exists, by nobody's decision. The standing example is `origin`, the transcript a run was
read out of: a path naming a person's home directory and every repository they work on. It is
excluded from both envelopes and from every note, and it leaves through exactly one command —
`why`, which an operator runs on the box the file is on, and whose entire job is to hand it back.

For the same reason a run record carries no title and no `cwd`. Both used to: a Claude or Codex
title was the first 120 characters of the operator's first message.

Board items come from a JSON file rather than a fetch. The fetch belongs to `@rickylabs/board`
(E6 · #36); wiring it in here would give the status command a GitHub token dependency, and the day
the token is the problem is a day you need status to work.

```
board activity as of 2026-09-05T00:45:00.000Z

governance: FRESH · synthetic:test · observed 5m ago
  subscription [throttle] — paced against the binding window
    codex/primary [throttle] · read 5m ago
      binding 5h: 63% used · resets in 1h 0m
  metered [allow]
    openrouter: $12.50 spent / $50.00 ceiling (monthly) · read 5m ago
  capacity [allow]
    n5-fixture · read 5m ago
      VRAM 8.0 GiB used / 24.0 GiB total · 16.0 GiB headroom
      RAM  32.0 GiB used / 128.0 GiB total · 96.0 GiB headroom
  #205 throttle [subscription] — quota-paced: waiting for the next subscription slot
    · synthetic:dispatcher · read 6m ago

3 run(s) across 3 epic(s) · 1.1Min/65.2kout · $0.04

epic:E4 (W1)
  · opencode  #90 routing policy bindings
      z-ai/glm-5.3-flash · 96.0kin/5.1kout · updated 7m ago

epic:E6 (W2)
  ▶ codex     #101 board projection
      gpt-5.6-sol/xhigh · 240.1kin/18.9kout · updated 33m ago

epic:E9 (W2)
  · claude    #39 telemetry sink
      claude-opus-5/medium · 812.4kin/41.2kout · updated 5m ago
```

`tree` prints those same runs one level lower, under the item they joined to, and there the run line
carries no `#number title` at all — the line directly above already does. A restated title is a
second copy of the longest string on the screen at a deeper indent, so it is the copy that wraps, on
exactly the rows an operator scanning for "what is happening right now" reads first:

```
    #210 `release` is the one lease door that does not check the fence: an evicted h…
        issue open · impl · live (turn, 5m ago)
        ▶ claude    claude-opus-5/medium · 812.4kin/41.2kout · updated 5m ago
```

Every title on the screen is clipped, including on lines with nothing printed after them. A GitHub
title is arbitrary text somebody typed, and one long one costs the alignment of every row under it.

Without `--items` nothing is attributed — and the snapshot says that rather than showing an empty
board, because silence there reads as "no work is happening", which is the exact wrong answer. An
unattributed run is named by its session id, which is what `why` takes, rather than by a title a run
record does not carry:

```
unattributed — 3 run(s) the board cannot see
  · claude    01997e0c
      claude-opus-5/medium · 812.4kin/41.2kout · updated 5m ago
  ...

notes:
  no --items given: runs are listed but not attributed to epics
```

Runs are joined to issues through the branch name (`orch/divybot-39`, `issue-42`,
`feat/issue/7-x`) and through an explicit `#NN` in the title. A bare number in a branch is a version,
not an issue, so `release/2.1.0` links to nothing.

### `why`

`why` answers "the run is not moving, where do I look" without making the operator guess which of
four layers failed. The ordering is the point — the first pointer is the one that pays off:

```
ses-stuck (claude, unknown) — look here, in this order:

  the run's own transcript
    ~/.claude/projects/<slug>/ses-stuck.jsonl

  dispatcher capacity decisions
    the dispatcher's own log on the orchestrator host
    grep: no host with free capacity|operator timeout|deferring
    why: a run that never appears is not a failed run; the dispatcher deferred it, and only its log says so
```

A run that spent zero tokens never got one back, so it is a dispatch or a load failure, and the
dispatcher's log goes first. A relay run goes to the relay log first and to LM Studio's own
`server-logs` second — not to the container's stdout, which is the webtop GUI stream and never
carries a load failure. A healthy run returns an empty list, because there is no layer below a run
that worked.

A run only the live log knows about points at the log. That is not a fallback: on this box the log
is the one file that has ever mentioned the run, and handing over a transcript path that does not
exist would be worse than handing over nothing. On a merged run the pointer stays the transcript,
because `why` exists to hand over the file that *explains* the run, and a transcript explains more
than a line of JSON does.

## Tests

342 tests, no mocked seams: the sink tests write to real temp directories, the opencode tests build
a real SQLite database, and the CLI tests run `main()` against a seeded home and read what an
operator would see. The live-log tests seed a real log through `resolveObservability`, so they stay
honest on a box where `DSH_TELEMETRY_DIR` is set to somewhere else.

The suite was checked by mutation rather than by coverage. Thirty-five defects — each one a
behaviour a test claims to guard — were reintroduced into pristine source one at a time, rebuilt,
and run. All thirty-five were caught, most by the test written for them:

| mutation | reintroduced defect | tests failed |
| --- | --- | --- |
| `rotation-evicted` | evict one generation too late | 2 |
| `rotation-boundary` | rotate on size alone, ignoring the incoming record | 9 |
| `sum-absent` | report an unreported field as zero | 4 |
| `sink-serialize` | let concurrent writes race the bound | 1 |
| `sink-oversize-silent` | drop the oversized-record note | 1 |
| `codex-total` | sum a running total instead of taking the last | 1 |
| `codex-epoch` | accept `0` as a timestamp | 1 |
| `claude-outcome` | call an unfinished run complete | 2 |
| `claude-sum` | take the last turn's usage instead of summing | 1 |
| `opencode-effort` | read the agent name as an effort | 1 |
| `opencode-query` | widen the read beyond `session` | 2 |
| `opencode-epoch` | date a null creation time to 1970 | 1 |
| `backfill-unconfigured` | report an absent store as empty | 1 |
| `backfill-truncation` | drop the truncation note | 1 |
| `backfill-unsorted` | truncate unreproducibly | 1 |
| `snapshot-stranded` | let a pure parent cycle vanish | 1 |
| `snapshot-cycle` | recurse into a cycle | 1 |
| `snapshot-orphan-note` | hide an orphaned subagent | 1 |
| `render-governance-footer` | move governance below the work | 2 |
| `render-quota-silent` | render an empty governance section | 2 |
| `render-notes-dropped` | drop notes | 3 |
| `cli-limit` | accept `--limit 1.5` as `1` | 1 |
| `cli-items-note` | show an empty board instead of saying why | 1 |
| `diagnostics-dispatch` | stop blaming the dispatcher first | 1 |
| `since-after-read` | filter `--since` after reading, so the bound is on output not work | 1 |
| `truncate-oldest` | keep the oldest transcripts when `--limit` has to choose | 1 |
| `absent-is-a-gap` | report a vendor this box does not run as a hole in the scan | 9 |
| `unreadable-is-not` | report a store that will not open as an ordinary empty result | 2 |
| `opencode-unbounded` | let `--limit` mean nothing on the opencode seam | 4 |
| `since-interpolated` | build the cutoff into the SQL text instead of binding it | 2 |
| `miss-is-failure` | exit 1 for a run that is not there, the same status as a crash | 1 |
| `loose-time-flag` | accept an unparseable `--since` and compare it as a string | 1 |
| `runs-bare-array` | emit `runs --json` as a bare array, dropping every note | 3 |
| `incomplete-exits-ok` | exit 0 from a status whose scan could not see everything | 2 |
| `publish-origin` | publish the transcript path on every projected run | 5 |

Two of these were real defects found while writing the tests, not planted afterwards: a parent cycle
with no member outside it produced no root, so those runs disappeared from the snapshot entirely
(`snapshot.ts`), and `--limit 1.5` silently became a scan of one (`cli.ts`).

That sweep predates `live.ts` and has not been re-run against it. The merge is instead pinned by
assertion: idempotence is asserted directly, by merging a log over an already-merged view and
deep-comparing the runs, which is the property the whole no-cursor design rests on.
