# Supervisor — `provider-uhp--e37`

Stage A. Who is working, on what baseline, and what may be written.

## Identity

| Field | Value |
|---|---|
| Run slug | `provider-uhp--e37` |
| Issue | [#286](https://github.com/rickylabs/harness/issues/286) — E3.7, `provider-uhp` over UHP `/v1/responses` |
| Parent | [#33](https://github.com/rickylabs/harness/issues/33) (E3) |
| Dependencies, both merged | S10 [#288](https://github.com/rickylabs/harness/issues/288) (PR #292), S11 [#289](https://github.com/rickylabs/harness/issues/289) (PR #295) |
| Sibling that carries the other half | [#294](https://github.com/rickylabs/harness/issues/294) — the live HarnessRouter round-trip |
| Model | claude-opus-5 (Claude Opus 5), Claude Code agent seat |
| Session | https://claude.ai/code/session_01UEtNMWR86XhHXKuBZbmc8A |
| Host | Linux 6.18.34+ x86_64, Node v26.8.2, pnpm 11.25.0 |
| Date | 2026-09-12 |

## Baseline

Branched from **`origin/main`** at `e8ff35f290aa9914887a979345a22e3bccbaa680`.

The brief stated both dependencies were on `main`. At the moment this run opened its worktree they
were not: PR #295 (S11) was still `OPEN` with `mergedAt: null`, and `packages/subagents/src` on the
then-current `origin/main` (`e6c5ddc`) held only `uhp-mock.ts`. It merged at `2026-09-12T14:38:10Z`
as `73ed1a0`, four minutes before this run's first read of it, and `origin/main` advanced to
`e8ff35f`. The branch is taken from the post-merge `origin/main`, so every module the brief says to
compose against is present. Recorded because a run that had started three minutes earlier would have
had to stack on an unmerged branch, and the difference is invisible in the finished diff.

| Fact | Value |
|---|---|
| Baseline commit | `e8ff35f290aa9914887a979345a22e3bccbaa680` |
| Baseline branch | `origin/main` |
| Working branch | `feat/286-provider-uhp` |
| PR base | `main` |

## Mutation surface

Declared. Anything found written outside this list is drift and is recorded in `drift.md`.

    packages/subagents/config/harnesses.v1.json    new — the pinned console manifest
    packages/subagents/src/uhp-harnesses.ts        new — manifest parsing and console drift
    packages/subagents/src/uhp-transport.ts        new — HTTP port; owns the credential, never the payload
    packages/subagents/src/uhp-redact.ts           new — the publication boundary and its fence
    packages/subagents/src/uhp-provider.ts         new — the SubagentProvider itself
    packages/subagents/src/uhp-harnesses.test.ts   new
    packages/subagents/src/uhp-redact.test.ts      new
    packages/subagents/src/uhp-provider.test.ts    new
    packages/subagents/src/uhp-gate.ts             extended — observeUhpRoute and its four readers move in
    packages/subagents/src/uhp-wire.ts             extended — Harness object, error envelope, version header
    packages/subagents/src/uhp-mock.ts             extended — path routing for harnesses, cancel and read-back
    packages/subagents/src/index.ts                extended — exports for the new modules
    packages/subagents/package.json                extended — ship and export the config directory
    packages/subagents/README.md                   extended — what the provider is and is not
    .llm/runs/provider-uhp--e37/**                 run artifacts

## Surfaces this run must not touch

- **`packages/contracts`** — published as `@rickylabs/harness-contracts`. A breaking change there is
  a proposal in these run notes, never an edit. This run needed none: nothing in the seam's published
  vocabulary changed.
- **`packages/routing`** — read only. `config/routing.v1.json` was read for the pinned-id convention;
  no file under it was written.
- **`packages/provider-codex/src/protocol.ts`** — read as prior art, and specifically as the refusal
  ladder this run must **not** copy (#286, requirement 2). Not edited.
- **A container runtime** — none started, none installed, none required. There is no docker daemon on
  this host and none can be created here. Every test runs against the in-tree mock over a loopback
  socket on an ephemeral port.
- **A live HarnessRouter** — not reached, not claimed. That is #294.

## Credentials

No credential is read, written, logged or embedded. `HARNESSROUTER_API_KEY` appears in this run only
as the **name of a credential profile**: `uhp-transport.ts` resolves it from the environment at call
time and attaches a bearer header; the dispatch payload the provider builds carries protocol fields
only. Neither the profile name nor any resolved value enters a request body, a `RunRef`, a verdict
detail or a fixture. `HARNESSROUTER_API_KEY` is unset on this host, which is the condition under which
the suite runs.
