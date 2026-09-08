# implementation-eval — connection-recovery--265

**Verdict: PASS at `a72f82020dcaf47116c4b76d2a357bb442b7a2f1`. No product defects found. No owner decisions invented.**

Combined delivery is clean: worker commit `a749aca` (contracts implementation + worker evidence) plus coordinator commit `a72f820` (installed-gate maintenance + gate evidence). Product diff against `d283af8` is exactly seven files: `packages/contracts/src/fold.ts`, `src/client.ts`, `src/index.ts`, `src/client.test.ts`, `README.md`, `package.json`, `scripts/check-installed-contracts.mjs`. No wire-shape, connection/server/events, other-package, workflow, tag, or lock change. Candidate is local `0.4.0`, protocol `1`, pack proof only — not publication or adoption.

[source: git rev-parse HEAD and diff d283af8..HEAD; topic: reviewed head and product surface; date: 2026-09-08]
[source: packages/contracts/package.json:2, :23-25; topic: candidate identity; date: 2026-09-08]

## Identity and independence

- Evaluator is a separate session from the generator. Generator route per run matrix is Astra/OpenAI family; this evaluator is a third family with no authorship overlap.
[source: .llm/runs/connection-recovery--265/matrix-implementation.json:10; topic: generator route; date: 2026-09-08]
- The fresh CLI route file named in the brief (`matrix-impl-eval-launch.json`) was not present in the worktree at review time, so route selection from that file is unverified and nothing here relies on it. Independence holds by session separation, not by that file.
- Governing design: independent Stage G PASS with six binding criteria, plus the published-baseline amendment moving the proposal to `0.4.0` over published `0.3.0` with protocol unchanged.
[source: .llm/runs/connection-recovery--265/plan-eval.md:3, :57-69; topic: binding criteria; date: 2026-09-07]
[source: .llm/runs/connection-recovery--265/baseline-amendment.md:3, :8, :12-15; topic: candidate identity and unchanged gates; date: 2026-09-08]

## Six binding criteria — all met

1. **Far-apart cold-HTTP ordering fixture.** Cold answers carry generation `900000` while the socket binds `1`; the lower hello is then accepted as a binding fact. Present in the phase matrix and the packed probe.
[source: packages/contracts/src/client.test.ts:695, :713-717; topic: cold far-apart generations; date: 2026-09-08]
2. **Actual HTTP unauthorized refusal.** A loopback server answers `401`; the decoded body drives the normal answered-dispatch refusal path, which stops the loop and unbinds while retaining the board — not only the raw `rejected` input kind.
[source: packages/contracts/src/client.test.ts:751, :758-780; topic: auth refusal routing; date: 2026-09-08]
3. **Three-phase glance marker.** Absent on a live bound fold with a snapshot, present immediately after unbind while the board displays, absent again after the new host snapshot.
[source: packages/contracts/src/client.ts:334; topic: stale marker; date: 2026-09-08]
[source: packages/contracts/src/client.test.ts:616, :619-635; topic: three-phase assertions; date: 2026-09-08]
4. **Helper enclosure.** Root exports only the public status query; `isBound`/`rebind`/`boundTo`/`openHub` are absent at root, with runtime and compile negatives.
[source: packages/contracts/src/index.ts:181-193, :233-238; topic: closed root surface; date: 2026-09-08]
[source: packages/contracts/src/client.test.ts:876; topic: export negatives; date: 2026-09-08]
5. **Non-inference and authorization text verbatim.** The `boardStatus` doc block carries the accepted five non-inferences plus the no-display/persistence/command-right and revocation paragraphs unsoftened; README mirrors them.
[source: packages/contracts/src/client.ts:299-310; topic: query contract; date: 2026-09-08]
[source: .llm/runs/connection-recovery--265/query-documentation.md:5-12; topic: required wording; date: 2026-09-08]
[source: packages/contracts/README.md:140-150; topic: public mirror; date: 2026-09-08]
6. **Local pack gate only.** Offline pack/install probes with digest receipts; no `0.4.0` tag exists, no registry push, no upgrade or adoption claim.
[source: .llm/runs/connection-recovery--265/packed-recovery-receipt.json:7-9; topic: local tarball proof; date: 2026-09-08]

## Real correctness — verified against code, not checklists

- **Immediate loss unbind, clocks/counters retained.** `drive` rebinds on every `connect` command and on accepted live-to-non-live transitions only; `rebind` clears `bound`/`lastSeq`, sets `needsResync`, keeps board, source clocks, tasks, runs and counts by reference. Dropped/rejected/stop matrix asserts retention; late frames on the lost link are fenced before retry.
[source: packages/contracts/src/client.ts:518-528; topic: rebind sites; date: 2026-09-08]
[source: packages/contracts/src/client.test.ts:594, :600-612; topic: loss matrix; date: 2026-09-08]
- **Lower/same-generation rule.** Unbound current-link hello may accept a lower generation after restart; once bound, equal/lower hellos discard without mutation. Same-generation new-link recovery binds and synchronizes only after the snapshot.
[source: packages/contracts/src/fold.ts:453-459, :460-470; topic: two-half binding; date: 2026-09-08]
[source: packages/contracts/src/client.test.ts:616, :638-645, :904; topic: restart and same-generation gates; date: 2026-09-08]
- **Old-link and pre-hello fencing.** `acceptsFrom` runs before the fold; old-link frames, opens and drops leave fold and counters identical. Unbound non-hello frames (snapshot, delta, unknown, payload-invalid) discard and increment only `discarded`; invalid-hello protocol mismatch refuses without binding.
[source: packages/contracts/src/client.ts:348-354; topic: link fence; date: 2026-09-08]
[source: packages/contracts/src/fold.ts:322-324, :350-359; topic: pre-hello gates; date: 2026-09-08]
[source: packages/contracts/src/client.test.ts:648, :666-669, :672; topic: fencing gates; date: 2026-09-08]
- **Hello alone never synchronizes.** `boardStatus` requires present board, live loop, non-null matching loop generation, bound fold and no pending resync; hello sets `needsResync` so status stays `retained` until a valid snapshot lands. Mismatched-generation snapshots cannot contaminate; replayed snapshots cannot clear pending resync; malformed envelopes refuse with board untouched.
[source: packages/contracts/src/client.ts:312-319; topic: status predicate; date: 2026-09-08]
[source: packages/contracts/src/client.test.ts:814, :886; topic: status exhaustiveness and replay gates; date: 2026-09-08]
- **HTTP races and refusal semantics.** Cold answers are taken only outside live; answers racing a live stream (before-hello taken unbound, after-hello and after-snapshot discarded) preserve synchronization. Actual `401` unbinds; ordinary HTTP/network failures leave a healthy synchronized fold and loop untouched. Unknown in-flight effects are retained across recovery and never resent; no second projection is stored.
[source: packages/contracts/src/client.ts:398-412, :452-463; topic: cold take, live discard, refusal; date: 2026-09-08]
[source: packages/contracts/src/client.test.ts:723, :751, :795, :904; topic: race, refusal, non-demotion, no-resend gates; date: 2026-09-08]
- **Legacy encoding, sentinel, hub refusal.** Optional `bound` with `bound ?? (generation !== null)` fallback; new empty folds explicit `false`; cold folds unbound with original timestamps. Unbound `resyncFrame` returns generation `0` with hub-never-assigns-`0` docs; mismatched resync closes the link with no recovery delivery. Legacy no-`bound` values compile and preserve hello/event/count behavior plus inherited-connect clearing.
[source: packages/contracts/src/fold.ts:79-84, :121-140, :149-164, :166-179; topic: encoding and sentinel; date: 2026-09-08]
[source: packages/contracts/src/server.ts:124-136, :237-252; topic: hub generations and mismatch close; date: 2026-09-08]
[source: packages/contracts/src/client.test.ts:841, :860, :922; topic: legacy, sentinel, inherited-connect gates; date: 2026-09-08]
- **Independent semantics, no downstream claims.** Status says only which stream last sent the board; completeness, recency, execution, certification and command admission stay separate dimensions. Retained/synchronized grants no rights; revocation overrides retention. Unknown outcomes are never auto-resent.
[source: packages/contracts/README.md:117-155; topic: public recovery contract; date: 2026-09-08]

## Pack/install and gate maintenance — no weakening

- The coordinator edit reads the source manifest and requires pack metadata and installed version to equal it, keeping protocol `1`, offline install, runtime/declaration checks, privacy scans, all fixtures and child cleanup unchanged. The diff is five added lines and two assertion swaps, nothing else.
[source: scripts/check-installed-contracts.mjs:72-79, :93; topic: manifest-driven version checks; date: 2026-09-08]
[source: .llm/runs/connection-recovery--265/coordinator-gate-amendment.md:3-5, :12; topic: gate ownership and scope; date: 2026-09-08]
- The original root-test FAIL (exit 1 at the pinned `0.3.0` assertions, all package suites passed) is preserved as history, not rewritten; the maintained combined-tree run passes.
[source: .llm/runs/connection-recovery--265/final-gates.json:17-19, :119-127; topic: historical FAIL; date: 2026-09-08]
[source: .llm/runs/connection-recovery--265/amended-gates.json:2-8, :115-122; topic: maintained PASS; date: 2026-09-08]
[source: .llm/runs/connection-recovery--265/drift.md:21-26; topic: gate disposition; date: 2026-09-08]

## Actual checks executed by this evaluator (summaries only)

All commands ran with an executable scratch directory and empty package-manager configuration; no live dispatch, provider calls, or release operations. Raw logs stay outside the repository.

| Check | Result |
|---|---|
| Contracts suite | PASS, 213/213, 0 fail |
| Workspace typecheck | PASS, exit 0 |
| Publish shape | PASS, 0.4.0, protocol 1, 78 files |
| Installed gate at reviewed head | PASS, 108 run-observation + 2 governance fixtures, tarball digest matches worker receipt |
| Packed recovery probe | PASS, same tarball digest, installed/source byte equality, runtime and declaration negatives |
| Independent probes: legacy/sentinel, binding invariant, hub sentinel close, root closure, unauthorized refusal, gap/replay/mismatch/malformed/stale, non-demotion/no-resend | All PASS against built output |
| Source hashes for the six product files | Match worker `source-verification.json` |
| Gate script hash | Matches amended receipt; no `0.4.0` tag exists |
| Whitespace check over the delivery diff | PASS |

## Limitations (unverified, not defects)

Node 24 execution, exact-head CI, registry publication, downstream API/client adaptation, backend authorization implementation, live-source acceptance and consumer adoption remain outside this review, as the run itself states.
[source: .llm/runs/connection-recovery--265/verification.md:136-140; topic: review boundary; date: 2026-09-08]

## Disposition

PASS. The implementation faithfully executes the approved plan under all six binding criteria, the coordinator gate maintenance is narrow and honest, and the historical FAIL is preserved. No defects to return. Merge readiness additionally needs exact-head CI and the publication scan per the plan DAG.
[source: .llm/runs/connection-recovery--265/plan.md:35-36, :42; topic: gates before merge; date: 2026-09-07]
