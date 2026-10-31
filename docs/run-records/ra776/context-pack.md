# Native revision context

Refs rickylabs/harness#776. The previous READY report and scan-based sign-off are superseded by the owner update.

Orchid PR #133 supplies the missing keyed run lookup and changes API; its full race, vet and build checks passed. Harness now joins restored workspace labels and agent-native session identities to exact receipt keys. Current Herdr state drives execution. Native Orchid completion is final-run evidence; idle/done alone is not. Current source gaps and ambiguity remain explicit.

Harness native regression controls pass; configured root gates and independent review are pending. The remaining required slice is cockpit integration: reuse the native Herdr reader, remove transcript-tree intake and the receipt-enumerating helper, consume native run invalidations, and use the existing durable stream/KV writer chain. Home must continue reading prepared KV without request-path external calls. No merge or deployment is authorized by readiness.

Supervisor sign-off: Harness leaf PASS at
53f4abe50f8fcabc117f961d83a08bc4195aa134; frozen install/typecheck/build/test
exit 0, leaks exit 0 (see review.md). Cockpit leaf pending; end-to-end NOT certified.

Supervisor sign-off: certified-receipt port PASS at
649c15dd72a58c31587788e817ab4fa05b3bfb02; focused build and seven native tests
exit 0, broad gates pending (see review.md). Cockpit leaf pending; end-to-end NOT certified.

Supervisor sign-off: native replay extension PASS at
add2eda4611bd3c38c6dcdcd3cf3ad3913afa07d; frozen install/typecheck/build/test
and leaks all exit 0, 15/15 native regressions green (see review.md). Live
deployment not tested. Consumer draft PR954 gates running; whole goal NOT READY.

Supervisor final end-to-end sign-off: PASS for the full native chain at
Harness 50e830975be0bca775bf8cb8ad9dee501a09e15e (reader pin add2eda valid),
Orchid 97143ced47a7b10de5e746386e9992cfad23e33d, cockpit
ff07c01af2a7898fb984c10ba940f678122fe52c — Orchid PR #133, Harness PR #777 and
the cockpit consumer. Producer gates all exit 0 with 15 source regressions and
original red controls; consumer full test 2568 passed with 2 database-less
ignored, parity 909 passed, interop PASS. Earlier pending/NOT READY notes here
are historical; current context supersedes. No live deployment acceptance.

Native completion replay extension: current labels plus bounded remembered native coordinates, current working seats first, keyed batches only. Native final record plus exact receipt survives seat disappearance; missing active seat stays Unknown. Canonical collector now also returns point-selected receipt/observation and native Codex thread-binding bundles so current roots do not depend on historical feed membership. Root-only tree uses the existing bounded scan_limit contract; no claim of complete descendants. Focused build and 14 native regression tests exit 0. Full root gates and same-session implementation review pending for this extension.

Supervisor found stale paired stop/teardown files could override resumed native work. The new real paired-stop regression failed before the fix; this source now strips all legacy stop/teardown/Claude-status facts and uses current Herdr execution plus native Orchid final phase only. Fifteen native regressions pass. Coordinate hints intentionally persist during upstream unavailability, with no execution or binding claim; the lease-fenced consumer merges them without clearing prior hints. Full install/typecheck/root build/test passed before this follow-up and are rerun for the final source.
