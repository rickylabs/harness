# Connection recovery — 265

DRAFT pending independent Stage G. One rule: retain the last board without representing a lost connection as synchronized; a valid current-link hello and subsequent snapshot restore synchronization. This is the P0 published read-flow prerequisite. Governance projection/bridge is the next P1, owned by existing 205/87 acceptance. No live dispatch, provider integration or new consumer fold.

## Baseline and decisions

Current main baseline 8fd096d includes published contracts 0.1.0 / protocol 1. The earlier recovery branch ended at 8e5c5dab with a FAIL_FIX on its freshness amendment, not an implementation PASS. A coordinator source diff confirms client.ts, fold.ts and connection.ts are unchanged between that reviewed head and this baseline. Earlier artifacts remain preserved in their original run/branch; this document consolidates the approved design and outstanding correction rather than importing operational research history into this public PR.

1. Add optional EventFold.bound with the legacy fallback `bound ?? (generation !== null)`. New empty folds explicitly set false. Cold snapshot folds retain display generation/data but set false and needsResync true. Optional encoding preserves existing TypeScript constructions; behavior changes require a disclosed 0.2.0 candidate under this package's 0.x policy.
2. Internal rebind clears bound and lastSeq, sets needsResync true, retains board, display generation and counters. Apply at each connect command and immediately on accepted live-to-non-live transitions. Old-link drops and ordinary command failures must leave a healthy connection untouched.
3. Hello on an unbound current link may accept a lower generation after server restart. Once bound, preserve strict-increase hello checks. Hello marks resync needed; only a valid subsequent snapshot establishes synchronization. Non-hello frames while unbound cannot change board, sequence or binding; count only discards. Existing old-link fencing runs first.
4. Export BoardStatus = absent | retained | synchronized and boardStatus(Cockpit). Absent means board null. Synchronized requires board present, loop live, non-null loop generation, matching fold generation, bound fold and no needsResync. Otherwise retained. No stored parallel projection.
5. resyncFrame on an unbound fold returns generation 0. RF-1 repaired: its public doc block is explicitly in scope and must say 0 is the existing no-generation sentinel; hubs never assign it; a mismatched resync closes the link, so sending the unbound frame is a transport fault, not a recovery request. Bound behavior remains identical, including legacy fallback.
6. Authorization is a separate backend duty. A retained or synchronized board grants no right to display, persist or command. Revocation overrides retention and late HTTP replies must not restore permission. This slice adds no authorization epoch/wire protocol. Observation timestamps remain unchanged; generatedAt is production time, not reception time. Synchronization says nothing about completeness, observation recency, execution, certification or command admission. Unknown effects remain unknown and are never automatically resent.
7. Package candidate 0.2.0, protocol 1 unchanged. The old E404 notes are historical: 0.1.0 was subsequently published with license/provenance. This PR prepares source, package contents and compatibility evidence; a source merge or pack is not registry publication. Do not push a release tag or claim consumers upgraded. Publication remains an explicit later receipt.

[source: issue 265 and prior independent review at 8e5c5dab; topic: recovery design and RF-1; consulted 2026-09-07]
[source: packages/contracts/src/fold.ts:79, :145, :156, :279, :435; client.ts:309, :372, :426, :467; connection.ts:159, :167, :196, :223; topic: current binding, HTTP races and loss transitions; inspected 2026-09-07]
[source: packages/contracts/src/server.ts:124, :135, :237; topic: generation identity and resync mismatch; inspected 2026-09-07]
[source: packages/contracts/README.md versioning policy; issue 267 published receipt; topic: release baseline and candidate boundary; consulted 2026-09-07]

## Mutation inventory and scope

Only packages/contracts/src/fold.ts, client.ts, index.ts; their existing test files or one focused recovery test; packages/contracts/README.md, package.json; this run's evidence; and lock metadata only if required by the version bump. Internal bound/rebind helpers must not accidentally become root exports. Update generation, bound, foldFromSnapshot, resyncFrame and client cold-fetch documentation, plus the structured query's non-inference/authorization contract. Add a glance stale marker and its recovery regression. No other product package, workflow, runtime transport, durable outbox or default configuration changes.

## Executable acceptance gates (planned, not run)

- Restart lower-generation hello on a new link converges to the new board; same/lower hello on the bound current link is refused/discarded without mutation.
- Before hello, delta/snapshot/count frames matching retained generation cannot contaminate data; abandoned-link events leave even counters unchanged.
- Cold HTTP snapshot binds nothing, retains its original timestamps and displays only as retained. Test replies during connecting/waiting/stopped, after live reconnect, and both request/response race orders.
- Dropped, rejected, explicit stop and backoff-before-retry immediately return retained, preserve board/counters and unbind. Old-link drop and non-auth POST/network failure do not demote a healthy connection.
- Empty board, absent board, partial snapshot, hello-before-snapshot, snapshot-after-hello, gap and recovery each have explicit status assertions. Synchronized partial snapshot remains complete:false.
- Direct resyncFrame: retained unbound yields zero; bound and legacy no-bound constructions preserve former behavior. Legacy fallback covers hello/event/count guards. Tests compile old-shaped values.
- Structured query never rewrites source timestamps, execution/effect outcomes or certification. Tests/documentation keep authorization outside synchronization.
- pnpm run typecheck, build, test and check:publish; targeted contracts tests first. Pack/install root/server exports and types with a synthetic recovery scenario from the actual candidate tarball; retain digest and exact source. No upgrade/publication inference.
- Independent exact-head implementation review, exact-head CI, publication scan. Only then review/merge under owner's standing authorization; no automerge.

## Risks and sequencing

The main risks are retained generation becoming a false binding, direct helper leakage, premature synchronization at hello/fetch, old-link demotion, and late unauthorized display. Each has a negative test above or an explicit backend authorization boundary. Numeric protocol remains 1 because no wire frame shape changes; source/API behavior is versioned 0.2.0. Downstream adaptation/OpenAPI/client receipts stay open.

DAG: this plan repair -> same-session independent Stage G -> implementation -> independent review and gates -> reviewable PR -> release preparation -> explicit publication receipt -> consuming version decision. Governance P1 follows separately. Routing272 remains planning only. No unanswered owner design fork; release execution is not authorized by the peer priority request.
