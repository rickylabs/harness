# architecture-foundation--seed

The founding architecture run for `rickylabs/harness`.

**Objective.** Produce the architectural foundation for a standalone agentic harness and
toolchain product, built on NetScript, that lets any TypeScript project adopt the harness
mechanism proven across three unrelated codebases.

**Planning only.** No product code. No mutation of sibling repositories.

---

## Reading order

| Order | File | Why |
|---|---|---|
| 1 | [`context-pack.md`](context-pack.md) | Resumes the run cold. Start here, always. |
| 2 | [`supervisor.md`](supervisor.md) | Identity, baseline, mutation surface, pinned sources |
| 3 | [`research.md`](research.md) | Stage B corpus. §6 is the decision everything depends on. |
| 4 | [`drift.md`](drift.md) | Deviations and their dispositions |
| 5 | [`worklog.md`](worklog.md) | How it got here |

## State

Stage **A complete**, Stage **B partial**. Stages C–H not started.

**Mutation of the world is blocked.** Stage G has not run.

## The question this run exists to answer first

Who owns run state — git, or the daemon?

The two live implementations disagree. `autocorner/website` PR #14 logged the disagreement as
accepted drift rather than resolving it. Every control-plane question follows from it: what the
dashboard reads, whether a phone can observe a run on a machine it cannot clone, what resume
means, whether two machines can advance the same run.

`research.md` §6 states three candidate positions without preference. Stage E locks it as D-1.

Nothing about the dashboard should be designed before then.
