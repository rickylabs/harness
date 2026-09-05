# Context pack — pr-105-adversarial-review--review-claude

## Outcome

**Complete with verdict `FAIL_FIX`.** PR #105 cannot pass adversarial review at head
[`96350ce`](https://github.com/rickylabs/harness/commit/96350cebd4dd727cb522be463adb3ceec04da6e7).

Required fixes, in priority order:

1. Make every file/tee sink call settle without throwing or waiting on a hung transport; recover a
   poisoned queue and invoke all tee legs even when one throws synchronously.
2. Make rotation cross-process safe and failure-atomic, report every failed operation, and use
   collision-proof archive names.
3. Validate parsed JSON shapes and date ranges, contain malformed input per file/seam, and report
   truncation/unknown records without letting unknown timestamps move activity.
4. Remove prompt/title, working-directory, and origin-path content from human and JSON surfaces;
   publish an allowlisted machine projection.
5. Replace host-locale ordering with a specified comparator.
6. Apply `--limit` and `--since` inside every reader, validate date flags, and define disjoint exit
   states for success, incomplete evidence, input error, lookup miss, and internal failure.
7. Leave ambiguous issue references unattributed with a note and retain notes in `runs --json`.

Passing evidence: pinned install, graph check, typecheck, build, and 116/116 tests; Claude delta and
Codex running-total arithmetic; Unix-second and SQLite-millisecond conversions; read-only SQLite
under a held WAL writer; absent-vs-zero rendering; explicit stale/no-quota output; all supplied
notes; unambiguous branch attribution; no-items visibility; complete `--home` routing; and no
network or credential access in the sink/backfill implementation.

The complete commands, synthetic inputs, results, citations, and per-box disposition are in
[`adversarial-review.md`](adversarial-review.md).
The same evidence was published on PR #105 as
[`pullrequestreview-5119178703`](https://github.com/rickylabs/harness/pull/105#pullrequestreview-5119178703).
