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
Codex capabilities are `gpt-6-sol` and `gpt-6-luna`; the older source capabilities remain in the
catalog, so no previously known physical model ID disappears. The `matrix.test.mjs` gate checks
every source cell against the frozen pinned export, every source capability against the ported
catalog, the preferred native IDs, owner and privileged gates, fallback, role transport, and
cross-vendor evaluator independence. It runs on the supported Node 24 floor. The frozen fixtures
are source evidence, not runtime inputs.

The legacy `routing.v1.json` profile remains readable until its consumers migrate. The
version-2 document schema under `src/fleet.ts` remains a separate configuration reader; this
pinned runtime is the dispatch authority for the Orchid/Cockpit cutover.
