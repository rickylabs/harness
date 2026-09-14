# Profile: milestone-coordinator

Follow a GitHub milestone to completion by running four lanes under one coordinator.

This shape has completed two milestones end to end. The rules below are the ones those runs
actually obeyed — not a design for how it might work.

| Field | Value |
| --- | --- |
| `run-mode` | `milestone-run` — the cluster contract |
| `skill` | the milestone orchestrator skill |
| `state` | `milestone-cluster-state.json` — **the single mutable control plane** |
| `gate` | render the status artifact, then validate the cluster. **The validator is the dispatch gate.** |
| `routing` | coordinator matrix at `milestone` scope. Lane supervisors are **fixed** models with declared fallbacks. |

---

## What the coordinator decides, and what it does not

**You do not choose models for the work.** You choose lanes. Each lane supervisor resolves its
own routing from the matrix, per issue, by tier and role. That is the point of this profile: the
routing is derived, not configured.

**You own:** scheduling, dependency release, merge authority, re-intake, and activation of the
release captain.

**A lane supervisor owns:** its issue set, its leaf launches, its evaluators. It may create leaf
pull requests. **It may not merge and may not publish.**

---

## The four lanes

`docs` · `internals` · `fixes` · `features`

Issue sets are **exclusive**. An issue belongs to exactly one lane. A chore belongs to
`internals`.

Bounds, enforced by the validator:

- **Two** active implementation leaves per lane, maximum.
- **One** evaluator per lane, maximum.
- **One** expensive gate globally, at a time.
- Watchers are event-driven and **read-only** — no mutation authority, ever.

---

## Step 0 — before any implementer or evaluator starts

Nothing launches until all of this is done and ratified. This step is the reason the shape
works; skipping part of it is how a milestone becomes a mess.

1. **Snapshot one baseline.** Every artifact in this run refers to the same baseline commit.
2. **Record every candidate** with exactly one admission predicate: `release-critical`,
   `dependency-required`, or `high-value-coherent`. A candidate without one is not admitted.
3. **Physically move approved external issues into the milestone before freezing.** An approval
   without the move fails the gate. **Silent additions are forbidden.**
4. **Inventory every issue** with exactly one disposition: `active`, `move`, `close-fixed`,
   `close-duplicate`, or `close-superseded`.
5. **Build the dependency graph.** Cycles are a blocker, not a warning.
6. **Obtain owner ratification.** This is a stop. You are proposing a scope; the owner locks it.
7. **Render, then validate.** Red validator, no dispatch.

---

## Artifacts

| File | Rule |
| --- | --- |
| `milestone-intake.json` | every candidate, with its predicate |
| `milestone-inventory.json` | every issue, with exactly one disposition |
| `milestone-dependency-dag.json` | the graph |
| `milestone-cluster-state.json` | the only thing you mutate during the run |
| `milestone-status.md` | **generated. Never hand-edited.** |
| `cut-trace.md` | captured **during** the run, from the log, as it happens. Never reconstructed afterwards. |
| `receipts/` | one per launch: requested versus observed |
| `supervisor.md` `plan.md` `worklog.md` `context-pack.md` `drift.md` | as in the leaf profile |

---

## Running

Dispatch is gated on a green validator, every time — not once at the start.

A lane reports terminal states upward. You release dependencies as they clear. You re-intake
what comes back. You do not implement.

**A lane in `blocked` must carry an open decision record.** A supervisor that stops without one
has lost the only thing the owner was needed for. File it with the question, the options, your
recommendation, and the cost of being wrong.

**Escalate rather than absorb** when any of these is true: a new locked decision is needed, the
dependency graph changed, a public surface changed, the scope needs cutting, or debt is being
accepted. Ask plainly whether the owner needs to decide. If yes, **stop before launching the
next group.**

---

## Release

The release captain stays **inactive** until every committed issue is terminal and the evidence
recomputes as sufficient against the current head — not against the baseline, and not against a
cached result. Then it takes **one writer lease** for that content and publishes.

---

## Close

Cleanup of run directories happens only on an explicit owner ruling. Nothing is removed without
the explicit apply flag. These directories are committed on purpose: they are how the next agent
recovers context that no chat transcript survives to carry.

Blocked lanes and leaves must satisfy the [open-decision snapshot rule](../docs/reference/blocked-decisions.md).
The cluster validator checks the reference; cockpit owns durable decision authority.
