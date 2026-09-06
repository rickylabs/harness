<!-- Generated from packages/forge/src/cli.ts by scripts/cli-reference.mjs. Do not edit; run "pnpm run docs:cli". -->

# `dsh-forge`

> board taxonomy and process skill, installable into any repository

Shipped by [`packages/forge`](../../../packages/forge). This page is *what it does*;
*why it does it that way* is [`packages/forge/README.md`](../../../packages/forge/README.md).

## Exit codes

| code | name | meaning |
| --- | --- | --- |
| `0` | `ok` | everything asked for is in place |
| `1` | `drift` | the repository has drifted from the taxonomy, or a label already means something else |
| `2` | `usage` | the command line was wrong |
| `3` | `unavailable` | no usable GitHub transport: gh missing, unauthenticated, or unable to reach GitHub |

Read from `EXIT` and `EXIT_MEANINGS` in [`packages/forge/src/cli.ts`](../../../packages/forge/src/cli.ts). The `exit codes`
block in the help text below renders from those same two constants, so this table, that block
and the number the process actually returns cannot disagree.

## `dsh-forge --help`

```text
dsh-forge — board taxonomy and process skill, installable into any repository

usage
  dsh-forge doctor                 report what this repository and environment support
  dsh-forge labels plan            show what would change (read-only; the default)
  dsh-forge labels apply           create and update labels; never deletes
  dsh-forge labels check           exit non-zero when the repo has drifted (for CI)
  dsh-forge labels eject           write .github/labels.yml — the reviewable source of truth
  dsh-forge skill install          write the board-process skill into this repo's skill dirs
  dsh-forge status settle          print the status: label change an ended item calls for
  dsh-forge targets show           print the dispatch table in resolution order
  dsh-forge targets check          exit non-zero when the table is wrong (for CI)
  dsh-forge targets reconcile      which inbox issues the dispatcher claims, and what came back
  dsh-forge targets backend        which backend dispatches each target, and why
  dsh-forge swarm admit            decide every /swarm comment the way the dispatcher would
  dsh-forge swarm mirror           the inbox issue each honoured trigger would open
  dsh-forge swarm teardown         which runs are past their deadline, and which actually stopped
  dsh-forge supervise              what is new on each agent's PR, and what it has already been told
  dsh-forge init                   eject + apply + skill install, in that order

options
  --repo <owner/name>   target repository (default: the origin remote)
  --cwd <path>          repository root (default: the working directory)
  --no-detect           portable core only; derive nothing from this repository
  --force               settle conflicts and overwrite files this tool did not generate
  --dispatch-label <n>  the label that starts an agent run here; teaches the skill to be careful
                        with it (default: none — most repositories have no dispatcher)
  --ending <how>        status settle only: completed | not-planned | reopened
  --labels <a,b>        status settle only: the labels the item carries now (repeatable)
  --event <path>        status settle only: a GitHub event payload to read all of that from
  --config <path>       targets and swarm: the dispatcher's config (default: ./divybot.json)
  --handover <path>     targets backend only: the parity ledger (default: ./handover.json;
                        absent means every target still dispatches through divybot)
  --snapshot <path>     targets reconcile and swarm: a 'dsh-board snapshot' JSON file (repeatable —
                        one per repository, including the inbox's own)
  --comments <path>     swarm only: a 'gh api repos/<owner>/<name>/issues/comments' JSON dump
                        (repeatable — one per target repository)
  --seen <path>         swarm only: the dispatcher's state.json, whose seen_swarm keys name the
                        comments it has already decided
  --runs <path>         swarm teardown only: a JSON array of observed runs (repeatable), each
                        {"ref":"owner/name#1","harness":"claude","startedAt":"<iso>","timeout":"2h",
                        "exited":false,"artefacts":[{"path":"…","at":"<iso>","bytes":0}]}
  --at <iso>            swarm teardown only: the moment to judge against (default: now)
  --settle <duration>   swarm teardown only: how long an artefact must be quiet before a run counts
                        as verified down (default: 5m)
  --stuck <duration>    swarm teardown only: how long past its deadline a run may write before it is
                        called stuck (default: 1h)
  --deadline <duration> swarm teardown only: the timeout a run with none of its own gets (default:
                        4h)
  --pulls <path>        supervise only: a 'gh pr list --json' dump (repeatable — one per repository)
  --panes <path>        supervise only: 'herdr pane read' output as JSON, one entry per pull:
                        {"pull":"owner/name#1","busy":true,"text":"…"} — redacted on the way in
  --supervision <path>  supervise only: what each pull has already been told (default:
                        ./supervision.json; absent means a first tick)
  --dry-run             report every change without writing a file or touching the repository
  --json                machine-readable output
  -h, --help            this text

exit codes
  0  everything asked for is in place
  1  the repository has drifted from the taxonomy, or a label already means something else
  2  the command line was wrong
  3  no usable GitHub transport: gh missing, unauthenticated, or unable to reach GitHub
```

---

Generated by [`scripts/cli-reference.mjs`](../../../scripts/cli-reference.mjs).
Editing this file by hand fails `pnpm run check:docs`; edit the CLI and run `pnpm run docs:cli`.
Back to [reference](../README.md) · [docs](../../README.md)
