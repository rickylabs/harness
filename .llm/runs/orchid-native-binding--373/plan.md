# Private Orchid root binding — issue 373

Implement the owner-authorized reader join on Harness main at
`78b40ab87260eef7fdfee61b83ad4998d8b1b99d`. Keep the PR draft for owner review.
No independent evaluator identity was established; no evaluator PASS is claimed.

## Evidence and scope

- CURRENT: `packages/telemetry/src/orchid-dispatch.ts` reads the issue assignment and
  requested route from the private dispatch snapshot.
- CURRENT: `packages/telemetry/src/agent-observations.ts` already builds bounded trees;
  `packages/telemetry/src/backfill/codex.ts` already reads native parent metadata.
- CITED: [Orchid native identity writer](https://github.com/rickylabs/orchid/blob/a94ba978904354d2d13a632ad1806def81ac07ae/cmd/divybot/native_identity.go)
  extends the existing private binding with `NativeSessionID` only after dispatch.
- CITED: [Orchid reservation contract](https://github.com/rickylabs/orchid/blob/a94ba978904354d2d13a632ad1806def81ac07ae/cmd/divybot/matrix.go)
  keys reservations by the digest of issue node identity, target repository, and brief digest.
  The target repository is distinct from the dispatch's inbox repository.
- PLANNED: Consume that binding inside telemetry, then reuse the native parent reader,
  existing public opaque identities, tree builder, and decoder. No public contract change.

## Decisions and checks

1. Validate reservation, requested route, supported native source and dispatched state.
   Read a bounded regular private file without following a symlink; recheck the dispatch
   snapshot after reading. Missing or mismatched evidence remains unavailable.
2. Keep the private join hash in a WeakMap, outside every serialized dispatch object.
   Legacy log records cannot replace or revive a private Orchid binding. Native telemetry
   records remain the authority for parenthood; no pane, workspace or time inference.
3. Preserve unknown observed route and execution state, individual unavailable cost rows,
   and the whole-tree refusal for incomplete native evidence. Do not collect new measures.
4. Mutation controls must fail assertions, compile successfully, and pass after restoration.
   Compilation failures are inconclusive mutations, never successful negative controls.
5. A real native pair can exercise an isolated synthetic assignment. That does not establish
   its relationship to a live issue. Live acceptance remains inconclusive until an actual
   dispatch receipt binds its root; never repair the receipt store during this task.

Mutation surface: telemetry reader, existing tree integration, focused tests, documentation,
validation scripts, and this redacted run record. No production configuration, labels,
process lifecycle or receipt-store mutations. Implementation tracks
[issue 373](https://github.com/rickylabs/harness/issues/373).
