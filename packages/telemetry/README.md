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

## Two halves

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

## Three properties the output holds

1. **Governance goes first.** "Why is nothing running" is a status question. The quota line is above
   the work, not in a footer, and it carries its own age — a stale reading is worse than none,
   because it is the shape of an answer, so nobody re-checks it. When no seam reported a window, the
   snapshot says so out loud rather than rendering an empty section that reads as "all clear".
2. **Notes are never dropped.** Every store that could not be read becomes a note on the same screen
   as the work that was found. An unreadable seam is never an exception and never a silent absence,
   because a run that is missing looks exactly like a run that never happened.
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
dsh-telemetry status [options]     render the current picture
dsh-telemetry runs [options]       one line per run, newest first
dsh-telemetry why <run-id>         which log to open first for that run

--home <path>          home directory the stores live under (default: this user's)
--items <path>         JSON array of board items to attribute runs to
--limit <n>            transcripts to scan per seam (default: 500)
--since <iso>          drop runs whose last activity is older than this
--now <iso>            reference time for ages, so output is reproducible
--json                 machine-readable output
```

Board items come from a JSON file rather than a fetch. The fetch belongs to `@rickylabs/board`
(E6 · #36); wiring it in here would give the status command a GitHub token dependency, and the day
the token is the problem is a day you need status to work.

```
board activity as of 2026-09-05T00:45:00.000Z

governance:
  codex     63% used of a 5h window, resets in 27m [pro]  (read 33m ago)

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

Without `--items` nothing is attributed — and the snapshot says that rather than showing an empty
board, because silence there reads as "no work is happening", which is the exact wrong answer:

```
unattributed — 3 run(s) the board cannot see
  · claude    telemetry sink
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

## Tests

116 tests, no mocked seams: the sink tests write to real temp directories, the opencode tests build
a real SQLite database, and the CLI tests run `main()` against a seeded home and read what an
operator would see.

The suite was checked by mutation rather than by coverage. Twenty-four defects — each one a
behaviour a test claims to guard — were reintroduced into pristine source one at a time, rebuilt,
and run. All twenty-four were caught, most by the test written for them:

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

Two of these were real defects found while writing the tests, not planted afterwards: a parent cycle
with no member outside it produced no root, so those runs disappeared from the snapshot entirely
(`snapshot.ts`), and `--limit 1.5` silently became a scan of one (`cli.ts`).
