# Fleet routing authority

This directory is the pinned Harness source for Orchid and Cockpit. It contains the complete
workload tier × role matrix, coordinator matrix, logical model catalog, ordered transport
capabilities, owner override and cross-vendor evaluator rules. The code was ported from the
clean NetScript `0985265f491f508d55f3b56d2cfc5bda20f68426` checkout. Consumers pin a full
Harness commit and verify a clean checkout before importing it.

`deno run --no-config --no-lock matrix/cli/delegation-matrix-table.ts --json` from the
`packages/routing` directory emits the closed JSON table used by the Orchid bridge and Cockpit
pre-check. `matrixTable()` provides the same data to tests. The JSON table has 5 workload tiers,
8 roles per tier and 4 coordinator scopes; empty cells and fallback order are significant.

Harness has newer native Sol and Luna model IDs than the pinned NetScript source. The preferred
Codex default is `gpt-6.1-sol` at `xhigh`, including simple tasks, coordinator scopes, and
Codex research fallbacks. Complex and architecture implementation keep Astra and their
existing efforts. Luna and older Sol capabilities remain in the catalog for compatibility,
so no previously known physical model ID disappears. The `matrix.test.mjs` gate checks
every source cell against the frozen pinned export plus the 2026-09-30 owner decision, every source capability against the ported
catalog, the preferred native IDs, owner and privileged gates, fallback, role transport, and
cross-vendor evaluator independence. It runs on the supported Node 24 floor. The frozen fixtures
are source evidence, not runtime inputs.

`deno run --no-config --no-lock matrix/cli/matrix-view.ts` is the human query viewer ported from
NetScript's `agentic:matrix`: the full matrix as Markdown, `--tier`, `--role` (with aliases such as
`impl-eval`), `--plan-evaluator`, `--impl-evaluator`, `--fallback-of <model>` and `--json` per
view. It never replaces the closed table above; its full, tier and role JSON equals
`matrixTable()`. `matrix-view.test.mjs` replays every recorded NetScript query, refusals included,
from the frozen `matrix-view.e75161c.json` reference with the same owner decision applied;
refusals and unrelated routes retain their source behavior.

The legacy `routing.v1.json` profile remains readable until its consumers migrate. The
version-2 document schema under `src/fleet.ts` remains a separate configuration reader; this
pinned runtime is the dispatch authority for the Orchid/Cockpit cutover.

`openrouter-launcher-policy.ts` carries the explicit four-ID admission set of the legacy
OpenRouter remote-model launcher. It is separate from the model capability catalog: a catalog
entry alone does not approve a paid launch. Retired IDs and proposed new IDs remain refused
until a separate policy decision changes this set.
