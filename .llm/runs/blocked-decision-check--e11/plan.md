# I4 blocked-decision check — locked plan

Extend the existing cluster validator so a blocked lane cannot pass without an unambiguous,
open decision for that lane. This is explicitly charter I4 (`ARCHITECTURE.md:162–165`).
Independent plan evaluation passed after the bounded corrections recorded in plan-eval.md. I1 implementation is in PR 342.

## Contract

The existing decision collection remains `state.reporting.ownerDecisions`; this is a snapshot
projection, not a new decision ledger. A blocked report row in `reporting.orchestratorMatrix`
requires `decisionRef`. The other blocked signal is a leaf with `phase: blocked`; lane objects
have no state field. If a leaf declares `decisionRef`, validate only that value, even when invalid.
Otherwise inherit only from the blocked report row for that exact lane. A schema-1 blocked leaf
fails closed: a schema-2 decision snapshot is required. Nonblocked schema-1 inputs remain compatible.
References on nonblocked rows/leaves are ignored; a blocked leaf still requires its own or an
applicable blocked-row reference regardless of other row states.

The reference must be a nonblank string matching exactly one record before filtering by status.
That record must have `status: open`, matching `lane`, nonblank `question`, at least two nonblank
string `options`, nonblank `recommendation`, nonblank `costOfBeingWrong`, and a parseable
`raisedAt`. A record carrying a non-null `answer` or `answeredAt` cannot satisfy open status.
Absent or null answer fields mean unanswered; blank strings count as answered and fail.
Duplicate identities, even an open/closed pair, are ambiguous and fail. Missing/malformed
collections and wrong-lane records fail. Existing reporting requirements (`whyOwnerOnly`,
`blockedItems`) continue to apply under schema 2. New diagnostics name the lane category and
fixed defect, not private decision, session or run identifiers.

A valid reference proves only consistency of the supplied snapshot. It does not prove that
an owner read the question, that the answer has not changed elsewhere, or that the record was
appended to cockpit's durable log. The existing reporting freshness and PR reconciliation
checks remain in force; no empty external result is turned into proof of live consistency.

## Implementation surface

- `.llm/tools/harness/validate-milestone-cluster.ts`: one shared I4 check called from
  `validateState`, covering both reporting versions and blocked leaves.
- Both validator and `.llm/tools/harness/render-milestone-status.ts`: replace `@std/path`
  imports with `node:path`, so Node 24 can import the existing functions in tests. Deno CLI
  remains behind `import.meta.main`; imported modules do not execute it. No Deno or NetScript
  build dependency is added. `.llm` is outside the root TypeScript references; this Node test
  provides the import/behavior gate.
- Node test beside the validator; `package.json` adds a named `check:cluster` stage to the root
  test aggregate, with a stage-membership (not adjacency) wiring assertion in the suite.
- `profiles/milestone-coordinator.md` links a concise reference describing decision fields,
  inheritance and the snapshot-only guarantee. No historical run artifact is rewritten.

## Verification

Use the existing templates to build a nonempty synthetic cluster: one admitted issue, one DAG
node/wave, exclusive lane ownership, one committed open issue, real rendered status and an
explicit injected controlled PR source whose open list and heads match the fixture leaves.
Reporting timestamps must satisfy the 15–60 minute cadence window. Baseline must pass the complete `validateMilestoneCluster`
function before any mutations, not only a helper. A blocked valid lane passes; a blocked leaf
with a valid inherited reference passes. Test each missing field, blank reference, closed and
answered records, duplicate ids, wrong lane, malformed options, missing reporting and legacy
blocked leaf (must fail). Test an invalid explicit leaf reference with a valid row reference,
and attempted inheritance from another lane. Preserve a nonblocked legacy case. A stale rendered
status and unavailable PR reconciliation source must still fail.

Temporarily remove the I4 call and show that the negative full-validator tests turn red, then
restore it. Run root pnpm typecheck/build/test, using known executable scratch for installed
contracts. Independent exact-head implementation review follows; no author self-certification.

## Decisions, risks and forks

1. Reuse the existing reporting decision collection; reject a parallel store.
2. A reference identifies one record before status filtering; reject ambiguity, not just absence.
3. Unknown external authority/freshness remains unproven; this checker makes only a snapshot claim.

Risks: backward compatibility (nonblocked legacy test), an unreachable helper (full-validator
negative control), false open status (closed/answered tests), and Node import breakage (Node 24 CI).
DAG: independent plan gate → source/test/doc change → repository gates → independent review.
Owner forks: none; this implements a locked invariant without changing the charter.
