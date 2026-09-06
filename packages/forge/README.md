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
dsh-forge swarm admit     # decide every /swarm comment the way the dispatcher would
dsh-forge swarm mirror    # the inbox issue each honoured trigger would open
```

Options: `--repo owner/name`, `--cwd <path>`, `--no-detect`, `--force`, `--dry-run`, `--json`,
`--config <path>`, `--snapshot <path>` (repeatable), `--comments <path>` (repeatable), `--seen <path>`.
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

## The comment trigger

`/swarm` is the one path by which work enters the fleet from outside the inbox: a comment on an issue
in a *target* repository, which the dispatcher mirrors into the inbox as a labelled issue and then
dispatches like any other. That makes it the fleet's authority boundary, and `dsh-forge swarm` is the
transliteration of the gate chain that guards it — same gates, same order, offline.

```bash
gh api "repos/denoland/deno/issues/comments?since=2026-09-01T00:00:00Z&per_page=100" > deno-comments.json
dsh-forge swarm admit --config ../divybot.json --comments deno-comments.json --snapshot deno.json
dsh-forge swarm mirror --config ../divybot.json --comments deno-comments.json --snapshot deno.json
```

`admit` prints one verdict per comment, unauthorised attempts first, and **exits `1` when any comment
carried a `/swarm` from somebody who is not the bot.** That is the one place this package departs
from `targets reconcile`'s rule that the contents are never drift: an inbox with unclaimed issues is
a day's work, but a stranger trying to spend the fleet's quota is an event, and a check that stays
green through it is not a check. The signal self-clears — whether the feed is windowed with `--since`
or the comment is listed in the dispatcher's `state.json` (`--seen`), the same attempt reads
`already-seen` next run, so the number counts *new* attempts rather than accumulating.

The free-text prompt is never printed. It is a stranger's prose whose entire purpose is to be
followed by an agent, and this output gets pasted into issues and quoted back into agent context; it
stays in `--json`, where a reader has to have gone looking for it.

### Four things the gate chain does that are not obvious

- **A target that *is* the inbox is skipped.** So in `rickylabs/harness` the trigger never fires at
  all: the inbox is where mirrors land, and a mirror that could trigger another mirror is a loop.
- **The `/swarm` test and the `/swarm` grammar are not the same test.** Admission needs the body to
  *start with* `/swarm` after trimming; the block parser needs a line equal to `/swarm` exactly. A
  comment reading `/swarm harness: claude` is therefore honoured with nothing parsed — it dispatches
  the target's default agent. Transliterated, not corrected.
- **The dedupe mark is taken before the author check.** An unauthorised attempt is recorded as seen,
  so it is refused once loudly and thereafter quietly. That is what makes the drift exit above
  survivable in CI.
- **Upstream's `err != nil || state != "open"` is split in two.** `issue-unknown` means no supplied
  snapshot covers the issue; `issue-not-open` means one does and it is closed. Upstream cannot tell
  those apart because it is holding an HTTP error; an operator reading this output needs to, since
  the first is a missing `--snapshot` and the second is a correct refusal.

There are **no attribution trailers**. Upstream hardcodes a `Co-Authored-By` into the mirrored issue;
our fork removed it, and `renderMirror` is byte-compared against the trailer-free template in the
suite so it stays removed. `admit` does report attribution trailers it finds *in the comment* —
those reach the agent's goal preamble and end up in its commits.

One caveat on `mirror`: `SourceIssue.body` is fetched for pull requests and deliberately not for
issues, so a mirror rendered from a board snapshot has a blank source section. It is a correct
preview of what would be filed, not the exact bytes a spawn would read.

## Ports from

`rickylabs/netscript`, where this taxonomy was proven. The repo-specific half was left behind
deliberately — see `detect.ts`.
