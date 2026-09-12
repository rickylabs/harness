# The dispatch label appears to have been a no-op since 2026-09-08

This is the most serious finding of the session and it is not specific to this repository.

## What was observed

`AGENTS.md` and `CLAUDE.md` both describe the `harness` label as an execution primitive: divybot
polls this repository every 30 seconds, and applying the label starts a real agent on a real host
against the issue body, with no draft state and no confirmation.

The label was applied to #288 on 2026-09-12 after the brief was read back from GitHub and verified
to round-trip byte for byte. At 25 minutes after application:

| Signal | State |
|---|---|
| Comment on #288 | none |
| Branch on origin matching the spike | none |
| Ephemeral work directory | none |
| `herdr agent list` | empty agent set |

25 minutes against a 30-second poll is roughly 50 missed cycles, which is not a slow start.

## Why this seat cannot diagnose it further

divybot runs on the `orchid` host. `/data/divybot.json` does not exist in this filesystem, there is
no divybot process here, and `herdr agent list` reports locally. The Cockpit coordinator confirmed
independently that it cannot reach the `orchid` host from its seat either. Neither coordinator can
restart it.

The most likely explanation is that the poller was stopped alongside the Codex seat on 2026-09-08
and was never brought back.

## Why it is a fleet-level problem rather than a harness-local one

**Applying the label returns no error and produces nothing.** That is a success-coded failure: the
action reports success at the only surface an operator can see, and the absence of work is
indistinguishable from work that has not finished yet. If the poller has been down since
2026-09-08, then anything dispatched by any seat in the four days since has silently not run, and
nothing on any board says so.

This is the same defect class as the route-identity problem that `RouteIdentityEvidence` exists to
solve, and as the `mismatch`-versus-`unknown` collapse corrected on #286 today: a signal that looks
identical whether or not the underlying thing is true.

**It appeared four times in one day, at four different layers, and the pattern is the finding.**

| Layer | What it looks like | What it is |
|---|---|---|
| Dispatch | label applied, no error, nothing happens | poller down since 2026-09-08 |
| Route identity | `unknown` where `mismatch` belongs | a silently substituted model |
| Quota, opencode_go | a job that hangs and returns nothing | subscription exhaustion, no quota error raised |
| Effort binding | a brief declaring `xhigh` | a host pin running `low`, no warning |

Each one reports absence the same way it reports slowness or success. Naming this as a class is
worth more than fixing the four separately, because the same fix applies to all of them: make the
negative case say something. The `usage_unproven` and `subscription_tier_unresolved` refusals in
`subscription-expense.ts` are the counter-example already in the codebase and the shape to copy —
they fail closed and name the reason.

The silent-hang instance was measured by the Mobile seat, which lost about fifteen minutes to it
before recognising it. Anyone dispatching to opencode_go before the October reset should treat
silence as exhaustion rather than progress.

## The standing rule this implies

Adopted jointly with the Cockpit coordinator, and stated as a rule rather than an observation about
this week:

**Until divybot is confirmed running, no seat should treat label application as evidence that work
started.** Applying the label is the coordinator's act and is complete when the label is on. Whether
a runner claimed it is a separate fact that requires a separate observation — a comment, a branch,
a work directory or an agent in `herdr agent list`.

## What was deliberately not done

The label was **not** re-applied. Per the W0 milestone record, re-applying produces no second
dispatch and destroys the evidence of the first. #288 keeps the label and `status:research`, so if
the poller comes back the dispatch stands.

## Owner action needed

Confirm divybot is running on the `orchid` host, and if it is not, restart it. Then check whether
anything else was dispatched between 2026-09-08 and 2026-09-12 that needs re-dispatching, since
those dispatches would have failed the same silent way.

[observed — #288 label applied and unclaimed at 25 minutes; herdr empty; no divybot process or
 config on this host; verified 2026-09-12]
[observed — Cockpit coordinator cannot reach the orchid host from its seat; reported 2026-09-12]

## Narrowed: the board digest is alive, so this is not a host outage

Established 2026-09-12 while writing the owner report, and it changes the recommended action.

The earlier reading here was that the poller was probably stopped alongside the Codex seat on
2026-09-08 and never brought back, with an implied remedy of restarting whatever runs on `orchid`.
That was too broad.

`origin/main` carries a `chore(board): publish` commit at **2026-09-11T23:34:04Z**, and the
`BOARD.md` it published reports latest board activity at 23:32:38Z while already listing #286
through #292. Publish commits also exist on 2026-09-08 at 21:07, on 2026-09-10 at 16:10, and twice
on 2026-09-11 — so the projection pipeline kept running straight through the pause that stopped the
Codex seat.

**Something is reading this board and writing back on schedule while the dispatch poller does
nothing.** So a wholesale automation outage is not the explanation, and "restart the host" is the
wrong instruction. The fault is specific to divybot.

Stated with its limit: this establishes that *a* board automation is current. It does not establish
which host runs the digest, so it does not prove `orchid` itself is up. What it removes is the
hypothesis that everything stopped together, which was the reading most likely to send someone to
reboot a machine rather than inspect one process.

[observed — `chore(board): publish` commit timestamps on origin/main and the published BOARD.md
 activity line and issue coverage; verified 2026-09-12]
