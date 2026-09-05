# @rickylabs/board

The board, projected from GitHub. Owned by **E6 · #36**.

```
dsh-board status     # milestone -> epic -> task, with progress rolled up
dsh-board columns    # the kanban view
dsh-board check      # exit 1 when the board contradicts itself
dsh-board snapshot   # the projection as JSON
dsh-board doctor     # transport and repository detection
```

## What it is for

To make `status ?` unnecessary. The command reads GitHub and prints the answer; no agent is
consulted, so it still works when every agent is asleep, wedged, or out of quota — which is when
the question actually gets asked.

## The projection is pure

`projectBoard` and `buildHierarchy` take data and return data. They take their timestamp as an
argument instead of reading a clock, so projecting the same issues twice produces a byte-identical
snapshot, and a diff between two snapshots means something.

Nothing here writes to GitHub. Decision 3 of #30 makes GitHub the truth and dsh the projection —
*if the projection and the issue disagree, the issue wins*. That is enforced by construction: the
adapter has no write path at all. Every disagreement becomes an `Anomaly` naming what the issue
says; nothing is repaired, reordered into plausibility, or hidden.

## Anomalies are the point, not an error path

A board that renders cleanly by ignoring what it cannot explain is worse than no board. `check`
reports every contradiction it can name, in `AnomalyKind` order:

| kind | meaning |
|---|---|
| `multiple-status` | two status labels; the item is in two columns and the board is lying |
| `unknown-status` | a status label outside the lifecycle |
| `no-status` | open work in no column — invisible to the board |
| `epic-not-found` | an `epic:` label no epic issue claims |
| `closed-but-unshipped` | closed on GitHub, still sitting in a live column |
| `shipped-but-open` | in the terminal column, still open |
| `closed-unmerged` | a pull request that claims delivery and never landed |
| `duplicate-epic-slug` | two epic issues answer to one slug, so "which epic" has no answer |
| `epic-milestone-conflict` | a task filed under a different milestone from its own epic |
| `epic-closed-by-child` | an umbrella closed while its children are still open |
| `closing-keyword-targets-epic` | an open PR whose keyword will close an umbrella on merge |
| `duplicate-label` | two labels of one family, so reading that family is a coin toss |
| `incomplete-fetch` | the fetch was capped; this board is a prefix of the real one |

This table used to open with "six kinds" and list six, while the type had carried eleven for some
time — a generated view of a hand-counted list, which is the same class of drift the last two rows
exist to catch. There is no count in the sentence any more.

The first run against this repository reported 87 items with no status label at all, which is an
accurate measurement of a real problem rather than a defect in the projection. The two epic rows
come from a later one: PR #105 implemented one task of six, its closing keyword named the *epic*,
and for two hours the board reported six unstarted children as delivered work.

## The lifecycle is configuration

`DEFAULT_LIFECYCLE` matches what `dsh-forge` stamps, so the common case needs no configuration.
It is a default, not a coupling: this package has no dependency on `forge`, and a repository with
different columns passes its own `Lifecycle`.

`@rickylabs/contracts` (#79) now restates the `Phase` and `Lifecycle` *shape* for the two cockpits,
and the phase **list** travels to them on the snapshot as data. It restates rather than imports
because it is the one publishable package and cannot depend on a private one — and it carries no
list of its own on purpose: `scripts/check-lifecycle.mjs` compares the two lists that must agree,
and a third copy, versioned and compiled into two clients on their own release cadence, would be the
one copy nothing can check.

## One dispatch payload

`DispatchRequest` is the single dispatch shape #36 asks for, with `renderSwarm` / `parseSwarm` as
its wire format. Today it serialises to a `/swarm` block that divybot executes; tomorrow the same
struct goes to an E3 provider. No second grammar.

Two things worth knowing before using it:

- **`validateDispatch` rejects a request with no `model`.** A `/swarm` block without one does not
  fail — it launches against whatever the provider's own config file says, so the run that
  executes is not the run the matrix selected and nothing in the record shows the substitution.
  Launch identity is data, not an inherited default.
- **`parseSwarm` cannot check authorship, and authorship is a security property.** A `/swarm`
  block is only honoured in an inbox issue body or in a comment *by the bot login*. Callers must
  verify the author before parsing. Parsing attacker-controlled text and acting on it is the whole
  vulnerability.
