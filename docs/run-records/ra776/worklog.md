# ra776 worklog
The resumed session already keeps its durable receipt join. The missing running state came from a native turn boundary beyond the fixed tail.

Design checkpoint:
1. Public surface: current issue-agent snapshot, with native-only running/ended and honest truncation.
2. Vocabulary: durable root is the verified receipt key; native boundary determines turn state; mtime is a scheduling hint only.
3. Ports: OrchidReads, native RunRecord parsing, existing snapshot decoder; optional host page cursor stays private.
4. Constants: existing wire/byte caps; CODEX_TURN_SCAN_BYTES, TURN_SCAN_CHUNK_BYTES and MAX_DISPATCH_PAGES_PER_FRAME bound new work.
5. Slice: native state recovery, receipt paging/priority, regressions, docs and run evidence. Gate: focused IO/integration tests, root install/typecheck/build/test/leaks, independent implementation review.
6. Deferred: no UI/backend migration, new root discovery, window expansion, or inferred liveness from process/pane/file clocks.
7. Contributor path: packages/telemetry/src/issue-agent-feed-cli.ts composes native reads and scheduling.

Plan evaluation: initial FAIL_PLAN correctly found the large-file native state gap; corrected plan PASS with explicit contention/freshness/byte documentation requirements.
Red control: unchanged production source at origin/main, with only the new two-test integration file, compiled successfully. Node test exit 1: tests 2, pass 0, fail 2. Resume actual unknown vs expected running; oldest active group actual undefined vs expected running.
Implementation: central native boundary vocabulary, bounded reverse recovery, per-frame metadata hints, no-paired-end before ended, running forests before output limits, bounded receipt paging. Focused tests: 30 tests, pass 30, fail 0 (exit 0). The independent Meta supervisor passed both the initial implementation and the final multi-root/directory-bound amendments. Exact-head attestation follows the implementation commit.

Final root gates (all exit 0):

    pnpm install --frozen-lockfile
    pnpm run typecheck — typecheck ok, 5 stages all green
    pnpm run build — build ok, 15 stages all green
    pnpm test — test ok, 8 stages all green

Three restart/capacity integration tests pass (exit 0), including a historical retry that cannot fit after native-state recovery. Byte-accounting tests cover backward reads, future completion, malformed records and capped gaps. Host-page test crosses 1,000 receipts; traversal guard verifies finite page exhaustion.

Read-only scoped live validation recovered a native running resumed root alongside native ended history, with honest scan_limit. The full feed remains partial at its fixed byte cap; contention can omit the same large root in another frame. This is a measured limitation, not an all-live-rows claim.

Reconcile: all source changes are within the declared surface; no contracts schema or cockpit source change; no owner-controlled runs or generated files touched. The assigned branch and Refs-only PR association follow the operator directive.

[Lesson](lesson-2026-10-31.md): native-state recovery must be tested independently of durable identity, and verified retries must survive another retry's budget exhaustion.
