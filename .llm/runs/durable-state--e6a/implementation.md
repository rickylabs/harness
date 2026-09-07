# durable-state--e6a — implementation evidence

The scoped store implementation is complete and the focused package suites pass. This is author
validation, not the independent implementation verdict or the coordinator's final clean-tree gates.

## What was implemented

- Published readonly storage port, full five-part intent identity, branded negative-receipt proof,
  and distinct pending/terminal types: `packages/contracts/src/state-store.ts:1`.
- Evidence constructors beside the existing decision journal, with boundary time outside the input,
  output and entry digests: `packages/coordinator/src/journal.ts:222`.
- Strict schemas and pure tail replay, followed by orphaning; retained history also checks checkpoint
  contents: `packages/coordinator/src/state-store.ts:49`, `:114`, `:165`.
- Same-successor ownership publication, internal PID-death observation, same-directory publication
  and uncertainty refusal: `packages/coordinator/src/state-store-fs.ts:55`, `:87`, `:99`.
- Serialized operations, defensive fencing, explicit genesis, and permanent closure before release:
  `packages/coordinator/src/state-store-fs.ts:237`. Public driver exposes acquisition only.
- Same-port memory fake with explicit simulated loss: `packages/coordinator/src/state-store-memory.ts:9`.

The configured directory is resolved once. All coordinating processes must use the same local
store directory for the scope; this does not establish exclusivity across independently copied
stores. The caller supplies an existing directory, and the adapter never creates an operational
home or chooses a production storage location.

## Commands actually run

- `pnpm --filter @rickylabs/harness-contracts --filter @rickylabs/coordinator test`: exit 0;
  contracts 121 passed, coordinator 299 passed, zero failures or skips in either.
- Store-specific run: `node --test packages/coordinator/dist/state-store*.test.js`: 49 passed,
  including 8 real SIGKILL cases and the compile-time impossibility module. The preceding package
  build compiled sources, including all `@ts-expect-error` assertions, before this run.
- `pnpm run check:graph`: exit 0, 15 packages with matching references and dependencies.
- `git diff --check`: exit 0.

The real-child suite checks three checkpoint publication boundaries, an actual synthetic effect
attempt between intent and receipt, three ownership publication boundaries and death before genesis.
It asserts the child reached its IPC boundary before SIGKILL, asserts the exit signal, and recovers
explicitly (`packages/coordinator/src/state-store-crash.test.ts:1`). Sent and negative-receipt controls
remain known; only unresolved evidence becomes unknown. Every temporary test directory and child is
owned by one cleanup helper (`packages/coordinator/src/state-store-test-helpers.ts:23`).

The filesystem tests exercise two real opens, a three-process same-predecessor race, stale identity
checks, serialized close, detachment, the four corruption modes across all four record kinds,
history gaps, publication poisoning, sequence collisions, fencing, and forged checkpoint state
(`packages/coordinator/src/state-store-fs.test.ts:1`).

## Limits and handoff

No production store selection, provider, runtime dispatch, transport server, live canary or external
reconciliation changed. Local process loss is tested; power loss, hardware caches, production flush
behavior, multi-host ownership and shared/network storage are not proven. These remain the #191
integration boundary and owner decisions F1/F2. Parent coordinator owns independent implementation
review, complete clean-tree ten-check build, whole-workspace tests, PR metadata and publication.
Owner alone merges. No implementation gate verdict is asserted here.
