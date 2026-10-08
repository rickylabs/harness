# ADR 0005 — Harness is our framework; dsh is an additional-router experiment

**Status:** accepted · **Date:** 2026-10-03 · **Ratified by:** Eric, through the coordinator · **Amends:** `ARCHITECTURE.md` and current framework documentation · **Supersedes:** the dsh-only product premise of #30 and its surviving current-facing descriptions · **Superseded where they differ by:** [ADR 0006](0006-rearch-2026-10-08.md)

## Decision

Harness is our own portable agent framework, built on [Orchid](https://github.com/rickylabs/orchid) for dispatch and [Herdr](https://github.com/herdrdev/herdr) for terminal control. It owns contracts, routing, provider boundaries, native observations, board and coordination mechanics, and the portable method and run record. It is not a collection of DeepSeek Harness plugins.

Retain DeepSeek Harness as an optional additional-router experiment. Its current `packages/dsh-app` composition, genuine upstream dependencies, profiles and golden fixtures remain valid experimental material. The approved relocation is `experiments/routers/dsh`, with default core checks excluding that experiment. Cleanup PR 3 implements the relocation and core-only selectors; the original documentation PR did not claim they had happened. Live experiment testing waits until after the next APK.

## Authority and evidence

Eric made Decision Q on 2026-10-03 and the coordinator approved the seven ordered cleanup PRs, flat core paths, this ADR and retained historical evidence. This record supplies the owner decision required by `ARCHITECTURE.md` §13 before changing the charter. The earlier decisions and completed run records remain historical evidence; their text is not rewritten to manufacture agreement.

At the inspected main revision `d0e0e7bce81b52ce1b1b62d7c9301a54af7d14ed`, only `packages/dsh-app` declares or imports `@deepseek-ai/*`. The core modules expose their own implementations and boundaries: [routing](../../packages/routing/src/document.ts), [board](../../packages/board/src/index.ts), [coordinator](../../packages/coordinator/src/index.ts), [telemetry](../../packages/telemetry/src/index.ts) and [forge](../../packages/forge/src/index.ts). The [experimental composition](../../experiments/routers/dsh/package.json) is a consumer of those modules, not their required host.

The [profiles](../../profiles/README.md) define eight matrix-role processes, the researcher compatibility alias and a dedicated milestone coordinator. Native activity and dispatch evidence are documented in [telemetry](../../packages/telemetry/README.md). Orchid's owner-authorized routing and native launch work is recorded in [#59](https://github.com/rickylabs/orchid/pull/59), [#64](https://github.com/rickylabs/orchid/pull/64), [#61](https://github.com/rickylabs/orchid/pull/61) and [#70](https://github.com/rickylabs/orchid/pull/70). Source or merged code establishes its implemented boundary; current activation, credentials, capacity and successful execution still require separate observations.

## Boundaries that remain

- Keep `@rickylabs/harness-contracts`, public exports and flat core package paths. Cockpit and mobile remain separate products; the native client uses cockpit's captured API/client for runtime product behavior.
- Keep routing configuration replaceable. The matrix is the default for agentic launches. A verified Eric-authorized owner-native override carries its own provenance and shares physical admission, accounting and safety checks; it does not invent a matrix receipt or waive evaluator independence.
- Keep native tasks separate from API/local-model calls. Native CLIs own their loops; an adapter may claim interception or enforcement only where implemented and proved.
- Keep GitHub authoritative for issues, labels and PRs. Native session stores and truthful launch receipts establish execution; admission, freshness and certification are separate facts. Unknown never means failed or permission to redispatch.
- Keep exact source identity, privacy screening, durable fences, budget accounting and independent evaluation. A documentation rename grants no runtime authority.

## Ordered implementation and consumer protection

1. Correct current documentation and metadata through this ADR; keep existing paths and executable names.
2. Introduce canonical core CLI names with tested compatibility aliases and regenerated references.
3. Move the dsh router into experiments and prove default core build/typecheck/test selection.
4. Establish canonical method/doctrine/tools and run-record template homes, preserving existing consumer entrypoints and historical records.
5. Migrate operator names with paired consumers and operator-controlled rollout.
6. Add canonical wire vocabulary to strict readers first, with required contracts and generated-client releases.
7. Switch producers only after reader readiness, retaining evidenced legacy read compatibility.

The vault refresh can start once steps 1–4 are merged: that is the truthful framework structure. Steps 5–7 are pending naming migrations until their paired rollouts complete. No live settings, host operations, experiment activation or deployment is authorized by a source merge. Issue #30–#39 replacement text is prepared separately for the coordinator to apply after leak review; no dispatch label is changed by this cleanup.

## Cost and alternatives

Keeping the dsh-only premise would make new agents follow a host and deployment that do not own the running framework, and would misdirect the vault structure. Deleting the router would discard a real future integration and its evidence. Relabelling upstream packages or rewriting old records would falsify provenance.

The selected approach preserves the integration while correcting current identity. Its cost is staged naming compatibility and explicit paired consumer/operator work. Those migrations remain visible debt until verified, rather than becoming silent path or wire breaks.
