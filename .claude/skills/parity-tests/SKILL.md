---
name: parity-tests
description: >-
  Which parts of rickylabs/harness other repositories depend on, and how they are regression-tested.
  Use this before moving, renaming or reshaping anything under packages/contracts, packages/routing,
  packages/subagents, profiles/ or a harness-* CLI, and before writing or deleting any test. It says
  which tests are allowed to exist, where the one cross-package test lives, and what it may assert.
---

# Parity tests

Regression tests exist only for parity features (golden rule 7). These are the consumer surfaces that
atelier-cockpit and orchid read from harness at a pinned revision. The list is the table in
[`docs/STRUCTURE.md`](../../../docs/STRUCTURE.md#consumer-surfaces): the contracts exports, the
routing matrix files and CLI, routing discovery, the subagents route, dispatch and go grammar, the
contracts governance read model, `profiles/<name>.md`, and the four `harness-*` CLIs.

## Where the test lives

There is one cross-package test, `tests/parity/` (added by issue #657). Package unit tests stay in
their package. No other test reaches across packages.

## What it may assert

- An export exists with the expected name and kind; a file exists at the path a consumer reads.
- A CLI resolves from its `bin` and exits 0 on `--help`.
- A profile has valid frontmatter. Use `scripts/profile-frontmatter.mjs`; do not write a second
  parser.
- Never screen text: no matching rendered output, terminal text or screenshots (golden rule 6). Assert
  exit codes, exports and parsed structure.

## When you move a surface on purpose

Edit the parity test in the same PR. Name the consumer that has to follow, in the PR body and in the
issue's Dependencies. Keep `packages/subagents/src/route.ts` and `dispatch.ts` self-contained, with no
new imports. Make contracts changes additive.

## Other tests

A test of code that is being pruned goes with the code. Write no new legacy-behaviour tests. A new
guard or check still needs a test that proves it fails when broken. That test lives next to the
guard, not in `tests/parity/`.
