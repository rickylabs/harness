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

## Repository identity and PR export

All four JSON artifacts must name the same `repo`, `milestone`, `baselineMainSha` and explicit
`defaultBranch`. Set the template's example branch to the repository's actual default, including
`master` or a qualified name such as `release/stable`. Leaves must target that branch directly.
The `baselineMainSha` and `currentMainSha` field names remain unchanged; they identify commits on
the verified default branch. The renderer displays the repository and branch with the current SHA.

Capture repository metadata with the official GitHub CLI:

    gh repo view OWNER/REPO --json nameWithOwner,defaultBranchRef

Keep its unmodified JSON object in `repository` alongside the milestone PR records in the export:

```json
{
  "schemaVersion": 1,
  "repo": "example/project",
  "milestone": "0.0.x",
  "capturedAt": "2026-01-01T00:00:00.000Z",
  "repository": {
    "nameWithOwner": "example/project",
    "defaultBranchRef": { "name": "master" }
  },
  "pullRequests": []
}
```

Capture the repository metadata and PRs together after the artifact update; set the one `capturedAt`
when the capture completes. Include every open milestone PR and every recorded nonterminal leaf's
current PR record, with `number`, `issueNumbers`, `lane` (or null), `baseBranch`, immutable `headSha`,
`state` (`open`, `merged`, `closed`) and `role` (`leaf`, `coordinator-artifact`). Use GitHub's
`baseRefName` and `headRefOid` for the branch and head, and retain coordinator roles explicitly.
An empty PR array is valid for bootstrap when repository identity is still present and verified.

The repository name and `defaultBranchRef.name` must exactly match the canonical artifacts. The
branch is never inferred from PRs. A competing top-level `defaultBranch`, repository `capturedAt`,
duplicate JSON key or duplicate PR is refused. Missing or invalid identity also refuses with zero PRs.
Every capture anchor must be a real UTC timestamp at second or millisecond precision, ordered as
`intake.capturedAt <= inventory.capturedAt <= state.updatedAt <= export.capturedAt <= now`.
Freshness is relative to these artifacts; this does not authenticate historical exports or impose an
arbitrary age limit. Recapture after updating state or PR heads. Exact-head and independent evaluator
requirements still apply. Wrong-base recorded leaves refuse and still undergo stale-head checks;
unrecorded open PRs are reconciled only on the verified default branch, excluding coordinator artifacts.

Extend this behavior through `src/domain/milestone/identity.ts` and the existing read-only
`MilestonePrSource` port's `readRepository`, `listOpenMilestonePrs` and `readPrHead` operations.
`validateMilestoneRun` also takes a `DuplicateKeyCheck`; the CLI injects `jsYamlDuplicateKeys` for
artifacts and the export. Parsed-object callers must reject textual duplicates before parsing.
The public API controls live in `tests/default-branch.test.mjs`; run their emitted-JavaScript mutation
controls with `node packages/method/tests/default-branch-mutations.mjs` after frozen installation.

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
