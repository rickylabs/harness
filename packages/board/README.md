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
reports six kinds of contradiction:

| kind | meaning |
|---|---|
| `multiple-status` | two status labels; the item is in two columns and the board is lying |
| `unknown-status` | a status label outside the lifecycle |
| `no-status` | open work in no column — invisible to the board |
| `epic-not-found` | an `epic:` label no epic issue claims |
| `closed-but-unshipped` | closed on GitHub, still sitting in a live column |
| `shipped-but-open` | in the terminal column, still open |

The first run against this repository reported 87 items with no status label at all, which is an
accurate measurement of a real problem rather than a defect in the projection.

## The lifecycle is configuration

`DEFAULT_LIFECYCLE` matches what `dsh-forge` stamps, so the common case needs no configuration.
It is a default, not a coupling: this package has no dependency on `forge`, and a repository with
different columns passes its own `Lifecycle`. When `@rickylabs/contracts` is published it should
own the shape and both packages should import it from there.

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
