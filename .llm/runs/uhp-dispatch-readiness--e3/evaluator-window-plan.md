# The Monday evaluator window, and how the four owed gates are ordered

Agreed with the Cockpit coordinator on 2026-09-12. Recorded because the window is contended across
two repositories and an order settled after it opens is a race, not a plan.

## Why there is a window at all

Every gate owed on both boards is Claude-generated, so Generator != Evaluator puts all of them on a
non-Claude evaluator. Both non-Claude routes are down simultaneously.

| Route | State | Returns |
|---|---|---|
| OpenCode Go | weekly limit, every model | 2026-09-14T00:00:00Z |
| Codex | 95 percent used, zero credit balance | 2026-09-15T01:23:04Z |
| Local n5air models via LM Studio | endpoint unreachable from this host | unknown |

The local row is the one worth recording, because it looks like an escape hatch and is not. The
`opencode.json` on this host declares an `n5air` provider at `http://lm-studio:1234/v1` carrying
Qwen 3.8 27B, Ornith 35B and Apodex 1.1 mini. Those are local-capacity models outside the metered
windows entirely, so they would have been a genuine non-Claude evaluator at no subscription cost.
The endpoint does not answer. Checked, not assumed, and recorded so nobody re-checks it hopefully.

## The order

1. **Cockpit PR #98.** Oldest owed gate, and the only one of the four with a third repository
   waiting behind it: it blocks Mobile's live-data path. Cross-repo blocking beats repo-internal.
2. **Cockpit OpenAPI client pack.**
3. **S10 (#288), conditional.** Only if the spike has actually produced a verdict by Monday. Its
   `RouteSource` decision is upstream of #287 alignment and therefore of Cockpit's re-pin, which is
   what earns it third place ahead of harness-internal work. As of this writing it has produced
   nothing and may not have started at all, so this slot reverts to Cockpit if empty.
4. **#272, Monday, after the two Cockpit items.** E11-internal routing configuration that blocks no
   other repository, and the one item that cannot be repeated because the owner authorized exactly
   one round.

## Why #272 goes Monday rather than into the uncontended Tuesday window

The first draft of this plan preferred a Tuesday Codex slot for #272, on the reasoning that an
unrepeatable gate should not sit in the most contended window of the week. That was wrong, and the
thing that overturned it is a difference between the two transports.

The host Codex pin is `gpt-5.6-sol` at `model_reasoning_effort = "low"`, and a board dispatch
cannot override it, because divybot parses `harness:` and stops while `model:` and `effort:` rows
fall through to the host config silently. **OpenCode Go has no equivalent pin: effort is bound per
invocation and guarded.** Verified directly in `rickylabs/netscript` rather than taken on report:
`OPENCODE_TOOL.defaultVariant` is `high` in `.llm/tools/agentic/config/versions.ts`, and
`.llm/tools/agentic/opencode/opencode-run.ts` rejects any `variant` that is not `provider_default`
or a declared effort before calling `assertWorkloadEffortAllowed` with that default as the
non-Copilot fallback, so the guard validates the effort against the lane instead of accepting a
downgrade silently.

So Tuesday costs the effort level itself, with no override available, while Monday costs only queue
position. For a round that cannot be repeated, fidelity beats contention. Raising the host Codex
pin to escape that would be a coordinated change across three seats to buy a worse outcome than the
option already on the table.

## Cross-seat test shape, mirrored

The Cockpit coordinator's observation, adopted here: a test asserting only "not verified" does not
cover the `mismatch`-versus-`unknown` collapse, because `isRouteEvidenceVerified` returns false for
both values. Such a test passes under the bug and manufactures confidence without coverage.

#286 was amended to require `provider-uhp`, as the producing end of the wire, to carry an assertion
that fails specifically when `mismatch` serialises, renders or compares equal to `unknown`. Cockpit
carries the mirrored assertion on the consuming side. The pair pins the distinction at both ends.
The same amendment states the transport-versus-value rule: verification status is read from the
value, never inferred from the transport, because a branch encoding "provider is uhp, therefore
unverified" keeps working today and silently never accepts a `known` after S10 widens `RouteSource`.

[source — Codex rate_limits snapshot and OpenCode Go window, relayed by the Cockpit coordinator
 2026-09-12; Codex figure is a floor from the last session that ran, not a live reading]
[observed — lm-studio:1234 unreachable; #288 unclaimed 25 minutes after labelling; verified 2026-09-12]
