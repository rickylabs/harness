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

Consumer integration follow-up: the existing cockpit private issue-target scope reader must retain its exact receipt validation. A private `onBinding` port now receives only a certified receipt and binding, so that reader can point-read its scoped metadata without enumerating receipts or duplicating the native join. Metadata failure cannot change execution evidence. The native regression verifies this separation and refuses the callback on a mismatched session.
