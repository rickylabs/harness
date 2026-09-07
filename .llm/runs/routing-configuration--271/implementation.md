# routing-configuration--271 — implementation

E11 step 1 is implemented as one local PR-sized change. The selected document now supplies all
routing and placement data; no compiled model/policy default remains. Local build, typecheck and
regression results are in `verification.md`. Independent exact-head implementation review remains
with the coordinator; this receipt does not claim that review passed.

Started from `7bbc9ba` after the retained Muse Spark1.3 max PASS on `548f24d`
(`plan-eval.md:3`). The provided fresh `matrix-implementation.json:11` selects `astra` at `xhigh`.
No agent was dispatched, and no alternate model/effort route was selected.

## Delivered manifest

- Strict UTF-8 JSON loader and pure parser with full raw-byte SHA-256 provenance, distinct refusal
  kinds, duplicate-key detection, structural bounds, hostile-data rejection and recursively frozen
  copies. All diagnostics use structural paths and fixed codes. Source:
  `packages/routing/src/load.ts:61`, `packages/routing/src/schema.ts:136`.
- Deleted the compiled model and policy modules. Configuration-first resolver, family and admission
  APIs query only their supplied document. The compatibility asset mechanically matches baseline
  `7bbc9ba`: 14 models, 23 lanes, 40 steps, four tiers, 18 placements, including the old reasons and
  requirements. Source: `packages/routing/src/configuration.ts:1`,
  `packages/routing/config/routing.v1.json:1`; comparison command described in `verification.md`.
- Placement references/totality live in routing; mechanism validation and coded refusals live in
  llm-local. The adapter takes explicit detached placements, and health/endpoint callers retain
  their existing behavior. Source: `packages/llm-local/src/capability.ts:63`,
  `packages/dsh-app/src/llm/adapter.ts:135`, `packages/llm-local/src/health.ts:1`.
- `harness-routing` requires a path or package subpath and supplies frozen configuration/provenance.
  The profile explicitly selects the exported packaged JSON; `harness-llm` waits for that service
  and refuses unsupported placement mechanisms before registration. The patch and golden were
  rendered by repository code, adding one composed row. Source:
  `packages/dsh-app/src/plugins/routing.ts:16`, `packages/dsh-app/src/bundle.ts:123`.
- Dry-run plans carry captured document text. Parsing, admission and input-revision hashing use those
  bytes. Per-handle serialization and a current-state read prevent pending or terminal unknown
  effects for the same repository/task/workflow step from being bypassed by any revision or attempt.
  No reauthorization API exists here. Source: `packages/dsh-app/src/dry-run-internal.ts:53` and `:104`.
- Regression suites cover disjoint configurations, mutation resistance, hostile/malformed input,
  credential diagnostics, packed resolution, arbitrary-family independence, composition and durable
  memory/filesystem negative cases. The build runs the AST compiled-policy gate and its mutation
  self-test. Source: `packages/routing/src/load.test.ts:1`,
  `packages/dsh-app/src/dry-run-crash.test.ts:1`, `scripts/check-compiled-policy.mjs:1`.

## Scope and remaining work

Inventory corrections and diagnostic hardening are appended as D-018 through D-020 in `drift.md`;
historical evidence and the normative plan were preserved. No dependency or contract/protocol
change, provider integration, live dispatch, host service operation, credential access, external
write, push, merge or tag was performed. Tests use local scratch and synthetic effects.

The shipped document is a compatibility transcription, not fleet parity. E11 steps 2–5, CLI keys,
provider/account detection and generator-relative evaluator selection remain outside this change.
#148 and #181 remain gated on later semantics. Source: `plan.md:831`,
`packages/routing/README.md:118`.

[source: repository files cited above; topic: E11 step 1 implementation and limits; inspected 2026-09-07]
