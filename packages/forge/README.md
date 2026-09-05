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
dsh-forge targets show    # the dispatch table, in resolution order
dsh-forge targets check   # non-zero exit when the table is wrong, for CI
dsh-forge targets reconcile   # which inbox issues get dispatched, and what came back
```

Options: `--repo owner/name`, `--cwd <path>`, `--no-detect`, `--force`, `--dry-run`, `--json`,
`--config <path>`, `--snapshot <path>` (repeatable).
Exit codes: `0` ok, `1` drift or conflict, `2` usage, `3` no usable GitHub transport.

## What it installs

**Portable core**, unconditionally — nothing in it names anything repo-specific:

| family | labels |
| --- | --- |
| `type:` | `feat` `fix` `docs` `chore` `refactor` `perf` `test` `umbrella` `sub-pr` |
| `status:` | the nine-phase lifecycle, plus `shipped` |
| `priority:` | `p0`–`p3` |
| `eval:` | `skip` `third-opinion` |
| flags | `rfc` `breaking` `flag:close-gate-override` |

A `status:` label *is* the board column, so nothing else may occupy it: `flag:close-gate-override`
records an audited exception to the close gate and sits *alongside* whichever phase the item is
actually in.

**Retired**, never installed and never deleted — a label that recorded a decision keeps recording it,
so `dsh-forge` only rewrites its description to name the successor:

| label | use instead |
| --- | --- |
| `status:close-gate-override` | `flag:close-gate-override` |

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

## The dispatch table

`dsh-forge targets` reads divybot's own `divybot.json` and answers the question labels raise but do
not settle: *this issue is labelled — where does the work actually go, and did any come back?*

```bash
dsh-forge targets show --config ../divybot.json
dsh-forge targets reconcile --config ../divybot.json --snapshot board.json --snapshot deno.json
```

The whole group is arithmetic on a config file and one or more `dsh-board snapshot` files. No
network, no `gh`, no clock — which is what makes it runnable in CI and quotable in an issue.

It reads the dispatcher's file rather than a second copy of it, and reads only the half that decides
where an issue goes: `inbox`, `bot_login`, `branch_prefix`, `poll_interval`, `targets`, `memory`.
`hosts`, `governor` and `state_file` are the dispatcher's operational business, and a second copy of
those is a thing that can disagree with the one that matters. Nothing is coerced: a `"3"` where Go
wants a number is reported, not read as `3`, because a table this calls healthy has to be one
divybot will actually start on.

### Three things the table does that are not obvious

- **First match wins, in config order.** A second row naming the same label is unreachable, and
  divybot says nothing about it. `targets show` prints the resolution index; `reconcile` names the
  shadowed rows per issue.
- **The agent list is an overflow preference, not a choice.** Admission takes the first agent whose
  *account* still has budget, so which one runs is a function of live quota and is not decidable
  from the table.
- **Accounts are coarser than harnesses.** `accountOf` pools `opencode` onto the codex account,
  which means `["opencode", "codex"]` collapses to one candidate. That is transliterated, not
  corrected — the divergence is real for this fleet (our OpenCode goes over OpenRouter, which no
  subscription window meters) and it belongs in the fleet's config, not in the mirror of it.

### What `targets check` refuses

Structural (`missing-label`, `missing-repo`, `malformed-repo`, `duplicate-label`,
`missing-branch-prefix`, `missing-bot-login`, `no-targets`, `malformed-duration`) — a table divybot
would reject or misread. Policy (`automerge-enabled`) — humans merge in this fleet, so a row that
sets it is refused rather than reported. Boundary (`unknown-agent`, `memory-on-inbox`) — the second
is the mechanism ADR 0001 asked for: the memory store must not be the inbox, or the dispatcher's
own notes land in the queue it reads from. It is silent when the store is off.

### How a delivery is linked back

Two mechanisms, and the order matters. **The branch** — `orch/divybot-142` is the dispatcher's own
naming and the only link that survives a repository boundary, because GitHub's closing keywords
close nothing across one: a PR in `denoland/deno` *cannot* reference an issue in the inbox that way.
**Closing keywords**, for a PR in the inbox repository itself, which is also how a human's own
branch claims an issue no run was dispatched for. Branch wins where both fire.

Two consequences worth stating, both found by running this against a real board rather than a
fixture: an issue with no target is `ignored` whether it is open or closed, because `settled` has to
mean "the dispatcher is done here" and not "this issue is closed"; and `landed` counts targeted
items only, because that number sits under the dispatcher's name and a human's merged PR is not its
output. Deliveries are still indexed for every item — *what closed #142* is worth answering whoever
did the work.

`coverage` is a first-class field rather than an implementation detail. An operator looking at an
item with no deliveries has to be able to tell "the run has produced nothing yet" from "nobody
handed me that repository's snapshot"; those want opposite reactions, and both otherwise render as
an empty list.

## Ports from

`rickylabs/netscript`, where this taxonomy was proven. The repo-specific half was left behind
deliberately — see `detect.ts`.
