# Worklog — `uhp-stream-adapter--s11`

Append-only. Times are UTC on 2026-09-12.

---

**10:33 — Stage A.** Read the brief with `gh issue view 289`, then `AGENTS.md` and
`doctrine/WORKFLOW.md` before touching anything. Read #287 for the lifecycle table.

**10:35 — baseline.** `git fetch origin`, branched `feat/uhp-stream-adapter--s11` from
`origin/chore/route-identity-uhp--s10` at `a382171` — **not** from `main`, which does not carry the
mock. `supervisor.md` written with the declared mutation surface. Baseline `pnpm run build` green
before the first edit.

**10:38 — Stage B, repo leg.** Read `uhp-mock.ts` (S10's mock, 401 lines), `route.ts`, `provider.ts`,
`telemetry/src/liveness.ts`, the codex refusal ladder at `provider-codex/src/protocol.ts:230-250`, and
`dsh-app/src/dry-run-internal.ts:97-98` — the shape the brief points at, which decides on
`!isRouteEvidenceVerified` and carries `status` only into the refusal payload. Read
`scripts/check-compiled-policy.mjs`, which turned out to constrain the file layout: its allowance for
literal `model`/`effort` in `uhp-mock.ts` is justified by "not imported by any production entry point",
so nothing exported from `index.ts` may import the mock.

**10:44 — Stage B, external leg.** Retrieved the Streaming, Lifecycle and Sessions chapters of UHP
`2026-08-11`. Four things changed the design:

1. There is **no `response.cancelled` event**. A cancellation is `response.failed` carrying
   `status: "cancelled"`, and "the status field, not the event name, is authoritative". S10's decoder
   lists a `response.cancelled` terminal type that cannot occur — harmless there, load-bearing here.
2. **No event carries a timestamp.** Freshness must be stamped from the reading clock, and the module
   has to say so rather than let a reader assume the server dated it.
3. The chapter is **silent on unrecognised event types**. Asked directly. Recorded as a reading.
4. Sessions §1 requires a continued chain to **report the same `session_id`**, and says the chain is on
   response ids partly because it "leaves room for a server to branch from an earlier response later" —
   which is the argument for keying on `runId`.

**10:52 — Stage D/E, compressed deliberately.** This is a dispatched implementation brief with the
design already fixed by #289 and #287: five modules, three fail-closed requirements, one mapping table.
No design pack and no `plan.md` were produced; the decisions that would have gone in one are in the
module docblocks, where the next reader is standing. Recorded as `drift.md` D-1.

**10:58 — Stage H, mutation 1 of the world.** `uhp-wire.ts` created: the wire types moved out of the
mock with their citations, plus the event vocabularies and `previous_response_id`. `uhp-mock.ts`
re-exports them so every S10 importer is untouched.

**11:06 — `uhp-stream.ts`.** The reader, and the freshness surface built so requirement A is not
expressible: no status parameter, a module-private `Symbol` brand on evidence, `kind` restricted to
`delta | item`, and `stalled` excluded in the type because it needs a running claim.

**11:20 — `uhp-lifecycle.ts` and `uhp-gate.ts`.** The #287 table as an exhaustive switch. The gate as
`negatives → verdict`, with the negatives type carrying no status field at all, so the codex ladder
cannot be reintroduced without first widening an interface in a diff that says what it is doing.

**11:32 — `uhp-session.ts`.** Ledger keyed on `runId`, session id in `RunRef.external`, seven named
refusals. Found while writing it: a turn observed as `in_progress` and then re-read as terminal would
have been refused as a replay, which would make polling a live run impossible. Added an explicit
advance path for the same response id, distinguished from a replay of a *settled* turn.

**11:41 — mock extensions.** Frame scripting, the five lifecycle fixtures, the three-turn chain, a
session-aware loopback server enforcing the server's side of Sessions §1, a `send()` that exposes the
HTTP status (a decoded response cannot carry a 404), and thirteen deliberately broken stream bodies.
`decodeUhpStream` became a delegate to the new reader rather than a second decoder — `drift.md` D-2.

**11:55 — suites.** 92 tests across four files. S10's 252 still pass unchanged against the delegated
decoder.

**12:10 — `pnpm run build` and `pnpm run test`.** Build green. Test green except the final
`check:installed`, which needs an executable `TMPDIR` and unsandboxed process control on this host;
with both it reports PASS for its two checks. Environmental, unrelated to this run, recorded in
`verification.md` §0 rather than papered over.

**12:20 — mutation testing.** Fourteen mutations, each a change a reviewer might have waved through,
each applied to the real source and reverted byte-for-byte afterwards. Thirteen went red immediately.

**M6 killed nothing.** Dropping the stickiness of a refusal failed zero tests, because the stickiness
test pushed a *fresh* stream after the damage and the mutant refused those bytes for a second reason —
the test passed on both sides of the distinction, which is precisely the failure the brief names. The
test was rewritten to push a frame numbered to fit the stopped sequence counter, with a control proving
that same frame *is* accepted by an undamaged reader. M6 then killed it. Full table in
`verification.md` §3.

**12:40 — artifacts.** `research.md`, `verification.md`, `drift.md`, this log, `context-pack.md`.

---

## Owner forks

**F1 — does a UHP dispatch proceed on a route that can never be verified?** Not resolved here, and not
resolvable here.

If S10's reading holds, no UHP route can ever reach `accepted`: three of the four fields are absent by
protocol design, so `decideUhpRoute` returns `unknown` on every conformant response, and `unknown`
permits no useful turn. That makes `provider-uhp` (#286) a provider that correctly refuses everything.

The options, none of which this run took:

1. **Accept it.** UHP is unusable for routed work until the protocol reports more. Cost if wrong: the
   Community Edition path is written off on an unevaluated generator verdict.
2. **Narrow what a UHP route must prove** — for example, `model` observed and agreeing is sufficient for
   a lane that does not require effort evidence. Cost if wrong: a certification lane runs at an effort
   nobody evidenced, which is the failure #195 exists to prevent.
3. **Carry the route out of band**, e.g. a harness configured server-side per lane and audited there.
   Cost if wrong: the audit is outside this repository, so the coordinator's evidence is a promise.

This is an owner decision, not a true/false question, and it belongs to #286 and #294 where a live
router can inform it. Filed here rather than decided. `uhp-gate.ts` implements option 1's behaviour
because that is the fail-closed default, and the other two options are additive to it.
