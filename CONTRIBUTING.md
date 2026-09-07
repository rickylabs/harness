# Contributing

Most pull requests in this repository are opened by an agent, not a person. That is not a
disclaimer — it is the design, and it decides the shape of this guide: the rules that matter are
the ones a machine can check, and the ones a machine cannot check are stated once, in the file that
owns them, and linked from everywhere else.

If you are an agent, your entry point is [`AGENTS.md`](AGENTS.md) and your rulebook is the generated
[`.claude/skills/board-process/SKILL.md`](.claude/skills/board-process/SKILL.md). Read both before
your first board mutation. This file is the human-readable version of the same conventions plus the
things a skill has no reason to carry.

Before anything else: **this repository is a live agent inbox.** Labelling an issue `harness`
dispatches a real agent on a real host against that issue's body, within about thirty seconds, with
no confirmation step. [`AGENTS.md`](AGENTS.md#operational-hazard-this-repository-is-a-live-inbox)
states the full hazard and [`SECURITY.md`](SECURITY.md#2-the-dispatch-label-is-an-execution-primitive)
states what it means for access control. Label deliberately.

## The local loop

Four commands. CI runs the last three, in this order, on ubuntu-latest with Node 24 — so a clean
local run and a green build are the same claim.

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

Node 24 or newer and [pnpm](https://pnpm.io) 11. The pnpm version is pinned by `packageManager` in
the root `package.json`, and CI reads that same line rather than pinning a second one — so upgrading
pnpm is a one-line change, not a two-file dance.

`build` is not only a compile. It runs ten repository-wide checks around the per-package builds,
in this order:

| Check | What it refuses to let through |
| --- | --- |
| `check:graph` | workspace dependencies that disagree with the TypeScript project references |
| `check:lifecycle` | the board's phase list differing between the two files that hold it |
| `check:links` | a relative link or heading anchor in any markdown file that does not resolve |
| `check:forms` | an issue form that does not parse, or that applies a label the taxonomy does not declare |
| `check:snapshots` | a committed allowance snapshot — a quota, a spend balance, a serialised probe |
| `check:publish` | the publishable package not publishing what it claims to |
| `check:label-registry` | a label the board branches on that `dsh-forge init` would never create |
| `check:docs` | a generated CLI reference page that no longer matches its binary |
| `check:skill` | a committed `SKILL.md` that is not what the generator would write today |
| `check:tutorial` | a pasted output block in a tutorial that the command no longer prints |

Each one exists because the failure it catches is silent. None of them are optional, and running
`pnpm -r run build` directly skips all ten.

The first five need nothing but the tree, so they run before the compile and a docs-only change
fails in seconds. The last five read `dist/`, so they run after it.

Five notes on what these checks deliberately do *not* do. `check:links` never fetches an external
URL — a link check that goes over the network fails when someone else's server is down, and a gate
that fails for a reason unrelated to the change under review teaches people to skip the gate.
`check:forms` reads `.github/labels.yml` rather than asking GitHub, so it needs no token and runs in
the same CI job as everything else. `check:snapshots` reads only tracked `.json` and `.yaml`, never
prose: the docs discuss quotas and allowances at length and must keep being able to, because a
paragraph explaining why a quota is not committable is not a committed quota. And
`check:label-registry` reads only labels the code branches on — declared in
`packages/board/src/labels.ts` — not every label the taxonomy defines. Whether a label nobody reads
should still exist is a curation question with a legitimate answer either way, and folding it in
here would give people a reason to argue with the half that is not a judgement call. And
`check:tutorial` runs a deliberately small subset of shell rather than a shell — temporary homes,
`env -u`, a piped `printf`, and a `node` entry point, with everything else refused by name. A block
it cannot run has to be marked `verify: none` with a reason, which it then prints. That is slightly
annoying on purpose: the alternative is a gate that quietly executes whatever a documentation change
put in front of it.

### One check that is not a gate

```bash
pnpm run check:metadata
```

It compares GitHub's own description of this repository against the `description` in the root
`package.json`, which is the side that is in the tree and reviewed. It is deliberately outside
`build`: only an admin can change the GitHub string, so gating pull requests on it would paint
unrelated work red until the owner acted. It prints the exact `gh repo edit` command that fixes what
it found. Exit 3 means it found no GitHub transport and compared nothing — which is not a pass.

Tests run against emitted JavaScript, not sources, so `pnpm test` on a tree that has not been built
tests the previous build. When in doubt, run the full four.

## Generated files are generated

Six artifacts here are produced by code. Editing one by hand is the most common way a contribution
fails, and for five of them it fails loudly — which is the point.

| File | Changed by |
| --- | --- |
| `docs/reference/cli/*.md` | `pnpm run docs:cli` |
| `.claude/skills/board-process/SKILL.md` | `pnpm run skill:install` |
| `packages/dsh-app/dump-config.golden.yml` | `pnpm run golden:bless -- "the reason it changed"` |
| `packages/dsh-app/cordis.patch.yml` | editing `packages/dsh-app/src/bundle.ts` — never the file |
| `.github/labels.yml` | `node packages/forge/dist/cli.js labels eject` |
| `BOARD.md` | nothing you can run — move the issue, and the next scheduled render follows |

`BOARD.md` is the sixth and the exception, so it gets its own warning. No check guards it; the
[`board`](.github/workflows/board.yml) workflow simply overwrites it every half hour. An edit there
is not rejected, it is *reverted*, silently, by a run nobody was watching — and in the meantime the
page says something GitHub does not. The board is repaired on the issue. Always.

The golden snapshot takes a required reason and writes it into the file's own header, because a
snapshot updated by whoever was annoyed by the failing test has stopped being evidence. Put that
same reason in the pull request.

"Verified against it" is now literal for the first two: `check:docs` re-derives every CLI reference
page from its binary, and `check:skill` re-runs the skill generator and compares. Both are in
`build`, so a hand-edited copy of either fails before review rather than after.

The tutorial is the case that rule cannot reach: a page whose value is the prose around the output
cannot be generated from the code, so it stays hand-written and goes stale like anything else — it
did, in four places, before `check:tutorial` existed. What is generated there is not the page but the
*verdict*: each output block declares whether it is re-run or trusted, the build re-runs the first
kind, and the second kind is printed with its reason on every pass rather than left to be inferred.

The rule these six serve is stated in full in [`docs/README.md`](docs/README.md#the-rule-these-docs-are-held-to):
every artifact either states facts it owns, or is generated from the code that owns them.

## Branches, commits, pull requests

Branch names are `<type>/<issue>-<slug>` — lowercase, kebab-case, no dates:
`docs/145-getting-started`, `feat/58-routing-matrix`, `fix/127-eject-roundtrip`. Types match the
`type:` labels: `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`. Work with no issue
behind it drops the number, but most work here has one.

Open the pull request against `main` using the [template](.github/pull_request_template.md), and
keep its **Verification** section honest — paste real output and real exit codes. A checked box with
nothing behind it is how a false green merges.

**Link the issue you close.** A closing keyword (`Closes #N`) in the pull request body is what makes
the merge close the issue; a bare `#N` does not. Never put a closing keyword on an epic — an epic
closes when its children do.

Nothing here auto-merges. A human merges every pull request, deliberately, after CI is green.

## Labels, the board, and what this file does not own

The label taxonomy is machine-readable in [`.github/labels.yml`](.github/labels.yml), which is the
source of truth, and narrated for agents in the generated
[board-process skill](.claude/skills/board-process/SKILL.md). **This file does not restate the
lifecycle**, because a second copy of it is a copy that will eventually be wrong.

What you need to know to file or move something:

- Exactly **one** `status:` label at a time. It is the board column, and `dsh-board check` exits
  non-zero when an item carries two or none.
- `type:`, `area:`, `priority:`, `epic:` and `topic:` are additive.
- Labels are never deleted, only retired — deleting one strips it from every item that carried it,
  and an item that recorded a decision stops saying so.

Read the current state without asking an agent:

```bash
node packages/board/dist/cli.js columns
node packages/board/dist/cli.js check
```

## Substantial changes

For anything beyond a scoped fix, the method is [`doctrine/`](doctrine/) — eight stages, and nothing
mutates the world before the gate at stage G. [`WORKFLOW.md`](doctrine/WORKFLOW.md) has the
lifecycle; [`PRINCIPLES.md`](doctrine/PRINCIPLES.md) has the rules a run is judged against. Both are
short on purpose.

Two constraints apply to every change here, large or small, and are not restated per task:

1. **Citations or it is not a claim.** Every load-bearing statement carries a repository path with a
   line reference, a document page, or a URL retrieved during the work. Something you believe but
   cannot cite is a finding to investigate, not an input to a plan.
2. **Owner forks are raised, never resolved silently.** When the answer depends on what the owner
   wants rather than on what is true, stop and record the question, the options, a recommendation,
   and the cost if the recommendation is wrong. Do not pick one and move on, and do not bury it in
   prose.

The four **ratified decisions** in [#30](https://github.com/rickylabs/harness/issues/30) are not
open questions. A design that contradicts one is wrong before it is reviewed; reversing one is a
change to #30 first. [`AGENTS.md`](AGENTS.md#ratified-decisions-you-inherit) lists them.

## Review

Review here is adversarial by construction and by policy: an evaluator must not be the author of the
artifact it evaluates, and that is enforced topologically rather than by convention —
`node packages/coordinator/dist/cli.js policies` prints the rules that decide who may review whose
work.

A review that finds nothing is a review that has not looked. Findings are recorded, not softened,
and an owner fork raised in review is resolved by the owner, not by the reviewer and not by the
author.

## Legal

MIT ([`LICENSE`](LICENSE)), matching `dsh`. This repository is public. There is currently no CLA
and no DCO sign-off requirement; the owner maintains the contribution policy described here.

Never open a public issue for a security problem — [`SECURITY.md`](SECURITY.md) says why the usual
advice is doubly true here.
