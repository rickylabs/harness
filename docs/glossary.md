# Glossary

Words this repository uses without stopping to explain them. Each entry says what the word means
*here* and points at whatever owns it; where a term has a page of its own, this is a signpost rather
than a summary.

Several of these are ordinary English words used precisely. That is the hazard the glossary exists
for — an unfamiliar word gets looked up, a familiar one gets assumed.

---

### bundle

A dsh artefact listing the rows that go onto a service entry list. This project ships one, rendered
from typed data in `src/bundle.ts` into
[`packages/dsh-app/cordis.patch.yml`](../packages/dsh-app/cordis.patch.yml) and byte-compared in the
test suite. A bundle here *adds* services and never reconfigures dsh's own — a patch that reaches
into the base rows is a fork wearing a config file.

### dispatch

Handing a task to an autonomous agent. In `rickylabs/harness` specifically, labelling an issue
`harness` **dispatches a real agent** on the N5 through divybot. It is an action, not a category
tag, and it is applied deliberately.

### doctrine

The portable half of this project: how work is staged, reviewed and gated, written as markdown with
no runtime, in [`doctrine/`](../doctrine/). It works in any repository in any language, which is why
it is not in `docs/` and not in a package. Compare **mechanics** — the parts a machine can enforce,
which are the packages.

### drift

A generated or derived artefact no longer matching its source, or a run writing outside its declared
**surface**. Drift is never a diff to eyeball: it is a failing check, because the alternative is a
document that quietly becomes a lie. See [05 — Determinism](concepts/05-determinism.md).

### epic

A numbered issue owning a slice of the architecture, and the unit the roadmap is organised in. The
`epic:*` labels are **derived** from the epic issues by `dsh-forge labels eject` — the issue comes
first, the label follows.

### gate

A check that decides whether something may proceed, as opposed to a phase that says where work is.
`flag:close-gate-override` and the `gate:*` labels are gates; the ten `status:` phases are not.
Keeping the two in separate prefixes is what makes "exactly one status label" a statement that can
be enforced. A gate that runs leaves a **receipt**.

### lane

A parallel track of work, so several agents can run without colliding. Four exist — `docs`,
`internals`, `fixes`, `features` — carried on `topic:*` labels. Under a **milestone cluster** each
lane has its own orchestrator and its own concurrency limits.

> **Naming note.** `lane:*` labels also exist in this repository and are unmanaged leftovers; the
> live prefix is `topic:`. `dsh-forge doctor` reports which prefix is in use, and the divergence is
> a recorded owner fork rather than a bug to fix quietly.

### milestone cluster

A milestone being worked by several agents at once, with the shape written down rather than
improvised: a baseline commit, one coordinator, one orchestrator per lane, and explicit limits —
how many implementation slices may be active per lane, how many evaluators, how many expensive gates
globally, how many writers a release may have. The templates are in
[`.llm/harness/templates/`](../.llm/harness/templates) and the validator in
[`.llm/tools/harness/`](../.llm/tools/harness).

### owner fork

A decision only the owner can make, raised rather than resolved. Where sources conflict or a choice
is outside an agent's authority, the run records a numbered fork with the question, the options, a
recommendation, and the cost of getting it wrong — and then proceeds with everything that does not
depend on the answer. Not deciding is a deliverable; guessing quietly is not.

On the board the same thing is a label: `flag:owner-decision`, carried *alongside* whichever phase
the work reached. A fork recorded only in a run's output is one the owner has to go looking for; the
flag is what puts it on the page they already read, and what stops the projection counting the item
as work in progress. See [03 — The board](concepts/03-the-board.md).

### profile

A dsh deployment: a named set of bundles and patches composed into one running system.
`dsh-profile` writes and checks this repository's. Layering is declarative — bundle, then profile,
then home, then `--patch`.

### projection

Rendering a view from a source of truth without owning any state. `dsh-board` projects GitHub into
columns; it holds nothing, so the view cannot disagree with the board. A pure projection is the
reason there is no sync job anywhere in this system. See [03 — The board](concepts/03-the-board.md).

### receipt

Durable evidence that a **gate** ran, and what happened. A `GateReceipt`
([`.llm/tools/gates/contract.ts`](../.llm/tools/gates/contract.ts)) carries the request it answers,
the commit it ran against, the runner's identity, the attempt number, timings, the exit code, and
hashed stdout and stderr — under a versioned schema, so a receipt written last month is still
readable.

The outcome vocabulary is the part worth internalising, because it refuses the usual collapse into
pass/fail: `PASS`, `FAIL`, `TIMED_OUT`, `SPAWN_FAILED`, `INTERRUPTED`, `SKIPPED` and `NOT_RUN` are
all *terminal*, and they mean genuinely different things. A gate that never started is not a gate
that failed, and a system that cannot tell them apart will eventually merge on the difference.

A set of receipts covering a declared surface is an **evidence set**, which is either `SUFFICIENT`
or `INSUFFICIENT` with reasons — never a bare boolean. Separately, a run's `receipts/` directory
holds the same idea in prose: a dated record of something that happened outside the repository, kept
so the claim is checkable a month later.

### row

One entry on a dsh service entry list — a plugin, plus the configuration it is constructed with.
Bundles are lists of rows, and "adding a row" is how this project attaches to dsh without forking it.

### run

Two different things, both correct: a **doctrine run** (a staged, reviewed unit of work living in
`.llm/runs/<slug>/`) and a **telemetry run** (one agent session, reconstructed from a vendor
transcript). One doctrine run spans many telemetry runs. This collision is documented rather than
renamed — see [04 — What "run" means](concepts/04-the-run.md).

### seam

Where a model attaches, and how it is paid for. Two, deliberately: `ctx.subagents` (autonomous
vendor CLIs, metered by a quota window) and `ctx.llm` (API-key and local models, metered per token).
The coordinator names the same pair `subscription` and `relay`. See
[02 — Two seams, not one](concepts/02-the-two-seams.md).

### surface

The **mutation surface**: the exact set of paths a run declares, up front, that it may write.
Anything found outside it afterwards is **drift**, not scope. Declared in a run's `supervisor.md`
([`doctrine/WORKFLOW.md`](../doctrine/WORKFLOW.md)). An **evidence set** carries a `surface` field in
the same sense — the scope the gates it collects are claimed to cover.

---

Back to [docs](README.md)
