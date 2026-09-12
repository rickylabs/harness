# Supervisor — `uhp-stream-adapter--s11`

Stage A. Who is working, on what baseline, and what may be written.

## Identity

| Field | Value |
|---|---|
| Run slug | `uhp-stream-adapter--s11` |
| Issue | [#289](https://github.com/rickylabs/harness/issues/289) — Spike S11, the buildable half |
| Parent | #286 (provider-uhp), itself under E3 #33 |
| Sibling that carries the other half | #294 — the live HarnessRouter round-trip gate |
| Model | claude-opus-5 (Claude Opus 5), Claude Code agent seat |
| Session | https://claude.ai/code/session_01UEtNMWR86XhHXKuBZbmc8A |
| Host | `ai-agents`, Linux 6.18.34+, Node v26.8.2, pnpm 11.25.0 |
| Date | 2026-09-12 |

## Baseline

Branched from **`origin/chore/route-identity-uhp--s10`** at `a382171`, *not* from `main`.

That is deliberate and it is a stack. S10 ships `packages/subagents/src/uhp-mock.ts` — the UHP
wire types, SSE codec, fixture set and loopback server this run extends — and it is unmerged
because it awaits an independent non-Claude evaluator. `main` does not carry it. The pull request
for this run is therefore based on `chore/route-identity-uhp--s10`; when S10 merges, GitHub
retargets it to `main`.

| Fact | Value |
|---|---|
| Baseline commit | `a38217172865176f9971f244c56a9a589a735cc6` |
| Baseline branch | `origin/chore/route-identity-uhp--s10` |
| Working branch | `feat/uhp-stream-adapter--s11` |
| PR base | `chore/route-identity-uhp--s10` |

## Mutation surface

Declared. Anything found written outside this list is drift and is recorded in `drift.md`.

    packages/subagents/src/uhp-wire.ts          new — the wire contract, types only
    packages/subagents/src/uhp-stream.ts        new — SSE consumption and freshness
    packages/subagents/src/uhp-lifecycle.ts     new — lifecycle to RunLiveness
    packages/subagents/src/uhp-gate.ts          new — the substitution gate
    packages/subagents/src/uhp-session.ts       new — multi-turn continuation, keyed on runId
    packages/subagents/src/uhp-stream.test.ts   new
    packages/subagents/src/uhp-lifecycle.test.ts new
    packages/subagents/src/uhp-gate.test.ts     new
    packages/subagents/src/uhp-session.test.ts  new
    packages/subagents/src/uhp-mock.ts          extended — fixtures, frames, session mock
    packages/subagents/src/index.ts             extended — exports for the new modules
    packages/subagents/README.md                extended — what the adapter is and is not
    .llm/runs/uhp-stream-adapter--s11/**        run artifacts

## Surfaces this run must not touch

- **`packages/contracts`** — published as `@rickylabs/harness-contracts`. A breaking change there
  is a proposal in `proposal-*.md`, never an edit. This run needed none.
- **`packages/provider-uhp`** — does not exist and is not created here. That is #286 and it
  depends on this work.
- **`packages/provider-codex/src/protocol.ts`** — read as prior art, and specifically as the
  refusal ladder this run must *not* copy (#289 fail-closed requirement C). Not edited: the
  ladder is correct for the codex dialect, where all four route fields are observable.
- **`packages/telemetry`** — owns `LivenessVerdict` and the `claimsRunning` join. This run
  computes UHP freshness from timestamps and deliberately stops short of that join.
- Any sibling repository. `rickylabs/atelier-cockpit` is cited, never written.
- Any container runtime. There is no docker daemon on this host, none is started, and nothing
  here requires one.

## Standing constraints inherited

1. **Citation bar.** Every load-bearing protocol claim carries a URL retrieved during this run or
   a repository path with line reference. Retrievals are listed in `research.md`.
2. **No silent owner decisions.** Anything that turns on what the owner wants is a numbered fork,
   not a choice made in passing. This run raised one (F1, in `worklog.md`) and did not act on it.
3. **No credentials, no secrets.** This repository is public. The mock never reads an
   `Authorization` header and no fixture contains one.
4. **Nothing about a live router is claimed.** `verification.md` is split into what the mock
   proved and what only #294 can prove, and the second list is not empty.
