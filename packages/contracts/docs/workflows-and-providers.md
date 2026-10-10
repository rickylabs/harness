# Contracts: workflows, receipts and providers (0.15.0 to 0.35.0)

Part of the [`@rickylabs/harness-contracts` README](../README.md), split out to keep each page
under the 500-line cap. Each section states the release that introduced it.

## Repo profiles and Cockpit workflow revisions (0.15.0)

`ProfileRef` names a pinned target-repo Markdown profile and matrix revision. It carries
the kind, role, tier and sourced token budget, with digests instead of instructions or model choices.
`WorkflowRevision` is an immutable Cockpit DB phase graph; each phase references a profile and
exposes only opaque writer-scope IDs. Cockpit keeps writer file ownership and approval/rollback
records privately. `RoutineRevision` pins a workflow and exposes its trigger kind or schedule,
overlap and missed-run policy; GitHub trigger filters are digest-only. A wake-up creates or labels
an issue, and Orchid remains the launcher.

`WorkflowRun` and `WorkflowAttempt` carry closed pending/running/blocked/ended states, closed
outcomes, one of four block kinds, and independent run-token and metered-USD-micro rows. A missing
measurement is `null` with a named reason; measured zero remains zero. The exported readers reject
unknown fields, raw prompts, paths and invalid source/state combinations. These are additive
contract types; this release does not claim a live Cockpit workflow producer or dispatcher.

An issue-tree agent can also carry `profileRevision` and `matrixRevision` as a pair. Each is the
exact pinned commit from the root dispatch, with `scope: root-dispatch` and a typed unavailable
reason when the receipt cannot bind it. A child's copy identifies its dispatch context; it does
not claim the child loaded that profile. The decoder checks child pins against the verified root
and continues to accept older frames without either field.

## Action receipts and timeline (0.16.0)

The action vocabulary adds `raise_budget` and source-proven `retry`. Accepted receipts use
`goal_budget_updated` and `retry_dispatched` respectively; a retry carries the replacement
agent and dispatch IDs. Missing pins, incomplete terminal proof, an in-flight retry, and budget
ceiling failures have closed rejection codes. Ambiguous writes and launch effects remain `unknown`
with closed reasons. The issue timeline reports delivery outcomes on the original agent; a receipt
never proves that the replacement ran or that a raised budget was consumed. Older action rows
remain readable.

In 0.17.0, a new accepted `raise_budget` receipt may carry `tokenBudget`, the value Orchid
confirmed through the native goal read-back before persisting the receipt. On a complete action
scan, the issue tree uses the highest confirmed raise for the exact root agent and dispatch,
marks its budget `source: action-receipt`, and uses that value as the token usage denominator.
The child's budget stays unknown. Old receipts without this field remain readable and cannot
change the launch budget; rejected, unknown, mismatched or malformed receipts cannot change it.

## Per-agent token and budget history (0.18.0)

Each issue-tree agent can add `resourceHistory` with separate `tokens` and `budgets` series.
Token points are the cumulative `tokenUsage` figure (processed input plus output, as defined in
[recent agent work](agent-trees-and-stop-state.md#recent-agent-work-and-timeline-in-0120)) at
native Codex `token_count` or deduplicated Claude assistant usage timestamps. The producer keeps
the first and latest 15 changes, reports `truncated`, and publishes no text, paths or native IDs. A missing, unsafe, decreasing or
inconsistent series is unavailable with a named reason; it is never filled with zeroes.

Budget points belong to the root only: the dispatch's sourced launch budget followed by
confirmed exact-root accepted `raise_budget` receipts. The child budget series remains
unavailable because a child budget is not bound. An incomplete action scan makes root budget
history unavailable, while the existing current budget retains its own source-backed value.
Both series are bounded at 16 points and checked against the current agent value. Older frames
without `resourceHistory` continue to decode.

## Workflow revision transfer (0.19.0)

`encodeWorkflowRevisionBundle` writes a deterministic UTF-8 JSON export of one workflow's
selected public revisions and screened approval/rollback ledger facts. Revision IDs and decision
positions are sorted; object keys are sorted; no export time or random ID is added. The required
SHA-256 callback hashes the canonical payload without `bundleDigest`, so the contract works in
Node, browsers and native clients without a platform dependency.

`readWorkflowRevisionBundle` accepts only the exact canonical encoding with a matching digest.
It validates every revision, profile pin, phase dependency and ledger reference, and rejects raw
instructions, paths, actors, grants and extra fields. A successful read is **data only**: it does
not grant access, approve a draft, change the active revision or write to storage. Cockpit must
authorize the scope, resolve the pinned profile and route, and append its own reviewed revision
and decision ledger entries when importing.

## Routine wake facts (0.20.0)

`readRoutineWake(value, source)` validates a bounded public observation against a validated
`RoutineRevision` from Cockpit storage. The wake carries exact routine/workflow pins, the
trigger kind, an opaque 256-bit hex idempotency key, first/last observed times, and a coalesce
count from 1 through `MAX_ROUTINE_WAKE_COALESCE`. The reader rejects mismatched pins or
trigger kind, raw event payloads, malformed keys, count overflow and reversed timestamps
even when both timestamps fall in the same millisecond.
Counts above one require a coalescing overlap or missed-run policy in the bound revision.

Cockpit owns trigger identity, key generation, authorization, deduplication and scheduling;
it must not publish a plain hash of guessable event data as the key.
This record reports trigger observations only; it does not assert that Cockpit created an
issue or that Orchid launched an agent. The caller must supply the immutable revision from
its trusted storage, not a revision supplied by the wake sender.

## Separate workflow reviewer observations (0.21.0)

`readWorkflowReviewObservation(value, runSource, revisionSource)` binds a verdict to an ended
subject attempt and an ended, distinct evaluator attempt in the same validated run and immutable
revision. The evaluator phase must depend on the subject phase and have its declared verifier
role. An observed verdict is `allow`, `block` or `escalate` and requires a successful reviewer
attempt plus a random private-evidence lookup ID. A reviewer error has no verdict or evidence ID;
it never grants release. Missing observations also do not grant release. Raw review prose,
native identifiers and unbound attempt references are rejected.

This is a sourced fact for Cockpit's workflow ledger, not an owner approval. Cockpit still
checks reviewer identity, cross-vendor policy, allowed actions and its separate approval boundary
before releasing a phase. It retains the private evidence behind the opaque ID.

## Verifier presence at workflow save (0.22.0)

`readWorkflowRevisionForSave` applies the existing bounded revision reader, then requires every
phase that declares a `verifierRole` to have a directly dependent evaluator phase with that role.
It returns a per-field `verifier_missing` error when the evaluator is absent or disconnected.
`readWorkflowRevision` and bundle import remain compatible with older stored revisions; Cockpit
uses the strict reader before approving a new draft. The reader validates graph shape, not route
authority or private writer-file ownership, which Cockpit must check against its pinned sources.

## Phase artifact observations (0.24.0)

`readWorkflowArtifactObservation(value, runSource, revisionSource)` binds an opaque Cockpit
artifact ID to one successful ended attempt and its exact dispatch in a pinned workflow run.
The output kind and schema digest must match the declared phase, and the observation cannot
precede the attempt's end, including at nanosecond precision. Pending or failed attempts,
wrong pins, raw artifact paths or content, and unknown fields are rejected.

Cockpit supplies the run and revision from its trusted storage and separately verifies that
the artifact ID exists in its private ledger. This public reference alone neither proves
artifact storage nor releases the next phase; Cockpit still applies the dependency, reviewer
and owner-approval gates before dispatching it.

## Issue-agent tree validity (0.25.0)

`ISSUE_AGENT_TREE_FRESH_MS` is now 30 seconds, three intervals of the default five-second watch
cadence. A read that takes several seconds no longer lets a frame expire before its successor
arrives. `readIssueAgentTreeSnapshot` accepts `validUntil` exactly `observedAt` plus 30 seconds
or plus the earlier 15 seconds (`ISSUE_AGENT_TREE_ACCEPTED_FRESH_MS`), and nothing else, so a
reader on 0.25.0 decodes frames from both older and newer producers. Upgrade readers before
producers. A running observation must still cover the whole snapshot validity, so the Codex
producer now keeps running only for native events at most 90 seconds old at capture.

## Issue-agent liveness `idle` (0.26.0)

`AgentTreeLiveness` gains `{ state: "idle", evidence: "runtime-observation", observedAt, reason: null }`
for an agent observed stopped at its prompt (a Claude root that ended its turn). It is not
terminal: `terminalOutcome` stays null, and a later `running` frame replaces it. The agent's
observation then carries `running: { value: false, observedAt }` at the same time, with
`validUntil` at least the frame's. `readIssueAgentTreeSnapshot` rejects `idle` without that false
bit, and a false bit beside any other liveness. A reader before 0.26.0 rejects a frame that
contains `idle`, so upgrade readers before producers.

## Finished before a teardown (0.27.0)

A teardown (`endedBy` `timeout` or `teardown`) ends the agent's seat. Its `terminalOutcome` was
always `cancelled` from `teardown-observation`. It may now instead be
`{ value: "succeeded", source: "native-outcome", observedAt }` with `observedAt` at or before the
teardown's `liveness.observedAt`: the agent had completed its work and sat at its prompt when it was
torn down. For a Claude root, that is its last turn closing on the final answer with nothing after.
`endedBy`, `endedAt` and the `ended` timeline reason still record the teardown. A reader before
0.27.0 rejects this pairing, so upgrade readers before producers.

## Transport availability in the governance read (0.28.0)

A governance document may carry the dispatcher's transport availability: which matrix transports
(`MATRIX_TRANSPORTS`: `claude`, `codex`, `agy`) its admission would offer now, and why each other
one is out (`TRANSPORT_UNAVAILABLE_REASONS`: `no-capacity`, `meter-unread`, `meter-stale`,
`window-expired`, `5h-ceiling`, `weekly-ceiling`, `ceiling-misconfigured`). Two keys, always together:
`sources.transportAvailability` (the usual meter coverage, provenance
`reader:divybot-transport-availability`) and a top-level `transportAvailability`, non-null exactly
when that coverage is `read`: `{ observedAt, validUntil, transports }`, with the coverage's own times,
one row per transport in order, and `reason` null exactly when `available`. It has its own validity
and is not part of the governance envelope, its `validUntil`, or `not-configured`. Failed or
discarded coverage makes `complete` false. A document without the keys (every earlier one, and any
producer that does not configure the source) decodes unchanged, so readers can upgrade first; a
reader before 0.28.0 rejects a document that carries them. `SOURCE_FAILURE_REASONS` gains
`file-unreadable`.
## OpenCode transport availability (0.31.0)

`MATRIX_TRANSPORTS` now appends `opencode` after `claude`, `codex`, `agy`.
`SUBSCRIPTION_MATRIX_TRANSPORTS` identifies the original three subscriptions.
The governance reader and private snapshot mapper accept either that exact legacy
three-row prefix or all four rows in order. A legacy document stays unchanged;
an absent OpenCode row supplies no evidence of availability.

OpenCode's row is `{ transport: "opencode", available: true, reason: null }` when
at least one explicitly configured provider pool has a free seat, or
`{ transport: "opencode", available: false, reason: "no-capacity" }` otherwise.
This aggregate reports provider capacity, with no invented subscription meter,
quota percentage or credit balance. It does not certify any particular provider,
model or variant: native discovery and exact route admission still decide a launch.
Subscription meter reasons on an OpenCode row are rejected. The envelope, schema,
coverage, expiry and privacy boundaries remain unchanged.

Upgrade readers to 0.31.0 before a dispatcher publishes four rows. Older strict
readers reject the extra row; a new reader can safely consume the three-row producer
until deployment. Cockpit must keep a missing legacy OpenCode row unavailable.

## OpenCode provider pools (0.32.0)

`transportAvailability.openCodeProviderPools` is optional. When present it is the
dispatcher's source list of `{provider,maxActive,active}` records, with at most
128 unique provider identifiers, integer `maxActive` from 0 through 256 and
nonnegative safe-integer `active`. Occupancy may exceed the cap. Identifiers use
lowercase letters, digits, dots, underscores and hyphens, start with a letter or
digit, and are at most 64 characters. The producer sorts the records.

Missing means per-provider capacity is unknown; `[]` means no configured pools.
The list requires the fourth `opencode` row, whose `available` must equal whether
any pool has `maxActive > active`. These are concurrency counts, without quota,
credit, entitlement or model-readiness claims. Readers preserve legacy snapshots
without inventing pools. Upgrade both the telemetry reader and contracts decoder
to 0.32.0 before the dispatcher emits the field: older strict readers reject it.

## Provider billing and price readers (0.33.0)

`readAccountUsageDocument` accepts the existing native schema 1 envelope unchanged,
or an opt-in schema 2 wrapper containing `account` (that same native envelope) and
`providers`. `readProviderUsageSnapshot` copies bounded, closed rows for premium
requests, AI credits, USD and unknown units independently. Decimal quantities are
canonical fixed-point strings; null means unavailable. Copilot rows retain gross,
included discount and net overage quantities and amounts for each UTC day/month.
Consumed discounts do not establish the plan's total included entitlement.
`reportedThrough` stays null when the source supplies no settlement watermark.

Current OpenRouter catalog prices use USD per million tokens in four nullable
columns: input, output, cache read and cache write. Context and UTC time/day
overrides stay attached to the exact model. Missing rates and unsupported extra
charges make the preview partial; no cached/free price is invented. Historical
OpenCode counts and locally reported costs have separate provenance and coverage.
Model IDs may carry one leading `~` alias marker and remain bounded to 256
characters across prices, history, meters and provider budget decisions. UTC
override clocks use validated `HH:MM` strings, preserving midnight and wrap order.
Cache efficiency divides summed cache reads by summed fresh input plus cache
reads and writes, with null for incomplete or empty denominators. Local history
never establishes account allowance or settled provider spend.

Optional `transportAvailability.providerBudgets` contains exact provider/model
availability decisions with the snapshot's observation and expiry clocks. It
stays separate from 0.32 provider seat pools. Launch refusals `budget-reached` and
`budget-unavailable` are supported by the issue tree reader. Install both the
published decoder and telemetry reader before any producer emits these fields or
refusals. No budget enforcement or provider hard stop is implied by a meter row.

### Provider budget model identity (0.33.1)

`ProviderBudgetDecision` is keyed by the exact pair `(provider, model)`. `provider`
is the provider ID in its own field; `model` is the provider-native model ID.
For example, `{provider:"fixture-provider",model:"vendor/native-model"}` is valid,
while `{provider:"fixture-provider",model:"fixture-provider/native-model"}` is
rejected. The reader preserves native nested vendor/model suffixes and leading
tilde IDs without stripping, case folding, alias matching or family matching.
When joining a provider-qualified catalog route, remove exactly its own provider
prefix once before joining both fields. A duplicated prefix is invalid; do not
retry the join with another spelling. Budget decisions still have no used, limit
or unit quantities; consumers must not infer them from capacity or usage rows.
### OpenCode persisted activity and native end (0.35.0)

`AgentActivityStep.source` accepts `opencode-transcript`. Existing opaque agent
and step IDs, activity, liveness, terminal outcome and end fields are reused.
Direct OpenCode dispatches are decoded like the other native transports. The
model field alone accepts bounded native qualified identifiers with colon,
nested slash and leading tilde; provider prefixes must agree independently and
private-path/secret screening still masks unsafe metadata. Other labels keep
their existing grammar.

OpenCode route observations use `opencode.message.providerID`,
`opencode.message.providerID+modelID`, `opencode.message.variant` and
`opencode.message.path.cwd` provenance. The model is formatted from the exact
native provider/model pair; missing variant and private cwd stay null. These
observations never borrow the requested route or Codex thread-start provenance.

Activity represents persisted assistant text parts, with native clocks and the
existing sentence screening. Token deltas are not durable and are not synthesized.
Only a completed final nonempty stop without continuation tools can succeed;
native error and cancellation remain distinct, and resumed turns clear old ends.
Consumers must upgrade this decoder before a reader emits the new activity source
or route provenance. Release 0.35.0 follows the AGY 0.34.0 release.

## Provider-limit evidence snapshot

`readProviderLimitSnapshot(unknown)` decodes the closed version-one provider-limit source that
atelier-cockpit's merged schema accepts, and copies it. `ProviderLimitSnapshotV1` holds
`schemaVersion: 1`, `generatedAt`, `meters` (`ProviderLimitMeterV1`) and `outcomes`
(`ProviderOutcomeV1`). Subscription windows and named OpenRouter key amounts stay separate meters.
Percentages, including 100%, are advisory, and so is a `rate_limited` refusal. Only a durable actual
inference outcome refused with `quota_exhausted` or `payment_required` is refusal evidence, until a
later verified success; the decoder never invents a refusal. Each collection holds at
most `MAX_PROVIDER_LIMIT_SOURCE_ROWS` rows, and `MAX_PROVIDER_LIMIT_SOURCE_BYTES` bounds the source
file. Model identifiers, in `model`, `launchModels` and outcome `model`, are at most 256 characters,
a leading `~` included, as in Cockpit's schema. The decoder rejects extra fields, accessors,
credentials, private paths and hosts, ambiguous route bindings, duplicate meter identities, malformed
quantities and rows observed after `generatedAt`. The private file reader is `readProviderLimitsFile` in
[`@rickylabs/governance`](../../governance/README.md#provider-limit-evidence).

### Warnings and route admission (0.42.0, rickylabs/atelier-cockpit#451)

`assessProviderLimits(snapshot, now)` turns a decoded snapshot into `ProviderLimitAssessmentV1`
at `now` (epoch milliseconds), with no I/O. Each meter becomes a `ProviderLimitAdvisoryV1` with
`usedPercent`, `stale` and `warning`. For a named key, `usedPercent` is
`(limit - remaining) / limit` of that key's own cap, and a zero cap counts as 100%. A reading is
stale once it is `PROVIDER_LIMIT_VALIDITY_MS` old (two 180-second polls, as in Cockpit) or past its
`resetsAt`. A reading observed after `now` has `stale: null`. `warning` is true only for a known,
fresh reading at or above `PROVIDER_LIMIT_WARNING_PERCENT` (90). Unknown and partial readings never
warn. `refusals` holds the active `quota_exhausted` and `payment_required` outcomes, and `rateLimits`
the active `rate_limited` ones. A refusal stays active until a success in the same provider, key
and account scope is observed strictly later. For a provider-wide refusal (null `model`) that
success can be on any model; otherwise it must be on the same model. An equal instant keeps the
refusal.

`admitProviderRoute(assessment, route)` answers for one provider-qualified launch ID
(`opencode-go/fixture`, `openrouter/vendor/model`) with `ProviderRouteAdmissionV1`. The route is
refused only by an active quota or payment refusal that covers it. A refusal with no key and no
account covers every route of its provider, or only `provider/model` when it names a model. Any
other refusal covers only routes bound in `launchModels` by a meter that matches every credential
the refusal names: an account-only refusal reaches every bound key of that account, a key-only
refusal that key on any account, and a refusal naming both needs both. Of several covering
refusals, the verdict reports the latest, and the first listed on an equal instant.
Warnings, rate limits, unknown and stale readings never refuse a route; the verdict still carries
the route's bound warnings and covering rate limits. The integration fixtures in
`test-fixtures/provider-limits-produced/` are byte-for-byte snapshots written by Orchid's producer
([rickylabs/orchid#97](https://github.com/rickylabs/orchid/pull/97)). `pnpm run check:installed`
reads them through the actual `harness-telemetry provider-limits` command and the installed tarball.
