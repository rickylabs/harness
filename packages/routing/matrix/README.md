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
Codex default is `gpt-6.1-sol` at `xhigh`, including coordinator scopes. Former Luna cells for simple tasks
and Codex research fallbacks use `gpt-6.1-sol` at `low`. Complex and architecture implementation keep Astra and their
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

The model catalog, labels, ordered cells, loop policies, coordinator scopes and provider precedence
now come from [`routing.fleet.v2.json`](../config/routing.fleet.v2.json). This is an **interim**
versioned routing document under [E11 / #270](https://github.com/rickylabs/harness/issues/270),
not a substitute for provider discovery or the cockpit configuration editor. Its exact Grok 4.7
and standard Muse Spark 1.3 IDs were measured and answered one-line OpenCode probes on 2026-09-30:
Grok on Go and OpenRouter, standard Muse on OpenRouter. Contributor remains a separate catalog
model; it does not replace the standard evaluator. Historical Grok 4.6 stays catalog-only.
No Ollama Grok/Muse ID was served by this host's measured catalogs. Catalog inclusion elsewhere
is not a successful launch claim. Effort support remains unknown.

`configuredRoutingPolicy(loaded)` accepts a successful result of the #271 whole-document loader.
The selected v2 document replaces the shipped catalog, cells, families and launcher approvals
wholesale. It preserves source provenance and cannot merge with the shipped default. V1 inputs
are refused. Load and validate the caller's document before constructing this adapter; an absent
or invalid load is a refusal. Two disjoint document tests prove there is no retained default.
The pinned raw-source bridge still imports the shipped, CI-validated JSON directly. Migrating
those consumers to their own explicit document loaders is interim work tracked by #270; the
bridge is not claimed to provide runtime #271 validation of arbitrary JSON. Existing executor
vocabulary and provider-default effort are also explicitly interim. Compatibility model aliases
are data references, not a second table of physical model IDs.

The legacy `routing.v1.json` profile stays readable until its consumers migrate. Its approved
Grok evaluator now uses the current owner ID. API spending approval is separate from model
catalog membership: `openrouter-launcher-policy.ts` projects only explicit `launcherAlias`
entries from the selected document. It admits the current standard Muse and Grok IDs while
retaining the three unrelated legacy approvals; contributor and retired Grok IDs are refused.

`matrix/opencode-preflight.ts` is a read-only dispatch-host check. It selects the route once,
executes `opencode models <provider>` with a 15-second deadline and a 1 MiB output limit, and
requires an exact provider/model line. An unavailable catalog or missing selected ID produces a
named refusal containing the selected model and launcher. It never starts a turn or silently
chooses another model. With no catalog observation, route resolution reports `unverified`.
A successful catalog check proves configured launcher membership only; quota, reachability,
effort support and independent observed evaluator identity remain separate requirements.

From the `packages/routing` directory, send a workload-route request as JSON on stdin to
`deno run --no-config --no-lock --allow-run=opencode --allow-read matrix/opencode-preflight.ts`.
The output contains only status, launcher, model, logical model, family, requested effort and
catalog timestamp, or fixed refusal fields. It omits worktree and session identifiers.

`matrix/cli-discovery.ts` exposes the same portable observer as the Node package.
Pass its snapshot as `launcherInventory: { discovery: snapshot }` to the workload or
coordinator resolver. A fresh exact configured ID has catalog admission; an unseen ID
is `unverified` with `catalog-model-unseen`, while an absent/stale/unknown observation
is `unverified` with `catalog-not-observed`. `assertRouteLaunchable` converts either
state into a named refusal. Neither resolver nor preflight changes the selected model
or transport to hide a missing observation. Catalog admission remains separate from
entitlement, quota, requested effort support and independent evaluator identity.

The generic `preflightDiscoveredWorkloadRoute` in `matrix/cli-preflight.ts` resolves once
and probes only the selected CLI, including AGY/antigravity. Exact observed IDs can
establish catalog admission; unproven auth/provider/effort facts stay unknown. From `packages/routing`, send the
same workload request on stdin to:

```sh
deno run --no-config --no-lock --allow-run=claude,codex,opencode,agy --allow-read --allow-env --allow-net=127.0.0.1 matrix/cli-preflight.ts
```

The environment permission lets the Node-compatible subprocess API inherit the CLI
environment and set a process-local password for its owned loopback metadata listener;
the observer does not emit environment values. This emits fixed admission/refusal fields and excludes caller/account metadata. The CLI
returns exit 2 for unverified admission. The older OpenCode-only preflight remains
available for existing pinned consumers. See the [discovery contract and official
CLI sources](../README.md#read-only-cli-discovery-274).
