# harness

**The deterministic coordinator layer for an agent fleet.** A monorepo of
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugins that turn a
GitHub repository into a board, decide what may run next, and tell you what the fleet did —
without waking an agent to ask.

> **Scope.** This repository is the `dsh` plugin layer, the doctrine those plugins encode, and the
> run artifacts they produce. Nothing else. The cockpits that consume it live in
> `rickylabs/netscript` and reach this layer over a published contract package
> ([decision 4](#ratified-decisions)).
>
> **Status** lives on the board, not in this file: the
> [E0 roadmap](https://github.com/rickylabs/harness/issues/30) is what is built and what is not.

📖 [**Documentation**](docs/) — concepts, how-to, reference and a
[glossary](docs/glossary.md). This file is the front door; `docs/` is the house.

---

## What runs today

Five command-line tools. Each one answers a question you would otherwise have to ask an agent.

| Command | Package | The question it answers |
| --- | --- | --- |
| `dsh-board` | [`board`](packages/board) | What is on the board right now — and does it contradict itself? |
| `dsh-coordinator` | [`coordinator`](packages/coordinator) | May this step run? Who is allowed to review it? What changed since last time? |
| `dsh-telemetry` | [`telemetry`](packages/telemetry) | What did the fleet actually do — read from disk, with nothing awake? |
| `dsh-forge` | [`forge`](packages/forge) | Install this board process into any repository. |
| `dsh-profile` | [`dsh-app`](packages/dsh-app) | Compose every plugin into one `dsh` profile. |

They are deliberately separate binaries rather than subcommands of one. Each reads a different
source of truth — the GitHub API, a state file on stdin, a log directory on disk, the repository
you are standing in — and a tool that fails should fail for one reason you can name.

## Quickstart

Node 24 or newer, and [pnpm](https://pnpm.io) 11.

```bash
pnpm install
pnpm run build
```

Then, from the repository root:

```bash
node packages/coordinator/dist/cli.js policies
```

That one needs nothing but the build — it prints the independence rules that decide who may review
whose work. The next three read the world:

```bash
node packages/board/dist/cli.js columns       # the kanban view of this repository
node packages/forge/dist/cli.js doctor        # what this repo and this environment support
node packages/telemetry/dist/cli.js where     # where run evidence is written, and what to read first
```

`dsh-board` and `dsh-forge` reach GitHub through the [`gh`](https://cli.github.com) CLI or a
`GITHUB_TOKEN`; both exit **3** and say so when neither is available, rather than printing an empty
board. `dsh-telemetry` reads local directories and needs no network at all.

<details>
<summary>Why <code>node packages/…/dist/cli.js</code> and not the bare command name</summary>

Every package here except `contracts` is `private: true`, so pnpm links their bins where a
*dependent* resolves them — not at the repository root. Running the built entry point directly is
the honest invocation from a fresh clone, and it is what the repository's own scripts do (see
`skill:install` in the root `package.json`). Installing the profile with `dsh-profile install` is
what puts them somewhere a `dsh` process can find them; that path is described in
[`deploy/`](deploy/README.md).

</details>

### Install the board process into another repository

`dsh-forge` is the part that works outside this repository. Point it at any repo and it writes the
label taxonomy, the lifecycle, and the skill that teaches an agent to move work through them:

```bash
node packages/forge/dist/cli.js init --repo owner/name
```

`init` is `labels eject` + `labels apply` + `skill install`, in that order. It **never deletes a
label** — a deleted label takes the record of everything that carried it. Where the ejected file
and the live repository disagree, it reports drift and exits **1** instead of guessing.

## The idea, in one page

Compressed. [`docs/concepts/`](docs/concepts/) has the long form — five pages on what this is, the
two seams, the board, the two meanings of *run*, and why determinism is the point.

### GitHub is the board; `dsh` projects it

There is no second database of task state. Issues, labels, milestones and pull requests *are* the
board, and `dsh-board` renders a view of them ([decision 3](#ratified-decisions)). This is why the
board survives a machine dying, and why a human editing an issue in a browser is a first-class way
to steer the fleet rather than an inconsistency to reconcile.

The lifecycle is ten `status:` labels — `triage`, `research`, `plan`, `plan-eval`, `impl`,
`impl-eval`, `augment-review`, `ci-fail`, `ready-merge`, `shipped` — and an item carries exactly
one at a time. `dsh-board check` exits non-zero when that is violated.

### Two seams, not one

The central architectural finding of this project, and the thing most easily collapsed by accident:
**subscription agent CLIs and API-key models attach to different `dsh` services.**

`ctx.subagents` takes autonomous workers — Claude Code, Codex, opencode, agy — that run their own
loop and are metered by a **quota window**. `ctx.llm` takes models behind a token stream —
OpenRouter, LM Studio, local llama — metered **per token**, inside `dsh`'s loop.

[`docs/concepts/02-the-two-seams.md`](docs/concepts/02-the-two-seams.md) owns this argument in full:
what each seam is metered by, what running out of one means, where a gate can and cannot stand, and
the three places the coordinator reads it.

Three consequences follow, and they are why this is a design decision rather than a taxonomy:

1. "An evaluator must not be the artifact's author" becomes **topological** instead of a naming
   convention — it is enforced where the two seams meet. That is `dsh-coordinator evaluator`.
2. **Governance is not one regime.** It is three, because the two seams plus the local models
   admit work on incomparable grounds.
3. `dsh` **cannot** gate a tool call happening inside a vendor CLI's child process. So the gate
   moves to the sandbox boundary, not to the tool call.

### Everything generated is generated

Four artifacts in this repository are produced by code and verified against it, not maintained by
hand: the `dsh` bundle patch (`cordis.patch.yml`, byte-compared in a test), the board-process skill
(`.claude/skills/board-process/SKILL.md`, written by `dsh-forge skill install`), the config golden
snapshot (captured from the real binary, re-blessed with a written reason), and the label taxonomy
(`.github/labels.yml`, ejected by `dsh-forge labels eject`).

The rule behind all four:

> **Every artifact either states facts it owns, or is generated from the code that owns them.**

A file that restates a fact some other file owns is a fact that will eventually disagree with
itself, and the failure is silent — nothing goes red, the document just becomes a lie that the next
agent reads first. That is a correctness bug in a coordinator, not a cosmetic one.

## Packages

Fifteen packages. Eight carry real code; seven are stubs waiting on their epic, and say so.

| Package | Ships | What it owns |
| --- | --- | --- |
| [`telemetry`](packages/telemetry) | ✅ | The run record: a bounded, rotated JSONL log, and the readers that merge it with vendor transcripts. |
| [`contracts`](packages/contracts) | ✅ | The wire protocol and types the netscript cockpits consume. The one **published** package. |
| [`coordinator`](packages/coordinator) | ✅ | Evaluator independence, workflow definitions, the admission gate, journals and replay. |
| [`forge`](packages/forge) | ✅ | The board taxonomy and process skill, installable into any repository. |
| [`board`](packages/board) | ✅ | The GitHub → board projection, and the checks that catch a board contradicting itself. |
| [`routing`](packages/routing) | ✅ | The model matrix. The single owner of every model id in this repository. |
| [`subagents`](packages/subagents) | ✅ | The `ctx.subagents` seam: quota-metered autonomous workers. |
| [`dsh-app`](packages/dsh-app) | ✅ | The profile and the bundle patch that compose every plugin above into one `dsh`. |
| [`governance`](packages/governance) | — | Tri-regime admission control. [E5](https://github.com/rickylabs/harness/issues/35). |
| [`llm-local`](packages/llm-local) | — | The `ctx.llm` seam: OpenRouter and local endpoints. [E4](https://github.com/rickylabs/harness/issues/34). |
| [`netscript-bridge`](packages/netscript-bridge) | — | The adapter decision 2 rests on. |
| [`provider-claude`](packages/provider-claude) | — | [E3](https://github.com/rickylabs/harness/issues/33). |
| [`provider-codex`](packages/provider-codex) | — | [E3](https://github.com/rickylabs/harness/issues/33). |
| [`provider-opencode`](packages/provider-opencode) | — | [E3](https://github.com/rickylabs/harness/issues/33). |
| [`provider-acp`](packages/provider-acp) | — | [E3](https://github.com/rickylabs/harness/issues/33). |

A stub is a `package.json`, a tsconfig and a placeholder — enough to hold its place in the project
graph so the dependency shape is decided before the code is written, and not enough to pretend it
works.

## Why this exists

Coding agents produce output faster than humans can review it. The bottleneck moved.

The working loop it replaces: open a mobile agent client, triage which daemons died, step into the
one that matters, steer it, back out, watch the orchestrator, repeat — and reach for a desktop only
to review real work. The agents are capable. What is missing is a substrate that makes their work
legible, resumable and reviewable across projects, machines and vendors.

Two products bracket the gap. [t3.codes](https://t3.codes) is a control panel *over agent sessions*
— multi-vendor, mobile, remote-capable; it manages conversations and has no opinion about the work.
[Linear](https://linear.app) is a board growing agent teammates — structure, initiatives, roadmap;
it manages intent and never touches the run. Neither owns the middle: staged runs, cited research,
locked decisions, explicit owner forks, adversarial review, and gates that must pass before
anything mutates.

That substrate has been run against three codebases with nothing in common:

| Repository | Stack | Role |
| --- | --- | --- |
| `rickylabs/netscript` | Deno 2.x, JSR, Aspire | Origin. Runtime spine and harness v3 doctrine. |
| `rickylabs/eis-chat` | Deno, oRPC, Turso, Deno KV | The harness at depth: services, workers, sagas, streams. |
| `autocorner/website` | Next.js 16, React 19, Sanity, bun | A doctrine port across a total stack swap. |

The port to a non-Deno, non-netscript codebase transferred **cleanly for mechanics and not at all
for domain knowledge**. That asymmetry is the product seam:

> **Mechanics are portable. Knowledge is specific. Ship the mechanics; scaffold the knowledge.**

## Design commitments

- **Artifacts over chat.** If it is not in a run artifact, it did not happen.
- **Citations or it is not a claim.** Every load-bearing statement carries a repo path, a document
  page, or a URL.
- **Owner forks are raised, never resolved silently.** Ambiguity is escalated with a recommendation
  and a cost-if-wrong.
- **Nothing mutates before a gate passes.** Plans are locked and evaluated before the board, the
  code, or the world is touched.
- **Deterministic work belongs in the daemon.** Anything an agent is asked to do repeatedly and
  identically is a bug in the harness.
- **Local first, vendor neutral.** Claude Code, Codex, opencode, Copilot — the harness outlives
  whichever one you opened this morning.

Each commitment is made executable by a named epic on the
[roadmap](https://github.com/rickylabs/harness/issues/30). Two of the six —
*artifacts over chat* and *citations or it is not a claim* — are only **partially** owned:
[E9](https://github.com/rickylabs/harness/issues/39) makes artifacts durable but does not decide
what has to become one, and [E6](https://github.com/rickylabs/harness/issues/36) carries evidence
between steps but sets no citation bar. Both need an owner before the commitment is real. A tidy
table that hid this would be worth less than the gap it papers over.

## Ratified decisions

Four decisions are **ratified** in the *Decisions taken* table of the
[E0 roadmap](https://github.com/rickylabs/harness/issues/30). They are restated here because root
documents are what an agent reads first, and a root document that contradicts a ratified decision
propagates the contradiction silently. They are not re-opened in a run, a PR, or a prompt;
reversing one is a change to #30 first.

1. **Plugin-only, no core fork.** Depend on published
   [`@deepseek-ai/dsh`](https://github.com/deepseek-ai/deepseek-harness). We ship Cordis plugin
   packages and one profile. Only
   [`runzhliu/deepseek-harness-docker`](https://github.com/runzhliu/deepseek-harness-docker) is
   forked, with the upstream remote kept for updates.
2. **Node + pnpm.** netscript stays a service behind an adapter, not a build-time dependency.
3. **GitHub is the source of truth for the board**; `dsh` projects the live view.
4. **This repo is the `dsh` layer only.** The Expo cockpit and the web cockpit both live in
   netscript. Consequence: `contracts` must be a *published* package, not a workspace import.

Two further decisions — the MIT licence, and the divybot/herdr strangler-fig — are recorded on #30
as **taken, reversible**. They are not restated as settled here; read them on the board.

## Doctrine

[`doctrine/`](doctrine/) is the portable half: plain markdown, zero runtime, works in any
repository in any language with no daemon installed. It is what ported at 7/10 across the three
stacks above.

- [`WORKFLOW.md`](doctrine/WORKFLOW.md) — the run lifecycle, and how to pick a run up from any CLI
- [`PRINCIPLES.md`](doctrine/PRINCIPLES.md) — the rules a run is judged against
- [`TOOLCHAIN.md`](doctrine/TOOLCHAIN.md) — which tool for which job
- [`decisions/`](doctrine/decisions/) — architecture decision records

The plugins in `packages/` are the other half: the parts of that doctrine a machine can enforce.

## Repository map

```
packages/             the dsh plugin layer — one package per subsystem
docs/                 concepts, how-to, reference, tutorials, glossary
doctrine/             how to work here: portable, stable, no runtime
deploy/               the N5 compose stack and the patch overlays it applies
scripts/              the repository-wide checks the root scripts run
.llm/runs/            run artifacts — durable, reviewed via PR
.llm/harness/         the artifact templates a run fills in
.llm/tools/           milestone and gate tooling (Deno; see the note below)
.github/labels.yml    the ejected label taxonomy — generated, then reviewed
.github/workflows/    the CI gate and the release pipeline
.claude/skills/       the generated board skill (`pnpm run skill:install`)
AGENTS.md             entry point, agent mode
CLAUDE.md             entry point, standard mode
deno.json             see below
```

`deno.json` and `deno.lock` at the root of a pnpm monorepo look like debris and are not: they run
the milestone and gate tooling under `.llm/tools/`. Whether that second toolchain stays is an open
owner fork, recorded on [#140](https://github.com/rickylabs/harness/issues/140).

## Checks

`ci` runs on every pull request and on `main` as a single job: `pnpm run typecheck`,
`pnpm run build`, `pnpm test` — the same three a contributor runs locally, against the same
lockfile. One job, because a check that lives in two places is a check with two places to forget it.

Those root scripts carry three checks of their own:

| Script | What it refuses to let through |
| --- | --- |
| `check:graph` | workspace dependencies that disagree with the TypeScript project references |
| `check:lifecycle` | the board's phase list differing between the two files that hold it |
| `check:publish` | the publishable package not publishing what it claims to |

`ci` itself publishes nothing. `@rickylabs/harness-contracts` has a separate pipeline,
[`release-contracts.yml`](.github/workflows/release-contracts.yml), triggered by a
`harness-contracts-v*` tag rather than by a merge, and inert until the repository has an
`NPM_TOKEN`. Keeping that credential out of the workflow that runs on every pull request is the
point of the split. See [`packages/contracts/README.md`](packages/contracts/README.md) for the
versioning and deprecation policy.

## Deployment

[`deploy/`](deploy/README.md) runs the `dsh` web surface as a container on the N5: the compose
file, the patch overlay that binds it, and — importantly — what actually gates that surface, since
the upstream Docker image's warning about it is out of date.

## A note for anyone filing work here

This repository **is** an agent inbox. An issue labelled `harness` is polled and dispatched to a
real agent. That is a feature, not a hazard, but it means the label starts something. Label
deliberately.

## Licence

**MIT**, matching `dsh`, so the plugin packages can carry the `dsh-plugin` topic. Taken on
[#30](https://github.com/rickylabs/harness/issues/30) as reversible. See [`LICENSE`](LICENSE).
