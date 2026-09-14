# Blocked decisions in a cluster snapshot

A blocked report row or leaf must reference one complete, open decision for its lane.
The cluster validator enforces charter [I4](../../ARCHITECTURE.md#7-invariants).
A successful check establishes consistency of the supplied snapshot. It does not establish
that a decision is still open in cockpit, was durably appended, or was read by the owner.

Use the existing `state.reporting.ownerDecisions` collection in a schema-2 cluster state.
A referenced record needs:

- `id`: the exact nonblank string used by `decisionRef`; identities are not trimmed for matching.
- `lane`: the referencing topic lane; `status`: `open`.
- `question`, `recommendation`, `costOfBeingWrong`: nonblank strings.
- `options`: at least two nonblank strings; `raisedAt`: a parseable timestamp.
- `answer` and `answeredAt`: absent or null. An empty string still counts as an answer.
- Existing reporting fields `whyOwnerOnly` and `blockedItems` remain required.

An identity must match exactly one record before status filtering. An open record and a closed
record with the same identity are ambiguous, so validation fails. Historical decisions that no
blocked row or leaf references retain the existing reporting requirements.

A row in `reporting.orchestratorMatrix` with `state: blocked` needs its own `decisionRef`.
A leaf with `phase: blocked` may supply its own reference. If that property exists, its value
is checked even when invalid; it cannot fall back to the row. Otherwise the leaf inherits from
the blocked report row for its own lane. Other lanes and unblocked rows cannot supply it.
References on nonblocked rows or leaves are ignored.

Schema-1 blocked leaves fail closed because they have no schema-2 decision snapshot.
Nonblocked schema-1 inputs remain compatible. Existing freshness, rendering and GitHub PR
reconciliation checks still apply; unavailable reconciliation is never a pass.

Run the existing cluster validation command documented in the
[milestone coordinator profile](../../profiles/milestone-coordinator.md).
CI runs `pnpm run check:cluster` as an explicit stage of `pnpm test`. The Node suite imports
the full validator and renderer, uses a nonempty synthetic inventory and an explicit controlled
PR source, and attacks decision references, completeness, inheritance and historical inputs.
The `.llm` TypeScript files are outside root TypeScript references; the Node test provides their
import and behavior coverage. No Deno or NetScript build dependency is introduced.

The negative reachability control is to temporarily remove the call to `validateBlockedDecisions`
inside `validateState`, run `pnpm run check:cluster`, confirm the negative cases fail, and restore
it. Passing synthetic tests prove neither deployed invocation nor live decision authority.
New I4 diagnostics report fixed defects and a topic lane, never decision identities or text;
raw operational snapshots should stay in private storage.
