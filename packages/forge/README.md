# @rickylabs/forge

GitHub bridge — absorbs the Orchid pipeline. Owned by epic E7 · #37.

The board taxonomy lands ahead of that epic because it is the mechanism the epic will drive: labels
are the surface a dispatcher reads, and until they exist the coordinator has nothing to write its
decisions onto. Everything here is a library first and a CLI second, so the coordinator can call the
same functions in-process.

## `dsh-forge`

Installs the namespaced label taxonomy — and the skill that explains it — into any repository.

```bash
dsh-forge doctor          # what this repo and this environment support
dsh-forge labels plan     # read-only diff (the default)
dsh-forge labels apply    # create and update; never deletes
dsh-forge labels check    # non-zero exit on drift, for CI
dsh-forge labels eject    # write .github/labels.yml
dsh-forge skill install   # write the board-process skill into this repo's skill dirs
dsh-forge init            # eject + apply + skill install
```

Options: `--repo owner/name`, `--cwd <path>`, `--no-detect`, `--force`, `--dry-run`, `--json`.
Exit codes: `0` ok, `1` drift or conflict, `2` usage, `3` no usable GitHub transport.

## What it installs

**Portable core**, unconditionally — nothing in it names anything repo-specific:

| family | labels |
| --- | --- |
| `type:` | `feat` `fix` `docs` `chore` `refactor` `perf` `test` `umbrella` `sub-pr` |
| `status:` | the nine-phase lifecycle, plus `shipped` and `close-gate-override` |
| `priority:` | `p0`–`p3` |
| `eval:` | `skip` `third-opinion` |
| flags | `rfc` `breaking` |

**Derived**, only where the repository provides evidence:

| family | evidence |
| --- | --- |
| `area:` | directories under a workspace glob that contain a `package.json` or `deno.json` |
| `gate:` / `ci:` | `.github/workflows/*` whose file or `name:` looks expensive to run |
| lane | lane ids in `.llm/runs/*/milestone-cluster-state.json` |
| `epic:` | open issues labelled `epic` or `type:umbrella` |

The lane family adopts whichever prefix the repository already uses — `orchestrator:`, `topic:` or
`lane:`. Two prefixes for one concept is how a taxonomy stops meaning anything.

## Progressive enhancement

Nothing here assumes an environment. Each capability is probed, and a missing one narrows the
output instead of failing the run:

- **GitHub access** — `gh` when it is installed *and* authenticated, otherwise `GITHUB_TOKEN` /
  `GH_TOKEN` over REST, otherwise both reasons are reported. `labels eject` and `skill install`
  work with no transport at all.
- **Repository shape** — every derived family is skipped, with a note saying which evidence was
  missing, rather than proposing a label that names nothing.
- **Skill location** — `.claude/skills` and `.agents/skills` are used if present; `.claude/skills`
  is created only when the repo has neither.
- **`.github/labels.yml`** — read as the source of truth when it exists, so a description edited
  there survives every later run. Core fills the gaps; detection adds the rest.

## Two rules it will not break

1. **It never deletes a label.** Deleting strips the label off every issue that carried it — silent
   data loss dressed up as tidying. Deprecate in `.github/labels.yml` and let a human remove it.
2. **It never silently overwrites an authored description.** That becomes a reported `conflict`
   the operator settles with `--force`, not an update that happens while they are not looking.
   GitHub's own stock descriptions are exempt: overwriting those is housekeeping.

The skill it installs carries the third rule, the one aimed at humans and agents rather than at the
tool: **exactly one `status:` label on an open item at a time.** The `status:` label *is* the board
column, so two of them means the column is a lie and none means the item is invisible.

## Ports from

`rickylabs/netscript`, where this taxonomy was proven. The repo-specific half was left behind
deliberately — see `detect.ts`.
