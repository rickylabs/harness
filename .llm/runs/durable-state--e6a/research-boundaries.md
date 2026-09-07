# durable-state--e6a — verified boundary evidence

Strict persistence must be separate from the tolerant decision-journal reader. The local adapter is a testable reference, not a production storage selection.

- `packages/coordinator/src/journal.ts:25` defines PersistedDecision; `:56` builds both digests; `:74` encodes a line. `:115` deliberately drops malformed lines. Reuse evidence vocabulary, never its recovery policy.
- `packages/coordinator/src/record.ts:72` receives time from the caller. `packages/coordinator/src/replay.ts:175` is a deterministic fold.
- `packages/contracts/src/governance.ts:118` demonstrates discriminated state data. The issue's description of “failure kinds” is idiomatic guidance, not a literal failure-kind type in that file.
- `packages/coordinator/src/worktree.ts:365` accepts time at the boundary; it does not itself define a clock interface.
- [Issue 245](https://github.com/rickylabs/harness/issues/245) specifies local ownership, checkpoint replacement, intent/receipt evidence and real child kills. [Issue 191](https://github.com/rickylabs/harness/issues/191) keeps production selection F1 and live rollout F2 separate. Retrieved in this run.

## Filesystem sources retrieved in this run

- [Node filesystem flags](https://nodejs.org/api/fs.html#file-system-flags): exclusive creation refuses an existing path, but network filesystems may not honor it. The adapter must not claim arbitrary shared-volume safety.
- [Linux fsync](https://man7.org/linux/man-pages/man2/fsync.2.html): syncing file contents does not sync the containing directory entry. Sync the directory after publication and return named failure when sync fails.
- [Linux rename](https://man7.org/linux/man-pages/man2/rename.2.html): replacement of an existing target is atomic for readers. Process-kill tests are not power-loss or hardware-cache tests.
- [Linux link](https://man7.org/linux/man-pages/man2/link.2.html): an existing destination refuses publication. This is a candidate for immutable ownership records without check-then-unlink recovery races.
- [Linux kill](https://man7.org/linux/man-pages/man2/kill.2.html): signal zero checks existence and permission; permission denial is not death. A reused PID can conservatively block recovery; no timeout may establish death.

## Read-only prior art

Netscript `packages/plugin-workers-core/src/ports/worker-idempotency-port.ts:36` separates claim and completion. Its release-for-retry comment is not sufficient authority to turn this store's unknown into unsent. `packages/plugin-sagas-core/src/ports/saga-store-port.ts:25` separates persistence from runtime and carries expectedVersion. `packages/plugin-triggers-core/README.md:9` establishes persist-before-ack ordering. These are patterns only; no build dependency on that runtime.

## Unverified integration

Production filesystem flush behavior, multi-host ownership, power-loss recovery, runtime dispatch and external reconciliation are not proven by a local process-kill suite. #191 owns those integration gates. This issue cannot claim end-to-end restart visibility.

The new contract dependency will invalidate the dependency claims in `packages/coordinator/src/index.ts:10` and `packages/coordinator/src/record.ts:16`; update those comments with the dependency addition. Package references must mirror workspace dependencies (`scripts/check-project-graph.mjs:5`, `packages/README.md:57`).
