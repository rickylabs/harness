# What "run" means

The word means two different things in this repository. Both are correct, both are load-bearing, and
neither is going to be renamed. This page exists so that nobody has to work that out from context.

| | A **doctrine run** | A **telemetry run** |
| --- | --- | --- |
| Is | a unit of *work*, staged and reviewed | a unit of *execution* — one agent session |
| Lives in | `.llm/runs/<slug>/`, committed | a vendor transcript, read after the fact |
| Named by | a slug you choose: `<topic>--<qualifier>` | an id the vendor assigned |
| Created by | a person or an agent starting work | Claude Code, Codex or opencode starting up |
| Ends when | the work is ratified and merged | the session exits, or stops being written to |
| Defined by | [`doctrine/WORKFLOW.md`](../../doctrine/WORKFLOW.md) | [`packages/telemetry`](../../packages/telemetry) |

The relationship is one-to-many and unsurprising once stated: **one doctrine run spans many telemetry
runs.** A single piece of work takes days, several agents and a dozen sessions. The doctrine run is
the thing with a beginning and an end; the telemetry runs are what actually burned quota inside it.

## Why the collision was not resolved by renaming

Both names arrived from outside and both are the natural word in their own domain.

The vendors call a session a run. Claude Code, Codex and opencode each write one, and telemetry's
job is to read what they wrote — with nothing awake, after the fact, from files those tools already
produce. Renaming the concept inside this repository would mean maintaining a translation layer
against three vendors' vocabulary forever, which is a permanent cost to avoid a moment's confusion.

The doctrine's `run` came from the other direction: it is the unit the method is written in, it
predates this repository, and it ported here from an unrelated stack unchanged. Renaming it would
break the portability that is the entire argument for keeping doctrine separate from the packages
([01 — What this is](01-what-this-is.md)).

So the collision is documented instead. In practice they are trivial to tell apart: a doctrine run
is a **directory with a slug**; a telemetry run is a **record with a vendor id**.

## The doctrine run, briefly

Runs here are **durable and committed.** A run directory is opened, filled with staged artifacts as
the work proceeds, reviewed as a pull request, and kept. One run means one slug, one branch, one pull
request, and the slug appears in all three.

That is a deliberate divergence from the ephemeral scratch-directory convention this doctrine came
from, and [`doctrine/WORKFLOW.md`](../../doctrine/WORKFLOW.md) records it as an open architectural
question rather than a settled one. It buys reviewable reasoning: the argument for a change arrives
in the same pull request as the change, and it is still there a year later.

`WORKFLOW.md` owns the stages, the artifacts each produces, and the verdict vocabulary. It is short,
it is the thing to read before starting work, and this page does not restate it.

Two of its properties are worth knowing even if you never open it, because they explain things you
will otherwise meet as surprises:

- **A run declares its mutation surface up front** — the exact paths it may write. Anything found
  outside that surface afterwards is drift, not scope. This is why a run that grows an extra fix
  along the way has to say so rather than simply include it.
- **A finding without a citation is not a finding.** Discovery is held to that bar deliberately: an
  agent's recollection of what the code does is the single most expensive error in this system, and
  the citation requirement is what makes it cheap to catch.

## The telemetry run, briefly

A record of one session: where it ran, what it cost, what it touched, and whether it finished.
Reconstructed by reading what the vendor tools already write to disk, which is why it works when the
agent is gone, the terminal is closed, and the machine has been rebooted — the property that makes
it an answer to "status ?" rather than another thing to ask.

Two design facts have consequences you will notice:

**A run can join to no board item at all.** Those are collected rather than dropped. Work that
happened and left no trace on the board is precisely the visibility gap this project exists to
close, so it is a result, not a gap in the data.

**The path to the transcript is recorded, and it does not leave the machine.** `dsh-telemetry why
<run-id>` exists to hand an operator the file to open. Every projection meant to travel excludes it,
because a transcript path is a local fact and, on a shared host, a private one.

[`packages/telemetry/README.md`](../../packages/telemetry/README.md) owns the rest — the two halves
and how they join, the properties the output holds, and the exit statuses.

## When you see the word

| Where | Which one |
| --- | --- |
| `.llm/runs/…`, a run slug, `supervisor.md`, "stage F" | doctrine run |
| `dsh-telemetry`, a run id, `quota`, `usage`, "the run failed" | telemetry run |
| A branch name or a PR title | both — that is where they meet |

---

Next: [05 — Determinism](05-determinism.md) · Back to [docs](../README.md)
