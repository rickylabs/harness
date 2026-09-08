# Recovery compatibility disposition

The recovery implementation adds BoardStatus and boardStatus at the contracts root. Its candidate is0.4.0, protocol1. All existing standalone governance and repository-run decoder exports remain. Producer commands and repository/run relationship limits are unchanged. This is a source/candidate receipt until an exact registry release exists.

Connection loss immediately unbinds while retaining caller-held board data and its original timestamps. The query reports absent without a board, retained outside a synchronized current stream, and synchronized only after current-link hello and a valid snapshot. Cold HTTP, hello alone, retained generation and needsResync in isolation do not establish synchronization. No parsing status prose or downstream duplicate fold is required.

Completeness, source observation recency, execution, certification, admission and authorization remain independent. Backend grant/revocation/current-binding fences remain required; synchronization grants no right to display, persist or command. Unknown effects remain unknown and are not resent. This does not supply missing run messages, ancestry, task linkage or a repository census.

Consumer adoption remains deferred pending exact published artifact identity, installed compatibility fixtures and backend adaptation. No-current-call-sites and import-only success are not behavioral compatibility. Generated OpenAPI/client and native end-to-end receipts remain unknown. This records the handoff boundary without asserting delivery or acknowledgement by a peer.

[source: packages/contracts/src/client.ts and README.md at fe32adb; topic: reviewed synchronization contract and unchanged standalone producers; date:2026-09-08]
[source: implementation-eval-r2.md and packed-recovery-receipt.json; topic: reviewed candidate and publication/adoption boundary; date:2026-09-08]
