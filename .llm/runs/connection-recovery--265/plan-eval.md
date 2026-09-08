# plan-eval — connection-recovery--265 (independent Stage G, resumed session)

**Verdict: PASS, with six bounded criteria named below that bind the implementation and its independent review.**

Evaluated: `.llm/runs/connection-recovery--265/plan.md` at source head `107281057ad399b0b1ba3a89a2f26d72ef4ffa54`. This PASS covers only the consolidated P1 read-flow prerequisite inside `packages/contracts`; governance 205/87, routing 272, any outbox, transport work and any publication remain outside it, as the plan itself states.
[source: .llm/runs/connection-recovery--265/plan.md:3, :41; topic: scope and sequencing; date: 2026-09-07]

## Identity and head confirmation

- Reviewer: GLM5.3, provider-default effort, via the upstream agentic launcher; CLI-selected zhipu family. This is the same independent session that returned FAIL_FIX at the prior reviewed head `8e5c5dab`, resumed under a fresh feature plan-evaluator query. Original plan author family: anthropic. Coordinator correction family: openai. This evaluator is a third family with no authorship overlap with either.
[source: .llm/runs/connection-recovery--265/supervisor.md:3; .llm/runs/connection-recovery--265/matrix-plan-eval.json:6-23; topic: route, independence and repair policy; date: 2026-09-07]
- Upstream independent attestation of this session's execution identity remains unknown, as in all prior rounds; nothing in this artifact relies on it.
- Head confirmed by read-only git inspection in this run's worktree: `git rev-parse HEAD` returns `107281057ad399b0b1ba3a89a2f26d72ef4ffa54` on a clean tree, sitting on main baseline `8fd096d` plus this run's planning commit. A scoped `git diff` between the previously reviewed head `8e5c5dab` and this head over `packages/contracts` shows exactly one change: an added `LICENSE` file from the 0.1.0 release handoff. `fold.ts`, `client.ts`, `connection.ts`, `events.ts`, `server.ts`, `index.ts`, the contracts `package.json` and `README.md` are byte-identical to the sources this session fully verified in earlier rounds, so every prior source verification carries to this head; the load-bearing lines were re-pinned below regardless. The contracts manifest at this head still reads `version 0.1.0`, `dsh.protocol 1`, consistent with plan review, not implementation.
- The only things executed by this review are read-only git and source reads: `rev-parse`, `log`, `status --porcelain`, scoped `diff`, and file reads. No test, build, gate, pack or network check was run, and none is claimed.

## RF-1 — verified repaired

The prior FAIL_FIX stood on one finding: `resyncFrame` is exported and its behaviour changes, so its public documentation had to ride in the same pull request. The consolidated plan repairs it completely:

- the doc block is explicitly in the mutation inventory — "Update generation, bound, foldFromSnapshot, resyncFrame and client cold-fetch documentation";
[source: .llm/runs/connection-recovery--265/plan.md:24; topic: RF-1 in the mutation surface; date: 2026-09-07]
- the required content carries all three statements: generation 0 is the existing no-generation sentinel on an unbound fold; hubs never assign it; a mismatched resync closes the link, so sending the unbound frame is a transport fault, not a recovery request;
[source: .llm/runs/connection-recovery--265/plan.md:13; topic: RF-1 doc content; date: 2026-09-07]
- the gate set asserts the behaviour: retained-unbound yields zero; bound and legacy no-bound constructions preserve former behavior.
[source: .llm/runs/connection-recovery--265/plan.md:33; topic: RF-1 gate; date: 2026-09-07]

The underlying source facts were re-verified this round: `resyncFrame` reads the retained generation (`packages/contracts/src/fold.ts:157-162`); hub generations are always ≥ 1 (`packages/contracts/src/server.ts:124-126`, `:135-136`, `:163`); a resync naming another generation is unanswered and the connection is closed (`packages/contracts/src/server.ts:237-252`). No claim is made anywhere that sending the sentinel frame would succeed.

## Consolidation audit — accepted design present and unaltered

Each element of the accepted P1′ + freshness design was checked against the consolidated text and the unchanged source:

- Optional `EventFold.bound` with legacy fallback `bound ?? (generation !== null)`; `emptyFold` sets false; `foldFromSnapshot` retains display generation and data, sets false and `needsResync` true; 0.2.0 candidate disclosed under the 0.x policy. Matches the accepted design verbatim.
[source: .llm/runs/connection-recovery--265/plan.md:9; packages/contracts/src/fold.ts:79-80, :145-154, :253; topic: binding encoding and constructors; date: 2026-09-07]
- Internal `rebind` clears bound and lastSeq, sets needsResync, retains board, generation and counters; applied at each connect command and immediately on accepted live-to-non-live transitions; old-link drops and ordinary command failures leave a healthy connection untouched. Matches the accepted leave-live clause and its negatives; the source paths are as previously verified (`dropped`/`rejected`/`stop` are the only transitions out of live; `stale`/`hold` return the same state; non-auth refusals and `failed` never reach `drive`).
[source: .llm/runs/connection-recovery--265/plan.md:10, :31; packages/contracts/src/connection.ts:159-165, :167-174, :196-209, :219-229; packages/contracts/src/client.ts:426-437, :282-286, :467-493; topic: rebind sites and non-demotion guarantees; date: 2026-09-07]
- Lower-generation hello accepted only on an unbound current link; strict-increase preserved once bound; hello marks resync needed; only a valid snapshot establishes synchronization; unbound non-hello frames cannot change board, sequence or binding and count only discards; old-link fencing runs first.
[source: .llm/runs/connection-recovery--265/plan.md:11, :28-29; packages/contracts/src/fold.ts:442-448, :305-310, :336-342, :279-287; packages/contracts/src/client.ts:321-328; topic: the two-half binding invariant and pre-hello gates; date: 2026-09-07]
- `BoardStatus = absent | retained | synchronized` and `boardStatus(Cockpit)` with the exact accepted predicate; closed union; no stored parallel projection.
[source: .llm/runs/connection-recovery--265/plan.md:12, :32; topic: structured query; date: 2026-09-07]
- Authorization stays a separate backend duty; retained or synchronized grants no right to display, persist or command; revocation overrides retention; late HTTP replies do not restore permission; no authorization epoch is invented; observation timestamps remain unchanged with generatedAt as production time; synchronization says nothing about completeness, recency, execution, certification or command admission; unknown effects remain unknown and are never automatically resent. This is the accepted transport-only composition boundary, and the query's documentation carries the non-inference and authorization contract.
[source: .llm/runs/connection-recovery--265/plan.md:14, :24, :34; topic: revocation boundary and non-inferences; date: 2026-09-07]
- Cold HTTP: binds nothing, retains original timestamps, displays only as retained; replies tested during connecting/waiting/stopped, after live reconnect, and in both request/response race orders. The live-answer discard path and both race orderings are unchanged in source.
[source: .llm/runs/connection-recovery--265/plan.md:30; packages/contracts/src/client.ts:369-387; topic: cold fetch and HTTP answer races; date: 2026-09-07]
- Empty, absent and partial boards each carry explicit status assertions, with a synchronized partial snapshot remaining `complete: false` — the accepted completeness non-inference fixture.
[source: .llm/runs/connection-recovery--265/plan.md:32; packages/contracts/src/snapshot.ts:60-61; topic: empty/partial board statuses; date: 2026-09-07]
- Legacy fallback is gate-enforced at the hello/event/count guards and by compiling old-shaped values, which keeps the no-type-break claim mechanical; the optional encoding and additive exports are what a published 0.1.0 consumer base now actually needs.
[source: .llm/runs/connection-recovery--265/plan.md:9, :33; topic: published-package compatibility; date: 2026-09-07]
- Gate inventory: every previously accepted gate survives the thematic consolidation — restart inversion and same-link refusals; pre-hello contamination and abandoned-link counter identity; the cold-fetch matrix; dropped/rejected/stop/backoff with the two non-demotion negatives; status exhaustiveness including gap and recovery; the sentinel; root typecheck/build/test plus `check:publish`; the legacy fallback; the glance stale marker regression. One new element is added — pack/install of root/server exports and types from the actual candidate tarball with a synthetic recovery scenario, digest retained — which this review accepts as in-rule: it verifies this pull request's own package contents against the now-real publication boundary, claims no upgrade or publication, and is consistent with the pack shape `check:publish` already asserts.
[source: .llm/runs/connection-recovery--265/plan.md:26-36; packages/contracts/package.json:46-51; topic: gate consolidation and pack verification; date: 2026-09-07]

## Publication correction — carried accurately

The plan retires the stale no-published-identity premise: 0.1.0 was subsequently published with license and provenance, the earlier 404 notes are historical, the 0.2.0 candidate is source/pack preparation only, no release tag is to be pushed, no consumer-upgrade claim is made, and publication remains an explicit later receipt. This matches the repository state this review could verify — the 0.1.0 release-handoff commit and the added LICENSE exist at this head, the manifest still reads 0.1.0/protocol 1 — and the registry listing itself is outside this review's reach and is not asserted by it.
[source: .llm/runs/connection-recovery--265/plan.md:15; packages/contracts/package.json:3, :23-25; topic: publication boundary; date: 2026-09-07]

## Bounded criteria (binding on implementation and its independent review)

The consolidation is faithful at design level; three accepted fixture-level details lost their explicit naming and are hereby pinned as the gates' meaning, alongside three standing interpretations:

1. The cold-HTTP test must include the accepted ordering fixture: a fetched generation deliberately far from the socket's (the reviewed hard case), so the subsequent lower-generation hello's acceptance is proved as a binding fact rather than a coincidence of numbers.
2. The `rejected` gate must retain the variant of an HTTP `unauthorized` answer routed through the command-refusal path, not only the raw rejected input kind.
[source: packages/contracts/src/client.ts:426-437; topic: auth refusal routing; date: 2026-09-07]
3. The glance stale-marker regression must assert all three accepted states: absent on a live bound fold that has applied a snapshot; present immediately after unbind while the board is still displayed; absent again once the new host's snapshot lands.
4. The internal `rebind` and bound helpers must not become root exports; the plan's inventory guard stands as written.
[source: .llm/runs/connection-recovery--265/plan.md:24; topic: helper enclosure; date: 2026-09-07]
5. The `boardStatus` doc block ships the non-inference and authorization paragraphs verbatim and unsoftened, including that a retained or synchronized board grants no display, persistence or command right.
6. The pack gate produces local tarball verification only — no tag, no registry push, no publication or consumer-adoption inference; release execution stays owner-gated per the plan's own DAG.
[source: .llm/runs/connection-recovery--265/plan.md:35, :41; topic: pack gate and release boundary; date: 2026-09-07]

## Boundaries and unverified

- All gates are planned, not run; no gate outcome is claimed by this review or by the plan. No product mutation exists at this head.
[source: .llm/runs/connection-recovery--265/plan.md:26; .llm/runs/connection-recovery--265/worklog.md:1; topic: gates not run; date: 2026-09-07]
- The registry publication of 0.1.0 is asserted by the plan and its cited published receipt; this review performed no network check and does not attest it. Downstream adaptation, OpenAPI and generated-client receipts remain open, and no behavioural compatibility pass is claimed.
[source: .llm/runs/connection-recovery--265/plan.md:15, :20, :40; topic: receipts open; date: 2026-09-07]
- Prior-run source verifications carry forward on the strength of the empty git diff named above; connection.ts, events.ts and server.ts were fully read in earlier rounds of this same session and re-cited here at their exact lines.
- No owner fork is outstanding: the prior conditional fork was closed by coordinator disposition under existing package policy, and RF-1 is repaired. Release execution is not authorized by the peer priority request and is not authorized by this PASS.
[source: .llm/runs/connection-recovery--265/plan.md:41; topic: no open fork, release gated; date: 2026-09-07]

## Disposition

PASS at `107281057ad399b0b1ba3a89a2f26d72ef4ffa54`. Implementation of the consolidated slice may proceed within `packages/contracts` under the plan's mutation inventory, subject to the six bounded criteria above, followed by exact-head independent implementation review, exact-head CI and the publication scan before reviewable merge. This is plan approval only — not implementation approval, not a compatibility pass, and not publication authorization.