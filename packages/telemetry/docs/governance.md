# Governance reads in `harness-telemetry`

How `harness-telemetry` reads live governance sources and publishes the governance read document.
The document's shape and decoder belong to [`@rickylabs/harness-contracts`](../../contracts/README.md#governance-read-document-020);
the readers themselves live in [`@rickylabs/governance`](../../governance/README.md), which `harness-telemetry`
wires with its producer name. This page covers the sources, the collection rules and
the commands. Back to the [package README](../README.md).

## Live governance sources

`harness-telemetry status --observations-from <absolute-descriptor-path>` (also `tree`) composes
explicitly configured readers into the published `GovernanceReadSnapshot` and decodes it with
`readGovernanceSnapshot` from `@rickylabs/harness-contracts`. The flag excludes `--observations`.
`--observations-from file:<absolute-document-path>` is an alias for the `--observations` file reader:
the same governance read document, evaluated at `--now`, reread on each invocation.

A descriptor has exactly `accountLabel`, `usage`, `spend`, `capacity`, and `admissions`, and may add
`transportAvailability` (0.28.0: `null` or `{ "path": "<absolute path>" }`, the dispatcher's private
per-transport availability snapshot, an owner-only regular file). Each leg is
explicitly `null` or an object with **all** the fields below; omitted fields and unknown fields are
errors. There are no inferred source defaults. Keep the descriptor outside version control. Paths,
model IDs, credential names and provider response metadata are never copied into governance output.

| Leg | Required fields |
| --- | --- |
| `usage` | `denoBin`, `probe`, `checkout`: absolute paths; `model`: bounded provider/model routing string; `credentialEnv`: environment-variable name; `allowNet`: the one bare hostname the usage probe may reach (no scheme, port, path or wildcard), for example `usage.example.invalid`; `timeoutMs`; `maxBytes`; `windows` |
| `usage.windows` | Exactly `rolling_five_hours`, `weekly`, `monthly`, each with a distinct safe `label` and positive integer `windowMinutes`. Durations are configuration, including monthly duration; the reader never guesses them. |
| `spend` | `url`: the operator's spend endpoint, an exact canonical `https` URL with no userinfo, query or fragment (for example `https://spend.example.invalid/api/v1/key`); the credential is sent to that URL only; `credentialEnv`; `window`: `total`, `daily`, `weekly`, or `monthly`; `validForMs`; `timeoutMs`; `maxBytes` |
| `capacity` | `cgroupRoot`: absolute configured cgroup-v2 directory; `scopeLabel`: safe public label; `validForMs` |
| `admissions` | Exactly `{ "fromObservabilityLog": true }` |

`accountLabel`, `scopeLabel` and window labels use `[A-Za-z0-9][A-Za-z0-9._:-]*`, at most 128
characters. The account label means one configured credential binding, not discovered fleet coverage.
`model` is runtime configuration, at most 256 characters, with slash-separated identifier components;
there are no compiled model IDs or routing decisions. `timeoutMs` is an integer from 1 through 60000;
`maxBytes` is an integer from 1 through 4194304. `validForMs` and window durations are positive safe
integers. Environment names are bare identifiers, never values; runtime-control names such as `HOME`,
`PATH`, and names prefixed `DENO_`, `NODE_`, `LD_`, or `DYLD_` are rejected.

The usage probe is [`adapters/opencode-usage-probe.ts`](../adapters/opencode-usage-probe.ts), a **Deno
service outside the Node TypeScript project**. The configured external checkout supplies
`.llm/tools/agentic/runtime/provider-usage.ts` and `config/subscriptions.ts` under that same agentic
root. It is an operational service dependency, never a package or build dependency. An in-memory
import map resolves two static aliases to those files. The launcher uses `--no-config`, `--no-lock`,
`--no-prompt`, `--no-remote`, `--no-code-cache`, `--allow-env=<credentialEnv>` and
`--allow-net=<allowNet>`; no read, write, subprocess, or broad environment permission is granted.
The minimized child environment contains only that binding and fixed Deno runtime controls;
`DENO_DIR=/dev/null` prevents disk caching. The probe remaps the named binding to the upstream
library's `OPENCODE_API_KEY`, injects rejected file readers, and never loads an auth file or `.env`.
The runtime must support these Deno flags and static import maps. A missing or incompatible service
fails unread. No provider model process is started.

The upstream snapshot's `capturedAt` and imported `EXPENSE_SNAPSHOT_MAX_AGE_MS` travel in the
serialized result. The probe supplies its clock after response parsing, does not accept `--now`,
bounds response bytes, refuses redirects, and the parent bounds stdout and total runtime. Quota
percentages remain subscription allowances, never billed dollars. Every window has `binding:false`
and the subscription note says binding is unobserved. No maximum-percentage or pacing policy runs.

Spend uses a GET of the exact current-key URL with `redirect:error`, an authorization header from
the named environment binding, a bounded streaming body and a timeout covering the response body.
The selected fields are `usage`, `usage_daily`, `usage_weekly`, and `usage_monthly`, respectively.
Output provider is always `openrouter`; window labels are the four reader-owned enum values;
`ceilingUsd` is always null. BYOK amounts are never added and balances are never used to infer spend
or a ceiling. Only total/monthly were receipt-observed during planning; omitted daily/weekly fields
fail unread. Labels, user metadata, response text and transport errors are not projected.

Capacity reads only `memory.current` and `memory.max` within `cgroupRoot`. This is **configured cgroup
v2 scope**, not automatic current-cgroup discovery or a verified dispatch/physical-host limit.
There is no v1, ancestor or host-memory fallback. `max` retains known used bytes and reports total
and headroom unknown. GPU measurements stay null. Partial known values remain visible in text.

### Recorded admissions

The producer is the gate with authority (E5 wiring), not this observation reader. It records the
existing telemetry envelope through `record`, with an explicit decision timestamp in `detail`:

```json
{
  "at": "2026-09-07T12:00:00Z",
  "runId": "synthetic-log-identity",
  "kind": "governance.admission",
  "detail": {
    "item": { "number": 205 },
    "regime": "subscription",
    "state": "throttle",
    "observedAt": "2026-09-07T12:00:00Z",
    "validUntil": "2026-09-07T12:05:00Z",
    "outcome": { "accepted": false, "reason": "quota-paced", "detail": "Synthetic gate explanation" }
  }
}
```

This example is synthetic, not an operational admission receipt. The reader accepts `throttle` or
`pause` with a public-safe machine-readable refusal code. Codes contain 1–128 ASCII letters,
digits, dots, underscores, colons or hyphens and start with a letter or digit. Their meaning belongs
to the producer and the published `DispatchOutcome` contract, not a new telemetry taxonomy:
`quota-paused`, `lane-unknown`, `needs-approval` and future producer codes are accepted. Producers
must keep credentials and private identifiers out of these public reason codes. Prose and paths
fail unread; private explanatory detail is withheld. Each refusal is validated by the published
contract before publication: `readDispatchRefusal` decodes the outcome (detail at most 4096
characters, any approval requested no later than the decision), and `readRecordedAdmission` decodes
the recorded refusal at collection completion. Caller provenance is replaced by
`reader:recorded-admission`; the reason is retained, while free-form operator detail and any approval
payload never enter the read, to prevent private prose or run identity from being published.
The output explicitly says that admission is not execution evidence. Pending approvals are unobserved.

The newest decision timestamp wins per item/regime, independent of log order. Identical duplicates
collapse (including equivalent timestamp offsets); same-time conflicting decisions make that key
unavailable. Differences in private operator detail also count as conflicts before redaction.
A malformed newest record cannot revive an older refusal. An unorderable timestamp blocks its key;
an unidentifiable admission or degraded log blocks the admission leg because the superseded item
cannot be established. Valid other keys survive scoped failures. Expired newest decisions are removed,
without reviving older ones. Missing admissions make a configured admission source incomplete.
The log envelope `at` is never substituted for missing detail time. Routing events, arbitrary prose,
and `runId` never supply item identity or admission facts. In live-source mode these receipt events
are excluded from run lifecycle merging.

### Freshness and failure behavior

Collection completion stamps the envelope; original source timestamps remain on leaves. Expired or
future legs are removed independently with fixed diagnostics, never restamped. Envelope expiry is
the earliest retained source expiry, including recorded admissions. With no successful source the
view is unavailable. Without `--now`, the CLI evaluates against completion time; explicit `--now`
can intentionally make a live envelope stale or future-invalid. File-mode stale values remain visible.
Text rendering also compares leaf ages with the envelope's declared validity span and marks/counts
stale leaves; a fresh envelope badge is qualified when its leaves are stale. This derived display span
is not a claim of independently observed leaf validity.

| Condition | Result |
| --- | --- |
| Invalid descriptor, nonabsolute source path, conflicting flags | Exit 2, fixed usage diagnostic before source I/O |
| Leg explicitly `null` | Distinct `not-configured` note; other configured legs can complete |
| All legs `null`, or no successful retained leg | Unavailable, `complete:false`, exit 3 |
| Missing credential binding | `credential-unbound`; that leg unread |
| Spawn failure/nonzero exit, timeout, oversized output, non-JSON, invalid payload | `spawn-failed`, `timeout`, `oversize`, `non-json`, or `shape-mismatch`; that leg unread |
| Spend HTTP/transport failure | `request-failed`; spend unread |
| Cgroup unreadable/unsupported | `cgroup-unreadable` or `shape-mismatch`; capacity unread |
| Cgroup unlimited | Known used retained; total/headroom unknown, explicit scope note |
| Log unreadable/degraded, no current admissions, conflicting admissions | `log-unreadable`, `no-admissions`, or `admission-conflict`; admission evidence incomplete |
| Expired/future source at completion | `stale-source` or `future-source`; discarded without restamping |
| Invalid composed envelope/evaluation clock | Unavailable, `envelope-invalid`, exit 3 |
| Any requested source fails while another succeeds | Successful sources still render; `complete:false`, exit 3 |

`complete` describes the requested inputs and the existing telemetry scan, not fleet-wide discovery,
physical-host capacity, pending-approval completeness, or proof that any item was dispatched.
Observation reads write no telemetry, cache, quota reservation or source state. The synthetic producer
CLI tests write fixtures **before** measuring read-side immutability. Node tests use isolated temporary
homes with ambient `HARNESS_TELEMETRY_*` neutralized, real CLI subprocesses and injected services; they
need no credentials, network or Deno. Live acceptance remains a separate coordinator integration gate.

## Published governance read command

`harness-telemetry governance --observations-from <absolute-descriptor-path> [--now <iso>] [--home <path>]`
collects the explicitly configured sources once and emits one schema-1/protocol-1 governance JSON
object. `--json` is accepted but unnecessary. The installed
`@rickylabs/harness-contracts` root export `readGovernanceSnapshot` decodes it losslessly into typed
source coverage, envelope/state and recorded admission refusals. A descriptor that configures
`transportAvailability` adds `sources.transportAvailability` and a top-level `transportAvailability`
(which matrix transports admission would offer, with its own validity); one that does not emits the
document byte-for-byte as before. See the
[contracts document](../../contracts/README.md#governance-read-document-020).

The command rejects missing descriptors, `file:`, `--observations`, `--items`, `--run`, `--kind`,
`--limit`, `--since`, extra positional arguments and unknown flags before collection. It scans no
transcripts and renders no board. Descriptor fields are the operator-configured live-source fields
already documented above. Credentials enter reader services only through the configured environment
binding; credential values never go in argv or the public document. The command does not dispatch
models or change policy. Usage/spend services run only when the operator configures and binds them.

Exit 0 means configured evidence is complete; exit 3 means incomplete or unavailable. Both emit one
JSON object and newline. Exit 2 reports invalid command line/descriptor; exit 1 reports a fixed
internal/projection diagnostic and emits no document. Successful sources remain visible when another
source fails. Sources have closed status/reason codes and their own provenance/timestamps; notes are
informational and must not be parsed. Admission refusals are not execution outcomes. Empty/degraded/
conflicting logs remain distinct; pending approvals are always `not-observed`, never a census.
`--now` changes the evaluation clock only, not source capture or completion timestamps.

`status` and `tree` show the same decoded document; `--observations` and `file:` read a stored copy
of it, so there is one governance read model and no second input format. No `RemoteSnapshot`,
protocol, hub, fold or client change is part of this slice.

### Installed consumer verification

After a workspace build, `pnpm run check:installed` packs the contracts workspace package, installs the actual tarball
with `npm install --offline` in an isolated consumer, imports both root and `/server` runtime exports,
and actually compiles a TypeScript consumer of both installed declaration entry points. It then
records a synthetic admission using the real CLI and invokes the real governance command with a
synthetic cgroup and an actual bounded sleeping Node probe. The CLI must terminate and reap that
probe; it creates no descendants. An all-unconfigured descriptor is also decoded with the installed
package. The receipt includes the tarball SHA-256, version, unchanged protocol, exports and fixtures.
The root `test` chain runs this gate after package tests; no additional workflow is needed.

The fixture currently requires a POSIX shebang host and an **executable temporary filesystem**.
If the default temp mount is `noexec`, configure `TMPDIR` to an operator-selected executable scratch
location before running the gate/root tests. A failure is reported as failure; there is no network
install fallback. Scratch trees and child processes are owned and cleaned by the script. No live
provider access, host-capacity measurement, downstream compatibility or publication is tested.

## Provider-limit snapshot command

`harness-telemetry provider-limits --source <absolute-snapshot-path>` reads one normalized
provider-limit snapshot through `readProviderLimitsFile` from
[`@rickylabs/governance`](../../governance/README.md#provider-limit-evidence) and prints it as one JSON
object and newline. The shape and decoder are the contracts'
[provider-limit evidence snapshot](../../contracts/docs/workflows-and-providers.md#provider-limit-evidence-snapshot).
It calls no provider API and reads no credential.

Exit 0 emits the complete valid document. Exit 2 means an invalid command line: anything other than
exactly `--source <path>`. Exit 3 means the source is unavailable or unsafe; it prints the fixed
diagnostic `provider limits unavailable`, no partial JSON and no path or environment name. The
collector, the durable outcome ledger and admission belong to the producer in Orchid
([rickylabs/orchid#97](https://github.com/rickylabs/orchid/pull/97)). This command publishes no
package and activates no host.
