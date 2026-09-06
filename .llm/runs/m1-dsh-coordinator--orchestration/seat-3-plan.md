# Seat 3 continuation plan

Draft: repair the 13 verified milestone conflicts, evaluate PR 190, ship one isolated
consolidation fix, and file the durable-loop design on E6/E9. No product or board mutation
before independent plan PASS. Owner release and architecture forks remain open.

## Authority and evidence

The owner handoff explicitly authorizes autonomous milestone maintenance, evaluated merges,
and separate PRs for issue 182. The live board check on 2026-09-06 exited 1 with exactly
13 epic-milestone-conflict findings. PR 190 head is faebcda72b2418456e9365825020f459356b3b28;
its CI is successful and its author is Anthropic (https://github.com/rickylabs/harness/pull/190).
Issue 182 names the isolated sibling-block defect (https://github.com/rickylabs/harness/issues/182).
`packages/dsh-app/src/llm/request.ts:136` joins sibling text blocks without a separator.

## Decisions

1. Set milestone M1 — dsh coordinator foundation on issues/PRs 183, 186, 174, 175,
   188, 176, 184, 185, 177, 178, 179, 180, 181. Their epic already belongs there.
   Do not change epic identity, topic labels, status, or dispatch labels. Read back and
   require board check exit 0. Alternative: remove epic milestones, which widens scope.
2. Require GLM 5.3 Flash independent implementation evaluation before merging PR 190.
   Current matrix straightforward implementation-evaluation cell, with provider-default effort;
   DeepSeek V4 Pro only on primary unavailability. Retired Sol route is invalid.
3. Use one separate child issue/PR for sibling-block flattening. Preserve text boundaries
   with newline separators; verify user, assistant and nested tool result behavior, keeping
   image refusal and reasoning omission. Plan review must validate this scope before code.
4. E6/E9 design is a draft until its own review. Research durable journal, workflow planner,
   board projection, live telemetry and mux sources before proposing orchestration wiring.

## Owner forks

No new owner choice is required for milestone repair or the bounded correctness fix.
Existing release tag, governance ADR, permanent topic conflicts and deployment forks stay
with their existing owner issues. Do not publish packages or activate a runtime fleet.

## DAG and gates

Plan review/evaluation → milestone repair → check exit 0.
PR 190 independent evaluation → named failure or ready-merge → squash merge → shipped readback.
Sibling fix research → plan evaluation → issue/implementation → regression test/build →
opposite-family implementation evaluation → PR merge.
E6/E9 source research → draft plan artifacts → file on issues 36 and 39.

## Risks

- Concurrent board changes (medium): re-read targets before mutation and check after batch.
- Documentation false claims (medium): independently review exact PR head and live facts.
- Separator changes intentional fragments (medium): compare upstream text-block contract
  and existing tests before implementation; record any scope change in drift.
- Credentials/publication (high impact): no credential/session data in artifacts; no workflows.

## Review dispositions — 2026-09-06

1–2. Current source pin is netscript 8ba53bc50ca02aab29e99ba5362728839b8f1713,
https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/harness/workflow/lane-policy.md
Retrieved into a read-only source copy and rendered with `deno task agentic:matrix --tier
straightforward --json`. The 2026-09-04 workload matrix replaces historical named routes;
provider_default is the current cell, max is the retired route. PR 190 GLM uses OpenCode Go,
not OpenRouter. Straightforward plan-eval uses claude-opus-5 medium.

3. OpenRouter fallback receives only the code diff, never .llm/run evidence or credentials.
OpenCode Go subscription transport is not that OpenRouter relay. A final GLM verdict is an
implementation-gate report with cited checks, never evidence of a hidden reasoning trace.

4–5. Corrected join citation: request.ts:131. Coverage means text content inside tool-result
blocks, not recursively nested tool-result blocks. The independent research checks installed
dsh-llm-pi-ai and dsh-llm-deepseek implementations; they also join with empty strings. This
upstream behavior does not prove newline is a vendor requirement. Issue 182 identifies this
as a harness defect; separator semantics must be reviewed explicitly in the child plan.
Stream chunks in adapter.ts and stream.ts are outside the mutation surface.

6. `git diff origin/main...origin/docs/189-public-repo-truth-and-polish -- BOARD.md` is empty;
the reported generated-board hunk came from comparing tips rather than the PR merge base.
Do not modify BOARD.md by hand. Re-check head, CI, mergeability and actual PR files directly
before merge. Any head change invalidates the evaluation until reviewed.

7. Repair changes only the 13 listed child milestone memberships; no epic membership is
changed. The historical de-milestoning note predates today's live epic state, whose provenance
is not established. This run follows current GitHub truth and the user's explicit check-zero
repair requirement, without claiming to ratify a new burn-down policy. Compare exact live
membership sets before/after: expected set = original union the 13 targets. Exactly 12 are
closed/shipped and 1 (#181) open/triage; verify states directly before mutation. Also require
all labels unchanged. If readback or check fails, stop further effects and record the exact
failure; only revert this batch's milestone additions if the failure is attributable to this
batch. Never undo a concurrent actor's unrelated changes.
