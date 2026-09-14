# Prune pass — five probes, five zeros, and four false positives worth keeping

Coordinator receipt. 2026-09-14, against `b1b75fa` on main. Posted on issue 315. Nothing was
deleted, relocated, redacted or untracked.

## Scope, after the owner-reserved surface is removed

377 tracked files under `.llm`, of which 363 are run directories. Rules of the NAS rule 2 makes
harness-run cleanup an owner-controlled post-stable-release operation and forbids deleting any run
directory the owner has not explicitly selected. It also states that a scoped harness run is not to
be stripped, untracked, redacted or classified as leakage merely because it holds run identities,
worktree paths, receipts or resumable state — which is exactly the content a stale-content sweep
targets, so the rule anticipates the argument. The conflict between a prune mandate and that rule
resolves to the owner, not to a coordinator.

Addressable: 370 package files, 21 docs pages, 14 scripts, 5 profile and deploy files, the root
documents.

## Results

| Probe | Population | Candidates | Real |
| --- | --- | --- | --- |
| Unreferenced source modules | 176 | 4 | **0** |
| Docs pages nothing links to | 21 | 0 | 0 |
| Scripts nothing invokes | 14 | 0 | 0 |
| Tracked build output | — | 0 | 0 |
| Profile and deploy files unreferenced | 5 | 0 | 0 |
| Exported symbols named only in their own file | 1636 | 37 | **0** |

`.gitignore` covers `dist/`, `node_modules/` and logs, and no compiled output is tracked.

## The finding: four out of four false positives from a probe whose control passed

The module probe searched import and export-from specifiers and `require`. Its control, a module
known to be imported, came back referenced by 16 files, so the probe fired. It then reported four
unreferenced modules and all four are live:

    packages/coordinator/src/state-store-child.ts         fork(new URL("./state-store-child.js"))
    packages/dsh-app/src/dry-run-child.ts                 fork(new URL("./dry-run-child.js"))
    packages/dsh-app/src/board-smoke.ts                   npm script runs node dist/board-smoke.js
    packages/telemetry/adapters/opencode-usage-probe.ts   a test readFile's the source as an artifact

A control proves the search fires against the pattern it implements. It says nothing about whether
that pattern covers how the codebase actually refers to things. Three reference mechanisms appear in
no import graph: a child process forked by URL, an entry point reached through a package manifest,
and a source file read as data by a test that asserts on its contents.

New row for the absent-signal catalogue: **a reference the probe cannot express, reported as an
absence of references.** It is the same shape as the sweep failure recorded in
`charter-reconciliation.md` the same night — there the instrument was not pointed at every source,
here the instrument cannot see every kind of pointing — and both were caught only by checking each
candidate individually rather than trusting an aggregate that had passed its own control.

## Exported symbols

37 of 1636 are named only inside their own file. Control at 53 mentions. Almost all are types,
interfaces and const unions, which are public API surface and not dead by virtue of having no
internal consumer. Three are functions and none should be removed:

- `plainDataProblem` in `packages/routing/src/schema.ts` and `safeLabel` in
  `packages/telemetry/src/source.ts` are used inside their own file. Their `export` is wider than
  needed. That is API-surface tightening, not pruning, and both sit in lanes with live work.
- `laneConstraint` in `packages/routing/src/configuration.ts` is referenced nowhere, including in
  its own file. It is named explicitly in `.llm/runs/routing-configuration--271/plan.md:547` beside
  `effortIndex`, `isDeclaredEffort` and `maxFallbackDepth` as part of the loader's reader surface.
  Those three are referenced, at 4 and 18 mentions. So it is the one member of a deliberately
  specified accessor set whose consumer has not shipped, and issue 273 is titled "Resolve lanes and
  evaluators against the selected generator".

**Planned but not yet consumed is not stale.** From inside a single commit it reads identically to
dead code, and the only thing distinguishing them is the plan. That is a general rule for any prune
pass on a repository with queued work, and it is the reason `laneConstraint` is reported rather than
removed.

## Reproducing this

The probes are shell, not committed as tooling, because a hygiene measurement should not leave a
gate behind that nobody asked for. The shape that matters, for anyone repeating it:

1. Enumerate the population from `git ls-tree`, not from the filesystem, so untracked scratch does
   not enter the input set.
2. Run a control first, on a member whose answer is known, and exit non-zero if it comes back wrong.
3. Treat every candidate as a question. Check each one individually for reference mechanisms the
   pattern cannot express before proposing any deletion.
4. Prefer listing an arguable deletion. More can be deleted tomorrow; nothing nobody noticed can be
   un-deleted.

Step 3 is the one that mattered here. Without it this pass would have deleted four live files and a
planned accessor, with a green control to point at.

## Net

The production surface is already tight. The answer to the prune mandate for this repository is a
report rather than a diff, and the four false positives are worth more than the diff would have
been.
