# Install the board process into an existing repository

The board process is a label taxonomy plus a skill that teaches an agent to use it. `dsh-forge`
installs both into a repository that is not this one, without taking over the repository it lands
in.

This is the shortest correct path. *Why* the board works this way is
[concepts/03 — The board](../concepts/03-the-board.md); every flag is
[the generated reference](../reference/cli/dsh-forge.md).

## Before you start

- **`gh`, authenticated, with push access to the target.** Labels are created through the GitHub
  API, not through a checkout. Without a usable transport every label command exits `3` rather than
  guessing.
- **A checkout of the target repository**, because the skill is written to disk even though the
  labels are not.
- **A built `dsh-forge`.** From a clone of this repository, `pnpm install && pnpm --filter
  @rickylabs/forge run build`, then invoke `node packages/forge/dist/cli.js`. The examples below
  write `dsh-forge` for that.

You do not need this repository's taxonomy to match the target's. Deriving the difference is the
first step's entire job.

## 1. Ask what the repository already supports

```bash
dsh-forge doctor --repo you/your-repo --cwd ../your-repo
```

```text
repository       you/your-repo
github           gh — gh CLI (gh version 2.97.0 (2026-07-31))
labels present   38
labels proposed  30
lane prefix      lane:
skill dirs       none — would create .claude/skills

derived from this repository
  (nothing — the portable core only)

notes
  lane prefix in use: lane:
  no workspace manifest with directory globs — no area: labels proposed
  no .github/workflows — no gate: or ci: labels proposed
  no milestone cluster state found — no lane labels proposed
  no open epic/umbrella issues — no epic: labels proposed
```

Read the `notes` block before anything else. Every line is a label family the target does **not**
get, and the reason. A repository with a pnpm workspace gets `area:` labels named after its
packages; one without gets none, and says so rather than inventing them.

`lane prefix` is worth a second look. This repository uses `topic:`; the target above already used
`lane:`, so `doctor` adopted the target's convention instead of imposing ours. If that line names a
prefix you did not expect, stop here — it means the repository is already saying something about how
it organises work, and you are about to add to it.

## 2. See exactly what would change

```bash
dsh-forge labels plan --repo you/your-repo --cwd ../your-repo
```

```text
create (2)
  epic                         absent from the repository
  flag:owner-decision          absent from the repository

keep (28) — already correct

unmanaged (10) — present on the repo, not in this taxonomy, left alone
  accessibility, bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix
```

`plan` is read-only and it is the default: `dsh-forge labels` with no verb does this. Three buckets,
and the third is the one that matters for trust — **labels outside the taxonomy are left alone, and
`apply` never deletes.** GitHub's own defaults, and whatever the repository invented for itself,
survive the install.

The target above had been forged before, which is why 28 labels are already correct and only two are
missing. On a repository seeing this for the first time every managed label appears under `create`.
Running `plan` twice in a row on an installed repository is how you confirm nothing drifted.

## 3. Eject the taxonomy and review it as a diff

```bash
dsh-forge labels eject --repo you/your-repo --cwd ../your-repo
```

```text
would write .github/labels.yml — 30 label(s) plus 1 retired
```

This writes [`.github/labels.yml`](../../.github/labels.yml) into the target. That file — not this
tool's memory — becomes the reviewable source of truth for what `apply` will do, and it wins on
overlap. Commit it, and the taxonomy stops being something a binary knows and becomes something the
repository states.

Review it now. Editing it before you apply is the supported way to disagree with a default.

## 4. Apply, and install the skill

```bash
dsh-forge labels apply --repo you/your-repo --cwd ../your-repo
dsh-forge skill install --repo you/your-repo --cwd ../your-repo
```

`apply` creates and updates; it does not delete. `skill install` writes
[`.claude/skills/board-process/SKILL.md`](../../.claude/skills/board-process/SKILL.md) — the same
taxonomy in the form an agent reads, so that the rules a human sees on the board and the rules an
agent follows come from one source.

`dsh-forge init` runs eject, apply and skill install in that order, which is the same thing once you
have decided to trust the plan.

**These two commands change a repository other than the one you are standing in.** Add `--dry-run` to
either, or to `init`, to print all of it and write nothing.

If a label already exists with a different colour or description, `apply` reports drift and exits
`1` rather than overwriting a label that may already mean something to somebody. `--force` settles
those conflicts; reach for it only once you have read what they are.

## 5. Keep it honest in CI

```bash
dsh-forge labels check --repo you/your-repo --cwd ../your-repo
```

Exits non-zero when the repository has drifted from `.github/labels.yml`. A taxonomy nobody checks
is a taxonomy that quietly stops describing the board.

## If something goes wrong

| Exit | What it means | What to do |
| --- | --- | --- |
| `1` | drift, or a label already means something else | read the report; edit `.github/labels.yml`, or `--force` once you know what you are settling |
| `2` | the command line was wrong | check the flag against [the reference](../reference/cli/dsh-forge.md) |
| `3` | no usable GitHub transport | `gh auth status` — this is `gh` missing, unauthenticated, or unable to reach GitHub |

Exit `3` is deliberately not a silent skip. A label command that cannot reach GitHub has not
installed anything, and reporting success there would leave a repository that looks forged and is
not.

## What this does not do

It does not install a dispatcher. The taxonomy includes no label that starts an agent run unless you
name one with `--dispatch-label`, which exists so the generated skill can teach an agent to be
careful with a label that has consequences. Most repositories have no dispatcher and should pass
nothing.

It does not import issues, touch milestones, or open anything. It also does not make the board move
on its own — that is `dsh-board`, and it reads the board rather than installing it.

---

*Transcripts above were executed at commit `fe278bc` with Node 22.20.0, pnpm 11.25.0 and gh 2.97.0,
against a repository whose name has been normalised to `you/your-repo`. The step 4 and step 5 blocks
carry no output because those commands mutate a repository's taxonomy and were not run here;
everything shown was.*

Back to [how-to](README.md) · [docs](../README.md)
