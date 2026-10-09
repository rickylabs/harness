# @rickylabs/provider-agy

A bounded, private reader of agy's (Antigravity CLI) retained conversation log, for the telemetry
producer's issue-agent tree (#699). It names native tool calls. It never decides their lifecycle.

## What it reads, and why that surface

agy publishes the path of its persistent `transcript.jsonl` conversation log as `transcriptPath` in
every [hook](https://www.antigravity.google/docs/hooks) payload. The hooks are the vendor's
documented structured surface for an interactive session. Its stream-json output is a
[headless (print) mode](https://www.antigravity.google/docs/cli/headless/) surface. The Orchid
launch is interactive, so neither stream reaches it today. Installing hooks per launch is a deferred
follow-up. No ACP surface was discovered in the installed CLI. No terminal text is ever read.

The vendor documents the log's path, not its schema. The keys this package reads were measured on
agy 1.3.2: `step_index`, `type`, `tool_calls[{name, args}]` and `truncated_fields`. A line outside the
bounds in `src/domain/transcript-line.ts` makes the whole read invalid rather than guessed.

## What it returns

`readAgyToolCalls` returns a `NativeToolCallRead`, a shape owned by `@rickylabs/harness-contracts`:

- the tool-call descriptors of every decoded planner step that is not vendor-truncated;
- the decoded planner steps, including steps that issued no call;
- the vendor-truncated steps;
- whether the read started at the log's start, and the smallest decoded step;
- the bytes read, or a `tool-names-*` gap when nothing could be read.

The telemetry producer compares that receipt with the native SQLite trajectory, which stays the
authority for step existence, state and completion. Any hole in the window becomes an explicit
coverage gap.

Not derivable from the log, and never claimed:

- a call's result or state (per-call correlation is unproven);
- its timing (the log's status and time fields lag the trajectory and are not read);
- the model.

## Bounds

- **Tail:** at most 1 MiB (`MAX_TRANSCRIPT_TAIL_BYTES`), and never more than the caller's remaining
  byte budget.
- **Lines:** a partial first line in a tail and a partial last line are dropped. A line over 256 KiB
  is invalid. The last line per `step_index` wins, and steps at or past the trajectory's step count
  are ignored.
- **Fields:** at most 64 calls per line; names of at most 128 characters; argument values of at most
  4096 characters (longer becomes null); at most 16 `truncated_fields` entries of at most 64
  characters each.
- **The file:** opened with `O_NOFOLLOW`, so a symlinked log is refused. It must be a regular file
  with one link, owned by this process's uid. Its directory's real path must be the expected one
  beneath the certified store root, so a symlinked parent is refused too. The path is derived only
  from a verified conversation id.

## Shape

- `mod.ts` exports the frozen `agyNativeReads`, which structurally satisfies telemetry's
  `AgyNativeReads` port.
- `src/domain`: the line decoder and the tool vocabulary. It imports only contract types.
- `src/ports`: the file tail the application needs.
- `src/adapters`: the filesystem implementation of that port.
- `src/application`: path derivation, decoding and the receipt.
