# S10 dispatched in-process, and the trigger disarmed

Owner steering of 2026-09-12: do not wait for an external poller to claim S10; launch an in-process
Claude Opus 5 delegate directly in an isolated worktree, as the Cockpit seat did for its own
children. Done.

## What was launched

A delegate on `claude-opus-5` at `high` effort, in its own git worktree, working from the brief in
the body of #288 rather than from a paraphrase. The host effort binding was aligned to `high`
earlier in this run, so the declared route and the observed route agree for the first time today.

The delegate's instructions restate the whole spike rather than pointing at the issue alone, since
a subagent does not inherit this session's context: the mock-first constraint, the prohibition on
treating a self-authored fixture as evidence about the server, the `RouteSource` finding as its
first deliverable, the `mismatch`-versus-`unknown` assertion, and the requirement that the verdict
keep what the mock proved strictly separate from what only a live router can prove.

## The label came off, and that is the safety-relevant part

`harness` was removed from #288 in the same action as the handover.

It had been applied earlier and sat unclaimed for over an hour against a documented thirty-second
poll, which is the evidence in `dispatch-primitive-failure.md` that divybot has not been polling
since roughly 2026-09-08. The work is now claimed in-process.

**Leaving a live trigger armed on a claimed issue is the hazard.** If divybot is restarted on the
`orchid` host, a label still sitting there spawns a second agent against the same brief, giving two
writers on one work item. That is precisely what #196's single-writer lease rule exists to prevent,
and it would be a self-inflicted instance of it rather than a race anyone else caused.

This generalises past this issue. Any issue anywhere on the fleet that was labelled between
2026-09-08 and today is now carrying an armed trigger that did nothing, and will fire when the
poller returns. Restarting divybot is therefore not a neutral recovery action: it will dispatch the
backlog. That should be checked before it is restarted, not after, and it was raised to the Cockpit
seat in those terms.

## The package name was wrong in the steering, for the third time

The steering described S10 as the "`@rickylabs/routing` UHP contract". The route-identity contract
is in **`packages/subagents`**, at `packages/subagents/src/route.ts`. `packages/routing` consumes
the fleet matrix as data under E11 and is a different seam entirely.

This was the third occurrence today: the seat brief had it, the Cockpit goal file had it, and the
steering had it. The correction was put at the top of the delegate's instructions rather than left
to inference, noted on #288, and raised to the Cockpit seat.

**Traced, and the earlier framing here was too pessimistic.** This file previously said three
independent documents carrying one error put it "upstream of all three". That implied doctrine
drift. It is not. The Cockpit coordinator traced it and the result was verified here: exactly two
occurrences exist on this host, both in the brief layer outside any repository.

    /home/agent/briefs/goal-shared.md:15
    /home/agent/briefs/supervisor-harness.md:41

Every occurrence inside the architecture documents is **correct** and must not be touched.
`@rickylabs/routing` genuinely owns lane admission, model-family mapping, effort ladders, CAS
leasing and the Generator != Evaluator rule; the RFC places `provider-uhp` under `packages/subagents`
and names both packages accurately.

So this is a compression error in a derived document, not drift propagating outward from the
architecture: someone writing the weekend goal collapsed "the subagents adapter, under unchanged
routing governance" into "the routing adapter", and both seats then inherited it from their own
brief. That is the better of the two failures, because the authority documents are right and only
the derived ones are wrong.

**Neither seat is editing those files.** They are owner-authored steering documents outside any
repository, and silently correcting the instructions one was given is not a coordinator's call even
when the correction is obviously right. Both file-and-line references go to the owner instead, with
the request that the fix land at that source.

## What this dispatch does not satisfy

The independent evaluation gate. The generator is Claude, so the evaluator must be non-Claude, and
every non-Anthropic privileged route is out of budget until 2026-10-04. Whatever the delegate
returns is a generator's verdict until that gate runs. It is not a PASS and must not be recorded as
one.

[owner — direct-delegate steering; received 2026-09-12]
[observed — #288 unclaimed for over an hour after labelling; herdr reporting no agents; label
 removed at handover; 2026-09-12]
