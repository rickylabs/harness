<!-- Generated from packages/telemetry/src/cli.ts by scripts/cli-reference.mjs. Do not edit; run "pnpm run docs:cli". -->

# `dsh-telemetry`

> board activity, read from disk, with no agent awake

Temporary compatibility alias for [`harness-telemetry`](harness-telemetry.md). Both names run the
same entrypoint, help text and exit statuses. Prefer the canonical command in new callers.

Shipped by [`packages/telemetry`](../../../packages/telemetry). This page is *what it does*;
*why it does it that way* is [`packages/telemetry/README.md`](../../../packages/telemetry/README.md).

## Exit codes

| code | name | meaning |
| --- | --- | --- |
| `0` | `ok` | the picture is complete |
| `1` | `failed` | harness-telemetry itself failed |
| `2` | `usage` | the command line was wrong |
| `3` | `incomplete` | the picture is incomplete: a store could not be read, or a scan hit --limit |
| `4` | `notFound` | nothing matched, on a scan that could see everything |

Read from `EXIT` and `EXIT_MEANINGS` in [`packages/telemetry/src/cli.ts`](../../../packages/telemetry/src/cli.ts). The `exit codes`
block in the help text below renders from those same two constants, so this table, that block
and the number the process actually returns cannot disagree.

## `dsh-telemetry --help`

```text
harness-telemetry — board activity, read from disk, with no agent awake

usage:
  harness-telemetry codex-threads [--limit <n>] [--private] [--watch]  native thread JSON / goal JSONL
  harness-telemetry action-receipt --json --operation <uuid> [--digest <sha256>]  sanitized Orchid delivery
  harness-telemetry issue-agents [--json | --watch] [--home <path>] [--limit <n>] [--issue <owner/repo#number>] [--interval-ms <n>]  per-issue agent trees
  harness-telemetry run-observation --source <absolute descriptor path>  selected enrolled run JSON
  harness-telemetry governance --observations-from <descriptor>  typed governance JSON
  harness-telemetry account-usage --source <descriptor> [--watch]  subscription quota and session token JSON
  harness-telemetry tree [options]       milestone → epic → task → subagent, the whole board
  harness-telemetry status [options]     runs grouped by epic
  harness-telemetry runs [options]       one line per run, newest first
  harness-telemetry why <run-id>         which log to open first for that run
  harness-telemetry record [options]     append events to the observability log
  harness-telemetry where [options]      where that log is, and the layers below a run

options:
  --home <path>          home directory the stores live under (default: this user's)
  --items <path>         board items to join runs to: "harness-board snapshot" output, or a
                         JSON array of {number, title, epic, milestone, phase} refs
  --observations <path>  governance observation JSON for tree/status
  --observations-from <spec>  live source descriptor JSON path, or file:<absolute-path>
  --limit <n>            runs to read per seam, most recent first (default: 500)
  --since <iso>          only runs with activity at or after this time
  --now <iso>            reference time for ages, so output is reproducible
  --json                 machine-readable output
  --run <id>             with "record": the run one event belongs to
  --kind <name>          with "record": write that one event instead of reading stdin
  --help

"--observations" is optional and applies to "tree" and "status". It reads one typed governance
snapshot: account subscription windows, provider spend, host RAM/VRAM, and item-scoped refused
admissions. The file is read again on every invocation. No flag is explicit UNKNOWN/UNAVAILABLE;
a requested unreadable or invalid file is incomplete (exit 3). Stale values stay visible as STALE,
and missing measurements stay unknown rather than becoming zero.

"--observations-from" applies to governance/tree/status and excludes "--observations". A descriptor
configures independent usage, spend, configured-cgroup-v2 and recorded-admission readers.
Model IDs, window durations and safe labels are runtime configuration. No model is dispatched.
Live readings use collection completion time unless --now explicitly sets the evaluation clock.
A failed requested leg is unread, keeps successful legs visible, and returns incomplete (exit 3).
All-unconfigured is UNAVAILABLE/exit 3. Unlimited cgroup total/headroom and pending approvals are
unknown. File mode retains stale values and its existing exit behavior. See telemetry README
for descriptor fields, the env-only service dependency and public-safe admission reason codes.

"governance" emits one versioned JSON document (also without --json). It requires a descriptor,
refuses file: and --observations/--items/--run/--kind/--limit/--since, and scans no transcripts.
Exit 0 means configured evidence is complete; exit 3 means incomplete or unavailable.
Exit 1 emits no document and a fixed diagnostic. Pending approvals remain not-observed.

"run-observation" accepts only --source and one absolute local descriptor path.
It reads one selected Codex native file, with source-root and enrolled worktree checks.
Exit 0 means the selected source was read; exit 3 withholds the run with typed coverage.
Invalid descriptors exit 1 with a fixed diagnostic and no JSON. No home scan or network.

"action-receipt" reads one owner-only Orchid delivery result from HARNESS_TELEMETRY_DISPATCH_ROOT.
It requires --json and --operation with a lowercase UUID; --digest selects that request's
primary result or immutable digest-conflict rejection. Output contains only bounded issue,
opaque agent/dispatch identifiers, digest, action, delivery outcome, fixed reason and time.
Private host, pane, native session, idempotency key and action text never leave the reader.
Exit 0 means an accepted or rejected delivery result was read; exit 3 means unknown or unread.
Delivery never proves execution; use the separate issue-agent feed for observed state.

"record" reads JSONL on stdin — one {"runId","kind","at","detail"} object per line, "at"
and "detail" optional. A bad line loses that line and is named; an empty batch is not an
error. The log is bounded and rotated, and it is the same file whether an agent, a shell
hook or a daemon wrote it.

"tree", "status", "runs" and "why" read that log back and merge it into the transcripts by
run id. The Claude and opencode stores write no completion marker, so a run recovered from
either of them reads "unknown" forever unless something says otherwise; a recorded event
whose detail carries "outcome" is what says otherwise. "detail" keys that mean something
here: source, outcome, parentId, branch, model, effort, provider, profile. A live outcome
fills in a transcript that could not say and never overrules one that could, and a run the
log knows about with no "source" is counted rather than guessed at.

environment:
  HARNESS_TELEMETRY_DIR          live log directory (default: ~/observability)
  HARNESS_TELEMETRY_ARCHIVE      cold tier for rotated generations, or "none" to delete them
                                 (default: ~/archives)
  HARNESS_TELEMETRY_MAX_BYTES    bound per generation, e.g. 33554432 or 32M
  HARNESS_TELEMETRY_GENERATIONS  generations kept behind the live file
  HARNESS_TELEMETRY_WIRE_FAMILY  harness or legacy; default legacy until reader rollout
  HARNESS_TELEMETRY_LOG_NAME     explicit harness-telemetry.jsonl or dsh-telemetry.jsonl
                                 (default remains dsh-telemetry.jsonl until producer rollout)
  HARNESS_TELEMETRY_DISPATCH_ROOT           private Orchid receipt root
  HARNESS_TELEMETRY_CLAUDE_CHILD_EVENT_ROOT private Claude child-start root
  HARNESS_TELEMETRY_PLACEMENT_HOST          exact verified host label

The corresponding DSH_TELEMETRY_* settings remain legacy aliases. Equal dual values are accepted;
conflicting values refuse the source. Native bindings keep exact values and existing private-source
checks. LOG_NAME is new and has no legacy alias. Readers and writers refuse mixed log families,
including rotations outside the configured count. A selected canonical source must contain valid
events; migration requires stopping writers and moving the whole family before changing settings.

exit codes:
  0  the picture is complete
  1  harness-telemetry itself failed
  2  the command line was wrong
  3  the picture is incomplete: a store could not be read, or a scan hit --limit
  4  nothing matched, on a scan that could see everything
```

---

Generated by [`scripts/cli-reference.mjs`](../../../scripts/cli-reference.mjs).
Editing this file by hand fails `pnpm run check:docs`; edit the CLI and run `pnpm run docs:cli`.
Back to [reference](../README.md) · [docs](../../README.md)
