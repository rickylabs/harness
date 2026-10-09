# CLAUDE.md

See [`AGENTS.md`](AGENTS.md), then [`docs/DOCTRINE.md`](docs/DOCTRINE.md). The protocol is identical in
standard mode; the only difference is that you are expected to ask before mutating anything outside
the active run directory.

## Owner rules, first

Lower number wins (O1 > O2 > O3 > O4); the full text is in
[`docs/DOCTRINE.md`](docs/DOCTRINE.md#golden-rules).

- **O1.** What is the idiomatic way in NetScript to ship this feature? Ask the NetScript MCP or docs
  first and use the seam it gives. Never hand-roll what a primitive provides.
- **O2.** Are we following SOLID?
- **O3.** Is it performant?
- **O4.** Does it respect the doctrine?

## Where to read

- **Rules:** [`docs/DOCTRINE.md`](docs/DOCTRINE.md). Every pull request answers O1-O4 and cites
  the doctrine rules by number.
- **Tree and consumer surfaces:** [`docs/STRUCTURE.md`](docs/STRUCTURE.md).
- **Ratified decisions:** [`AGENTS.md`](AGENTS.md#ratified-decisions-you-inherit) and
  [`docs/decisions/`](docs/decisions/).
- **Skills:** listed in [`AGENTS.md`](AGENTS.md#skills): `doctrine`, `prune`, `parity-tests`,
  `package-layout` and the generated `board-process`.

## Before you touch the board

**This repository is the Orchid dispatch inbox.** divybot polls it every 30 seconds, and
applying the **`harness`** label to an issue starts a real agent on a real host against that
issue's body — no draft state, no confirmation. Label deliberately: tidying up the board is
enough to spend a run. A dispatched issue body must contain **no fenced code blocks**, because a
parser that stops at a fence runs the truncated brief without reporting that it did.

The generated rulebook is [`.claude/skills/board-process/SKILL.md`](.claude/skills/board-process/SKILL.md);
the hazard is stated in full in [`AGENTS.md`](AGENTS.md#operational-hazard-this-repository-is-a-live-inbox).
The board, without asking an agent: `harness-board status`, `harness-board check`.
