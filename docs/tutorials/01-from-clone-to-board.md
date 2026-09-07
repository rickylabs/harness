# From a clone to a moving board

By the end of this page you will have built this repository, installed its board process into a
repository of your own, filed an issue, moved it one column, and watched the column change. Then you
will record a run and read it back.

It takes about fifteen minutes. Everything runs on your machine. There is no N5 host in it, no model
provider, no API key, and nothing that costs money.

## Before you start

You need five things, and you will not be asked for a sixth later:

- **Node 24 or newer** and **[pnpm](https://pnpm.io) 11**.
- **The [`gh`](https://cli.github.com) CLI, authenticated** — `gh auth status` should print a
  logged-in account. Steps 2 and 3 read and write GitHub through it.
- **A scratch repository you own**, empty, that you do not mind changing. Call it `owner/scratch`
  below and substitute your own throughout. Step 2 writes labels into it.
- **A local clone of that scratch repository**, sitting beside this one (below, it is assumed to
  be at `../scratch`). `dsh-forge` writes files into a checkout, not into GitHub, so it needs a
  working tree to write into — and writing into this checkout would be a mistake explained at
  step 2.
- About 500 MB of disk for `node_modules`.

> [!WARNING]
> **Do not use `rickylabs/harness` as your scratch repository.** In that repository the `harness`
> label is not a category tag — applying it dispatches a real coding agent onto real hardware. Every
> write in this tutorial goes to `owner/scratch`.

## Step 1 — Build it and run the tests

```bash
git clone https://github.com/rickylabs/harness.git
cd harness
pnpm install
pnpm run build
```

`build` is not just compilation. It checks the project graph, checks the package lifecycle scripts,
compiles every package, checks what is publishable, and regenerates the CLI reference pages to
confirm they still match the CLIs. If any of those disagree with the code, the build fails here
rather than shipping a document that lies.

Now the tests:

```bash
pnpm test
```

Each package prints its own totals — a `pass` line and a `fail` line per
package, prefixed with its path, like `packages/dsh-app test: … pass …`.
The counts grow as the project does. The number that matters is `fail 0`,
on every package, and `pnpm test` exiting `0`.

**If it fails.** A failure in `pnpm install` about the Node version means you are below 24 — check
`node --version`. A failure in `pnpm run build` that names `check:docs` means a CLI changed without
its generated reference page being regenerated; run `pnpm run docs:cli` and commit the result. A
test failure on a clean clone is a real bug, and worth an issue.

## Step 2 — Install the board process into your repository

This step's tools do two different things: they read and write GitHub, and
they write *files* into a checkout. Both facts decide how you invoke them
here.

A warning first, because it is the one way to lose work in this step: the
`--cwd` flag decides which checkout gets the files, and it defaults to the
directory you are standing in. Run `init` from inside this clone without
`--cwd` and it treats the harness checkout as the target — it would overwrite
this repository's own tracked `.github/labels.yml` and board skill with your
scratch repository's taxonomy. Nothing stops you: there is no automatic
origin/target guard. So every command in this step is run from the harness
clone, with its binaries, and **every one passes `--cwd ../scratch`
explicitly** — the scratch clone you made before you started. The generated
files belong in the scratch checkout, where you can review and commit them.

Ask them what they can see first:

```bash
node packages/forge/dist/cli.js doctor --repo owner/scratch --cwd ../scratch
```

<details>
<summary>Why <code>node packages/…/dist/cli.js</code> rather than a bare command</summary>

Every package here except `contracts` is `private: true`, so pnpm links their executables where a
*dependent* resolves them, not at the repository root. Running the built entry point is the honest
invocation from a fresh clone, and it is what this repository's own scripts do. The root README
[explains it once](../../README.md#local-proof-first) and nothing else needs to.

</details>

`doctor` writes nothing. It reports the repository it resolved, how it reaches GitHub, how many
labels are already there (`labels present`), how many it proposes (`labels proposed`), the lane
prefix it detected (`lane prefix`), and the skill directories it found (`skill dirs`).

Next, see what it would do without doing it:

```bash
node packages/forge/dist/cli.js init --repo owner/scratch --cwd ../scratch --dry-run
```

Read that output before continuing. It is the whole change, in advance — including the files it
will write, which it names relative to `../scratch`. Then apply it:

```bash
node packages/forge/dist/cli.js init --repo owner/scratch --cwd ../scratch
```

`init` does three things in order: writes `.github/labels.yml` into the scratch checkout, creates
the labels on GitHub, and installs the `board-process` skill under the scratch checkout's
`.claude/skills/`. Those two files are now **scratch repository content**: review them and commit
them there, in the usual way. `init` **never deletes a label** — deleting one would take with it
the record of everything that ever carried it. Where the file and the live repository disagree,
`init` reports the conflict and exits `1` rather than guessing which is right.

One trap to know before you trust the exit code: `init` exits `0` when it
wrote the local files, even if the GitHub half of its work was skipped or
failed — with no usable transport it says `skipped apply` and still exits
`0`, and a label that GitHub refuses is reported and then swallowed the same
way. Exit `0` from `init` means *the files were written*; it does not mean
the labels exist on GitHub. Three readbacks close that gap, in increasing
strength. The first is local file review — the files really are in the
scratch checkout:

```bash
git -C ../scratch status --short
```

which should show `.github/` and `.claude/` as new. That confirms what `init`
wrote locally and nothing more. The other two read GitHub, so they need the
transport — and neither has been executed by this tutorial's author; they are
instructions, not receipts. First a raw readback: list what GitHub actually
has, and compare it against the ejected file yourself:

```bash
gh label list --repo owner/scratch --limit 100
```

Then the strict comparison — the ejected file against the live repository,
naming every drift:

```bash
node packages/forge/dist/cli.js labels check --repo owner/scratch --cwd ../scratch
```

On a repository where `init` fully succeeded, that prints `nothing to do —
the repository already carries this taxonomy` and exits `0`. **If either
GitHub command fails or shows missing labels, stop there and fix the cause
before continuing** — later steps only make sense if the labels are real.

**If it fails.** `labels check` — and `labels plan` and `labels apply` — are the commands that
exit `3` with no usable transport: `gh` is missing, not authenticated, or GitHub is unreachable —
`gh auth status` tells you which. `labels check` also exits non-zero when the live repository and
the ejected file disagree, naming each drifted label; on a fresh scratch repository that usually
means the apply never actually landed, and re-running `init` resumes it — it never deletes a
label, so re-running is safe. `doctor` and `init` do not exit `3`: `doctor` reports what it could
see and exits `0`, and `init`'s exit code says nothing about GitHub, which is exactly why the
readbacks above exist.

## Step 3 — File something, move it, and watch the column change

The label taxonomy has one rule that matters more than the rest: **exactly one `status:` label on
an open item at a time.** That label *is* the board column. Two of them means the column is a lie
— and every board view says so: a banner above the work, `!` beside the affected rows, and the
word `check` in the banner, because the banner counts and marks while `check` names each
contradiction and exits non-zero. When a view shows you that banner, run the check before doing
anything about the column underneath it.

File an issue:

```bash
gh issue create --repo owner/scratch \
  --title "Try the board" \
  --body "A first item, to watch it move." \
  --label "type:chore" --label "status:triage" --label "priority:p2"
```

Project the board:

```bash
node packages/board/dist/cli.js columns --repo owner/scratch
```

Your issue is under `## triage`. Now move it one column, exactly as an agent would:

```bash
gh issue edit <number> --repo owner/scratch \
  --add-label "status:impl" --remove-label "status:triage"
```

And project it again:

```bash
node packages/board/dist/cli.js columns --repo owner/scratch
```

The issue is now under `## impl`, and the triage count went down by one. That is the whole
mechanism. There is no database, no sync job and no daemon: GitHub holds the truth, and `dsh-board`
projects it on demand. Nothing had to be running for the column to be correct.

Finally, ask the board whether it agrees with itself:

```bash
node packages/board/dist/cli.js check --repo owner/scratch
```

On a healthy board that is one line and exit `0`:

```
no anomalies — every item has exactly one status label
```

**If it fails.** `check` exits `1` when the board contradicts itself, and names every case. The
common ones read like this:

```
## closed-but-unshipped
  #46: closed on GitHub but sits in ready-merge; the issue wins, the column is stale

## no-status
  #140: open item has no status label, so it appears in no column
```

Both are fixable with `gh issue edit`. The rule the taxonomy owns: on a completed close, replace the
phase label with `status:shipped`; on a not-planned close, remove the `status:` label entirely,
because it did not ship.

## Step 4 — Install the profile and see the projection

Steps 2 and 3 used the CLIs directly. The same code also loads into `dsh` as plugins, and the
profile is what registers them.

Install it into a scratch home directory so nothing touches your real one:

```bash
node packages/dsh-app/dist/cli.js install --home /tmp/dsh-home
```

```
profile   rickylabs
surface   tui
directory /tmp/dsh-home/profiles/rickylabs
bundles   @deepseek-ai/dsh-base, @rickylabs/dsh-app
rows      harness-subagents, harness-board, harness-coordinator, harness-telemetry, harness-llm
link      node_modules/@rickylabs/dsh-app -> /path/to/harness/packages/dsh-app

wrote  package.json
wrote  pnpm-workspace.yaml
wrote  cordis.patch.yml
wrote  node_modules/@rickylabs/dsh-app

5 rows will be inserted. Verify with:
  dsh --profile rickylabs --dump-config
```

Take it up on that. `dsh` is resolvable from the package that depends on it:

```bash
DSH_HOME=/tmp/dsh-home \
  packages/dsh-app/node_modules/.bin/dsh --profile rickylabs --dump-config
```

The output is long — it is the entire plugin graph. The part you are looking for is at the very
bottom, after the whole base bundle:

```
# == @rickylabs/dsh-app
- id: harness-subagents
  name: '@rickylabs/dsh-app/plugins/subagents'
- id: harness-board
  name: '@rickylabs/dsh-app/plugins/board'
- id: harness-coordinator
  name: '@rickylabs/dsh-app/plugins/coordinator'
- id: harness-telemetry
  name: '@rickylabs/dsh-app/plugins/telemetry'
- id: harness-llm
  name: '@rickylabs/dsh-app/plugins/llm'
```

Five rows, appended after the base bundle rather than replacing anything in it. That is the profile
doing its one job. To confirm later that it is still installed and unmodified:

```bash
node packages/dsh-app/dist/cli.js check --home /tmp/dsh-home
```

which prints `installed and matching.` and exits `0`.

**If it fails.** `check` exits non-zero when the installed profile has drifted from what this
repository would generate — usually because the working tree moved after `install` wrote the link.
Re-running `install` fixes it. This step does not boot a surface; booting one is a separate job with
its own prerequisites, and it belongs in a how-to rather than here.

## Step 5 — Record a run and read it back

Telemetry answers one question: *what has been running, and where do I look when one of them went
wrong.* It reads from disk. No agent needs to be awake, and nothing here reaches the network.

Start by asking where it writes:

```bash
node packages/telemetry/dist/cli.js where --home /tmp/tel-home
```

It prints the live log path, the rotation policy behind it, and — the useful part — the ordered list
of places a failing run hides, each with the string to grep for. That list is the answer to "the run
died and the transcript says nothing", which is the normal case rather than the exceptional one.

Nothing has run yet, so write one event. `record` reads JSONL on stdin, one event per line:

```bash
printf '%s\n' \
  '{"runId":"demo-1","kind":"run.started","at":"2026-09-05T10:00:00Z","detail":{"source":"claude","model":"claude-opus-5"}}' \
  '{"runId":"demo-1","kind":"run.finished","at":"2026-09-05T10:04:00Z","detail":{"source":"claude","outcome":"complete"}}' \
  | node packages/telemetry/dist/cli.js record --home /tmp/tel-home
```

```
recorded 2 event(s) to /tmp/tel-home/observability/dsh-telemetry.jsonl
```

Read it back:

```bash
node packages/telemetry/dist/cli.js runs --home /tmp/tel-home
```

One line, newest first: the finish time, the seam (`source`), the outcome, and the model,
padded into columns.

And ask what you would open first if that run had gone wrong:

```bash
node packages/telemetry/dist/cli.js why demo-1 --home /tmp/tel-home
```

```
demo-1 (claude, complete) — look here, in this order:

  the run's own transcript
    /tmp/tel-home/observability/dsh-telemetry.jsonl

  dispatcher capacity decisions
    the dispatcher's own log on the orchestrator host
    grep: no host with free capacity|operator timeout|deferring
    why: a run that never appears is not a failed run; the dispatcher deferred it, and only its log says so
```

**If it fails.** Exit `3` means the picture is incomplete rather than wrong, and the output says
exactly which part is missing. Two are worth recognising, because you will hit both:

```
  claude: no store on this box — nothing has run here
  live log: 1 run(s) named no seam and were left out — add "source" to the event
```

The first is not an error — it is telemetry declining to claim it saw everything when it did not.
The second is: an event without `detail.source` cannot be joined to a seam, so it is counted and
reported rather than silently guessed at. `source` must be one of `claude`, `codex` or `opencode`,
and `outcome` one of `running`, `complete`, `failed` or `unknown`. An `outcome` outside that set is
read as unknown, which is why the run in your first attempt may have come back as `unknown`.

## What you just did

Five things, none of which needed a server:

1. Built the workspace, with its own consistency checks running as part of the build.
2. Installed a board taxonomy and an agent-readable process into a repository, additively.
3. Moved an item through a column and saw the projection change, with nothing running in between.
4. Registered five plugins into a `dsh` profile and confirmed they land where they should.
5. Recorded a run and read back both its state and the ordered list of places to look when one fails.

## Where to go next

- **Why any of this is shaped this way** → [`concepts/`](../concepts/), starting with
  [03 — The board](../concepts/03-the-board.md), which explains why GitHub holds the truth and `dsh`
  only projects it.
- **Every flag and exit code** → the [CLI reference](../reference/cli/README.md), generated from the
  CLIs themselves.
- **A specific task rather than a lesson** → [`how-to/`](../how-to/).
- **The words used here** → [`glossary.md`](../glossary.md).

---

Back to [tutorials](README.md) · [docs](../README.md)
