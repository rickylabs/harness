# Telemetry operator names

Harness uses `HARNESS_TELEMETRY_*` for operator settings. The corresponding
`DSH_TELEMETRY_*` names remain compatibility aliases; this source change does not
modify a host's configuration or rename its files. Wire producers and cost-source
identities have a separate reader-first migration.

| Setting suffix | Meaning | Resolution |
| --- | --- | --- |
| `DIR` | Live log directory | Trim whitespace; blank is unset; relative paths resolve before writing. |
| `ARCHIVE` | Cold directory, or `none` | Same existing archive behavior and bounds. |
| `MAX_BYTES` | Bound for each generation | Existing binary suffix parser and diagnosed fallback. |
| `GENERATIONS` | Rotations behind the live file | Existing whole-number parser and diagnosed fallback. |
| `DISPATCH_ROOT` | Private Orchid receipt root | Exact value; existing absolute-path, ownership, mode and binding checks. |
| `CLAUDE_CHILD_EVENT_ROOT` | Private child-start event root | Exact value; existing source and session checks. |
| `PLACEMENT_HOST` | Verified placement label | Exact value; no host-name inference. |
| `NATIVE_HOME` | Home for the opt-in native-pair diagnostic | Exact value; the diagnostic still requires `--live`. |

An alias and its canonical setting may coexist only with equal resolved values.
Contradictory dual settings fail closed and diagnostics name the keys without
printing their values. Only the first four settings trim values and treat blank
as unset. A blank private binding remains a configured invalid source, rather
than turning into a healthy unconfigured source.

`HARNESS_TELEMETRY_LOG_NAME` is a new explicit selector with no legacy alias. It
accepts exactly `harness-telemetry.jsonl` or `dsh-telemetry.jsonl`. The default
remains `dsh-telemetry.jsonl` until the later producer rollout. Canonical directory
settings alone do not switch the basename.

Managed readers and observability sinks inspect both log families, including
rotations outside the configured count. They refuse mixed families and a family
that differs from the selection. They read only the selected family, never add
two migration copies. An explicitly selected canonical source with no valid
events is unavailable; an absent optional default legacy log retains its existing
semantics. The bounded inventory refuses directories exceeding 4,096 entries.
Reads check the family again after collection, and writes check before each
append. These checks detect conflicting files; they are not a cross-version
migration lock.

Operators must upgrade every active consumer before switching settings. Cockpit
must resolve both env names with conflict refusal, forward the selected binding
to its pinned Harness reader, and retain its existing private-source checks and
failure state. Upgrade its reader revision and source hash together. An immutable
older pin remains valid for the old settings; it does not acquire new support.

For the actual file migration, stop all writers and readers, back up settings and
inventory the complete live and rotated family. Rename files without copying or
leaving a second family; preserve bytes, modes and ownership. Set the canonical
basename explicitly, validate with the upgraded reader, then resume. Do not
create an empty canonical log to make a migration appear complete. Preserve
event timestamps and existing freshness, attribution and native-source fences.

Rollback also requires stopped writers: restore the settings and move the whole
current family back without discarding appended events or leaving duplicate
copies. The exact host paths, service commands, verified consumer pins and
backups belong in the private operator rollout descriptor. This public guide
does not authorize a live migration.

The implementation boundaries are [operator aliases](../../packages/telemetry/src/operator-environment.ts),
[family inventory](../../packages/telemetry/src/log-family.ts),
[managed reads](../../packages/telemetry/src/log-source.ts), and
[observability sink](../../packages/telemetry/src/observability.ts).
