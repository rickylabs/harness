# Concepts

*Why is it built this way?*

Six pages, meant to be read in order. They are the only pages here no generator can produce —
reference is rendered from the code, but the reasoning behind a decision exists nowhere except in
someone's head until it is written down, and then it is the most durable thing in the repository.

1. [**What this is**](01-what-this-is.md) — a coordinator layer, and the three things it is
   deliberately not. Read first; most misunderstandings of this project are answered here.
2. [**Two seams, not one**](02-the-two-seams.md) — the central architectural finding. If you read
   one page, read this one.
3. [**The board**](03-the-board.md) — why GitHub holds board truth and `dsh` only projects it.
4. [**What "run" means**](04-the-run.md) — the word names two different things. Both are correct.
5. [**Determinism**](05-determinism.md) — generated files, golden snapshots, replay, and why drift
   is a bug rather than untidiness.
6. [**The three layers**](06-the-three-layers.md) — the owner-locked responsibility model across
   coordination, the product backend and the client, and the two published carriers between them.

The order is not arbitrary: 2 explains the split the packages are cut along, 3 explains where state
lives, and 4 and 5 are the two places a newcomer most reliably trips — an overloaded word and a
guarantee that looks like ceremony until you have watched a board silently report itself empty. 6
draws the full deployment picture those five pages sit inside.

## What is not here

- **How to do a specific thing** → [`how-to/`](../how-to/).
- **Flags, subcommands, exit codes** → [`reference/`](../reference/), generated.
- **How work is staged, reviewed and gated** → [`doctrine/`](../../doctrine/). That is method, it is
  portable to any repository, and it deliberately lives outside `docs/`.
- **The design rationale for one package** → that package's README. Those are the deepest documents
  in the repository; these pages link to them rather than summarising them.

---

Back to [docs](../README.md)
