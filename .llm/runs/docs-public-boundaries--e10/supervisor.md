# Supervisor — docs-public-boundaries--e10

## Summary

This run makes the remaining public-documentation boundary corrections from the E10 addendum. It
will distinguish the declared Node baseline from an attributed historical observation, state the
tutorial's shell boundary without promising universal platform support, distinguish executed local
transcripts from source-derived illustrations, normalize machine-specific paths, and remove private
consumer identity and feature details from currently tracked public text.

The baseline is `7f6aed81751ed427dff26b0bd9231bf3d7b1f965` on branch
`docs/public-example-boundaries` in the isolated worktree
`/home/agent/projects/harness/.git/seat3-docs-boundary`. The plan author is `gpt-5.6-sol` at medium
reasoning. Product-document mutation remains blocked until a separate Claude Opus 5 medium session
reviews the plan and Stage G records `PASS` ([`doctrine/WORKFLOW.md:71-90`](../../../doctrine/WORKFLOW.md)).

## Authority and routing

- The owner explicitly selected the addendum's honest-boundary option; this run does not build a
  pasted-output gate. The addendum permits either a gate or an explicit illustrative/verified
  boundary ([issue #212](https://github.com/rickylabs/harness/issues/212)).
- Plan author: `gpt-5.6-sol`, medium.
- Independent plan reviewer: Claude Opus 5, medium, separate session.
- Documentation implementer after Stage G: Gemini 3.8 Flash, high, through its CLI.
- Post-implementation evaluator: GLM, provider default, separate session.
- The parent coordinator owns commits, pull requests, issues, and all forge interaction.

## Exact mutation surface

Run artifacts may write only:

- `.llm/runs/docs-public-boundaries--e10/supervisor.md`;
- `.llm/runs/docs-public-boundaries--e10/research.md`;
- `.llm/runs/docs-public-boundaries--e10/plan.md`;
- `.llm/runs/docs-public-boundaries--e10/adversarial-review.md`;
- `.llm/runs/docs-public-boundaries--e10/review-disposition.md` if review requires bounded fixes;
- `.llm/runs/docs-public-boundaries--e10/plan-eval.md`;
- `.llm/runs/docs-public-boundaries--e10/local-example-receipts.md`;
- `.llm/runs/docs-public-boundaries--e10/implementation-eval.md`;
- `.llm/runs/docs-public-boundaries--e10/worklog.md`;
- `.llm/runs/docs-public-boundaries--e10/drift.md` only if the locked plan changes.

After Stage G passes, product-document mutation is limited to:

- `AGENTS.md`;
- `README.md`;
- `docs/README.md`;
- `docs/tutorials/README.md`;
- `docs/tutorials/01-from-clone-to-board.md`;
- `docs/concepts/01-what-this-is.md`;
- `packages/netscript-bridge/README.md`;
- `.llm/runs/m1-dsh-coordinator--orchestration/reviews/pr-190-glm.md`.

No source, generated CLI reference, package manifest, lockfile, workflow, binary, screenshot, or
`BOARD.md` may change. Existing history is not rewritten. No sibling repository or worktree is in
scope.

## Safety boundary

Verification may execute only local built CLIs against unique temporary homes. Telemetry commands
must clear the four documented `DSH_TELEMETRY_*` overrides without reading their values and must
always pass the temporary `--home`; the CLI otherwise defaults to the current user's home
([`packages/telemetry/src/cli.ts:91-128`](../../../packages/telemetry/src/cli.ts)). Verification must
not inspect auth, dump the environment, read a default home, contact a model endpoint, or mutate a
real forge/GitHub target. No issue, label, PR, push, merge, or deployment action belongs to this run.
