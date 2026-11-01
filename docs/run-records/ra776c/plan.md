# Plan & design (ra776c)

Blocking items from the CHANGES review at `b82bbb835`:

1. `issue-agents-restart.test.ts:255` reads `agents[0]`; agents are sorted by opaque id, so the
   native child sorts first in about half of runs. Select the root by `parentAgentId === null`.
2. `native-issue-agents-projection.ts:51` keeps an issue `complete:true` while another active run
   on the same issue is hidden (no workspace label) or skipped at `native-issue-agents.ts:152/:154`.

## Design checkpoint

1. **Public surface.** Contracts 0.42.0 exports `ISSUE_PARTIAL_FOREST_REASONS` and
   `IssuePartialForestReason`; the decoder accepts an incomplete `binding_unavailable` issue that
   carries a closed verified forest. Telemetry native frames mark every issue row
   `complete:false, reason:binding_unavailable`; issues named only by an unattached Orchid run are
   listed instead of dropped; refusals survive on incomplete rows. Wire schema/protocol unchanged.
2. **Domain vocabulary.** *Uncovered issue*: the source cannot enumerate every active run on it.
   *Unattached run*: an Orchid run this read could not join to one receipt and one seat.
   *Partial forest*: verified roots and their closed subtrees that are not the whole issue.
3. **Ports.** Orchid `run.lookup` (keyed, via `orchidHost.lookupNativeRuns`), Herdr snapshot,
   Orchid receipt reads. No new ports.
4. **Constants.** `ISSUE_PARTIAL_FOREST_REASONS` (contracts), `UNCOVERED_ISSUE_REASON`
   (telemetry projection) replace the `"scan_limit"`/`"binding_unavailable"` literals on this path.
5. **Commit slices.** (a) test root by ancestry — gate: restart test x30 serial, 0 failures;
   (b) contract 0.42 + producer uncovered rows + docs — gates: contracts and restart tests, red on
   the previous source, green after exact restore, then the five root gates; (c) review sign-off.
6. **Deferred scope.** A covered active set needs Orchid #135; until then no native issue can be
   complete. Cockpit #951 opts into partial trees on its own schedule; no cockpit change here.
   Non-blocking review notes (Herdr package move, splitting `collectNativeIssueAgents`) stay open.
7. **Contributor path.** `packages/telemetry/docs/native-reads.md`, section "Native issue-agent reads".
