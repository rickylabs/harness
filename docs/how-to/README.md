# How-to guides

*I know what I want. What are the steps?*

A how-to is written for someone who already has a goal and needs the shortest correct path to it. It
assumes competence, states prerequisites once, and stops when the goal is reached. It is not a
tutorial — nobody is being taught here — and it is not reference, because it covers one path rather
than every option.

**One guide exists so far.** The rest of the table below is honest about where its material actually
lives today — package READMEs, which are the deepest documents in the repository — rather than
indexing pages that do not exist.

## Guides

- **[Install the board process into an existing repository](install-the-board-process.md)** — take
  the label taxonomy and the agent-facing skill into a repository that is not this one, without
  taking that repository over.

## What else belongs here

Tasks a person actually performs, each with a real starting condition:

| Guide | Where the material is today |
| --- | --- |
| Regenerate the board skill after changing the taxonomy | [`packages/forge`](../../packages/forge) — `pnpm run skill:install` |
| Eject labels and review the diff | [`packages/forge`](../../packages/forge) — `dsh-forge labels eject` |
| Re-bless the composed-profile snapshot | [`packages/dsh-app`](../../packages/dsh-app) — `pnpm run golden:bless` |
| Find out what an agent did after it exited | [`packages/telemetry`](../../packages/telemetry) — `dsh-telemetry why` |
| Deploy the stack | [`deploy/`](../../deploy) |
| Add a package to the workspace | [`packages/README.md`](../../packages/README.md) |

## What does not belong here

- **Why the design is this way** → [`concepts/`](../concepts/).
- **Every flag of every command** → [`reference/`](../reference/), which is generated.
- **How work is staged and reviewed** → [`doctrine/`](../../doctrine/). The method is portable and
  deliberately lives outside `docs/`.

## Writing one

Title it with the goal, in the reader's words: *Install the board process into an existing
repository*, not *Using forge*. Open with what must already be true. Number the steps. Show the
command and what a correct result looks like, so a reader can tell whether it worked without asking.
Link outward for anything owned elsewhere rather than restating it — the
[rule these docs are held to](../README.md#the-rule-these-docs-are-held-to) applies here as much as
anywhere.

---

Back to [docs](../README.md)
