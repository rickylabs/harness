# routing-configuration--271 — independent implementation evaluation

Verdict: **PASS**

Reviewed source HEAD: `08324193c3fb67dfac9f5eb7c1a5ace60d156ce9` (branch `feat/271-routing-configuration`).
Baseline product: `4c813fe10218e471f5d78a2dc45bd805ec260749`.
Evaluator route: fallback `muse_spark_1_3` at `max` per `matrix-implementation-evaluation.json:9-18`
(primary `grok_4_6` at `xhigh` produced no verdict per coordinator record; no substitution made).
No model or effort substitution, no agents, no product/test/plan mutation by this seat.

Scope evaluated: explicit whole-document loading, immutable configuration-first routing APIs,
configuration-supplied placements, profile/consumer migration, safe bounded diagnostics,
raw-byte identity, and per-handle dry-run pending/unknown guard across changed revisions and
attempts. Later E11 fleet schema, actual-generator fallback resolver, subscription/detection and
parity are out of scope by plan; the default JSON is a labelled legacy transcription, not fleet
parity. Contracts `0.1`/protocol 1 must remain unchanged.

## Disposition against plan and coordinator amendments

- Whole-document loading with no compiled fallback: `models.ts` and `policy.ts` deleted;
  `index.ts` exports loader/validator/schema only, no default-document accessor
  [source: packages/routing/src/index.ts:1-11; topic: loader surface; inspected 2026-09-07].
  Grep confirms no default accessor and no `"openai"` literal in routing runtime sources
  [source: packages/routing/src; topic: literal inventory; inspected 2026-09-07].
- Immutable configuration-first APIs: every resolver/family/admission entry takes configuration
  first; loaded value is structurally cloned and recursively frozen
  [source: packages/routing/src/configuration.ts:1-27; topic: config-first queries; inspected 2026-09-07]
  [source: packages/routing/src/schema.ts:332; topic: clone-freeze; inspected 2026-09-07].
- Raw-byte identity, never caller-asserted: `parseRoutingDocument` computes `sha256:` over the
  exact UTF-8 bytes itself; `DryRunPlan.routing` carries only `{ source, text }`, no digest;
  the driver parses in memory (no filesystem read) and puts the computed digest into
  `inputRevision`
  [source: packages/routing/src/load.ts:66-88; topic: parser identity; inspected 2026-09-07]
  [source: packages/dsh-app/src/dry-run.ts:26-28; topic: plan shape; inspected 2026-09-07]
  [source: packages/dsh-app/src/dry-run-internal.ts:66-102; topic: drive identity; inspected 2026-09-07].
- Configuration-supplied placements: routing validates shape/references/duplicate pairs/explicit
  totality without knowing backends; `llm-local` validates mechanism kinds and refusal vocabulary;
  unsupported backend is a composition refusal, never a drop or positive claim
  [source: packages/routing/src/schema.ts:305-330; topic: placement structure; inspected 2026-09-07]
  [source: packages/llm-local/src/capability.ts:63-93; topic: mechanism validation; inspected 2026-09-07]
  [source: packages/dsh-app/src/llm/adapter.ts:197-199; topic: composition refusal; inspected 2026-09-07].
- Profile/consumer migration: `harness-routing` requires an explicit portable `document` selection
  (`RangeError: routing-document-not-configured` on absent/empty), resolves `@`/bare specifiers
  via `import.meta.resolve`, and `harness-llm` injects `harnessRouting` before registering
  [source: packages/dsh-app/src/plugins/routing.ts:16-27; topic: explicit selection; inspected 2026-09-07]
  [source: packages/dsh-app/src/plugins/llm.ts:51,104-115; topic: consumer injection; inspected 2026-09-07]
  [source: packages/dsh-app/src/bundle.ts:121-127; topic: bundle row; inspected 2026-09-07].
  Patch and golden carry only the package specifier; no operator path present (grep count zero
  over both generated files).
- Safe bounded diagnostics: byte/depth/member bounds precede validation; plain-data walk rejects
  accessors, cycles, proxies, non-plain prototypes and reserved keys before any property read;
  all refusals carry fixed codes and structural paths only, never document values, OS text,
  parser messages or the source id
  [source: packages/routing/src/schema.ts:136-171; topic: hostile-input walk; inspected 2026-09-07]
  [source: packages/routing/src/load.ts:118-122; topic: refusal rendering; inspected 2026-09-07]
  [source: packages/routing/src/admit.ts:451-456; topic: configured-name withholding; inspected 2026-09-07].
- Per-handle dry-run pending/unknown guard: operations serialize per handle; the driver reads
  current state before intent; pending or terminal-unknown for the same
  repository/task/workflow-step refuses with `unresolved-prior-effect` independent of revision or
  attempt; read refusal stops the operation; no reauthorization API exists; store contracts
  unchanged (no diff under `packages/contracts`, `packages/coordinator` state stores untouched
  except pre-existing behavior)
  [source: packages/dsh-app/src/dry-run-internal.ts:53-114; topic: consumer guard; inspected 2026-09-07]
  [source: packages/dsh-app/src/dry-run.test.ts:175-207; topic: memory guard/regression; inspected 2026-09-07]
  [source: packages/dsh-app/src/dry-run-crash.test.ts:96-115; topic: filesystem guard/regression; inspected 2026-09-07].
- Contracts unchanged: zero diff under `packages/contracts`, `packages/coordinator`,
  `packages/forge`, `packages/board`, `packages/telemetry`, `packages/subagents`,
  `packages/provider-codex` across baseline-to-HEAD; build publish gate reports
  `@rickylabs/harness-contracts@0.1.0`, protocol 1
  [source: baseline-to-HEAD diff stat; topic: contract stability; inspected 2026-09-07].
- Default JSON is labelled transcription, not parity: provenance names the baseline modules,
  wire-id keying, the four orphaned pins and the non-parity status
  [source: packages/routing/config/routing.v1.json:1-5; topic: transcription label; inspected 2026-09-07].
- Package asset behavior: `exports` gains `./config/*.json`, `files` gains `config`; packed-layout
  regression extracts a real scratch tarball and resolves the document from an isolated consumer
  [source: packages/routing/package.json; topic: asset manifest; inspected 2026-09-07]
  [source: packages/routing/src/load.test.ts:102-117; topic: packed regression; inspected 2026-09-07].

## Coordinator followups — current behavior verified, outdated defect not repeated

- F-1 (accessor-bearing source id): current `parseRoutingDocument` checks `typeof sourceId`
  before any inspection or freeze, then enforces non-blank and 4096-UTF-8-byte bounds with fixed
  `source.id` diagnostics
  [source: packages/routing/src/load.ts:66-70; topic: source boundary; inspected 2026-09-07].
  Independent checks confirm: non-string/proxy/accessor inputs refused as
  `invalid/wrong-type at source.id` with zero trap invocations; blank/oversized refused with
  fixed codes; 4096-byte boundary accepted with unchanged raw-byte digest
  (EVAL-CHECK-1 below). The earlier accepted-and-invoked behavior is not present at this HEAD.
- F-2 (FIFO timeout): the initial committed `b15cad6` already opens with `O_NONBLOCK`; the
  comment records that a path pre-stat alone leaves a replacement race
  [source: packages/routing/src/load.ts at b15cad6; topic: nonblocking open revision; inspected 2026-09-07].
  Current HEAD retains that open and adds bounded child tests for direct FIFO, symlink-to-FIFO
  and replacement-at-open
  [source: packages/routing/src/load.ts:90-116; topic: descriptor-then-stat; inspected 2026-09-07]
  [source: packages/routing/src/load.test.ts:66-91,183-195; topic: FIFO regressions; inspected 2026-09-07].
  This seat independently refused a live scratch FIFO in a deadline-bounded child (EVAL-CHECK-1);
  blocking-mutant detection remains implementer/coordinator-reported, not re-claimed here.

## Independent executable checks (this seat; scratch only, no product mutation)

- EVAL-CHECK-1, `node --input-type=module` against built `routing/dist`: accessor/proxy/coercible
  source ids refused with zero invocations; blank and >4096-byte ids refused with fixed codes;
  4096-byte id accepted; identical config under different whitespace yields equal configuration
  with different digests; digest equals independent SHA-256; duplicate JSON keys refused;
  getter-bearing value refused as `not-plain-data` with zero calls; credential canary absent from
  refusal plus `describeLoadRefusal`; live scratch FIFO refused as `unreadable/not-a-file` inside
  an 8s-deadline child; loaded configuration frozen at every depth — PASS.
- EVAL-CHECK-2, built `routing/dist` + `dsh-app/dist`: shipped document parses to 23 lanes /
  14 models; `tierPlan` resolves all 4 tiers from data; plan without `routing` refused as
  `source-unusable` before any store read — PASS.
- EVAL-CHECK-3, built `llm-local/dist` + `routing/dist` + real `FileStateStore` in scratch:
  unsupported backend yields `placement-backend-unsupported` and `requirePlacements` throws;
  a disjoint synthetic document parses clean and rejects every shipped lane/model with
  `unknown-model`; two concurrent changed-revision drives against a seeded stale pending effect
  both refuse `unresolved-prior-effect/pending` with zero fake deliveries — PASS.
- EVAL-CHECK-4: `checkCapability` over the shipped placements is clean (18 entries); returned
  placements frozen — PASS.
- EVAL-CHECK-5: `tierPlan` resolves all shipped tiers from the implementation-primary family
  (no resolver family literal) — PASS. Earlier scratch attempt that tripped `unreviewed-step`
  on my own synthetic document was a fixture error, repaired in-scratch, not a product finding.
- `pnpm --filter @rickylabs/routing run test`: 205 pass, 0 fail — PASS (includes packed-asset,
  source-boundary, FIFO/symlink/replacement, hostile-input and replacement suites).
- `pnpm --filter @rickylabs/llm-local run test`: 95 pass, 0 fail — PASS.
- `pnpm --filter @rickylabs/dsh-app run test`: 332 pass, 0 fail — PASS (includes pending/unknown
  across revisions/attempts, concurrency, read-refusal, composition and golden suites).
- `pnpm run check:compiled-policy`: 281 sources checked, mutation self-test passed — PASS.
- `pnpm run build`: exit 0, all gates including snapshots, publish (contracts 0.1.0/protocol 1),
  CLI reference, skill and tutorial — PASS.
- `check:metadata` with empty scratch config and no tokens: exit 3, nothing compared —
  UNAVAILABLE, recorded as not-PASS (matches implementer receipt; coordinator exit-0 via its own
  transport is attributed, not re-claimed).

Not run by this seat: full `pnpm test` workspace sweep (implementer reports 2797 pass) and the
blocking-mutant runner (implementer/coordinator-reported). Those remain attributed, not
independent evidence. No network effects opened; no auth/credential files read; no sibling
checkouts touched.

## Findings

No load-bearing defect found. Checklist PASS items above were verified against source lines and
executed checks, not trusted from receipts. On FAIL criteria: nothing requires fix or rescope.

[source: run documents plan-eval.md, coordinator-disposition.md, plan.md, drift.md,
implementation.md, verification.md; topic: review basis; inspected 2026-09-07]
[source: baseline-to-HEAD diff and package suites listed above; topic: product evidence; executed 2026-09-07]
