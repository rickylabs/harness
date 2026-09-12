# Supervisor — `contract-alignment--e38`

Stage A. Who is working, on what baseline, and what may be written.

## Identity

| Field | Value |
|---|---|
| Run slug | `contract-alignment--e38` |
| Issue | [#287](https://github.com/rickylabs/harness/issues/287) — E3.8, contract alignment for UHP-hosted runs |
| Parent | [#33](https://github.com/rickylabs/harness/issues/33) (E3) |
| Dependencies, all merged | S10 [#288](https://github.com/rickylabs/harness/issues/288) (PR #292), S11 [#289](https://github.com/rickylabs/harness/issues/289) (PR #295), `provider-uhp` [#286](https://github.com/rickylabs/harness/issues/286) (PR #297) |
| Held release | [#283](https://github.com/rickylabs/harness/issues/283) — publication of `@rickylabs/harness-contracts` is the owner's call |
| Named consumer | `rickylabs/atelier-cockpit` #101 (D11.3), pinned at `@rickylabs/harness-contracts@0.3.0` and deliberately degraded |
| Blocked sibling, not claimed here | [#294](https://github.com/rickylabs/harness/issues/294) — the live HarnessRouter round-trip |
| Model | claude-opus-5 (Claude Opus 5), Claude Code agent seat |
| Session | https://claude.ai/code/session_01UEtNMWR86XhHXKuBZbmc8A |
| Host | Linux 6.18.34+ x86_64, Node v26.8.2, pnpm 11.25.0 |
| Date | 2026-09-12 |

## Baseline

Branched from **`origin/main`** at `c77191e3e3019b06b5b56f01cc69dfd5f5d6b68c`.

`packages/subagents/src` on that commit already carries `uhp-wire.ts`, `uhp-stream.ts`,
`uhp-lifecycle.ts`, `uhp-gate.ts`, `uhp-session.ts`, `uhp-provider.ts`, `uhp-harnesses.ts`,
`uhp-redact.ts`, `uhp-transport.ts` and `uhp-mock.ts`. Nothing in this run had to stack on an
unmerged branch.

| Fact | Value |
|---|---|
| Baseline commit | `c77191e3e3019b06b5b56f01cc69dfd5f5d6b68c` |
| Baseline branch | `origin/main` |
| Working branch | `feat/287-contract-alignment-uhp` |
| PR base | `main` |

## The version fact that the brief and the issue both state differently, read from the code

The brief and the issue comments describe `packages/contracts` as "a published package at 0.3.0 /
protocol 1". Read from the repository and from the registry, on this baseline:

| Fact | Value | Read from |
|---|---|---|
| Version in the tree | **0.4.0** | `packages/contracts/package.json:3` |
| Highest version on npm | **0.3.0** | `npm view @rickylabs/harness-contracts versions` → `[ '0.1.0', '0.2.0', '0.3.0' ]`, 2026-09-12 |
| Protocol | 1 | `packages/contracts/package.json` → `dsh.protocol` |

So 0.4.0 is an **unpublished, pending** release and 0.3.0 is what a consumer can actually install.
That matters for every determination in `verification.md`: a consumer's baseline is 0.3.0, and the
question "is this additive?" is asked against 0.3.0, not against the tree. It does not soften
anything — a break against 0.3.0 is still a break, and 0.4.0 has not shipped to absorb one.

No version number is changed by this run, in either direction, per the brief and per #283.

## Mutation surface

Declared. Anything found written outside this list is drift and is recorded in `drift.md`.

    packages/subagents/src/route.ts                 extended — the additive UHP arm and the dialect-keyed observed map
    packages/subagents/src/provider.ts              extended — SteerResult gains the route evidence DispatchResult already carries
    packages/subagents/src/uhp-provider.ts          extended — dispatch labels its dialect; steer publishes route evidence
    packages/subagents/src/index.ts                 extended — exports for the new type and predicate
    packages/subagents/src/route.uhp.test.ts        extended — the S10 tripwire, updated deliberately, plus the dialect rule
    packages/subagents/src/uhp-gate.test.ts         extended — UHP comparisons carry the UHP dialect
    packages/subagents/src/uhp-provider.test.ts     extended — steer route evidence, and its negative controls
    packages/subagents/src/uhp-redact.test.ts       extended — redaction over a null-sourced field
    packages/subagents/src/route.test.ts            extended — the codex dialect is unchanged, asserted
    packages/subagents/README.md                    extended — the dialect vocabulary
    .llm/runs/contract-alignment--e38/**            run artifacts

## Surfaces this run must not touch

- **`packages/contracts/src/repository-run-observation.ts`** — the observation surface. Work item 1
  is a **proposal**, not an edit, because all three of its required changes are breaking for a
  consumer. See `proposal-observation-surface-uhp.md` and `verification.md`.
- **Any `version` field, any `dsh.protocol` field, any tag, any publish.** #283 is the owner's.
- **`packages/routing`** — out of scope by the brief.
- **`packages/subagents/config/harnesses.v1.json`** — stays unreconciled, `reconciledAt: null`, with
  its placeholder ids. No id is invented here.
- **Any container runtime.** There is none on this host. Everything is tested against `uhp-mock.ts`.
- **Any claim about a live `HarnessRouter`.** That is #294 and it is blocked.

## Stage compression, and why it is permitted here

This run does not re-run Stages B–G from scratch. The design decision it implements was taken,
adversarially reviewed and owner-ratified upstream:

- Work item 3's decision is `.llm/runs/route-identity-uhp--s10/proposal-routesource-uhp.md` §3, with
  acceptance criteria in its §6. This run executes that, and re-derives only what it has to.
- Work item 2 is the proposal recorded on #287 by the `provider-uhp` run
  (`.llm/runs/provider-uhp--e37/worklog.md`, carried in a code comment at
  `packages/subagents/src/uhp-provider.ts`).
- Work item 1 is raised, not resolved: it is an owner fork in `verification.md` because it decides
  the shape of a published release.

Research that *was* done fresh in this run is cited inline in `verification.md` rather than in a
separate `research.md`, because every load-bearing claim is a repository read on this baseline.
