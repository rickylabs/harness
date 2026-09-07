# Current handoff — 2026-09-07

Implementation writer exited; coordinator repairs and final validation are recorded in `verification.md`.
Independent implementation evaluation is next. Earlier capacity-block and handback sections below are history.
No PR or merge yet; #205 remains open and sole active implementation.

# Live governance — #205 context pack

**S1–S5 implemented as an uncommitted tested diff. Coordinator handback is ready for review.**
Telemetry has 412 passing tests; the root build and full workspace tests pass (2,697 tests, zero skips).
Metadata comparison is **unverified, exit 3**, under the credential-free isolated validation environment.
S6 live integration and independent evaluation were not performed. No full #205 closure is claimed.

Base HEAD: `0e9998405e70bfb850bcff1adb7df22bca2a758d`. No implementation commit, push, PR, merge or tag.
The exact product/test/docs content is hashed in [`implementation-surface.json`](implementation-surface.json).
The pre-existing untracked `matrix-implementation.json` was not changed by the implementation session.

## Resume in this order

1. [`implementation.md`](implementation.md): implemented behavior, code/test citations, actual commands,
   outcomes, limitations and coordinator next steps.
2. [`plan-eval.md`](plan-eval.md): independent PASS and six binding notes, read before product mutation.
3. [`plan.md`](plan.md): D24 is normative over all earlier shorthand; plan history remains intact.
4. [`drift.md`](drift.md): planning withdrawals and implementation dispositions.
5. [`research.md`](research.md): source authority and earlier reachability-only receipts.

## What is implemented

Four independent observation legs produce the shipped governance envelope: env-only subscription
usage through an external Deno service, exact OpenRouter current-key spend, configured cgroup-v2
capacity and explicit recorded admission events. Runtime configuration owns model IDs and usage window
durations. No compiled model choice, maximum-percent binding policy, BYOK sum or inferred ceiling.
The upstream checkout is an operational dependency, with no Node import or workspace dependency.

Collection completion stamps the envelope while source timestamps remain intact. Expired/future
sources are discarded independently. A failed requested source keeps successful values visible but
sets incomplete/exit3; all-unconfigured is unavailable. Missing admissions stay unknown. The file
source remains compatible. Rendering preserves known used bytes with unknown total/headroom and
qualifies fresh badges when underlying leaves are stale.

Admissions require explicit detail timestamps and existing telemetry log envelopes. Newest-per-item/
regime selection, duplicate collapse, conflict and malformed-newest safeguards are tested. Routing
transitions and arbitrary prose never imply item admission. Caller provenance and private detail do
not escape; pending approvals and execution remain unobserved. E5 is still the real decision producer.

Implementation/code claims and coverage citations are in `implementation.md`. No source telemetry,
credential value, operator path, private response, host identity or operational quota figure was added
to tracked evidence. Synthetic launch scratch and validation logs remain in ignored git storage.

## Coordinator-owned next steps and exact unknowns

- Review the hashed diff, commit/publicize through the coordinator workflow, and run authenticated
  `pnpm run check:metadata`. The attempted isolated check compared nothing; it was not PASS.
- Run already-authorized S6 read-only integration, then independent implementation evaluation at the
  resulting exact head. No renewed scope question is needed for that already-authorized work.
- Finite capacity remains unknown until an actual finite reading at the authorized configured scope.
  Unlimited cgroup scope is not finite dispatch-host capacity; physical-host scope is unobserved.
- Item admission remains unknown until an authoritative gate emits an actual record. Synthetic writer
  fixtures prove the read path only, not a real refusal or execution.
- Planning receipts and the network-free synthetic Deno smoke are not live acceptance. The relationship
  may be **Part of #205**; do not claim full closure from fixtures.

No E11, route-policy change, contract/governance-stub edit, dependency/workflow change, sibling write,
provider dispatch, quota reservation, deployment or GitHub mutation occurred. No other agent or model
was spawned by this implementation session.
