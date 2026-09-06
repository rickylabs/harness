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
| `admit.ts` | The gate a dispatch passes before anything is spent on it |
| `probe.ts` | Availability — the one fact here that expires |

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

Two of those invariants are also exported on their own, because `checkPolicy` reads the live table
and takes no arguments — driving it can only show that today's matrix passes, never that a violation
would be caught:

- `selfCertifies(step)` — whether a seat certifies the family that authored it. `checkEvaluator`
  refuses such a pairing at dispatch, but by then the matrix has already promised a reviewer it
  cannot supply, and the work is done.
- `unreviewedSteps(implement, review)` — the indexes in an implementation chain whose author family
  no step in the review chain will certify. **Every step needs a reviewer, not just the primary.**
  `tierPlan` resolves a review lane against `openai` on the grounds that every implementation tier
  is Codex-authored; that was prose, and prose does not fail a build. Add one cross-family fallback
  and the tier still resolves, still dispatches, and only refuses at `checkEvaluator`.

## A model the CLI cannot reach is not a model the plan cannot afford

`complex_implementation` leads with `gpt-6-astra` and falls back to `gpt-5.6-sol` on
`model-unavailable` — a trigger that exists precisely so it is *not* spelled `native-quota-limit`.

    complex_implementation
      0  codex · native · gpt-6-astra  · medium      (primary)
      1  codex · native · gpt-5.6-sol · high         when model-unavailable

A quota trigger means the subscription is spent, so falling back to a second model on that same
subscription would be a fallback in name only. `model-unavailable` means this binary cannot dispatch
that id — which a sibling model on the same plan does satisfy. It is a real distinction and not a
hypothetical one: Codex CLI 0.144.3 refuses `gpt-6-astra` with an HTTP 400 reading "requires a newer
version of Codex", and 0.153.4 accepts it, on the same account and the same plan.

## Admission: the last place a dispatch is free

`validateDispatch` in `@rickylabs/subagents` refuses a request that leaves a choice implicit — no
model, no effort, an empty prompt, a timeout the executor would silently drop. It cannot refuse a
*wrong* model, and says so itself: it "does not choose models". `admitDispatch` is the other half,
and it lives here because the matrix does. An import the other way would close the dependency edge
into a cycle that `check:graph` refuses.

The failure it prevents is not a crash. A provider handed an id it does not recognise usually does
not fail at all — it falls back to whatever its own config says, runs to completion, and reports
success. The receipt then names a model that never ran. Every refusal below is decidable from two
tables and the request itself; nothing opens a socket, reads a file, or looks at a quota. A refused
dispatch has cost a table walk, and a launched one has cost a subscription window or real money.

**Three ways a model id is wrong, and they want different fixes:**

| Refusal | Means |
| --- | --- |
| `unknown-model` | Not pinned at all — a typo, or an id from some other system |
| `unrouted-model` | Pinned, but no lane names it. The two `n5air/` seats are here today |
| `unroutable-model` | Pinned and routed, but never to this harness |

Pinning an id is not routing it: `@rickylabs/llm-local` knows where the local seats can physically
run, and no route sends work to them yet.

**And the rest of what only the matrix can answer:** `wrong-router` and `unbound-credential` for a
relay model addressed at the wrong box or with nothing naming the profile that binds its credential;
`unknown-effort` for a rung off the ladder; and, when the coordinator names the lane it is launching,
`unknown-lane`, `lane-model-mismatch` and `undeclared-effort`.

Every refusal names what *would* have been admitted, derived from the table on the spot — the ids
that harness takes, the lane's own chain, the efforts a step declares, the profiles that exist. A
suite case walks every step of every lane and asserts the gate admits it: if a route the matrix
declares cannot pass the gate that guards it, one of the two is wrong.

### Credential material is refused first, and alone

A dispatch is written into an issue body, a receipt and a run log, so a credential in the payload is
a credential in all three. The relay key is bound by **profile name** and read from its mode-600
file at launch; nothing in a `/swarm` block ever carries a value — which is why `relayProfiles()`
can tell an operator exactly what to write without anything having read a key.

Two details make that a property of the module rather than of each caller that logs a refusal:

- **A payload carrying credential material is refused on that ground alone.** Every other message
  names the offending field's value, and one of those fields is the one holding the secret.
- **No message echoes a value longer than the longest name this package knows.** A value longer than
  that is not a mistyped id — there is nothing it could be a typo *of*. Its length is reported
  instead, which is enough to diagnose a typo, and `expected` still names what was wanted.

The scan is structural — `sk-`, `ghp_`, `AKIA`, a `PRIVATE KEY` block, a `name = value` assignment in
the key block — because a generic "long random string" test would refuse legitimate briefs, and a
gate operators learn to route around is worse than no gate. A brief that merely says the key is read
from `openrouter.env` is admitted.

## Availability expires, and everything else here does not

Everything above is true until somebody edits it. A subscription window empties and refills, a relay
balance only goes down, and a staged rollout turns a model on for some accounts on a Tuesday.
**E4.3 ([#59](https://github.com/rickylabs/harness/issues/59)) states the consequence: time-sliding
facts must never be committed.** `probe.ts` is where that stops being a rule people remember.

It sits beside admission rather than inside it because the two questions are different. Admission
asks whether a pairing is *permitted*, and answers from the table. Availability asks whether it is
*possible right now*, and no table can answer that. Neither may borrow the other's answer.

Nothing here opens a socket either. A caller takes the observation and hands the result in; this
decides what the result means. Same split as the lease module and the liveness module, same reason:
a decision that opens a socket cannot be tested, and an availability rule that cannot be tested will
be wrong on the day it matters.

### The third success-coded failure

Ask codex-cli for a model it has no metadata for and it prints
`Model metadata for '…' not found. Defaulting to fallback metadata` — and then runs the job, exit
code zero, with the wrong context window and the wrong reasoning defaults. A probe that asserts on
the status admits precisely the run it was written to refuse.

So there are four verdicts, not two. `degraded` is that case: the destination did not refuse, and
what came back is not what was asked for.

And the absence of that warning is only evidence if the probe got far enough to print it. A run that
died on authentication contains no warning either. An `Observation` therefore carries `reachable` and
`completed` separately — the first says something answered, the second says the probe reached the
point where the warning would have appeared. Reachable but incomplete is `unknown`: nothing was
established, and something did answer.

An unattributable warning — the marker with no model named — is read as being about the model asked
for. A warning that names only *other* models is not.

### A constant may refuse, and may never permit

Static allowances survive as "a documented fallback", and the sharp form of that is asymmetric. A
constant saying *unavailable* is safe in the only way that matters: being wrong costs a dispatch that
did not happen. A constant saying *available* is the whole failure — a value typed weeks ago,
spending a subscription window today, looking exactly like a reading.

`availabilityOf` refuses a fallback of `available` and answers `unknown`. Every verdict carries its
`source` — `probe`, `fallback` or `none` — so a caller cannot receive a constant without also
receiving the word for what it is, and `mayDispatch` requires both `available` and `probe`. That
second test is deliberately redundant against verdicts this module builds, and not redundant at all
against one a caller assembled by hand.

The rule's other half is `check:snapshots`, which runs in `build`: no tracked data file may carry a
key that is only ever true as of a moment. A type cannot see a file that nothing imports.

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
is the provider packages' boundary (**E3 · #33**); `admitDispatch` is where a wrong id fails loudly
before it gets that far.

Nothing in the repo calls it outside the suite yet, because nothing launches a dispatch yet — the
execution channel is **E5 · #62**, and it is the one call site that must go through this gate.
