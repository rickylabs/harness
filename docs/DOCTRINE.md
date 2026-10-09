# Doctrine

This page holds every rule this repository is held to. [`STRUCTURE.md`](STRUCTURE.md) gives the tree
these rules shape. To change a rule, record a numbered decision in [`decisions/`](decisions/) that
supersedes it; do not edit a rule silently. The skill
[`.claude/skills/doctrine/SKILL.md`](../.claude/skills/doctrine/SKILL.md) loads this page into an agent
session.

## Golden rules

The golden rules are two sets. The **owner rules O1-O4** are four questions every change answers, in
priority order: a lower number wins (O1 > O2 > O3 > O4). The **doctrine rules 1-11** are the rules
below them, cited by bare number. "Golden rule 7" always means doctrine rule 7; an owner rule is always
written with its `O`.

How a pull request cites them (the template has the section):

- **Owner rules:** one line per rule, O1 to O4 in order, each answering the question and citing a
  NetScript doc slug or a repository file.
- **Doctrine rules:** the numbers the change relies on or enforces ("Doctrine rules cited: 2, 3, 10").

### Owner rules O1-O4

- **O1. What is the idiomatic way in NetScript to ship this feature?** Ask the NetScript MCP or docs
  first and use the seam it gives. harness is a pnpm/Node repository and NetScript is a service behind
  an adapter, never a build-time dependency, so for vendor seams the idiomatic primitive is the
  vendor's official programmatic surface (Claude Agent SDK `query()` and hooks, Codex `app-server`,
  `@opencode-ai/sdk`, herdr `agent wait` / `report-agent`). Never hand-roll what a primitive provides.
- **O2. Are we following SOLID?**
- **O3. Is it performant?**
- **O4. Does it respect the doctrine** (the doctrine rules below and the rest of this page)?

### Doctrine rules 1-11


1. Use the NetScript primitive before writing your own. harness is pnpm/Node, so for vendor seams the
   "primitive" is the vendor's official programmatic surface: Claude Agent SDK `query()` + hooks, Codex
   `app-server`, `@opencode-ai/sdk`, ACP, herdr `agent wait` / `report-agent`. Never scrape a TUI.
2. One owner per query or concern. `packages/contracts` owns every shared shape; other packages import
   it, never re-parse it.
3. No duplicate code. No generated compatibility copies of docs, templates or tools.
4. File size cap: 500 lines per file (source: epic #622 golden rule 8). Enforced by the reviewer
   tonight; files already over it are split only when touched.
5. Model ids never in code: model catalog from `packages/routing/config/*.json` + per-CLI discovery.
6. No screen-text validation: agent state comes from native signals (herdr integrations, vendor
   hooks/events), never from matching rendered text or screenshots.
7. Regression tests only for parity features: the consumer surfaces listed in
   [`STRUCTURE.md`](STRUCTURE.md#consumer-surfaces) (what atelier-cockpit and orchid read from harness).
   Delete other legacy tests freely when the code they test is pruned.
8. SOLID + composition: each package has `mod.ts` as its only entry and
   `src/{domain,application,ports,adapters}`; `domain` imports nothing outward; vendors and hosts are
   adapters behind ports; compose, do not inherit.
9. One toolchain: pnpm workspace + Node 24. No Deno config or lockfile.
10. No empty packages; nothing tracked that is generated output. `.llm/runs/**` is owner-controlled
    and is never deleted or rewritten by an agent.
11. Public repo: `pnpm run check:leaks` before every PR; no hosts, IPs, ports, home or data paths,
    session ids or usage numbers in tracked files.

## Run invariants

A check that could not execute is **unproven**. An empty check set, an empty source or a missing
receipt certifies nothing. The independent evaluator assesses the exact changed head; it does not rely
only on the author's account of the gates.

- **I1: every spawn records its route authority and observations.** A default launch keeps its matrix
  source and resolution. A verified owner-native launch keeps the owner provenance and the exact route.
  Requested and observed model, effort, transport, role or tier, and session identity stay distinct.
- **I2: a generator never certifies itself.** Generator and evaluator are separate sessions from
  different vendor families. A missing evaluator is a blocker, not permission to weaken the rule.
- **I3: privileged tiers carry authority.** `complex` and `architecture` need a named authorized owner
  or coordinator and a nonempty rationale. An override never waives independence or budget.
- **I4: a blocked lane carries an open decision.** It records the question, the options, a
  recommendation and the cost of being wrong. A native startup or access block stays a truthful
  technical observation; it is never reported as a successful launch.

## Gates report three states

| Exit | Meaning |
| --- | --- |
| 0 | every stage ran and passed |
| 1 | a stage ran and refused |
| 2 | a stage did not reach a verdict (inconclusive, never green) |

A stopping chain names the stage that decided, says whether the designated compile stage ran, and names
every stage that never started. Run each gate's guard before the gate. Do not put a number in a
document unless something checks it. The full protocol is in [`scripts/gates.md`](../scripts/gates.md).

## Working rules

- **Code is truth.** Docs, specs and prior runs describe intent; where they disagree with the code,
  the code wins and the disagreement is a finding.
- **Artifacts over chat.** A conclusion that exists only in a conversation does not exist.
- **Citations or it is not a claim.** Every load-bearing statement carries a repository path, a
  document page, or a URL retrieved during the work. A belief is a spike, never an input to a decision.
- **Owner forks are raised, not resolved.** When the answer depends on what the owner wants, stop and
  record the question, the options, a recommendation and the cost if it is wrong.
- **Nothing mutates before the gate.** A plan is locked, attacked and evaluated before the board, the
  code or a host is touched.
- **Deterministic work belongs in the daemon.** Rescue, restart, health checks, sync and supervision are
  code, not model tokens.
- **Summary first.** Every artifact opens with what it concluded.
- **Vendor neutral.** Nothing here depends on which agent client opened the repository.
- **An absence is only as good as its reachability list.** A search that finds nothing proves nothing
  until every way the subject could be reached has been checked; see the
  [prune skill](../.claude/skills/prune/SKILL.md).

## Dispatch and route authority

The matrix in `packages/routing` is the default route authority. A verified owner-native override
records the authorizer, the rationale and the exact tool, provider, model and effort; it keeps the
physical checks and budget accounting. A free-text model request is not authority. Requested and
observed effort are recorded separately; a request is not proof the model applied it. The `harness`
label starts a real agent, so read the
[live-inbox hazard](../AGENTS.md#operational-hazard-this-repository-is-a-live-inbox) before touching an
issue.

## Cost

Subscription headroom, metered spend and run usage are three separate truths with different sources
and units. No blended price is invented for subscription turns. Unknown is not zero: a missing quota,
access or budget observation stays unknown. A transport with no quota source is explicitly unmetered
and uses configured physical capacity; it never consumes another vendor's meter.

## Run lifecycle

A run has one slug (`<topic>--<qualifier>`), one branch and one pull request. Its stages:

| Stage | Produces | Rule |
| --- | --- | --- |
| A Supervisor | `supervisor.md` | identity, baseline SHA, declared mutation surface |
| B Discovery | `research.md` | repo, document and external legs, all cited |
| C Synthesis | | contradictions surfaced, never averaged |
| D Design packs | drafts | marked draft, no mutation |
| E Plan lock | `plan.md` | decisions, owner forks, spikes, dependency DAG, risks |
| F Adversarial review | `adversarial-review.md` | a separate session attacks the plan |
| G Plan evaluation | `plan-eval.md` | until it reads `PASS`, nothing mutates |
| H Ratification and execution | the change | the owner ratifies forks; then execute |

`context-pack.md` (resumes the run cold), `worklog.md` (append-only) and `drift.md` (every deviation
with a disposition) are kept current through every stage. Once locked, a plan changes through
`drift.md`, not in place. Templates live in [`packages/method/templates/`](../packages/method/templates/).

Verdicts, used identically at F and G and at implementation review:

| Verdict | Meaning |
| --- | --- |
| `PASS` | proceed |
| `PASS AFTER NARROW FIXES` | proceed once the listed bounded fixes land; no re-review |
| `FAIL_FIX` | the plan is sound, parts are wrong; fix and re-run the stage |
| `FAIL_RESCOPE` | wrong problem; return to C |

Evaluation always uses a separate session from a different vendor family (I2). Query the route from
the routing authority for every dispatch; neither a remembered route nor an example in a brief
replaces a fresh query. An owner override is recorded in the worklog and never waives independence.

## Toolchain

The pnpm version equals `packageManager` in the root `package.json`; Node satisfies `engines`. CI
declares its own versions in its workflow. A host pins its toolchain outside the checkout, so every
worktree inherits the same pin and no version file is tracked.
