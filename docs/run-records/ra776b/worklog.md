# Blocking review repaired

- Restored the previous bounded collector for socket-absent rollout, sharing one metadata reader
  and the pure projectors with native mode. Removed the duplicate test collector and migrated every caller.
- Native current/final state enters the pure node projector. Metadata costs, native child links,
  action receipts, local capacity, launch refusals and blocks remain available. A failed native read
  preserves independent admission evidence without falling back to historical execution.
- Replaced serial per-root receipt validation with bounded batches. Native receipt selection is
  independent of retained history; admission-only reads do not read historical dispatches.
- Removed unconditional boundedness. True key/agent/metadata overflow is `scan_limit`; default rows
  contain no bounded forest, while explicit partial-tree callers retain the closed observed forest.
- Replaced mandatory-socket assertions with positive production-fallback and strict invalid-source
  controls. This was an intentional behavior correction, not a flaky fixture.
- The restart/history revert control compiles the previous source selection, fails both tests at
  runtime, restores exact source bytes, then passes both tests. An initial whole-CLI overlay did not
  compile against the changed watch ports and was inconclusive; it is not counted as a negative control.
- Built the tagged 0.36 contract decoder independently. Complete/default-overflow/faceted native
  frames decode; the explicitly opted-in bounded frame remains deliberately incompatible with it.
- Cockpit PR #954 was closed with a pointer to #951. The latter owns its native observer and reads
  unchanged public contracts. No competing consumer PR was opened.

Independent GLM plan evaluation passed. Muse inspected the source and ran independent package
checks. A final committed-head reconciliation is required before READY; see `review.md` for its result.

Reconciliation: HEAD b6dda35e52c3474f5200f0a4e81bdd02985a5ded verified clean,
then reviewed file by file. Late additions confirmed in the committed head: the
failure catch preserving independent admissions, launch-block coexistence, the
corrected fallback assertions, and the test-only older-decoder import seam with
its explicit opt-in negative. Root gates all exit 0 with telemetry at 808 pass
and 0 fail; revert and 0.36 compatibility receipts match their logs. Result PASS.
