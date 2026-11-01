# Native issue-agent reads

How `harness-telemetry issue-agents` joins Herdr, Orchid and receipts, what its coverage means,
and the rollout order. Back to [native reads](native-reads.md).

When `HARNESS_TELEMETRY_ORCHID_RUN_SOCKET` is configured, current workspaces from Herdr's official
snapshot API select Orchid's native job/comment coordinates. Restored vendor labels and the
integration-reported native session identity recover the same receipt after restart, even when
physical pane/workspace handles change. Recorded `codex-run` and `opencode-run` labels stay exact
on the native wire; only vendor matching maps them to the canonical Herdr integration/receipt source.
`src/native-issue-agents.ts` owns this join. Keyed native
lookups and exact receipt reads are batched; retained dispatch history never selects current work.
A current `working` root is running. `idle`, `done` and `blocked` mean an idle turn, never final
assignment completion. Only Orchid's completed-run fence ends that assignment. Its outcome and
exact end time stay unknown. Historical transcript outcomes and paired stops cannot override
current native execution. Missing, conflicting or duplicated native identity stays unresolved.

`src/native-issue-agents-projection.ts` composes every existing feed facet. Current execution comes
from native signals; capacity comes from the local kernel reader, actions from validated receipts,
and child relationships, activity and measured costs from the existing bounded native stores and
hooks where Herdr has no equivalent. A shared frame byte budget covers that supplemental metadata.
Unknown metadata never invents root execution. See [Herdr #5725](https://github.com/herdrdev/herdr/issues/5725)
for missing native child/usage signals. Admission-only receipt reads preserve refusals and blocks
without reading historical dispatches; [Orchid #136](https://github.com/rickylabs/orchid/issues/136)
tracks their missing native API. Existing sources remain until those upstream signals are available.
[Orchid #135](https://github.com/rickylabs/orchid/issues/135) tracks identity-negative coverage and
durable completion replay. This CLI has no persisted replay-coordinate source: after a workspace
label disappears it cannot discover that run or report its later completion. Cockpit #951 owns its
separate checkpoint; that does not provide replay to this producer.

Global native coverage remains `complete:false, reason:binding_unavailable` until Orchid #135
supplies a covered active set or replay. A successful keyless lookup proves source health alone;
empty or partial Herdr labels cannot prove there are no other active runs. The same holds for every
issue: a second active run on the same issue may have no workspace label, or Orchid may report a
run this read cannot attach (a duplicated receipt, a conflicting seat or a receipt identity
mismatch). Every native issue row is therefore `complete:false, reason:binding_unavailable`
(`UNCOVERED_ISSUE_REASON`), and an issue Orchid names only through an unattached run is listed with
that reason and no dispatches rather than dropped. An issue-level refusal under incomplete
coverage keeps its `launchRefusal` on the incomplete row. A verified root is never published as a
complete count for its issue.
With `--partial-trees`, an uncovered issue keeps its verified forest using the contract 0.42 shape
(`ISSUE_PARTIAL_FOREST_REASONS`); without it, the row has no dispatches, so readers at 0.41 or older
accept the snapshot. A native one-shot `issue-agents --json` exits 3 for incomplete coverage.
Real key/agent/metadata/transport overflow is `scan_limit`, which wins over `binding_unavailable`.
With `--partial-trees`, a bounded issue keeps its closed observed forest using the existing
contract 0.37 shape. Without that flag, an incomplete bounded issue has no dispatch rows, so
readers at 0.36 or older accept the snapshot. Independent
good issues stay available when another issue cannot be resolved. Opaque public identities and
wire protocol are unchanged.

Without the socket setting, `src/issue-agent-feed-legacy.ts` supplies the previous bounded producer,
using the shared metadata reader and projector. It preserves admission, children, actions, cost,
capacity and existing scope/partial-tree behavior. A configured native source that fails reports
unavailable and preserves independent admission refusals and blocks, including when the Herdr
snapshot command fails; it never silently switches execution authority. The fallback is a rollout constraint,
not evidence that native restart recovery is deployed. Its history bounds remain as documented in [native reads](native-reads.md#bounded-agent-collection).

Deploy in this order:

1. Land [Orchid #133](https://github.com/rickylabs/orchid/pull/133), then
   [#134](https://github.com/rickylabs/orchid/pull/134), and deploy the binary. Configure Orchid's
   `native_run_socket` in a canonical private parent outside Git, mode 0700, with a mode 0600 socket.
   Readers use the same numeric UID; a stale/read-socket failure must not stop supervision.
2. Deploy this Harness reader. Set `HARNESS_TELEMETRY_DISPATCH_ROOT` and opt in with
   `HARNESS_TELEMETRY_ORCHID_RUN_SOCKET`. Existing operator-setting alias/conflict rules apply.
   Values are private runtime configuration and never enter public stream fields.
   Expect every native frame to answer `complete:false, reason:binding_unavailable` (one-shot exit
   3, and every issue row incomplete with the same reason) until
   [Orchid #135](https://github.com/rickylabs/orchid/issues/135) lands a covered active set. That is
   the honest state of native coverage, not a rollout failure; verified rows reach consumers that
   read contract 0.42 and pass `--partial-trees`.
3. Deploy [cockpit #951](https://github.com/rickylabs/atelier-cockpit/pull/951). It supersedes #954 and
   owns its native observer independently of this CLI. Its observer-only `COCKPIT_ORCHID_RUN_SOCKET`,
   `CONTROL_PLANE_SOCKET` and scoped `COCKPIT_HERDR_SERVER_MAPPING` follow that PR's deployment guide.
   Mount private socket parents, preserving same-UID access and socket replacement across restarts.

The CLI reads `herdr api snapshot`, subscribes to Orchid native invalidations and refreshes bounded
snapshots within freshness limits. Cockpit #951 uses its own typed subscribed native reader, then
its existing worker/durable-stream/TTL-KV pipeline. Home reads prepared projections; it performs no
external source calls. Neither native path derives root execution from terminal text, process
ancestry or transcript history. No live deployment is performed by this change.
