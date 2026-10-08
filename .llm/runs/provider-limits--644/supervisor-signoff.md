# Supervisor source sign-off — Harness644 contract and private reader, final Owner549 state (2026-10-08)

Verdict: PASS. Supersedes the earlier sign-off recorded at commit 1a287c2. Harness product bytes are unchanged since that commit: all 12 paths in reviewed-product-source.json match current SHA256 and the full configured typecheck, build and test wrappers exit 0 on them. This commit carries final run records only.

The Owner549 policy change (rate_limited/429 informational, quota_exhausted and payment_required blocking until verified success) lives in the Orchid producer. Its effect on this contract was reviewed by this supervisor: the closed outcome reason enum is unchanged; two outcome rows per scope (hard and rate) decode because the decoder enforces identity uniqueness on meters only; the 1024 outcome-row bound is guaranteed by the producer's 512-scope reservation; observedAt and resetsAt are copied verbatim and bounded by generatedAt; the same-UID 0600 no-follow reader and fixed CLI exit codes are unaffected. The same independent Meta MuseSpark1.3/xhigh conversation returned PASS on call3 for the final frozen paired source (call1 UNPROVEN, call2 prior bytes, no terminal failures).

## Reviewed invariants, unchanged bytes

Closed copying decoder with exact key counts, plain or null prototypes and accessor refusal; calendar-valid UTC timestamps with observedAt at most generatedAt and reader refusal of future generatedAt; subscription/key scope rules and exclusive route bindings; state and quantity consistency with 100 percent as advisory evidence; outcome refused if and only if a reason is present; document-wide secret, address and path scan; reader fences on realpath, O_NOFOLLOW, regular file, same UID, mode 0600, size bound and pre/post stat equality; CLI exit 0/2/3 with no partial JSON and no path or environment leak.

## Final gates and paired proof

| Gate | Exit |
| --- | --- |
| Harness configured typecheck, 12-path unchanged manifest | 0 |
| Harness configured build | 0 |
| Harness configured test | 0 |
| Actual CLI to offline-installed contract decoder and declarations | 0 |
| Orchid final race (561.451 s), vet, build | 0 |
| Orchid source-trigger 41, endpoint non-root 7, producer 10 mutations, all compiled assertion-red and restored | 0 |
| Configured privileged two-UID kernel | 127, UNPROVEN, sudo absent |
| Configured privileged root endpoint mutations | 1, UNPROVEN, sudo absent |

Four actual-producer snapshots against the separately owned renewed Cockpit550 checkout fd059e62944e9cf7d890df3bc87d270337b3ca59 exit 0: hard refusal remains blocking through picker and admission despite a later 429; rate-only and verified-success histories launch. Fixture only; no foreign source changed.

## Limitations preserved

Root gates UNPROVEN, not green. Live activation, production settings, restarts, secret stores, package publication, mobile645 and the canonical parent report are out of scope and unproven. Wire compatibility is fixture-proven, not deployment-proven. The fail-closed pattern scan may refuse an exotic but legitimate model id.
