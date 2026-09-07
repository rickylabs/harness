# dry-run-driver--e6c — brief

title:	E6.C — drive a dispatch through the durable store against fakes, with no live effect
state:	OPEN
author:	rickylabs
labels:	epic:e6, priority:p1, status:research, task, topic:features, type:feat
comments:	0
assignees:
projects:
milestone:	M1 — dsh coordinator foundation
issue-type:
parent:
sub-issues:
sub-issues-completed:
blocked-by:
blocking:
number:	253
--
Step C of the #191 dependency DAG:

> **C.** E6 driver wiring for GitHub and one configured provider; depends B. Start with dry-run/fakes, require checked routing and existing admission evidence before any live dispatch.

## Its dependencies are now satisfied

Steps A and B both landed in #247 (squash `fa0456c`, closing #245):

- **A** — the published store port, the local filesystem adapter with exclusive ownership and explicit stale recovery, atomic checkpoints and corruption refusal.
- **B** — effect intents and receipts beside `PersistedDecision` in `packages/coordinator/src/journal.ts`, and the pure recovery reducer in `packages/coordinator/src/state-store.ts`. B's other dependency, the citation-gate finding 182.3, shipped earlier in #236.

B needed no separate issue because #247 delivered it alongside A; this issue records that and moves to C.

## This slice is deliberately half of C

#62 is an open owner decision that names itself a blocker for this epic: it owns which execution channel a live dispatch actually travels through. That answer gates the *live* half of C and nothing else.

So this issue is the half that does not depend on it. **No live dispatch, no provider process, no network effect.** The driver is wired against fakes and a dry-run path, which is exactly what the DAG line asks for as the starting point. When #62 is decided, the live half becomes its own issue rather than an amendment to this one.

## Acceptance

- The coordinator can assemble a dispatch for a GitHub-sourced item and one configured provider, and drive it through the durable store from #247 — intent written, receipt settled, recovery replayed — with no real provider involved.
- Routing is *checked*, not assumed: an observed route that differs from the requested one fails closed. #195 already established this rule for provider-codex; this slice must not re-derive a weaker version of it.
- Admission evidence that already exists is required before a dispatch is assembled, rather than re-invented here.
- A dry-run produces the same durable record a live run would, so the restart proof in step F has something to assert against.
- Refusals are named, not booleans, consistent with the store port already published in `packages/contracts/src/state-store.ts`.
- Tests cover the crash points that matter for driving, not just for storing: crash between assembling a dispatch and writing its intent, and crash between an attempted effect and its receipt. The second must land as terminal `unknown`, never as `unsent` — this is the invariant #247 established and it must survive being driven.

## Explicitly out of scope

Live dispatch of any kind. Provider processes. Transport or hub lifecycle (that is step E). The restart acceptance proof and runbook (step F). Production storage selection, which is #191's fork F1. Anything that would need #62 answered.

## Process

Per #191: this slice needs its own brief, plan gate, independent implementation evaluation and PR. One rule per PR. Do not report as passing anything not actually run — evidence that could not be gathered stays unknown, never passed.


[observed - GitHub https://github.com/rickylabs/harness/issues/253; topic: acceptance and boundaries; retrieved 2026-09-07]
