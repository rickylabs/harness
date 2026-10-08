---
name: doctrine
description: >-
  The golden rules of rickylabs/harness and how to cite them. Use this before planning or opening any
  pull request here, before adding a file or a dependency, and whenever a reviewer asks "which rule
  does this follow?" — even for a one-line docs change. It covers the four owner rules O1-O4, the
  eleven doctrine rules, the 500-line cap, the leak check, and the "Golden rules" section every PR
  body carries.
---

# Doctrine

The rules are in [`docs/DOCTRINE.md`](../../../docs/DOCTRINE.md), and that page is the only copy. This
skill tells you how to apply them. If this summary and the page disagree, the page wins.

## The owner rules O1-O4, first

Four questions every change answers, in this order. A lower number wins (O1 > O2 > O3 > O4).

- **O1.** What is the idiomatic way in NetScript to ship this feature? Ask the NetScript MCP or docs
  first (`find_guidance`, `search_docs`, `get_doc`) and use the seam it gives. NetScript is a service
  behind an adapter, never a build-time dependency, so for a vendor seam the primitive is the vendor's
  official programmatic surface. Never hand-roll what a primitive provides.
- **O2.** Are we following SOLID?
- **O3.** Is it performant?
- **O4.** Does it respect the doctrine (the eleven rules below)?

If the MCP is unavailable, say so in the PR and cite repository files instead; never invent a slug.

## The eleven doctrine rules, in one line each

A bare number always means a doctrine rule: "golden rule 7" is doctrine rule 7.

1. Use the primitive: the vendor's official programmatic surface (Agent SDK `query()` + hooks, Codex
   `app-server`, `@opencode-ai/sdk`, ACP, herdr `agent wait` / `report-agent`). Never scrape a TUI.
2. One owner per shape: `packages/contracts` owns shared shapes; everyone else imports them.
3. No duplicate code, and no generated compatibility copies.
4. 500 lines per file at most; a file already over it is split when you touch it.
5. No model ids in code; the catalog comes from `packages/routing/config/*.json` + discovery.
6. No screen-text validation; agent state comes from native signals.
7. Regression tests only for the consumer surfaces in
   [`docs/STRUCTURE.md`](../../../docs/STRUCTURE.md#consumer-surfaces).
8. `mod.ts` + `src/{domain,application,ports,adapters}`; `domain` imports nothing outward.
9. One toolchain: pnpm + Node 24.
10. No empty packages, no tracked generated output; never touch `.llm/runs/**`.
11. Public repo: `pnpm run check:leaks` before every PR; no hosts, IPs, ports, home or data paths,
    session ids or usage numbers.

## Citing them in a pull request

The PR template has a **Golden rules** section with two parts:

- **Owner rules:** one line per rule, O1 to O4 in order. Each line answers the question and cites a
  NetScript doc slug (for example `mcp#architecture`) or a repository file.
- **Doctrine rules cited:** the numbers your change relies on or enforces, each with a few words:
  "3 (deleted the generated copies), 10 (`.llm/runs` untouched)".

A reviewer checks the diff against exactly those rules, and rejects the PR for any rule it breaks,
cited or not.

## Checks to run before you open the PR

- The cap, on every file you added, modified or renamed. Anything printed is over the cap:

      git diff --name-only --diff-filter=AMR origin/main | xargs wc -l | awk '$2 != "total" && $1 > 500'

- `pnpm run typecheck`, `pnpm run build`, `pnpm test`, with the real output and exit codes in the body.
- `pnpm run check:leaks`.
- For every path, script or package name you removed or renamed: a whole-repo `git grep`, excluding
  `.llm/runs`, with its empty result pasted (see the [prune skill](../prune/SKILL.md)).

## When a rule is in the way

Do not work around it, and do not edit `docs/DOCTRINE.md` in passing. Raise an owner fork: the
question, the options, your recommendation and the cost if it is wrong. A rule changes only through a
numbered decision in [`docs/decisions/`](../../../docs/decisions/).
