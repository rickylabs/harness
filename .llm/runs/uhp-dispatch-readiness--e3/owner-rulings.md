# Owner rulings of 2026-09-12, and what was executed against them

Four rulings were received after the hold recorded in `verification.md`. Each is stated, then what
this coordinator did about it, then what is still outstanding.

## Ruling 1 — S10 and S11 develop against a mock, not a container

> Develop the contracts and stream adapters against a lightweight local mock UHP loopback server,
> or mock SSE fixtures, in the test suite. Cockpit owns the container placement in Aspire
> (D11.3 / cockpit #101). Do not block S10 contract design on host docker.

This removes the blocker in `verification.md` section 5 and dissolves the placement circularity in
section 6: Cockpit owns placement, so S10 no longer waits on it.

**Executed.** #288 was rewritten as a mock-first brief and dispatched. The rewrite added the
constraint that the spike must not start or require a container runtime, and the explicit
prohibition against treating a self-authored fixture as evidence about the server.

That prohibition is the substantive addition. A mock can only show what this repository does with a
given wire shape; whether `effort`, `cwd` and `provider` are observable at all is answerable only
from the published UHP 2026-08-11 specification. A fixture that echoes an effort value, followed by
a report that effort is observable, would be a fabricated PASS — and it is the most natural
mistake to make under a mock-first instruction, which is why the brief names it.

### The finding that gave S10 a real first deliverable

`packages/subagents/src/route.ts` already carries the route-identity contract: `ROUTE_FIELDS` is
`provider`, `model`, `effort`, `cwd`; `RouteStatus` is `known`, `mismatch` or `unknown`; values
carry a label from a closed `RouteSource` provenance vocabulary and invalid or absent values are
`null`.

`isRouteEvidenceVerified` at `packages/subagents/src/route.ts:174` requires every observed field's
`source` to equal its entry in `OBSERVED_SOURCES`, and each of those entries is a
`thread/start.result.*` label from the in-tree codex protocol. **A UHP provider therefore cannot
produce verified route evidence under the current predicate, whatever the server reports**, because
its provenance labels are not in the vocabulary. Either `RouteSource` grows a UHP arm or every UHP
route is unverifiable by construction. S10 must decide which, and it is now deliverable 2 on the
brief.

This is also why holding the contracts publication is the right call rather than a delay: the
answer may move a published type.

## Ruling 2 — one additional bounded plan evaluation on #272 is authorized

**Recorded**, as the retained `maxRounds 1` / `escalateToOwnerAt 2` policy requires an explicit
override in the worklog. The authorization covers exactly one round, scoped to F1 through F4 at
`df85638`. #272 advanced to `status:plan-eval`.

**Not yet dispatched, and `flag:owner-decision` stays on for a narrower question.** Two facts
changed the routing after the ruling was given:

1. The preserved evaluator session `ses_f7d424645ffeq9bROwhiZS6RMy` cannot be re-steered. The
   identifier appears only as a reference inside retained transcripts on this host; no session file
   for it exists locally and it has no live entry in the peer listing. The authorized round must be
   a fresh independent evaluator.
2. Both opposite-family routes are down at once, for the rest of the weekend. The plan's author was
   Claude Fable 5.1, so the evaluator must be non-Claude.

The capacity picture was corrected mid-run by the Cockpit coordinator, and the correction changed
the recommendation rather than refining it. Codex is not at roughly 7 percent remaining; it is at
**95 percent used** on the weekly window, from the `rate_limits` snapshot in session
`01a084e3-0aea-78d3-885c-05aee79fbcde` of 2026-09-09, with `has_credits: false` and a zero balance
behind it. Treat 95 percent as a floor rather than a live reading, since it is a snapshot from the
last session that ran and `agentic:codex-status` could not be run to confirm it.

The ordering is the decision-relevant part. OpenCode Go returns `2026-09-14T00:00:00Z`, Monday;
Codex returns `2026-09-15T01:23:04Z`, Tuesday. So this is not "one of two routes is blocked", it is
nothing until Monday with Codex last.

**The earlier recommendation to raise the host Codex effort pin is withdrawn.** It was written
against the 7 percent figure. Raising the pin would spend the last 5 percent of a window that does
not reset for about three days, on a gate routed into an almost empty quota. The revised
recommendation on the issue is to wait for OpenCode Go on Monday rather than spend the single
authorized round on a diff-only relay evaluator, since the relay tier may retain and train on
prompts and so may receive the diff and nothing else. The same blackout applies to S10's own gate,
which is Opus-generated and needs a non-Claude evaluator too.

The effort-binding problem remains true and remains worth recording for Monday: the host Codex pin
is `gpt-5.6-sol` at `model_reasoning_effort = "low"`, and a board dispatch cannot override it,
because divybot parses `harness:` and stops while `model:` and `effort:` rows fall through to the
host config silently.

## Ruling 3 — hold 0.4.0 at 0.3.0 until S10 contracts are ready

**Executed.** #283 carries the ruling as a comment and `flag:owner-decision` was removed: the
decision is taken, and the item now waits on a dependency that has a runner rather than on a
person. `status:impl-eval` was left where it was, because the phase records how far the work got.
Published contracts remain 0.3.0 / protocol 1. No tag pushed.

## Ruling 4 — matrix override formally confirmed

> Coordinator is Claude Opus 5 high, and default feature implementation is Claude Opus 5 high.

This resolves the conflict raised in `supervisor.md` against the shared brief's row
`[astra@medium, fable_5_1@medium, opus_5@xhigh]`. It is an owner override of that row, now on the
record rather than inferred from a subscription outage.

**Executed, and it required a host change to be true rather than merely declared.**
`~/.claude/settings.json` already set `"model": "claude-opus-5"` and a top-level
`"effortLevel": "high"`, but `modelSettings["claude-opus-5"].effortLevel` was `"medium"`, and the
more specific setting wins. Every Claude agent dispatched on this host would have launched at
`medium` while every brief declared `high`.

That is the same defect class the W0 milestone recorded: a route that is declared in prose and
bound nowhere. Since the host agent config is the only binding surface for model and effort, the
per-model entry was changed from `medium` to `high`. The file was backed up first and re-validated
as JSON afterwards.

**This is host-global and affects peer seats.** It is the correct direction — ruling 4 puts both
the coordinator role and the default implementation role on Opus 5 high, so the host default now
agrees with the ruling instead of contradicting it — but Seats 1 and 2 should know their future
Claude launches inherit `high`.

## Cross-seat deconfliction, resolved the same day

The Cockpit coordinator reported that the weekend goal file assigns a `ctx.subagents` UHP adapter
to both seats. Confirmed their reading and posted the boundary publicly on #286: harness owns
`provider-uhp` in full, including the drift refusal, the `model_fallback` fail-closed gate and the
`RouteIdentityEvidence` nulls; Cockpit owns only the SSE consumer folding into `RunObservation`.
There will be exactly one `SubagentProvider` for UHP and one harness object registry, both here.

Two numbering corrections travelled with it: the package is `@rickylabs/subagents` and not
`@rickylabs/routing`, the same error already corrected in `handover-corrections.md`; and the goal
file's "D11.4" for Cockpit SSE ingestion is D11.3 in RFC section 6.3, which reserves D11.4 for test
fixtures.

## Outstanding

1. **#272 evaluator routing** — owner decision, recommendation on the issue.
2. **S10 spawn is unconfirmed, and the evidence now points at the poller being down.** The
   `harness` label is applied to #288. That is this coordinator's act and it is done. Whether
   divybot has claimed it is a separate fact, and at twelve minutes after labelling the answer is
   still no: no comment on the issue, no branch on origin matching the spike, no ephemeral work
   directory, and `herdr agent list` returning an empty agent set. `AGENTS.md` documents a
   thirty-second poll cycle, so twelve minutes is roughly twenty-four missed cycles rather than a
   slow start.

   divybot runs on the `orchid` host and `/data/divybot.json` does not exist in this filesystem, so
   this seat cannot read the dispatcher's state directly and cannot restart it. The most likely
   explanation is that the poller was stopped alongside the Codex seat on 2026-09-08 and was never
   brought back, which would mean the dispatch trigger is set against no runner.

   Per the W0 record the correct response is to check that divybot is polling, never to re-apply
   the label. Re-applying produces no second dispatch and destroys the evidence of the first. The
   label is therefore left in place and the spawn is reported as unconfirmed rather than as
   started. **This needs someone with access to the `orchid` host to confirm divybot is running.**
3. **#274 planner is resumable.** The preserved session `f8cf8218-6f61-4f67-aa82-84c536ebd295`
   exists on disk under the `seat3-capability274` worktree project directory. It was not resumed;
   S10 was the named priority. `research.md` and `plan.md` for #274 still do not exist.

[owner — four rulings; received 2026-09-12]
[observed — host settings binding, route.ts predicate, herdr agent list, GitHub board state;
 verified 2026-09-12]
