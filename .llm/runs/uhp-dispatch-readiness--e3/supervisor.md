# Supervisor

Run: `uhp-dispatch-readiness--e3`. Seat 3 milestone coordinator, `rickylabs/harness`.
Date: 2026-09-12 UTC. Host: current Linux workspace. Baseline: `fe278bc` on `main`.

Scope is **coordination only**: verify inherited state, establish whether Spikes S10/S11/S12
(#288, #289, #290) are dispatchable, and record the result. No product code, no package mutation,
no dispatch label, no publication.

Coordinator identity: this session runs on `claude-opus-5` at high effort, taking over from the
Codex seat (`gpt-6-astra` @ medium) paused on 2026-09-08 at 7% subscription remaining.

## Matrix-override note — raised, not resolved

`~/briefs/brief-shared.md` states the milestone coordinator row as
`milestone: [astra@medium, fable_5_1@medium, opus_5@xhigh]`, an ordered preference, with the rule
"fall back to this row's own next candidate — never to a model or effort the row does not declare."
Strict application puts this seat on `fable_5_1@medium`, not on Opus 5. The session directive
instead assigns this seat, and the default feature-implementation cell, to `opus_5@high` — an
effort step the row does not declare.

This is recorded as an **owner override of the routing row**, not as a matrix resolution. The
shared brief requires an authorization record with a non-empty rationale for such a move; the
rationale on record is the Codex subscription exhaustion of 2026-09-08. No work in this run
depended on the override, because no delegation was issued.

Invariant preserved regardless: Generator != Evaluator, and independent evaluation uses an
opposite vendor family.

## Mutation surface

This run directory only. One inert status label was applied to #285; it is recorded in
`worklog.md`. No `harness` dispatch label was applied to any issue, and none is proposed here.
