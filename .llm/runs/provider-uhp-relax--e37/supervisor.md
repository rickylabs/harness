# Supervisor — `provider-uhp-relax--e37`

Stage A. Who is working, on what baseline, and what may be written.

## Identity

| Field | Value |
|---|---|
| Run slug | `provider-uhp-relax--e37` |
| Branch | `feat/286-provider-uhp-relax` |
| Model | Claude Opus 5 (`claude-opus-5`), agent mode, Claude Code |
| Host | Linux worktree `.claude/worktrees/agent-abab4f80bbbeba3c7`, Node v26.8.2, pnpm 11.25.0 |
| Baseline commit | `c77191e3e3019b06b5b56f01cc69dfd5f5d6b68c` (`origin/main`) |
| Date | 2026-09-12 |
| Issue | [#286](https://github.com/rickylabs/harness/issues/286), under E3 (#33) |

## What this run is

Two **already-decided** changes to `provider-uhp`, both recorded on #286 as owner decisions of
2026-09-12. This run implements and proves them. It is not a design run: nothing here re-opens
either decision, and the two questions #286 leaves open are left open.

1. **The owner risk ruling — unattested effort is not blocking.** A route whose `model` was
   reported and agreed may be `accepted` even though `provider`, `effort` and `cwd` are
   unreported over UHP. A contradiction in the mismatch set still refuses, unchanged and still
   checked first. `model` itself unreported, or evidence that cannot be correlated at all,
   still yields `unknown`.
2. **The owner decision — narrow the drift refusal to the harness being dispatched to.** Drift
   on an unrelated pinned row no longer refuses an unrelated dispatch; it stays visible as a
   distinct non-blocking signal. `listing-unreadable` still blocks everything. The
   manifest-wide check stays available for reconciliation and audit.

## Declared mutation surface

    packages/subagents/src/uhp-gate.ts
    packages/subagents/src/uhp-gate.test.ts
    packages/subagents/src/uhp-harnesses.ts
    packages/subagents/src/uhp-harnesses.test.ts
    packages/subagents/src/uhp-provider.ts
    packages/subagents/src/uhp-provider.test.ts
    packages/subagents/src/index.ts            (re-exports only)
    .llm/runs/provider-uhp-relax--e37/**

## Surfaces this run must not touch, and why

- **`packages/subagents/config/harnesses.v1.json`** — ships with `reconciledAt: null` and
  placeholder ids. Every dispatch through it refuses, correctly, until a reachable deployment
  exists to pin real ids from (#294). `reconciledAt` is the only field in the file that claims
  anything about a server; inventing ids or a timestamp would be fabricating that claim.
- **`packages/contracts`** — published. Anything wanted there is a proposal in `worklog.md`.
- **`packages/routing`** — out of scope by the brief.
- **No container runtime.** None is reachable on this host and none is started. Every test runs
  against `uhp-mock.ts` over a loopback socket. Nothing in this run is evidence about a live
  HarnessRouter.

## Standing constraints inherited

Citation bar and no-silent-owner-decisions, per `AGENTS.md`. The two open forks on #286 — whether
the verdict vocabulary gains a distinct *identified but unattested* state, and what a
non-certifying lane may do — are **not** resolved here. The gate gains an internal grade that can
*state* the distinction and a detail string that shows it; `DispatchVerdict` is not widened.
