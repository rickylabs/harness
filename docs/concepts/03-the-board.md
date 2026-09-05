# The board

**GitHub holds board truth. `dsh` projects it.** That is ratified decision 3 on the
[roadmap](https://github.com/rickylabs/harness/issues/30), and almost everything else about the
board follows from it.

## The problem it is answering

The complaint that started this project was not "we need a task tracker". It was:

> I'm constantly spamming "status ?" to my orchestrator because I have zero visibility across the
> board.

Which is a specific failure, not a general wish. Agents were working. Work was landing. But the only
way to find out *where* anything stood was to interrupt the thing doing it and ask — and asking an
agent for its own status gets you an agent's account of itself, mid-task, from memory.

So the requirement is: state that can be read **without waking anything up**. Everything below is in
service of that one sentence.

## Why GitHub, rather than a database

The obvious build is a task store with a schema, and the reason not to build it is the sync problem.
The moment there are two places a task's state can live, there is a window in which they disagree,
and no amount of care closes it — it only makes the disagreement rarer and therefore more surprising
when it happens.

Choosing GitHub is choosing to have no second copy. It also comes with things a fresh store would
have to earn:

- **Agents can already write to it.** Claude Code, Codex and opencode all arrive holding a GitHub
  credential. A new store means a new integration for every agent, forever.
- **Humans already have the UI.** The board is readable from a phone in a queue, and nobody has to
  be taught it.
- **The state and the argument sit together.** An issue carries the conversation that produced the
  decision. A row in a task table carries a status.
- **The audit trail is somebody else's problem.** Who moved what, when, is already recorded.

The cost is real and worth stating: GitHub labels are a weak type system, the API is rate-limited,
and anyone with write access can put the board into a state that means nothing. The rest of this
page is how those are absorbed rather than denied.

## A column is a label

The lifecycle is a set of `status:` labels — the ten phases are listed in the
[root README](../../README.md#github-is-the-board-dsh-projects-it), and the rules an agent must
follow are generated into
[`.claude/skills/board-process/SKILL.md`](../../.claude/skills/board-process/SKILL.md) from the
taxonomy actually installed in the repository, not from a document somebody kept up to date.

Two properties matter more than the list:

**Exactly one at a time.** Two status labels is not "it is in both columns" — it is a contradiction,
and [`packages/board/src/project.ts`](../../packages/board/src/project.ts) reports it as one. Work
that is simultaneously `impl` and `ready-merge` is work whose real state nobody knows.

**Gates are not phases.** `status:close-gate-override` looks like a status label and is not one; it
is a gate, and it modifies what may happen rather than saying where the work is. Keeping the two
kinds in one prefix would make the "exactly one" rule unstateable.

Lanes (`topic:`), epics (`epic:`) and areas (`area:`) are separate axes on the same item. An item has
one column and any number of the others.

## Anomalies are output, not errors

A shared, mutable surface that both humans and agents write to concurrently *will* contradict itself.
Treating that as an exceptional condition — something to log and move past — is what lets a board
quietly stop being true.

So `dsh-board` names each contradiction, gives it a stable kind, and exits non-zero when any are
present. An epic closed while its children are open; an item that is closed but never marked
shipped; a closing keyword pointed at an epic; a fetch that came back incomplete. Each is a sentence
about a specific item number, which is the difference between a check you act on and a check you
learn to ignore. [`packages/board/README.md`](../../packages/board/README.md) owns the mechanics —
that the projection is pure, that the lifecycle is configuration rather than code, and what each
kind means.

The design property worth naming here: **an incomplete read is an anomaly, not a smaller board.**
A projection that silently drops what it could not fetch reports a clean board for a repository it
only half saw, and that is the one failure mode a status tool must never have.

## Where the board stops

The board says where work *is*. It cannot say what is *happening* — an item can sit in `impl` for a
day whether three agents are hammering it or nothing has been running since Tuesday. That question
belongs to telemetry, and to the other meaning of the word "run":
[04 — What "run" means](04-the-run.md).

## Installing it elsewhere

None of the above is specific to this repository. The taxonomy, the skill and the workflow files are
what [`forge`](../../packages/forge) writes into any repository — `dsh-forge init` — which is the
board process becoming portable rather than a thing this project has and describes.

---

Next: [04 — What "run" means](04-the-run.md) · Back to [docs](../README.md)
