# Live-source verification

**Implementation and coordinator checks pass; independent implementation evaluation is pending.**
This advances #205 with a reviewable live reader. It does not close #205 or #87: a real item-scoped
admission and finite dispatch-scope capacity remain unobserved. Humans merge.

## Coordinator repairs and their proof

- Removed the invented admission-reason enum. The published contract accepts machine-ish strings
  (`packages/contracts/src/routes.ts:106`). Its documented examples were rejected by the draft.
  The live reader now accepts bounded public-safe code syntax, preserving producer-defined semantics;
  prose and paths fail unread. Producers remain responsible for public-safe identifiers. The new
  regression includes all documented contract examples and a future producer code.
- Closed the probe stdout privacy gap. A synthetic private status string escaped the first draft.
  The probe now validates and copies each usage-window field, accepts the vendor's structured statuses,
  rejects unsafe status/reset strings before stdout, and omits extra metadata. Executable offline
  proof: `node .llm/runs/live-governance--205/verify-probe.mjs` — exit 0. It also proves denied reads
  and changing positive runtime validity values without a pinned 15-minute constant.

These bounded corrections honor plan D24 and the existing published contract. Earlier handback hashes
and test counts in `implementation.md` describe the writer's pre-repair snapshot, not this final surface.
No contracts, dependencies, routing policy, governance producer, dsh-app source or workflows changed.

## Commands actually run after repair

| Command | Result |
| --- | --- |
| `pnpm --filter @rickylabs/telemetry test` | Exit 0; 413 tests passed, zero failures/skips. |
| `node .llm/runs/live-governance--205/verify-probe.mjs` | Exit 0; offline Deno boundary checks passed; no network or real credential. |
| `pnpm run docs:cli` | Exit 0; regenerated the telemetry CLI page. |
| `pnpm run build` | Exit 0; repository checks and workspace compilation passed. |
| `pnpm run test` | Exit 0; 2,698 tests passed, zero failures/skips. Includes contracts and dsh-app. |
| `pnpm run check:metadata` | Exit 0 through authenticated gh; actual repository description compared. This resolves the writer's isolated-environment exit 3. |
| `git diff --check` | Exit 0. |

## Authorized live observations — scope of proof

The actual repaired Deno probe called the existing NetScript usage library through runtime imports,
with an inherited credential binding and no read/write permission. Exit 0; all expected windows,
reader timestamp and positive upstream validity were present. Credential absent from captured stdout
and stderr. Raw readings were neither printed nor retained. This proves reachability and probe
execution; it does not establish all metadata needed for a fully configured quota projection.

The actual compiled CLI ran twice against live OpenRouter current-key usage and configured cgroup-v2
memory, using an isolated temporary telemetry home and neutralized ambient log locations. Both runs
returned exit 3 and complete:false while successful spend and known-used memory remained fresh.
Completion, spend and capacity timestamps advanced. Unlimited total/headroom stayed unknown;
missing admissions stayed empty with an explicit unavailable note. The home and input files were
unchanged. Credential and temporary operational paths were absent from stdout/stderr. Only boolean
receipts survive outside private scratch.

Remaining limits:

- Monthly quota duration is subscription-anniversary based, not a fixed 30 days. The minimized
  usage response omits that anniversary; a configured synthetic duration is not live proof.
  End-to-end live quota projection remains unverified until authoritative duration configuration is
  available. Source-window reachability was observed separately above.
- The observed cgroup is unlimited. No finite dispatch-host limit, physical-host headroom or GPU
  capacity is claimed. Synthetic finite-memory tests prove mapping only.
- No real E5 producer admission was observed. Writer-to-reader fixtures prove ingestion and replay
  behavior, not live gate decisions. Unknown effects are never inferred as unsent or resent.
- No published contract package, backend OpenAPI or native client artifact changed. No downstream
  live-adapter, generated-client or native scenario PASS is claimed by these telemetry checks.

[source: NetScript runtime usage reader and matrix CLI; topic: runtime source and dispatch authority;
date: 2026-09-07; source commit: 8ba53bc50ca02aab29e99ba5362728839b8f1713]
[source: published contract routes.ts and coordinator synthetic/live checks; topic: reason compatibility,
probe privacy, refresh and unknown evidence; date: 2026-09-07]
[source: https://github.com/anomalyco/opencode/blob/dev/packages/console/core/src/util/date.ts;
topic: getMonthlyBounds subscription-anniversary calculation; retrieved: 2026-09-07;
retrieved blob: dea9c390e06af878623bfd7b8a20f986237ffe68]
[source: https://github.com/anomalyco/opencode/blob/dev/packages/console/core/src/subscription.ts;
topic: structured usage statuses; retrieved: 2026-09-07;
retrieved blob: adbb0a55bcd033bfae51db16434c81cb9ef2cbd8]

## Publication preparation

Private scratch-location references were removed before publication. The run retains dated decisions,
review text, source citations and executable checks; unpublished local commit IDs identify historical
checkpoints and are not promised as public GitHub refs. The original local history is retained privately.
The publication snapshot preserves the independently evaluated product/test/documentation tree;
the final exact-head confirmation is recorded on issue #205 and the PR rather than changing that head.
