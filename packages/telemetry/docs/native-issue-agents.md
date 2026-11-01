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
   `native_run_socket` in a canonical provisioned parent outside Git. The original endpoint requires
   a dispatcher-owned mode-0700 parent, a mode-0600 socket and same-UID readers. The shared observer
   server update is [Orchid #139](https://github.com/rickylabs/orchid/pull/139), following the latest
   owner dispatch on [Harness #787](https://github.com/rickylabs/harness/issues/787): it sets the
   socket to **0660** immediately after bind, preserves the setgid parent's group and also accepts
   a canonical dispatcher-owned **2750** parent. The operator provisions and mounts the parent;
   Orchid never creates or chmods it. A missing directory reports `parent-directory-missing`,
   and supervision continues. Safe stale 0600/0660 sockets are probed and replaced; live or
   foreign endpoints are preserved.
   For a different observer UID, set `ORCHID_NATIVE_RUN_PEER_UID` in the **daemon** environment to
   that one numeric UID. It replaces the same-UID default and is checked against Linux kernel
   peer credentials before each request; group access alone does not authorize reads. A malformed
   value reports `peer-uid-invalid` without stopping supervision. The owner-grant port keeps its
   separate private policy. Native JSON-lines framing, schemas and methods remain unchanged.
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
   Mount the provisioned socket parent so replacement remains visible across restarts. **Adopt the
   shared policy in the consumer before deploying Orchid #139:** Cockpit's current
   `orchid-native-runs/socket.ts` rejects anything except its own UID and 0700/0600. It needs an
   explicit trusted server identity and shared-parent/socket policy; setting the socket environment
   variable alone does not change that validation. Keep both Cockpit settings on the observer,
   never on the web request path. Observer enrichment `certified`, Home Running parity with current
   remote-control runs and removal after a completion remain operator acceptance checks after
   consumer adoption and deployment; this server change does not establish those live facts.

The CLI reads `herdr api snapshot`, subscribes to Orchid native invalidations and refreshes bounded
snapshots within freshness limits. Cockpit #951 uses its own typed subscribed native reader, then
its existing worker/durable-stream/TTL-KV pipeline. Home reads prepared projections; it performs no
external source calls. Neither native path derives root execution from terminal text, process
ancestry or transcript history. No live deployment is performed by this change.

## Watch wake and repair

`issue-agents --watch` publishes an initial validated snapshot, then wakes immediately on Orchid's
`run.subscribe` acknowledgment or `runs_changed` event. Loss of an acknowledged subscription also
wakes a reread: a hint invalidates the cache but never establishes execution facts. The subscription
is the only native change source; the CLI and cockpit add no filesystem watcher.

`--interval-ms` remains the heartbeat interval (default 5000 ms, accepted range 100–10000 ms).
A heartbeat repeats the cached snapshot without renewing `observedAt` or `validUntil`. Unchanged
evidence causes no extra event publication or scan. A 12-second safety reread repairs missed events
or an unavailable subscription; the next wait is clipped to that deadline. Collection and output
backpressure can add time to publication, so these bounds do not promise deployed client latency.

Reconnect uses one retry timer at 1000 ms and a 5000-ms unacknowledged-connection inactivity timeout.
Failed attempts before acknowledgment do not invalidate again. A successful acknowledgment wakes
one reread to recover any gap. SIGINT, SIGTERM and output closure abort the pending wait, remove its
listeners and close the owned socket and retry timer. Each event/heartbeat also cancels the losing
timer or event wait.

Producer load is one bounded reread per coalesced hint batch, serialized with the output write
callback. A single dirty bit coalesces bursts; hints arriving during collection or backpressure
survive until the next read, including before a waiter registers. Orchid owns the event rate. A
sustained stream of distinct batches can therefore cause back-to-back reads; there is no additional
polling loop or event queue. Keep the default heartbeat; lowering it is unnecessary for event wake.

Extend this behavior in `src/issue-agent-feed-changes.ts` (subscription and abortable notification)
and `src/issue-agent-feed-cli.ts` (validated collection, backpressure, heartbeat and safety).
`src/issue-agent-feed-wake.test.ts` controls monotonic deadlines while using real Unix subscription
events; `src/issue-agent-feed-changes.test.ts` covers notification, reconnect, malformed frames and
cleanup. Run the package build before invoking the compiled tests; repository gates remain required.
