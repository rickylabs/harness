# Native revision worklog

The owner's native-source requirement supersedes the earlier reverse-tail/history-priority implementation and sign-off.

1. Public surface: current issue roots retain their opaque assignment and issue across restored pane/workspace handles. History does not select live work.
2. Vocabulary: restored workspace label selects a native job coordinate; native session identity proves attachment; a native completion fence proves final assignment end; an idle turn is separate.
3. Ports: Herdr snapshot/events, Orchid keyed run lookup/change socket, exact receipt reads, cockpit canonical reconciler, existing NetScript durable streams and TTL KV projections.
4. Constants: existing current observation cap, 128-key native transport batches, fixed read-only methods and restored-label grammar. No cap increase or model IDs.
5. Slices: upstream source (PR #133, full Go race/vet/build exit 0, independent PASS); Harness native projection (in validation); cockpit subscribed intake and existing durable writer integration (next).
6. Deferred: UI/mobile policy, production deployment and unrelated historical parser changes. Missing native signals remain unknown.
7. Contributor path: `packages/telemetry/src/native-issue-agents.ts` owns the native join.

New native controls failed on unchanged main: resumed run had no running root; history occupied 256 rows instead of selecting the current workspace. Both pass with the native source. Additional controls cover stopped turns, final end, changed identity, duplicate seats and issue scoping. The obsolete elapsed-history-window and filesystem-watch tests were replaced; historical scanner metadata parity remains through the public pure tree projector.

Independent supervisor sign-off: PASS at reviewed code head
53f4abe50f8fcabc117f961d83a08bc4195aa134. Final gates: frozen install,
typecheck, root build and full test all exit 0; leak scan exit 0. Cockpit leaf
explicitly pending; end-to-end task NOT certified.

Historical attachment experiment: an optional certified-receipt callback was tested without a production caller. The coverage re-review removes that callback and its fixture-only guarantees; it never proved consumer integration.

Historical replay experiment: remembered coordinates were supplied only by tests. The coverage re-review removes those inputs and the disappearance/replay claims from this producer. Native completion is observable only for currently discoverable labels; missing coverage remains incomplete pending Orchid #135.

Supervisor found stale paired stop/teardown files could override resumed native work. The new real paired-stop regression failed before the fix; this source now strips all legacy stop/teardown/Claude-status facts and uses current Herdr execution plus native Orchid final phase only. Fifteen native regressions pass. Coordinate hints intentionally persist during upstream unavailability, with no execution or binding claim; the lease-fenced consumer merges them without clearing prior hints. Full install/typecheck/root build/test passed before this follow-up and are rerun for the final source.

Independent supervisor sign-off: PASS at reviewed head
add2eda4611bd3c38c6dcdcd3cf3ad3913afa07d. Final gates all exit 0 (frozen
install, typecheck, root build, full test, leak scan); 15/15 native
regressions green with red pre-fix recorded. Live deployment not tested.
Consumer draft PR954 still gating; whole goal NOT READY.

Supervisor final end-to-end sign-off: PASS at Harness
50e830975be0bca775bf8cb8ad9dee501a09e15e. Consumer chain complete with
Orchid 97143ced47a7b10de5e746386e9992cfad23e33d and cockpit consumer PASS
(2568 consumer tests, 909 parity, interop PASS). Earlier gating notes here are
historical. No live deployment acceptance.
