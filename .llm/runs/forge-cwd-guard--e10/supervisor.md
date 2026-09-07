# Supervisor — forge-cwd-guard--e10

## Summary

This run designs and, only after independent plan approval, implements issue
[#217](https://github.com/rickylabs/harness/issues/217): prevent `dsh-forge` local-writer commands
from targeting a checkout whose GitHub `origin` disagrees with explicit `--repo`. The author is a
Codex sub-session running `gpt-5.6-sol` at medium reasoning on host `ai-agents`. The product baseline
is `946dcfcadf8a25cc29425f65b5fa429951830459` on branch `fix/forge-cwd-guard` in the isolated
worktree `/home/agent/projects/harness/.git/seat3-forge217`.

The run is currently locked before product mutation. Independent Stage F review and an explicit
Stage G `PASS` are required first ([`doctrine/WORKFLOW.md:71-90`](../../../doctrine/WORKFLOW.md)).

## Authority and routing

- Owner steer delegates the guard design decision and requires the tutorial warning to describe the
  new guard. There is no owner fork unless implementation uncovers a preference outside that brief
  ([issue #217](https://github.com/rickylabs/harness/issues/217)).
- Plan author: `gpt-5.6-sol`, medium, this session.
- Independent plan reviewer: Claude Opus 5, medium, a separate session.
- Post-implementation evaluator: GLM 5.3 Flash by default, a separate session.
- Required commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Mutation surface

This run may write only:

- `.llm/runs/forge-cwd-guard--e10/*.md`, including the independently authored
  `closure-decisions.md`, review, evaluation, worklog, and drift artifacts;
- `packages/forge/src/cli.ts`;
- `packages/forge/src/cli.test.ts`;
- `packages/forge/src/labels/github.ts`;
- `packages/forge/src/labels/github.test.ts` if a focused parser test file is clearer than extending
  the CLI suite;
- `packages/forge/README.md`;
- `docs/tutorials/01-from-clone-to-board.md`;
- generated `docs/reference/cli/dsh-forge.md` through `scripts/cli-reference.mjs` only.

No product path may change before Stage G passes. `BOARD.md`, issue labels, live repository labels,
other worktrees, sibling repositories, auth state, environment credentials, home directories,
binaries, and deployment surfaces are excluded. This session does not push, merge, or mutate the
GitHub board.

## Safety constraints

Tests use disposable local Git repositories and the existing `CliOverrides.probeTransport` fake
transport seam; no test or experiment invokes Forge with its production transport. No `init` or
`labels apply` operation may run against a real repository. The repository's workflow requires
reviewed artifacts before code and world mutation ([`doctrine/PRINCIPLES.md:30-39`](../../../doctrine/PRINCIPLES.md)).

