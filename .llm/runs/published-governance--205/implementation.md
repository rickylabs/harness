# Published governance read — implementation

**Repair update:** CI `34170219400` exposed a tracked-file verification gap after the historical
source/review below. Snapshot guard repair `459afc6` pins the exact seven fixture paths and byte
digests; see [verification.md](verification.md) and [drift.md](drift.md) D-9. No contracts/telemetry
semantics or fixture bytes changed. Independent review of this repair remains coordinator-owned.

Implemented the reviewed standalone read slice in **`e6c14d9`**, on receipt head `89933b6`.
The evaluated authority is `01c523e894270700a8765d1bb0371cdaa7c0f1b8`, governed by
[plan-eval.md](plan-eval.md) and [coordinator-amendment.md](coordinator-amendment.md).
The independent plan verdict is PASS; this document does **not** claim an independent implementation
verdict. Implementation-session attribution: 2026-09-08 (the task/run date, not an exact wall-clock
ordering receipt).

## Result

The one-shot producer is `dsh-telemetry governance --observations-from <absolute-descriptor-path>`.
Its versioned typed source coverage, envelope/state and recorded refusals are consumed by the public
root `readGovernanceSnapshot` export from a packed, offline-installed contracts **0.2.0 candidate**.
Exits 0/3 emit one JSON document; exit 1 emits no document; invalid usage is refused before collection.
No transcript scan occurs on this command. The decoder clones schema fields into independent data,
checks shape/code/calendar/numeric/temporal consistency, and contains inspection exceptions.
[source: ../../../packages/telemetry/src/cli.ts:479;
../../../packages/telemetry/src/governance/read.ts:5;
../../../packages/contracts/src/governance-read.ts:81,413;
../../../scripts/check-installed-contracts.mjs:83,100,144]

## Binding implementation map

| Binding | Implementation and verification |
| --- | --- |
| BI-1 | Read coverage includes reader/scope provenance and original meter interval; admission collection time is separate from decision time. `compose.ts:17,54,65`; decoder `governance-read.ts:367,380`; producer `read.test.ts:55`; installed script `:160` |
| BI-2 | Existing `ok` behavior is retained, including empty-log incomplete and complete-with-admissions-unconfigured. Decoder rejects complete failed/discarded/dropped evidence. `compose.ts:60,69`; `admissions.ts:97`; decoder `:475`; CLI tests `:1012` |
| BI-3 | Real calendar and finite numeric checks; fresh/stale against evaluated clock; leaf/source/envelope pairing and earliest retained expiry. Decoder `:124,141,357,449`; decoder tests `:48`; producer tests `read.test.ts:55,108` |
| BI-4 | Available documents require nonempty read leaves and empty noted unread regimes. Unavailable envelope retains source coverage but withholds state and admissions. Decoder `:444,457`; fixture `admissions-only.json`; tests `read.test.ts:108` |
| BI-5 | Seven committed synthetic outcome fixtures in `packages/contracts/test-fixtures/governance-read/`; all decode and byte-lock against the projection (`read.test.ts:44`). Real CLI stdout also byte-locks mixed-timeout and all-unconfigured (`cli.test.ts:982,1012`) |
| BI-6 | Pure portable decoder, data-descriptor inspection, strict key sets, collection caps, independent output, contained throws with no arbitrary error/key/value reflection. Decoder `:75,81,93,413`; negatives `governance-read.test.ts:13,83,92,100`; README documents Proxy limits |
| BI-7 | `check:installed` is chained after recursive root tests, with no workflow edit. Offline-only isolated npm config/cache, temp/child cleanup and actual sleeping probe. Root `package.json:27,32`; script `:21,41,64,83,120` |
| BI-8 | Real installed root/server runtime imports and strict compiled consumer declarations, including negative type assertions, version/protocol and SHA-256 receipt. Script `:88,91,100,181`; [verification.md](verification.md) |
| BI-9 | Projection invokes the public decoder before serialization; over-cap composed evidence refuses without truncation. `read.ts:20`; `read.test.ts:103`; actual command exit-1/no-stdout test `cli.test.ts:1041` |
| BI-10 | Dated attribution and historical clock caveat in worklog; research correction recorded below; public-safe launch evidence retained and run links resolved relative to this directory |

Paths abbreviated in the table: decoder files are under `packages/contracts/src/`; producer files
under `packages/telemetry/src/governance/`; CLI files under `packages/telemetry/src/`; script is
`scripts/check-installed-contracts.mjs`. References identify code/tests in implementation `e6c14d9`.

The research phrase “reachable solely as a field of RemoteSnapshot” described the missing runtime
read path. Governance types already exist as direct root imports; this implementation adds the
standalone document and decoder, not the first type export.
[source: ../../../packages/contracts/src/index.ts:117,256; plan-eval.md:117]

## Boundaries and launch

The supplied sanitized [implementation-identity.json](implementation-identity.json) records native
`gpt-6-astra`, provider `openai`, effort `low`, matched to the requested route and owned worktree,
validated **before** the initial turn. The coordinator supplied this after the initial no-mutation
stop. [matrix-implementation.json](matrix-implementation.json) and the fresh resumed
[matrix-implementation-resume.json](matrix-implementation-resume.json) are retained. No agents,
evaluators, network providers, live host acceptance, sibling mutations, board actions, push, PR,
merge, tag or publication were performed by this implementation session.

Product mutations are limited to the reviewed inventory. A `ComposedGovernance` subtype carries
coverage through the existing collector without modifying the legacy observation type file. New
composer assertions live in the new `governance/read.test.ts` alongside the fixture round-trip tests;
existing `compose.test.ts` still runs unchanged. No type/dependency-file expansion was needed.
Protocol 1, RemoteSnapshot, events, fold, hub, server/client implementation and dsh-app are unchanged.
The root lockfile was not staged. [drift.md](drift.md) records evaluator corrections and the executable
temporary-filesystem constraint; [verification.md](verification.md) contains actual gate receipts.
