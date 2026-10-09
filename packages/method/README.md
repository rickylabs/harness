# method

The method tools and the run templates. The rules they enforce, and the
[run lifecycle](../../docs/DOCTRINE.md#run-lifecycle) that fills the templates, are in
[`docs/DOCTRINE.md`](../../docs/DOCTRINE.md).

## Commands

From the repository root, after `pnpm install`:

    pnpm exec harness-method milestone render <run-dir> [--check]
    pnpm exec harness-method milestone validate <run-dir> --github-prs <export.json>
    pnpm exec harness-method receipts receipt.json another-receipt.json

- `milestone render` writes `milestone-status.md` from `milestone-cluster-state.json`; `--check`
  compares instead and exits 1 when the page is stale or missing.
- `milestone validate` checks the five cluster artifacts (intake, inventory, dependency DAG, cluster
  state, status page), the [open-decision rule](../../docs/reference/blocked-decisions.md), and reconciles
  leaves against a captured PR export. Without an export, reconciliation is unavailable and the run
  never passes.
- `receipts` is the [matrix receipt checker](../../docs/reference/matrix-receipts.md).

Exit codes follow the gate states: 0 passed, 1 refused or unreadable, 2 no verdict. The
[generated CLI page](../../docs/reference/cli/harness-method.md) has the full table.

## Layout

`mod.ts` is the only entry. `src/domain` holds the pure checks (one module per artifact, the
reporting and I4 rules, gate receipts, route receipts, the status page renderer); `src/application`
the use cases; `src/ports` the interfaces they need; `src/adapters` the filesystem, js-yaml, PR-export
and CLI code. The package runs from source under Node 24 type stripping, so the bin exists as soon as
`pnpm install` links it; `tsc` type-checks it with the repository's strict base.

## Templates

[`templates/`](templates/) are the starting artifacts for a run or a milestone cluster. Copy them into
the run directory your brief authorizes. Completed run records under `.llm/runs/` stay byte-identical;
moving the templates relocates no completed record. The plan and supervisor templates refer to facts of
the target project, which must be cited from that project; N/A and unproven remain honest outcomes.

The renderer's first line names `packages/method`. Status pages rendered before the tools moved here
carry their earlier header and are history: re-validating one without rendering it again reports it
stale, by design.
