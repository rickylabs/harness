# Native reads in `harness-telemetry`

Run observations, Codex thread reads, account usage, provider meters and producer naming. Back to the
[package README](../README.md).

## Selected repository run observation

`harness-telemetry run-observation --source <absolute descriptor path>` emits the standalone
contracts `RepositoryRunObservation` document. This command accepts only those arguments;
unrelated flags fail before file access (exit 2, fixed diagnostic). A missing, oversized or
invalid descriptor exits 1 with no document and a fixed diagnostic. A valid binding with unread
or incomplete evidence emits coverage-only JSON and exits 3. A read emits JSON and exits 0.

The local descriptor has exactly this shape (all paths below are illustrative):

```json
{
  "schema": 1,
  "binding": {
    "namespace": "enrollment-authority",
    "id": "repository-association",
    "revision": "revision-1",
    "sourceScopeId": "native-store-1",
    "repo": { "owner": "example", "name": "repository" }
  },
  "source": {
    "kind": "codex",
    "root": "/absolute/native-store",
    "file": "/absolute/native-store/selected.jsonl",
    "nativeId": "selected-native-session-id"
  },
  "worktree": "/absolute/repository-worktree",
  "gitCommonDirectory": "/absolute/repository-common-git-directory"
}
```

Enrollment is trusted configuration. All paths must be absolute, bounded to 4096 characters
without control characters. The source file must canonicalize inside source.root, which is
separate from worktree. Fixed-argv local `git rev-parse` checks the enrolled worktree and common
directory with inherited Git redirections/config cleared; no network, hooks or provider calls.
At least one session_meta cwd must resolve within worktree. Every present session_meta or
turn_context cwd must resolve within it; absent cwd is neutral. Outside cwd rejects the whole
run, including later conflicting metadata. All session_meta id/session_id aliases must be valid,
equal and match selected nativeId. Turn IDs do not supply session identity.

The descriptor is limited to 64 KiB, the regular source file to 32 MiB, each line to 1 MiB.
Opened/path identities and bounded reads detect growth or replacement. Descriptor bytes and
identity, source root, worktree, common-directory and Git association are checked again before
serialization. Binding changes emit `incomplete/binding-changed` under the ORIGINAL snapshot
binding. Source-only changes emit `incomplete/source-changed`. No partial payload survives a
malformed line or tail, unknown envelope, bad timestamp or invalid supported evidence.
Known envelopes are session_meta, turn_context, event_msg, response_item, compacted,
world_state and token_usage_record;
unknown payload kinds within them supply no state. Each envelope requires a real canonical UTC
millisecond timestamp in nondecreasing file order. Identity fields keep their own supplying
event times; provider is from session_meta, model/effort from turn_context (including nested
collaboration settings). Accounting comes only from event_msg/token_count.info.total_token_usage.
A present total replaces the supported counter snapshot; missing fields are not zeros.
Only event_msg task_complete/error/stream_error/turn_aborted markers supply execution evidence;
a later task_started resets to unknown.

Collection/verification times are separate from native evidence. Public output carries no paths,
prompts, messages, raw errors, remote URLs or source notes. Allowlisted identity labels are not a
universal secret sanitizer: source storage must be trusted. There is no home scan, enrollment or
auth integration. Backend fencing/retention obligations and the strict portable encoding are
specified in [the contracts README](../../contracts/README.md#standalone-repository-run-observation-030-protocol-1).
Tests use temporary synthetic Git repositories/native files. Real-source acceptance is a separate,
privately authorized coordinator gate; this command does not certify backend authorization.


The supplemental native envelopes have deliberately narrow support:

- `world_state` requires `payload.full === true`, object `payload.state`, object
  `state.environments`, and a nonempty object `state.environments.environments`. Every map value
  must be an object with an absolute `cwd` resolving within the selected worktree. Malformed,
  missing, empty or partial (`full:false`) layouts yield `invalid-evidence`; unresolved cwd yields
  `scope-unverified`, and outside cwd yields `scope-mismatch`. The existing positive session_meta
  cwd remains mandatory. Environment IDs, instructions, model/settings and all other world-state
  fields are ignored and never output. There is no recursive cwd mining or partial-update support.
- `token_usage_record` requires both `payload.thread_id` and `payload.session_id` to be valid R1
  identifiers equal to the selected session_meta/native ID. Missing/malformed/wrong IDs yield
  `identity-mismatch`; a token-only source still yields `identity-missing`. Every other payload
  field is ignored, including all supplemental token blocks, turn/root-turn/response IDs, inner
  timestamps and any embedded settings. Supplemental numeric blocks are not shape-validated or
  compared with token_count totals. Only event_msg/token_count supplies accounting; supplemental
  records cannot double-count totals, refresh leaf clocks or create ancestry.

Both supplemental envelope timestamps must satisfy the same canonical/order rules and can extend
first/lastObservedAt. Only the outer envelope timestamp participates. Neither envelope changes
provider/model/effort/usage/execution observation times or implies current liveness. All other
unknown envelope types still withhold. This is support for two specifically reviewed source forms,
not a claim of vendor-wide format completeness. The coordinator retains any initial real-source
refusal and retries the unchanged source only under its separate private-read authorization.

### Orchid dispatch context

`harness-telemetry runs --json` retains its existing `runs` and additive `dispatches` arrays.
With the private `HARNESS_TELEMETRY_DISPATCH_ROOT` environment setting, it also reads Orchid's
existing matrix reservation directory. The same root is configured as Orchid's private
`matrix.receipt_root`; it must be readable by the telemetry process, private and outside Git.
No new collector runs. Missing configuration leaves this source unbound. A configured unreadable
or invalid source reports a fixed `orchid-dispatch` diagnostic and makes the read incomplete. The reader is
[`@rickylabs/host-orchid`](../../hosts/orchid/README.md); telemetry calls it only through its `OrchidReads` port.
The reader result also returns the configured `root` and a nullable machine-readable `reason`:
`missing`, `not_directory`, `wrong_mode`, `relative_path`, `symlink`, or `git_ancestor`. A healthy
readable root with no dispatches reports no reason, so it remains distinguishable from a refused
root without parsing the fixed diagnostic. These fields report existing checks and do not relax them.
The read is bounded to 1,000 reservations; truncation is explicit.

Each started Orchid dispatch carries `issue: {repo, number}` for the inbox issue,
`parentRunId: null` for this coordinator-dispatched root, exact `location: {paneId, workspaceId}`,
and `dispatchState: launching | dispatched | uncertain`. Dispatch acknowledgement does not
assert present liveness. Reserved attempts with no execution effect are omitted. The row's
canonical `route` preserves requested provider, model and effort directly from the NetScript matrix. Observed
identity remains unknown when the launch interface supplies no evidence. Transport is never substituted
for router. `external` stays null on this read: the private native binding is never a public
field. This reader never searches by cwd to guess an association.

Native `runs[].parentId` continues to come from the existing telemetry readers. Codex now uses
the thread's `id` ahead of a shared tree `session_id`, and reads explicit parent metadata. It
rejects conflicting/self-parent links and does not treat a fork as a spawned child. These native
links alone do not associate a root native session with an Orchid dispatch. Consumers must keep
that missing association visible, including unavailable per-run cost rows, until it is bound.

### Bounded agent collection

The same `harness-telemetry runs --json` read now adds `agentObservations` (schema 1 / protocol 1).
Use `readAgentObservations` from the published contracts package before filtering by repo and
issueNumber. It refuses an incomplete runtime tree or ambiguous ancestry as a whole, and enforces
record and byte bounds. A validated dispatch-only collection is readable with `complete:false` /
`ancestry_unavailable`; a successful decode does not make it complete. Preserve this status in the
per-issue view. See the [contracts exception](../../contracts/README.md#per-issue-agent-observations). Existing HARNESS_TELEMETRY_DISPATCH_ROOT configuration supplies the private Orchid receipts.
No additional process or collection command is introduced.

Issue linkage must be dispatcher-confirmed; transcript path/prose mentions never assign work.
Only an explicit native reference can connect a dispatched root to existing telemetry child
records. The reader now consumes Orchid’s private `NativeSessionID` from the existing binding
next to the dispatch snapshot. It validates the reservation digest and selected route, accepts only
a dispatched Codex launch, and resolves exactly one same-source native root. The binding read is
bounded to 256 KiB, requires a regular 0600 file, refuses symlinks, and rechecks the dispatch
snapshot after reading. Native identity is held only as an in-memory private hash, never copied
to `external` or any JSON field; legacy log evidence cannot replace or revive this binding.
Missing, malformed or unmatched bindings remain dispatch-only. Until that reference is bound, a dispatch-only row retains the requested route, has null native
parent and observed route values, and reports unknown execution with `observer-unavailable`.
The private Orchid `receipt.json` is also read with a bounded, 0600, no-symlink check. Its observed
status and fixed reason text are carried in `routeObservedReasons` only when the transport and
physical model match the dispatch snapshot. Requested effort may differ from effective dispatch
effort and is kept separate. Invalid or absent receipts expose only
`receipt-unavailable`; no raw receipt, path or native identity crosses the public boundary.
The collection says complete:false / ancestry_unavailable. A mixed collection containing runtime
observations still requires complete ancestry; it cannot fall back to dispatch-only evidence.
Source time is the receipt timestamp when present, otherwise its file modification time; it
never claims current liveness. Receipt revisions come from the exact source bytes; agent revisions also change when a native
root becomes bound. Public agent and assignment IDs keep their existing derivation. Unbound dispatches keep all three cost
rows unavailable. Once a unique native run is bound, roots and children project that run's existing
usage and quota into separate token, reported USD and account-headroom rows. Missing measurements
remain unavailable; reported zero is available zero. Headroom is the account window last observed by
that run, with source time and reset validity, never run spend or guaranteed current balance.
A native parent link does not invent child location, router or running observations. No cockpit
contract or decoder change is required. See [cost attribution](../../../docs/rfcs/0002-agent-cost-attribution.md)
for shared-run refusal, repeated-dispatch handling, source timestamps and limits.

AGY live issue collection uses the private `NativeSessionID` conversation ID and
`NativeStore` from the same dispatched reservation. It reads only that retained
store, never the global AGY history or a directory/title/time match. The installed
1.2.14 adapter opens fixed SQLite tables read-only with WAL visibility and byte,
session and step bounds. The conversation's `cascade_id` must match its bound ID;
the separate trajectory ID must match the native protobuf summary. Only typed
planner response text reaches the existing screening function. User prompts,
thinking, tool output, titles, native IDs and store paths never enter the feed.
A coherent latest user turn, native final status/stop reason and completion time
are required for an end; idle, mtime and an empty response cannot prove Done.
Current summary activity clears prior success, error and cancellation ends even
when the trajectory has not yet recorded the resumed turn. Unreadable/unknown
stores affect only their issue.
AGY token/quota measurements remain unavailable. Contracts 0.34.0 adds `agy` and
`agy-transcript` plus AGY direct-route decoding; upgrade the consumer decoder and
reader before enabling the Orchid writer. Bound database/WAL watches are hints
for a fresh read, with the periodic safety scan retained.

OpenCode issue collection joins the dispatched reservation's private
`NativeSessionID` to one root in the explicitly configured native database.
The legacy adapter decides the store family from its structure, never from the
OpenCode CLI version: the session/message/part tables must carry every column it
reads (checked before any row is read), no next-family row may be bound to the
session, and every row and part must pass the strict validation. The version
label is only checked to be bounded and non-empty. It reads those fixed columns
read-only with WAL visibility and per-issue/session/row/byte limits. It excludes unbound history, titles, paths,
user text, reasoning and tool output. Unknown or mixed next-schema rows affect
only their bound issue. Native database/WAL watches trigger rereads; they never
prove a message or terminal state.

Only persisted assistant text parts reach the existing screening function.
Native token deltas are live-only, so this SQLite reader does not promise
per-token updates. Stable step IDs replace the same persisted part on a reread.
Success requires the latest user turn's final nonempty assistant stop, an exact
native completion clock and no continuation tool. Resumed turns and pending
children clear the root's prior end. Known native error/cancellation retain
their own clock; unknown/empty/tool finishes and contradictory clocks cannot
become Done. Typed provider/model/variant observations stay separate from the
requested route; usage, quota and spend are not fabricated.

Contracts 0.35.0 adds `opencode-transcript`, direct OpenCode route decoding and
bounded model-specific syntax for exact qualified identifiers. Model observation
provenance `opencode.message.providerID+modelID` records the exact native field
pair used to format the qualified ID; provider and variant carry their own native
message provenance. Public path/secret screening stays in place. Publish after
0.34.0, and upgrade the reader/decoder before enabling the writer binding.

`node scripts/check-orchid-native-live-pair.mjs --live` is an opt-in integration control. It reads
a bounded native header sample using the normal home (or privately configured
`HARNESS_TELEMETRY_NATIVE_HOME`), exercises one real parent/child pair under an explicitly synthetic
assignment in a temporary private store, and deletes that store. It never modifies the live
receipt store or claims that the selected pair belongs to a live issue. Its separate live-issue
verdict preserves incomplete ancestry. Output contains only counts and closed reasons.

## Codex thread reads and goal notifications

`openCodexThreadReader()` opens the plain `codex app-server` JSONL stdio surface. `await reader.read()` returns a versioned native thread snapshot; `for await (const event of reader.events())` receives goal updated/cleared notifications without polling. Always close the reader in `finally`. It never dispatches, resumes, starts a turn, sets or clears a goal.

CLI: `harness-telemetry codex-threads --limit 500 --json`; append `--watch` for a snapshot followed by goal event JSONL. Exit 3 means incomplete source coverage; valid thread rows remain present when a goal RPC fails. Native parent absence remains `ancestry_unavailable`; goal absence remains `goal_absent`; an unset budget remains `budget_unset`. Reported zero is available zero. Model/effort are configured or persisted metadata, not per-turn route confirmation. Runtime state is scoped to the connected app-server; unloaded threads cannot prove running agents elsewhere.

The cockpit source feed is `harness-telemetry issue-agents --watch`. It writes a full per-issue tree
snapshot heartbeat every five seconds by default. Receipt changes, new native rollout files, and
changes to selected rollouts trigger a disk scan at the next heartbeat. Each scan reads every
transcript and the hook event file as they stood at the frame's capture time: a line stamped after
it, and everything written after that line, belongs to the next frame. Set the reader-only
`HARNESS_TELEMETRY_CLAUDE_CHILD_EVENT_ROOT` to the private owner-mode Claude hook event directory
to admit a fresh child `SubagentStart` as running only after the verified root dispatch and
native child ID match. While that Start is the child's latest hook event, the child stays running as long as the
Start or the child's own latest transcript record is fresh, so a child that works past the Start
window is still shown running. A later `SubagentStop` clears running to unknown; that callback alone is
never terminal evidence. A verified in-session Claude child ends natively when its direct
parent session enqueues the task-notification for exactly that child with status `completed`
(succeeded) or `failed` (failed), at or after the child's start and its last transcript record.
The notice's anchored header must name an Agent that session launched, as recorded in Claude's own
tool result; the header's single status line is read, never the child's summary or result. Any
other status, a second status line, or a resumed child's later records leave it unknown. Otherwise
it ends as cancelled only after the same root dispatch has separate seat-absent and
native-process-absent observations. A later matched Start restores running. A Codex root or
child that completes or fails on its own carries `endedAt` from the exact time of its own
`task_complete`, `error`, `stream_error` or `turn_aborted` record, never from its last activity; a
later `task_started` clears it. Without such a record, `endedAt` stays unavailable. Unsafe, stale,
absent or unmatched files leave the child unknown.
The reader watches that directory for new events. A 12-second safety scan
recovers missed filesystem events before the 15-second freshness deadline. A heartbeat between
scans keeps the original `observedAt` and `validUntil`; it never renews evidence by itself.
Each process has a fresh generation and sequence starting at zero; a restarted
consumer gets a new full snapshot. The cockpit backend, not this process, persists and replays
events to its own clients. Each snapshot expires 15 seconds after `observedAt`; a stale feed is
unknown, not still running. `issue-agents --json` reads one snapshot for diagnosis. Missing or
degraded evidence is reported as incomplete, with explicit unknown budget and liveness fields.
For one issue, add `--issue owner/repo#number` to `--json` or `--watch`. The command scans only
that issue's dispatches and returns exit 0 when its tree is complete, even if unrelated old
issues are incomplete; an absent or incomplete requested issue returns exit 3. The unscoped
cockpit feed still reports every issue and its aggregate completeness.
A dispatch is read until its run can no longer change. With no end yet, that is up to seven days
after the dispatch. Once Orchid saw it end (a paired seat and process absence, for a stop or an
ordinary teardown; the earliest such pair), it is read for 24 hours after that end, so the run's
final tree, ended and complete, is served even when the run outlived its first day. A run that only
ended after the seven days, or ended more than 24 hours ago, is `scan_limit`. Its Codex window runs
from ten minutes before the dispatch to ten minutes after the end (or now), never longer than seven
days and twenty minutes.

A dispatched Codex root is found by its rollout name, which carries the session id, and confirmed
by its own head; no other session is read to find it, however many share its window. Its
descendants are read from the heads of the newest 128 rollouts created no earlier than the root
(less a two-hour margin for a writer's clock set back), and linked through their parent ids.
Every bound stays explicit: 4096 rollout names per issue scan (past it the root may be unseen and
the issue is `scan_limit`), 128 descendant heads of at most 64 KiB, the frame byte budget, and the
scan limit on transcripts kept, parents before children. Once the root is established, nothing
that happens to a descendant refuses the issue: a bound reached, or a descendant transcript that
does not fit the frame, cannot be read, no longer holds the session its head named, or holds lines
the parser cannot read (a record still being written, an unknown envelope), omits that
descendant and its own descendants, and the tree is partial with a named reason
(`descendant_heads_bound`, `descendant_heads_budget`, `descendant_head_unreadable`,
`selected_files_bound`, `descendant_transcript_bound`, `descendant_transcript_unreadable`). The
agents served are always a closed tree from the root. A root that cannot be read or established
still refuses the issue. With `--partial-trees` such an issue is published as `complete: false`,
reason `scan_limit`, and keeps the agents it read (contract 0.37). Without it the issue is
`scan_limit` with no agents, which every earlier reader accepts: pass the flag only once every
consumer decodes with contract 0.37 or later, since an older reader rejects a whole snapshot that
holds such a row.
For the host-scoped capacity row, set `HARNESS_TELEMETRY_PLACEMENT_HOST` to this machine's
operator-configured short dispatch placement name. If it is unset, the row reports
`host_identity_unset`; a different placement host reports `binding_invalid`. The reader
uses `/proc/meminfo` and all AMD DRM card VRAM pairs in sysfs, with per-card values and
checked aggregate values. Missing files remain unavailable rather than becoming zero.
`--interval-ms` accepts 100–10000 milliseconds. If a scan lasts past its 15-second validity
deadline, the command emits an incomplete snapshot. Slash-bearing native display labels are
withheld because this public feed cannot safely distinguish them from relative paths.

The 0.11.0 `activity.steps` producer reads the single `in_progress` item from a Codex
`update_plan` call or Claude `TodoWrite` call as a current-step message. Assistant text contributes
only its first sentence. Both use a reject-not-truncate 120-character screen for controls, paths,
addresses, secrets and long opaque tokens; unsafe text stays a fixed generic label. An exact
`bash`/`sh -lc` command array can supply a safe command head from its inner command, still without
flags or arguments. The 0.11.1 contract shares the producer's screened-text rule, including
short recovery-code-like prose; unsafe summaries are refused rather than published.

The 0.13.0 issue-agent feed adds an exact bound-route effort value on roots and an opaque verified
parent ID on children. Native children do not inherit the root's effort. Each native activity step
can carry a typed short target: allowlisted command head, screened file basename, or a screened
Grep/Glob query. The same public screen runs in the producer and contract decoder; unsafe targets
are null, never truncated or echoed.

Cwd, Git origin and goal objective default to `redacted`. `includeSensitive:true` in the library or `--private` on the CLI permits those fields for an authenticated private consumer only. Never log that payload. Native IDs, session IDs, rollout paths and previews are always excluded; public thread references reuse existing opaque native-child IDs. `codexThreadEvidence(snapshot)` is the counts/availability/reasons-only projection for publishable evidence.

Defaults: 500 rows, 30-second read/request deadline, 50 rows per page. Hard caps: 5000 rows, 202 pages, 1 MiB per frame, 8 outstanding RPCs, 128 buffered goal notifications. Both archived states and all declared native source kinds are included; list-side rollout repair is disabled. Overflow/disconnect is explicit. Sequence numbers are connection-local, not durable replay cursors. The snapshot is not atomic with the stream, and cross-process notification delivery is not claimed. See [RFC 0003](../../../docs/rfcs/0003-codex-thread-read-stream.md).

For `openCodexThreadReader`, `timeoutMs` bounds each request and the entire paged read (default 30000, maximum 60000 milliseconds). Either deadline reports `request_timeout`; raising the row limit does not extend it. Cross-page or cross-archive duplicate identities refuse the read because the snapshot is not atomic.

A goal read rejected by the daemon with its exact request-bound `thread not found` response reports `thread_not_found`, preserves the thread row, and marks coverage incomplete. Other daemon error replies use `rpc_error`; transport failures remain `source_unavailable`, `source_closed` or `request_timeout`. Native error text and identities are never exported.
## Account quota and session token usage

`harness-telemetry account-usage --source <descriptor>` emits an `AccountUsageEnvelope`.
`--watch` emits JSONL and polls every 180 seconds. Neither command starts a model session.
The new projection includes safe display aliases and opaque refs, token splits and separate
weekly/5h account readings. Missing values stay null. A one-shot exits 3 when configured-store
coverage is incomplete; its JSON remains useful. Invalid descriptor/key/state exits 1.

The private descriptor has exactly these fields:

```json
{
  "schemaVersion": 1,
  "keyFile": "<private absolute key path>",
  "stateFile": "<private absolute state path>",
  "codex": { "bin": "<absolute Codex executable>", "home": null },
  "stores": [
    { "vendor": "codex", "seat": "seat-a", "cwdLabel": "project-a", "root": "<private absolute store root>", "accountIdentity": null },
    { "vendor": "claude", "seat": "seat-a", "cwdLabel": "project-a", "root": "<private absolute store root>", "accountIdentity": null }
  ]
}
```

The key file must be a regular, non-symlink file, mode 600, containing at least 32 bytes of private
random key material. Configure the same key across contributing seats. `codex: null` disables
direct reads; `home` optionally binds the Codex configuration directory. Paths and raw identities
remain inside the descriptor. Historical session account membership stays unknown unless the
operator explicitly supplies `accountIdentity`; it is never guessed from the currently logged-in
account. `seat` and `cwdLabel` are deliberate aliases, not hostnames or path basenames.

The state file is mode 600 and stores the previous validated envelope and private source/key scope
hash. Run one collector per state file. Missing/corrupt state, a changed descriptor or a rotated key
starts a fresh inference baseline. A crash during a state write also loses that baseline safely.

Measured with Codex CLI 0.159.2: `codex app-server --listen stdio://` answered `initialize`,
`initialized`, `account/read` (`refreshToken: false`) and `account/rateLimits/read` without any
thread/turn creation. The reader requests `excludeResetCreditDetails: true` for background polls,
bounds time and bytes, and drains stderr without publishing it. The response includes exact
durations, reset times, multiple meter buckets and an account identity which is HMACed locally.
See the [official app-server documentation](https://learn.chatgpt.com/docs/app-server).

Measured with Claude Code 2.1.285: `claude usage --help` returned global help, and
`claude auth status --json` returned authentication metadata without quota fields. The tested CLI
commands exposed no sessionless quota interface; this is a bounded negative measurement.
The documented [`/usage` command](https://code.claude.com/docs/en/commands) runs inside a session.
No Claude session was started to probe it. The sampled native store contained token usage but no
quota readings, so direct Claude quota is explicitly unavailable. No undocumented endpoint or
synthetic percentage is substituted.

Codex reads both `token_count` quota windows and `token_usage_record` cumulative thread totals,
including cache writes. Per-turn cumulative usage is retained separately inside telemetry.
Response usage is not added to the same thread total. Claude retains its native response-id
deduplication and separate cache read/write counts. For accounting and the attribution guard,
see [the published contract](../../contracts/README.md#account-usage-projection-0290).

OpenCode availability (contracts 0.31.0) appends a fourth `opencode` row to the
private transport snapshot. The reader also accepts the exact legacy three-row
prefix unchanged for reader-first rollout. OpenCode reports configured provider
seat capacity (`true`/`null` or `false`/`no-capacity`), never subscription quota or
model readiness. Native route discovery remains required. Pin the new reader and
contracts before deploying the four-row dispatcher emitter.

Provider-pool snapshots (contracts 0.32.0) add optional `openCodeProviderPools`
records `{provider,maxActive,active}` directly from the dispatcher. The reader
preserves absent lists as unknown and validates bounded unique IDs, whole counts
and agreement with the aggregate OpenCode row. No local config mirror supplies
these records. The private regular-file bound is 32 KiB to accommodate 128 pools;
owner-only permissions and no-symlink checks still apply. Upgrade this reader and
the public decoder before enabling the new emitter.

## Opt-in provider meters and catalog prices (contracts 0.33.0)

The existing `account-usage` command/watch accepts a private schema 2 descriptor:
`{ schemaVersion: 2, accountUsage: <existing schema 1 descriptor>, providers: <source> }`.
There is one collector and state file. Native Codex/Claude collection and schema 1
emission are unchanged. A configured provider with incomplete coverage makes a
one-shot exit 3; the validated JSON still carries its unavailable rows.

The provider source has exactly `githubCopilot`, `openRouter`, and `openCode`;
each may be null. `githubCopilot` has `username`, `credentialFile` (absolute path
or null), and `models:[{model,billingModel}]` with exact configured aliases. The
owner-only, regular, non-symlink, mode 600 credential JSON has just the key
`GITHUB_COPILOT_PLAN_READ_TOKEN`. Supply a fine-grained PAT or GitHub App user token
with user Plan read permission. No CLI, environment or Copilot OAuth fallback is
used. Until that credential exists, billing is UNKNOWN with reason
`no-plan-read-credential`. Personal billing endpoints do not include usage billed
to an organization or enterprise. [GitHub billing API](https://docs.github.com/en/rest/billing/usage?apiVersion=2026-03-10).

The adapter issues separate bounded GETs for premium requests and AI credits,
month and day, validates account/unit/period, and preserves the provider's
gross/discount/net quantities and USD amounts. Missing access and malformed or
partial responses never become zero usage. Fetch time is not settlement time.

`openRouter` has `models`, an array of exact catalog IDs; empty selects the whole
bounded catalog. Four price columns and applicable context/time overrides come
from the [models endpoint](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties),
without hardcoded rates. Prices are previews, separate from billed account spend.
Catalog aliases with one leading `~` are retained within the 256-character ID
bound, including when an ordinary model is selected from a catalog containing
unrelated aliases. The upstream integer HHMM override clocks are normalized to
the public `HH:MM` shape; zero and overnight windows keep their original order,
and weekday conditions and inherited rates are preserved. Invalid clocks remain
unavailable. [OpenRouter pricing overrides](https://openrouter.ai/docs/guides/overview/models#pricing-overrides).

`openCode` has `databaseFile` (absolute), `from` (UTC instant), `versions` (explicit
vetted native versions), and `providers:[{provider,accountIdentity}]`. The operator
must verify each enrolled version's additive input/output/reasoning/cache schema
and USD cost semantics; unknown versions withhold token/cache aggregates. The
Linux reader pins an owner-held inode, opens SQLite read-only, bounds rows/bytes
and rechecks identity/metadata. It exports neither native IDs, message text, file
paths nor raw account identity. Numeric costs are labeled local-reported, and
account allowance remains unknown. These historical rows cannot fund admission.

The 0.33 transport snapshot reader bounds private files at 512 KiB to hold the
bounded model decisions as well as provider pools.

Schema 2 opt-in and optional provider budget decisions require both the 0.33
public decoder and telemetry reader in the consumer first. Keep disabled paid
provider pools disabled; this reader PR does not change routing or live config.

### Operator naming migration

Canonical `HARNESS_TELEMETRY_*` settings retain the corresponding legacy
`DSH_TELEMETRY_*` aliases with conflict refusal. The log basename remains legacy
by default; `HARNESS_TELEMETRY_LOG_NAME` explicitly selects the canonical or legacy
family. No host settings or files change merely because this reader is upgraded.

## Producer naming rollout

The CLI is `harness-telemetry`. Cost and governance output support explicit
`HARNESS_TELEMETRY_WIRE_FAMILY=harness|legacy`. Absence retains legacy output while supported
readers are upgraded; invalid values refuse collection. The selection affects only names on
originated rows, preserving measurements, source clocks and native attribution. Received
provenance remains unchanged.
