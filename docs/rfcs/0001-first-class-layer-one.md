# RFC 0001: First-class Layer 1 adoption

- Status: proposed; no charter amendment or runtime acceptance
- Date: 2026-09-14
- Scope: Harness board, matrix, admission, telemetry, two seams, sandbox boundary and forge
- Evidence snapshot: Harness `eb33b3aa149f475e85d53c2fcf2e5dba7718679e`;
  NetScript `f3324909e0896cedc9729005bac5f508e122d6c6`;
  cockpit `041e620e4fbaf68828fa44f49a63b55a0eec16cd`;
  EIS-Chat `90b6d866d1f0b078a82fce5b1851275647c982af`
- Delivery tracking: [#355](https://github.com/rickylabs/harness/issues/355),
  [E11 #271](https://github.com/rickylabs/harness/issues/271),
  [registration #352](https://github.com/rickylabs/harness/issues/352),
  [agent observations #354](https://github.com/rickylabs/harness/issues/354)

## Claim labels

Every material statement below has one of these labels:

- **CURRENT**: inspected in the pinned source; not proof of deployment.
- **CITED**: supported by the named upstream document or owner issue.
- **PLANNED**: proposed implementation or acceptance work that this RFC does not deliver.
- **MEASURED**: an executed check with its command, exit and output recorded.

## Summary

**PLANNED.** Make existing capabilities first-class by giving them one contract owner, one
composition point, an explicit source binding and a reproducible refusal/acceptance check.
Adopt supported NetScript implementations through their existing service boundary where needed.
Do not translate the Deno framework into a second Node runtime.

**CURRENT.** The [locked family charter](../../ARCHITECTURE.md) owns the portable runtime,
keeps divybot as dispatcher, parks UHP dispatch and puts profiles plus matrix-before-spawn first.
[Cockpit's Layer 1 description](https://github.com/rickylabs/atelier-cockpit/blob/041e620e4fbaf68828fa44f49a63b55a0eec16cd/doctrine/ARCHITECTURE.md#layer-1--coordination)
names the same coordination responsibilities. Its Layer 2 owns product event-log/worker/saga
composition. Adoption does not transfer those product responsibilities into Harness.

**CITED.** The owner requests the
[EIS RFC format](https://github.com/rickylabs/eis-chat/blob/90b6d866d1f0b078a82fce5b1851275647c982af/docs/rfcs/0001-mcp-2026-enterprise-foundation.md).
This document adopts that shape without treating a proposed RFC as a ratified decision.

## Context and current state

**CURRENT.** Harness already uses explicit contracts and thin Cordis composition. Its
[package map](../../packages/README.md) separates board, routing, coordinator, telemetry,
providers and the published contracts package. The
[routing plugin](../../packages/dsh-app/src/plugins/routing.ts) loads an explicit document;
missing configuration is a refusal. The
[subagent plugin](../../packages/dsh-app/src/plugins/subagents.ts) deliberately registers an
empty instrumented registry. An implemented provider is not a composed provider.

**CURRENT.** The [NetScript bridge](../../packages/netscript-bridge/README.md) and
[governance admission package](../../packages/governance/README.md) remain stubs. Their owning
epics must establish their contracts before behavior is added. Telemetry governance reads do
not imply that spend admission is wired.

**CURRENT.** The [leaf profile](../../profiles/leaf.md) already specifies the seven-item design
checkpoint and matrix-selected implementation/evaluation roles. Profiles are markdown at
`profiles/<name>.md`; adoption does not introduce another profile format.

**CITED.** NetScript MCP `find_guidance` was called with the intent to adopt contract-first
boundaries and plugin composition while retaining the service adapter and Node/pnpm. Exact
`get_doc` reads returned:

- [Contracts & type flow](https://rickylabs.github.io/netscript/netscript/explanation/contracts/):
  one boundary definition supplies validation, implementation and client/type flow.
- [The plugin system](https://rickylabs.github.io/netscript/netscript/explanation/plugin-system/):
  a core package owns behavior; a thin connector contributes to a host.
- [Author a plugin](https://rickylabs.github.io/netscript/netscript/orchestration-runtime/how-to/author-a-plugin/):
  the generator emits core and connector packages, with public contracts and testing exports.

**MEASURED.** MCP `get_doc` for `pages/orchestration-runtime/cli-scaffold`, a slug named in the
cockpit architecture's older citation, returned `doc_not_found`. Current plugin-authoring and
plugin-system pages above were retrievable. This is a documentation-locator discrepancy, not
proof that a runtime capability is absent. The public MCP pages are retrieval-time evidence;
they are not asserted byte-identical to the pinned repository snapshot.

## Capability ownership and the next proof

**CURRENT** identifies the inspected source; **PLANNED** identifies the remaining proof.

| Capability | Existing source and owner | Next proof; no replacement runtime |
| --- | --- | --- |
| Board and forge | **CURRENT:** [board](../../packages/board/README.md) projects GitHub; [forge](../reference/cli/dsh-forge.md) owns taxonomy and dispatch admission helpers. | **PLANNED:** preserve issue identity from the labeled inbox through the dispatch receipt and consumer read. Keep label application a deliberate execution act. |
| Profiles and matrix | **CURRENT:** [profiles](../../profiles/README.md), [routing](../../packages/routing/README.md), and the [Orchid matrix hook](https://github.com/rickylabs/orchid/pull/2). | **PLANNED:** installed dispatcher resolves the authority before each effect. Explicit configurable pins require the trusted owner-override record; a pin alone is not authority. |
| Registration and supervision | **CURRENT:** [Orchid #3](https://github.com/rickylabs/orchid/pull/3) is the source fix for [#352](https://github.com/rickylabs/harness/issues/352), stacked on the matrix hook. | **PLANNED:** coordinator-owned issue 316 / leaf dispatch reaches registered, goal-delivered and working. A ready PR or a busy-pane negative control is not that live proof. |
| Coordinator admission | **CURRENT:** [coordinator](../../packages/coordinator/README.md) owns deterministic admission and durable state/effect boundaries; its README distinguishes shipped decisions from wiring. | **PLANNED:** preserve admission versus execution. Reuse existing state-store contracts and receipts; do not create a second product effect ledger. |
| Telemetry and public reads | **CURRENT:** [telemetry](../../packages/telemetry/README.md) supplies run and governance observations. [PR #353](https://github.com/rickylabs/harness/pull/353) adds the bounded collection/decoder under [#354](https://github.com/rickylabs/harness/issues/354). | **PLANNED:** bind explicit dispatcher/native ancestry and each cost source, then verify the installed published package through cockpit. An unavailable row remains unavailable until its own source is enrolled. |
| Two seams and sandbox | **CURRENT:** [the two-seam contract](../concepts/02-the-two-seams.md) separates autonomous seats from token calls and places the seat gate at the sandbox boundary. | **PLANNED:** any new binding proves the appropriate seam and refusal behavior. Keep sandbox/governance implementation under [#35](https://github.com/rickylabs/harness/issues/35); do not infer interception inside vendor CLIs. |
| NetScript service adoption | **CURRENT:** [netscript-bridge](../../packages/netscript-bridge/README.md) is a runtime adapter placeholder under [#37](https://github.com/rickylabs/harness/issues/37). | **PLANNED:** identify a concrete caller, discover the served operation and schema, then implement only its adapter. Cockpit retains its product runtime composition. |

## Contract-first boundaries

**PLANNED.** Every added consumer boundary reuses its owning package's vocabulary and exported
decoder. Move a shared implementation when publication requires it; do not copy the model.
The route move in PR #353 follows this rule: the original subagents entry re-exports the
canonical implementation from the published contracts package.

**PLANNED.** The acceptance record distinguishes source implementation, packed package,
installation, live source binding and product acceptance. It names the exact command/read,
version, bounds and completeness/refusal semantics. Incomplete trees are rejected as a whole;
a prefix must not appear to be complete ancestry. Native session identities stay private.

**CURRENT.** The charter's three cost rows have distinct sources and units. The per-issue
candidate keeps all three explicitly unavailable until bound. Provider-wide subscription
headroom does not become one run's metered spend. The current task does not authorize another
collector or a native model/session observer.

## Composition and durable operations

**PLANNED.** Retain the existing Cordis composition points on the Node side. NetScript's
core/connector pattern is useful prior art for separating behavior from hosting; its Deno
plugin generator is not a reason to replace Harness's package graph. A service requirement
uses the existing runtime adapter boundary, never a cross-repository workspace import.

**PLANNED.** Before implementing a NetScript call, use `list_service_operations` and
`get_operation_schema` on the discovered service. Inspect public package exports and installed
behavior before declaring a framework gap. Record an unavailable service or missing export as
inconclusive. A core interface alone does not establish that no implementation exists.

**PLANNED.** Preserve the current local dispatcher receipt/state mechanism at its execution
boundary. Cockpit's durable stream consumes observations and owns product delivery/recovery;
it does not become the dispatcher. Future adapter work must name which existing runtime owns
retry, fencing and effect receipts before introducing any new mechanism.

## Delivery sequence

1. **PLANNED:** complete coordinator-owned #352 / issue 316 acceptance from the matrix plus
   registration stack. Orchid merges remain owner-controlled.
2. **PLANNED:** complete #354 source publication and explicit observation bindings; prove the
   source-to-cockpit path without fabricated ancestry, liveness or cost.
3. **PLANNED:** choose the next concrete adapter or composition gap from its existing epic,
   starting with a served contract and caller. File one issue and one PR for that slice.
4. **PLANNED:** add a NetScript runtime capability only after source/export/operation evidence
   identifies what is reused and what adapter behavior is missing.

**CURRENT.** [Mailbox pilot #349](https://github.com/rickylabs/harness/issues/349) and its
[existing RFC](../../.llm/runs/charter-enforcement--e11/mailbox-rfc.md) remain an undecided pilot
for a separate owner brainstorm. This RFC neither ratifies a mailbox contract nor claims a
measured efficiency improvement. Future design files use the numbered RFC format.

## Consequences

**PLANNED.** “First-class” means discoverable contracts, explicit composition/binding and
verifiable behavior. It does not mean importing every framework subsystem into this repository.
The main cost is retaining explicit incomplete/unavailable states while integration evidence
is missing; that prevents the phone from presenting invented operational truth.

**CURRENT.** The family charter takes precedence over older repository descriptions. The
cockpit document's historical fixed trigger vocabulary does not override Harness's current
configuration-driven routing source. No runtime constants are introduced to imitate an older
matrix snapshot. Any actual change of ownership or charter requires a numbered owner decision.

## Revisit triggers

**PLANNED.** Revisit when a deployed service contract establishes a concrete bridge caller;
when provider composition has an approved execution contract; when the owner ratifies mailbox
behavior; when publication changes the consumer boundary; or when measured integration
contradicts an ownership assumption. Keep failed or skipped checks visible as unproven.
