# Independent plan-review disposition — public-docs-relaunch--e10

**Verdict received: `FAIL_FIX`. All three required findings are fixed, and both non-blocking findings
are dispositioned.** Review source: `.git/seat3-plan209-eval.txt`, produced by the independent Opus plan
review for E10 child #209. No public documentation or product code changed in response.

## Required findings

### F1 — Evidence-to-GitHub arrow asserted automation

**Accepted and fixed.** The diagram no longer draws evidence directly to GitHub. It now passes through
an explicitly labeled “Human or dispatcher chooses a GitHub update” node. The mandatory caption says
this is an action, and that `dsh-board` only reads and projects GitHub. This matches the coordinator's
own boundary: workflow data decides what may run, while doing the effect belongs to another caller
([`packages/coordinator/src/workflow.ts:1-8`](../../../packages/coordinator/src/workflow.ts)). The board
transport type permits only three read commands
([`packages/board/src/github.ts:105-126`](../../../packages/board/src/github.ts)).

### F2 — Diagram omitted the repository's GitHub write boundary

**Accepted and fixed.** The diagram now shows `dsh-forge` between the human and GitHub for explicit
labels/process setup. The caption names it as a separate mutation boundary and cites the transport
interface plus its POST/PATCH implementations
([`packages/forge/src/labels/github.ts:34-43`](../../../packages/forge/src/labels/github.ts),
[`packages/forge/src/labels/github.ts:87-109`](../../../packages/forge/src/labels/github.ts)). The node
does not imply that forge automatically writes run evidence.

### F3 — Stale concept citation and provider split were imprecise

**Accepted and fixed.** Research now cites the stale statement at
[`docs/concepts/02-the-two-seams.md:118-131`](../../../docs/concepts/02-the-two-seams.md), explicitly
identifying lines 126–127. Its claim inventory now has separate rows for `provider-claude`,
`provider-opencode`, `provider-codex`, `provider-acp`, `llm-local`, and the empty composed subagent
registry. W3 repeats the exact repair: Claude, opencode, and `llm-local` are implemented; Codex and ACP
remain stubs; implementation does not imply profile registration or live reachability.

## Non-blocking findings

### N1 — Phone review had no pass condition

**Accepted and fixed.** W2 now requires both a GitHub-rendered preview at 375 CSS pixels and Markdown
wrapped to 80 columns. It defines containment, prose fallback, non-color heading, ordering, and status
criteria. W5 independently repeats that gate.

### N2 — Validation matrix double-counted checks

**Accepted and clarified.** The matrix retains focused `check:links` and `check:docs` rows because their
outputs diagnose documentation failures. It now states that the full workspace row is the single
aggregate acceptance receipt and that root `build` already invokes both checks
([`package.json:12-24`](../../../package.json)).

## Re-review state

The corrected artifacts remain plan-only. Independent re-evaluation should read `research.md`,
`plan.md`, and this disposition against the same pinned baseline before any README implementation wave
begins.
