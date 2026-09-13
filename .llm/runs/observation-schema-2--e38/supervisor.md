# Supervisor — `observation-schema-2--e38`

Stage A of [`doctrine/WORKFLOW.md`](../../../doctrine/WORKFLOW.md). Who is working, on what baseline,
and what this run may write.

## Identity

| Field | Value |
|---|---|
| Run slug | `observation-schema-2--e38` |
| Branch | `feat/300-observation-schema-2` |
| Issue | [#300](https://github.com/rickylabs/harness/issues/300) — E3.8a, the observation surface for UHP-hosted runs |
| Author model | Claude Opus 5, high effort |
| Session | https://claude.ai/code/session_01UEtNMWR86XhHXKuBZbmc8A |
| Host | Linux 6.18.34+, Node 26.8.1, pnpm workspace |
| Baseline | `08d0be5` (`origin/main`, `chore(board): publish`) |
| Date | 2026-09-13 |

The run is an **execution** run, not a design run: the owner ratified fork F1 before it started, so
Stages B through G were carried by [PR 299's
proposal](https://github.com/rickylabs/harness/pull/299) (`.llm/runs/contract-alignment--e38/proposal-observation-surface-uhp.md`)
and this run begins at Stage H. What is *not* pre-decided, and is decided here with its reasoning in
[`verification.md`](verification.md), is the protocol number, reader compatibility and the package
version.

## Authority

- **Owner decision, received 2026-09-13:** fork F1 **option 1** — widen in place on `schema: 2`, and
  bump. Option 2 (the additive schema-2 sibling) is explicitly not taken.
- **Owner ruling on [#283](https://github.com/rickylabs/harness/issues/283), 2026-09-12:** hold the
  0.4.0 publication until the S10 contracts are ready, so that the contract change "can ship inside
  one version bump rather than two".
- **Coordinator correction, received 2026-09-13 mid-run:** that ruling has been discharged. The owner
  authorized the 0.4.0 publication and the `harness-contracts-v0.4.0` tag is being pushed against
  `main` **as it stands, without this run's widening in it**. 0.4.0 therefore becomes an immutable
  published artifact carrying the connection-recovery change and nothing from this run. **The target
  for this run is 0.5.0.** See `verification.md` §4 for the full reasoning and the evidence trail.
- Proposal authority: `proposal-observation-surface-uhp.md`, §7 fork F1, on PR 299 (open, unmerged).

## Mutation surface

Paths this run may write:

    packages/contracts/package.json            version only: 0.4.0 -> 0.5.0
    packages/contracts/src/repository-run-observation.ts
    packages/contracts/src/repository-run-observation.test.ts
    packages/contracts/src/index.ts
    packages/contracts/test-fixtures/repository-run-observation/
    packages/contracts/README.md
    packages/telemetry/src/repository-run-observation.ts
    packages/telemetry/test-fixtures/run-observation/matrix.mjs
    packages/contracts/src/runs.ts                comment only, on coordinator instruction
    .llm/runs/observation-schema-2--e38/

`packages/contracts/package.json` is edited **only** on the `version` field. `dsh.protocol` stays `1`
— see `verification.md` §2 for why.

## Surfaces this run must not touch

| Surface | Why |
|---|---|
| `packages/routing` | Out of scope by the brief. |
| `packages/subagents/config/harnesses.v1.json` | Stays unreconciled, `reconciledAt: null`. No ids invented. |
| `.github/workflows/release-contracts.yml` | Arming a release is an owner action on #283. Read only. |
| Any git tag, `npm publish`, `npm version` | Publication is irreversible and is #283's decision. |
| Sibling repositories | `rickylabs/atelier-cockpit` is a consumer; this run writes nothing there. |
| `RunSource` in `packages/contracts/src/runs.ts` | Stays `claude \| codex \| opencode`; stays the billing seam. |

Anything found written outside the declared surface is drift and is recorded in `worklog.md`, not
quietly absorbed.

## Standing claims this run may not make

- No live `HarnessRouter` answered anything here. There is none on this host and no container
  runtime, and none was installed. Every UHP shape comes from the published specification and
  `packages/subagents/src/uhp-mock.ts`. The live round-trip is
  [#294](https://github.com/rickylabs/harness/issues/294) and is blocked.
- No claim that any server has been observed reporting an in-flight status to this repository.
- No claim about `rickylabs/atelier-cockpit`'s code beyond what #287 and #300 state; that repository
  was not read during this run.
