# Context pack — forge-cwd-guard--e10

## Summary

Issue [#217](https://github.com/rickylabs/harness/issues/217) passed independent Opus 5 plan review
after the bounded fixes in [`review-disposition.md`](review-disposition.md); Stage G is `PASS` in
[`plan-eval.md`](plan-eval.md). No product mutation had occurred when this gate opened. The effective
plan adds a pre-transport identity guard
for `init`, `labels eject`, and `skill install`: explicit `--repo` plus a different parseable GitHub
origin at target cwd exits `2`; `--force` accepts it; missing/non-GitHub origin and non-local-writer
commands preserve existing behavior. Writer dry runs are guarded too, so dry run predicts admission.

## Resume point

1. Read [`implementation-disposition.md`](implementation-disposition.md) and the exact diff.
2. Obtain independent GLM 5.3 Flash implementation review through the ready `opencode` session named
   in [`worklog.md`](worklog.md). Shell, edit, and network remain denied to that reviewer.
3. Apply only bounded review fixes, rerun affected focused gates and the build, and record any plan
   deviation in `drift.md` ([`doctrine/WORKFLOW.md:59-69`](../../../doctrine/WORKFLOW.md)).
4. The parent coordinator owns real-checkout dry-run evidence, commit/PR handling, and issue closures.

## Identity

- Worktree: `/home/agent/projects/harness/.git/seat3-forge217`
- Branch: `fix/forge-cwd-guard`
- Baseline: `946dcfcadf8a25cc29425f65b5fa429951830459`
- Plan author: `gpt-5.6-sol`, medium, Codex sub-session `/root/forge217`
- Plan reviewer: Claude Opus 5, medium, separate session
- Implementation evaluator: GLM 5.3 Flash, separate session
- Required commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Key evidence

- Explicit repo bypasses origin resolution, then context probes transport
  ([`packages/forge/src/cli.ts:251-290`](../../../packages/forge/src/cli.ts)).
- `init` ejects first and has no current identity guard
  ([`packages/forge/src/cli.ts:583-603`](../../../packages/forge/src/cli.ts)).
- Eject and skill install are standalone local writers
  ([`packages/forge/src/cli.ts:497-580`](../../../packages/forge/src/cli.ts)).
- Existing origin parsing is a loose regex
  ([`packages/forge/src/labels/github.ts:217-225`](../../../packages/forge/src/labels/github.ts)).
- CLI tests already inject a recording transport through the real entrypoint
  ([`packages/forge/src/cli.test.ts:21-86`](../../../packages/forge/src/cli.test.ts)).
- Tutorial step 2 currently states that no guard exists
  ([`docs/tutorials/01-from-clone-to-board.md:60-81`](../../../docs/tutorials/01-from-clone-to-board.md)).

## Adjacent closure decisions

[`closure-decisions.md`](closure-decisions.md) records the parent's independent judgment: issue #209
is complete after `033da73` and `99d48de` and may be closed after guard work; issue #212 remains open
because concrete prose fixes and an admission did not create the executable stale-output gate. This
sub-session does not mutate either issue or the board.

## Prohibited surfaces

Do not alter `BOARD.md`, other worktrees, sibling repositories, auth/environment/home state, binaries,
live labels, or GitHub issue/PR state. Do not push or merge. The exact mutation allowlist is in
[`supervisor.md`](supervisor.md).
