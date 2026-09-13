# ADR 0003 — `ARCHITECTURE.md` v1 is the ratified charter

**Status:** accepted · **Date:** 2026-09-13 · **Supersedes:** the architecture recorded in
[#30](https://github.com/rickylabs/harness/issues/30) · **Issue:** #304

---

## Decision

**[`ARCHITECTURE.md`](../../ARCHITECTURE.md), version 1, locked 2026-09-13, is the charter of this
repository.** The owner made this decision; this record files it in the place the charter's own
amendment rule points to, so that the next amendment has a predecessor to supersede.

It carries three consequences that are easy to miss when reading the charter alone:

| | what | where the charter says it |
|---|---|---|
| 1 | The architecture recorded in #30 is superseded. The repository is the portable agent runtime, not the `dsh` plugin layer. | §1, header |
| 2 | **UHP-hosted dispatch (epic E3) is parked** — not deleted. | §10 |
| 3 | **Epic E11 is promoted to the critical path.** | §10, §11 step 2 |

## Context

**Why E3 is parked.** Evidence, not preference: no router instance exists to talk to on any host,
and the spike that would prove a live round-trip ([#294](https://github.com/rickylabs/harness/issues/294))
has never been funded. The client is well built and has nothing to connect to, so every contract
shaped against it is work against an untested assumption. The dispatch contract in §5 — an issue in
this repository carrying the dispatch label — is proven and needs no protocol. If #294 is funded and
passes, UHP returns as one more transport behind the same matrix, never as a replacement for the
steering path.

**Why E11 is promoted.** "Consume the fleet matrix as data" is invariant I1 — every spawn records a
matrix resolution — and it is build-order step 2. It is the critical path.

## Consequences

- Parked E3 issues carry the `parked` label; their branches remain.
- An agent may not amend `ARCHITECTURE.md` and may not open a pull request that assumes a different
  shape. Disagreement is a new numbered record here, with evidence, a recommendation and the cost of
  being wrong (§13).
- Nothing in this record is enforced mechanically. The invariants' checks are listed in §7; any that
  cannot execute are unproven, not green.
