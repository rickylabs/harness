# Supervisor — `route-identity-uhp--s10`

**Stage A.** Who is working, on what baseline, and what may be touched.

## Identity

| Field | Value |
|---|---|
| Run slug | `route-identity-uhp--s10` |
| Issue | [#288](https://github.com/rickylabs/harness/issues/288) — Spike S10, route identity over UHP |
| Parent | #286 (`provider-uhp`), part of #33 |
| Lane | n5 · product pack id S10 |
| Model observed | `claude-opus-5` |
| Effort observed | `high` |
| Host | `ai-agents`, Linux 6.18.34+, Node v26.8.2 |
| Baseline commit | `538d63cf5cb7c5569520dda2aa6d1075aef4fc93` |
| Date | 2026-09-12 |

Issue #288 declares `model: claude-opus-5` and `effort: high` in its `/swarm` block and says plainly
that those rows bind nothing — divybot binds `harness:` only. The observed values above match the
declared ones, and they are recorded here as observation, not as inheritance.

## Mutation surface

This run may write:

- `.llm/runs/route-identity-uhp--s10/**` — run artifacts
- `packages/subagents/src/uhp-mock.ts` — mock UHP loopback server and fixture set (new)
- `packages/subagents/src/route.uhp.test.ts` — fail-closed tests (new)
- `scripts/check-compiled-policy.mjs` — **one allowlist line, added mid-run.** Declared as drift, not
  as original scope; see `drift.md` D-1. The guard refuses literal `model`/`effort` assignments in
  any non-`.test.ts` source, which the fixture set necessarily carries. The entry mirrors the
  existing `packages/dsh-app/src/dry-run-test-fixtures.ts` precedent verbatim in form and reason. No
  guard logic changed and no other entry was touched.

This run must **not** write:

- `packages/routing/**` — read-only. `config/routing.v1.json` is read for the certification
  consequence (deliverable 6); nothing under `packages/routing` is edited. The steering that reached
  this run named `@rickylabs/routing` as the home of the UHP contract. That is wrong: the
  route-identity contract is `packages/subagents/src/route.ts`. `packages/routing` consumes the fleet
  matrix as data under E11 and is a different seam.
- `packages/contracts/**` — published package; a breaking change there is a proposal, not an edit.
  In fact `packages/contracts` carries no reference to route identity at all, so nothing there is
  even adjacent — see `research.md` §6.
- `packages/subagents/src/route.ts` — the contract itself. The `RouteSource` question is answered as
  a **proposal** in `proposal-routesource-uhp.md` and deliberately not applied. See that file for
  why applying it inside this spike would add vocabulary with no producer.
- `provider-uhp` in any form — that is #286, which depends on this spike.

## Environment constraint, owner-ruled

There is no container runtime on this host: no `dockerd`, `containerd`, `runc`, `podman` or
`nerdctl`. The `docker` on `PATH` is a client-only static binary with no daemon. There is no
HarnessRouter Community Edition instance reachable from here. Per the owner ruling of 2026-09-12,
S10 develops contracts and stream adapters against a lightweight local mock inside the test suite
and does not block on host docker. No attempt was made to start, install or require a runtime.

## The epistemic boundary this run is held to

Stated here because it governs every artifact below.

A mock tells this run what **this repository** does with a given wire shape. It tells this run
nothing about what a **real HarnessRouter** returns. Therefore:

- Every claim about whether a field is observable is sourced from the published UHP `2026-08-11`
  specification, its OpenAPI document, or its conformance suite — all retrieved during this run and
  cited by URL and line.
- No claim about observability is sourced from a fixture written by this run.
- Where the specification is silent or ambiguous about a field, the answer for that field is
  **"unobservable until proven otherwise"**, and the fail-closed path is the one that must work.

`verification.md` keeps what the mock proved and what only a live router can prove in two separate
lists that are never summed into one verdict.
