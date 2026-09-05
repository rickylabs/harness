# @rickylabs/routing

The delegation matrix, as data. One question, one answer: which model, at which effort, over which
transport, for a given lane — and who is allowed to certify the result.

Owned by **E4 · #34**, defined by **#58**.

## What is in here

| File | What it owns |
| --- | --- |
| `models.ts` | Every model id, and the family it belongs to |
| `policy.ts` | The matrix: one entry per lane, each an ordered fallback chain |
| `family.ts` | Generator is not evaluator, checked against the two-seam topology |
| `resolve.ts` | The only sanctioned way to ask the table a question |

## Family is a property of the model, not of the harness

This is the load-bearing decision, and everything structural about the evaluator rule follows from
it.

The fleet's own resolver derives family from the *agent*: `claude` means anthropic, `codex` means
openai, anything else means google. That holds exactly as long as the transport is native. The
moment a run goes over OpenRouter the harness is just a driver — the Claude CLI pointed at
`z-ai/glm-5.3-flash` is an **open**-family run, and calling it anthropic gets the rule wrong in both
directions at once: an approved third-opinion evaluator is refused as self-certification, and GLM is
accepted as an evaluator for GLM-authored work. The fleet patches around this with an out-of-band
`evaluatorModelPolicy: 'open_only'` marker on precisely the two relay evaluation routes, plus a
preset check beside it.

Reading family off the model makes that special case fall out of the general rule instead of
standing next to it. `checkEvaluator` needs no clause for the relay, and none for the seams either:
two runs on *different* seams running the same weights are correctly refused, and a Claude-CLI relay
run reviewing native Opus is correctly allowed.

## What a lane looks like

A lane is an ordered chain. `chain[0]` is the primary; every later step names the closed set of
triggers that reach it.

    docs_polish
      0  claude · native · fable-5 · medium        (primary, included in plan)
      1  claude · native · opus-5  · xhigh         when token-limit
      2  claude · openrouter · z-ai/glm-5.2 · xhigh when no-claude-surface

The fleet stores the same information as one flat array where a free-text `condition` string does
three jobs at once — describing when a lane applies, marking a row as a fallback, and naming the
trigger — so chain order is recovered by filtering for rows whose condition does not begin with
`fallback`. Nothing about a route moved in the port; the ordering just stopped living inside a
`filter` predicate.

Two lanes have **two primaries**, distinguished by what they certify: formal plan and impl
evaluation each seat Fable against openai-authored work and Codex against anthropic-authored work.
`resolveRoute` refuses to pick between them without being told the author family, because guessing
there is the exact mistake the invariant exists to prevent.

## What a step certifies

Four evaluation steps in the fleet matrix carry no author family, and they do not mean the same
thing by it. The relay routes are family-agnostic — an open model is opposite-family to anthropic
and openai alike — while `adversarial_design_eval` carries none because it is not a gate at all: it
is vision evidence that *complements* the required GLM design review. `certifies` distinguishes
them: a family, `any`, or `none`. A `none` step may be scheduled against any author family and may
certify nothing.

## The refusals are the feature

Everything returns a verdict instead of throwing. At the coordinator a refused pairing is a routing
fact to record and fall back from, not an exception to unwind a run around.

- **An undeclared effort escalation is refused, never inferred.** `docs_audit` may go to `high` on a
  large changeset because the step says so. Nothing else may, however reasonable it would look.
- **A step outside the plan needs explicit approval.** No step in the current matrix declares
  `outside_plan`. The guard exists so that the day one does, adding the row cannot quietly start
  spending money on a fallback nobody approved.
- **A model this package does not pin cannot certify anything.** `familyOf` answers `null`, and
  every caller treats `null` as a refusal rather than as a family.
- **A relay evaluator seat must run an approved open model.** GLM 5.2 leads design and is a polish
  fallback of last resort; neither makes it an evaluator.
- **A fallback happens at a turn boundary.** Swapping the model mid-turn produces a transcript that
  cannot be read as one run.

`checkPolicy()` runs all of the table-level invariants — every model pinned, every evaluation step
declaring what it certifies, opencode routes naming their router, relay routes naming the profile
that binds their credential, escalations that actually raise effort, lane constraints holding on
every step. The suite asserts it returns nothing.

## What this package does not do

It does not launch anything, and it does not translate a pinned model id into a vendor CLI's command
line. `@rickylabs/subagents`' `dispatch.ts` states the direction of the dependency from the other
side: it "does not choose models", because the matrix is the single source of truth and duplicating
any part of it there would create a second answer to a question that must only have one.

`toDispatch` is the hand-off and carries routing fields only — harness, model, effort, and where
relevant the router and profile. The prompt, the timeout and the token budget belong to whoever is
launching the run.

The pinned ids are the ones the matrix names and telemetry records. A vendor CLI may accept a
different spelling for the same model on its command line; the fleet carries a separate
`NATIVE_CANARY_MODEL_ARGS` table for exactly that reason. Translating a pin into a launch argument
is the provider packages' boundary (**E3 · #33**), and #34 owns making a wrong id fail loudly there.
