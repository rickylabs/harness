# Research — public-docs-relaunch--e10

**Stage B complete for E10 child [#209](https://github.com/rickylabs/harness/issues/209), a plan-only
documentation lane under #140.** The public front door should be rewritten
around one honest mental model: this repository supplies deterministic coordination around stochastic
agent work. It should explain the human/agent split and the current integration boundary before it
offers an install command. The current README contains most required facts, but introduces five CLIs
before the coordinator loop, mixes package implementation with live availability, and carries at least
one stale concept page.

This run writes only `research.md` and `plan.md`. It does not choose or build a docs site, alter the
product or public docs, publish a package, touch GitHub, inspect private host state, or mutate a sibling
repository.

## Evidence baseline

| Source | Pinned revision | Read for |
| --- | --- | --- |
| `rickylabs/harness` | `9d800b54e447a600d8afab2ff90d07455b13a9c7` | Current public docs, package source, manifests, checks |
| `rickylabs/netscript` | `08f581e8334485c29c845b39615276c59b48cc35` | Front-door order, quickstart proof, docs information architecture |
| `rickylabs/eis-chat` | `90b6d866d1f0b078a82fce5b1851275647c982af` | Boundary presentation and dependency-direction diagram |
| `rickylabs/ledgerline` | `5cbb38a88328911b672a3d314055804db79405b4` | Visual hierarchy and repeated presentation grammar only |

The sibling repositories were read-only prior art. No claim about harness behavior comes from them.
Historical claims from issue #140 are excluded from the current-state inventory; code at the pinned
harness baseline wins, as required by [`doctrine/PRINCIPLES.md:1-8`](../../../doctrine/PRINCIPLES.md).

## Findings

### 1. The front door starts in the middle of the story

The README's opening is accurate and concise: it calls harness the deterministic coordinator layer,
names GitHub board projection, and says the layer operates without waking an agent
([`README.md:8-16`](../../../README.md)). It then routes to the board and docs
([`README.md:18-27`](../../../README.md)) and immediately introduces five commands
([`README.md:31-45`](../../../README.md)) and build instructions
([`README.md:47-74`](../../../README.md)). The coordinator model begins much later under “The idea,
in one page” ([`README.md:115-151`](../../../README.md)); the motivating human workflow appears later
still ([`README.md:202-216`](../../../README.md)).

That order makes a newcomer decode package names before learning what the layer coordinates, which
decisions remain human, and what must already be running. A from-scratch rewrite should preserve the
opening precision while moving the problem, system loop, and division of responsibility above every
installation path.

NetScript demonstrates the useful order: a concrete product proposition and two audience actions in
the hero (`docs/site/index.vto:7-14`), the failure at the seams immediately below it
(`docs/site/index.vto:16-23`), an end-to-end diagram before the detailed capability grid
(`docs/site/index.vto:44-50`), and explicit destinations at the end
(`docs/site/index.vto:150-159`), all at pinned revision `08f581e…`. Its quickstart states the end
condition and ownership knowledge before prerequisites (`docs/site/quickstart.vto:7-15`) and validates
the installed CLI before scaffolding (`docs/site/quickstart.vto:18-39`). Those are presentation
patterns, not behavioral evidence for harness.

### 2. The public mental model must separate three actors

The code describes a workflow as inert data; deciding what may run is pure, while performing an
effect is somebody else's job ([`packages/coordinator/src/workflow.ts:1-19`](../../../packages/coordinator/src/workflow.ts)).
Its step kinds distinguish reads, gates, and effects, and every effect must have an upstream gate
([`packages/coordinator/src/workflow.ts:22-45`](../../../packages/coordinator/src/workflow.ts),
[`packages/coordinator/src/workflow.ts:122-137`](../../../packages/coordinator/src/workflow.ts)). The
built-in milestone flow makes task creation, dispatch, and landing explicit effects behind named
gates ([`packages/coordinator/src/workflow.ts:160-252`](../../../packages/coordinator/src/workflow.ts)).

The public split can therefore be stated without inventing automation:

- A human supplies intent in GitHub, resolves owner forks, and accepts consequential outcomes. GitHub
  is the board authority; `dsh-board` fetches and projects it
  ([`packages/board/src/cli.ts:3-7`](../../../packages/board/src/cli.ts),
  [`packages/board/src/cli.ts:190-208`](../../../packages/board/src/cli.ts)). Its GitHub runner's type
  permits only `issue list`, `pr list`, and `repo view`
  ([`packages/board/src/github.ts:105-126`](../../../packages/board/src/github.ts)).
- Agents do the stochastic research, implementation, and review work. Autonomous vendor CLIs attach
  through `ctx.subagents`; prompt-completion models attach through `ctx.llm`, with different units of
  work and meters ([`docs/concepts/02-the-two-seams.md:5-16`](../../../docs/concepts/02-the-two-seams.md),
  [`docs/concepts/02-the-two-seams.md:42-69`](../../../docs/concepts/02-the-two-seams.md)).
- Harness supplies deterministic projection, eligibility, evaluator independence, recording, and
  replay. It exposes commands and Cordis services; a dispatcher or operator must call them. The code
  explicitly says the workflow definition does not do the work itself
  ([`packages/coordinator/src/workflow.ts:1-8`](../../../packages/coordinator/src/workflow.ts)).
- `dsh-forge` owns the repository's explicit GitHub label mutation boundary: its transport separates
  read methods from `createLabel` and `updateLabel`, and both mutations issue named POST/PATCH requests
  ([`packages/forge/src/labels/github.ts:34-43`](../../../packages/forge/src/labels/github.ts),
  [`packages/forge/src/labels/github.ts:87-109`](../../../packages/forge/src/labels/github.ts)). This is
  tooling an operator invokes, not an automatic evidence-to-GitHub loop.

EIS-Chat's accepted RFC 0004 is the presentation reference for this boundary: its “may depend on / must
not depend on” table makes ownership falsifiable (`docs/rfcs/0004-modular-netscript-workspace.md:33-45`)
and one text diagram shows dependency direction (`…:46-65`) at pinned revision `90b6d866…`. Harness's
README needs an equally assessable system diagram, but its arrows must describe the current code above.

### 3. “Shipped” is not one state

The workspace has fifteen packages; eleven have implementation and four explicitly open with
`Status: stub` ([`packages/README.md:1-24`](../../../packages/README.md),
[`packages/governance/README.md:1-8`](../../../packages/governance/README.md),
[`packages/netscript-bridge/README.md:1-10`](../../../packages/netscript-bridge/README.md),
[`packages/provider-codex/README.md:1-10`](../../../packages/provider-codex/README.md),
[`packages/provider-acp/README.md:1-9`](../../../packages/provider-acp/README.md)). Five packages
declare public command-line binaries and the generated CLI index covers those five
([`scripts/cli-reference.mjs:31-41`](../../../scripts/cli-reference.mjs),
[`scripts/cli-reference.mjs:46-82`](../../../scripts/cli-reference.mjs)).

Implementation does not imply live composition. `provider-claude` and `provider-opencode` have real
package entry points, builds, and tests
([`packages/provider-claude/package.json:1-28`](../../../packages/provider-claude/package.json),
[`packages/provider-opencode/package.json:1-29`](../../../packages/provider-opencode/package.json)).
Yet the composed `ctx.subagents` plugin deliberately registers an empty, telemetry-instrumented
registry ([`packages/dsh-app/src/plugins/subagents.ts:10-33`](../../../packages/dsh-app/src/plugins/subagents.ts),
[`packages/dsh-app/src/plugins/subagents.ts:80-97`](../../../packages/dsh-app/src/plugins/subagents.ts)).
The local LLM adapter registers three backend routes, but actual reachability and credentials are
resolved at dispatch ([`packages/dsh-app/src/plugins/llm.ts:52-80`](../../../packages/dsh-app/src/plugins/llm.ts),
[`packages/dsh-app/src/plugins/llm.ts:96-124`](../../../packages/dsh-app/src/plugins/llm.ts)).

The profile itself is private and linked to the current checkout; moving or deleting that checkout
breaks the profile ([`packages/dsh-app/src/profile.ts:17-29`](../../../packages/dsh-app/src/profile.ts)).
The repository includes one N5 deployment, but its README calls that deployment rather than the
portable product ([`deploy/README.md:1-12`](../../../deploy/README.md)). A public README must therefore
use at least these distinct labels:

| Label | Meaning |
| --- | --- |
| **Implemented** | Source and meaningful tests exist in this workspace. |
| **Composed** | The `dsh-app` profile actually registers the service or adapter. |
| **Host-dependent** | Use requires a live provider/server, credential, GitHub transport, or deployment wiring not supplied by a clone. |
| **Stub** | The package reserves dependency shape and exports a placeholder only. |

“Production ready,” “autonomous swarm,” and “installable from a registry” are unsupported at this
baseline and must not appear.

### 4. Existing docs contain useful owned material and detectable drift

The docs already separate concepts, tutorials, how-to, reference, and a glossary
([`docs/README.md:1-48`](../../../docs/README.md)). Generated CLI pages derive help text and exit codes
from built binaries and compare byte-for-byte
([`scripts/cli-reference.mjs:1-20`](../../../scripts/cli-reference.mjs),
[`scripts/cli-reference.mjs:221-266`](../../../scripts/cli-reference.mjs)). Relative links and GitHub
anchors are checked, while external links are deliberately counted but not fetched
([`scripts/check-links.mjs:1-38`](../../../scripts/check-links.mjs),
[`scripts/check-links.mjs:290-304`](../../../scripts/check-links.mjs)). Root `build` runs link checks,
generated-doc checks, package builds, tests around other repository invariants, and CI runs typecheck,
build, and tests ([`package.json:12-28`](../../../package.json),
[`.github/workflows/ci.yml:31-63`](../../../.github/workflows/ci.yml)).

The current concept page is stale at exactly lines 126–127: it says all four provider packages and
`llm-local` are stubs
([`docs/concepts/02-the-two-seams.md:118-131`](../../../docs/concepts/02-the-two-seams.md)). The correct
split is narrower: `provider-claude`, `provider-opencode`, and `llm-local` are implemented;
`provider-codex` and `provider-acp` explicitly remain stubs; and the composed subagent registry is still
empty. Those are separate inventory rows below. Link correctness alone cannot catch semantic drift. The
relaunch needs a claim inventory whose rows point to code owners, plus a review step that checks every
status claim against the merged baseline.

### 5. Presentation should favor hierarchy over decoration

The Ledgerline reference sheets use a repeatable visual grammar and make one primary value dominate
each composition (`DESIGN-REFERENCES.md:67-84`) at pinned revision `5cbb38a8…`. Its design review
identifies repetition, confident hierarchy, and putting accent on the data as the source of clarity
(`DESIGN-DIRECTION.md:48-67`). Applied to Markdown, that means: one dominant proposition, one compact
system diagram, short status labels, and consistent audience-path blocks. It does not justify adding
screenshots, branded art, cards, or a docs site to harness.

## Current executable evidence

Executed locally against built artifacts at the pinned harness baseline without network access,
credentials, home-directory telemetry, or host inspection:

| Check | Result |
| --- | --- |
| `pnpm run check:links` | exit 0; 57 Markdown files, 294 relative links, 25 anchors, 0 broken; 110 external links explicitly not fetched |
| `pnpm run check:docs` | exit 0; six generated files match the five binaries |
| each of the five built CLIs with `--help` | exit 0 |
| `node packages/coordinator/dist/cli.js policies` | exit 0; prints both policies and the default |

These prove the current local documentation and help surfaces agree structurally. They do not prove a
provider, GitHub account, local model server, deployment, or autonomous orchestration loop is live.

## Auditable claim inventory for implementation

Every claim in the new README must receive one inventory row before prose lands.

| Claim family | Code/document authority | Allowed public claim | Forbidden shortcut |
| --- | --- | --- | --- |
| Product identity | [`package.json:1-10`](../../../package.json), [`AGENTS.md:12-20`](../../../AGENTS.md) | dsh plugin layer and deterministic coordinator layer | complete fleet platform |
| Board truth | [`packages/board/src/github.ts:105-126`](../../../packages/board/src/github.ts), [`packages/board/src/cli.ts:190-208`](../../../packages/board/src/cli.ts) | reads GitHub and projects a board | writes task state or owns a second task database |
| Workflow/gates | [`packages/coordinator/src/workflow.ts:22-45`](../../../packages/coordinator/src/workflow.ts), [`packages/coordinator/src/workflow.ts:160-252`](../../../packages/coordinator/src/workflow.ts) | declares and checks gated effects | executes the whole workflow autonomously |
| Two model seams | [`packages/dsh-app/src/plugins/subagents.ts:1-33`](../../../packages/dsh-app/src/plugins/subagents.ts), [`packages/dsh-app/src/plugins/llm.ts:1-31`](../../../packages/dsh-app/src/plugins/llm.ts) | separate task and prompt paths | one generic model pool |
| `provider-claude` | [`packages/provider-claude/README.md:1-19`](../../../packages/provider-claude/README.md), [`packages/provider-claude/package.json:1-28`](../../../packages/provider-claude/package.json) | implemented; a composition root must inject the SDK; not registered by the profile's empty subagent registry | shipped means composed or live |
| `provider-opencode` | [`packages/provider-opencode/README.md:1-16`](../../../packages/provider-opencode/README.md), [`packages/provider-opencode/package.json:1-29`](../../../packages/provider-opencode/package.json) | implemented; requires a long-lived external `opencode serve`; not registered by the profile's empty subagent registry | shipped means composed or live |
| `provider-codex` | [`packages/provider-codex/README.md:1-10`](../../../packages/provider-codex/README.md) | stub | provider implementation exists |
| `provider-acp` | [`packages/provider-acp/README.md:1-9`](../../../packages/provider-acp/README.md) | stub | provider implementation exists |
| `llm-local` | [`packages/llm-local/README.md:1-17`](../../../packages/llm-local/README.md), [`packages/dsh-app/src/plugins/llm.ts:96-124`](../../../packages/dsh-app/src/plugins/llm.ts) | implemented; adapter composed for three routes; each destination remains host-dependent | registered route means reachable backend |
| Subagent composition | [`packages/dsh-app/src/plugins/subagents.ts:80-97`](../../../packages/dsh-app/src/plugins/subagents.ts) | composed registry is empty | implemented providers are automatically registered |
| Forge write boundary | [`packages/forge/src/labels/github.ts:34-43`](../../../packages/forge/src/labels/github.ts), [`packages/forge/src/labels/github.ts:87-109`](../../../packages/forge/src/labels/github.ts) | explicit label create/update tooling mutates GitHub when invoked | evidence automatically writes itself to GitHub |
| Telemetry | [`packages/telemetry/src/index.ts:1-19`](../../../packages/telemetry/src/index.ts) | sink plus backfill, readable with no agent awake | global live fleet visibility from any clone |
| Distribution | [`packages/dsh-app/src/profile.ts:17-29`](../../../packages/dsh-app/src/profile.ts), [`packages/contracts/package.json:1-45`](../../../packages/contracts/package.json) | checkout-bound private profile; contracts is the public package | registry install for the coordinator |
| Cockpit boundary | [`AGENTS.md:69-91`](../../../AGENTS.md) | separate consumer products; published contract boundary | cockpit is built here |

## Scope conclusion

The E10 delivery should be a bounded rewrite of the repository's Markdown front door and its immediate
navigation, backed by existing code and generated references. It should not wait for every MVP lane to
finish: status claims are snapshots against the merge baseline and can be updated mechanically during
implementation. It should also not start issue #148's docs-site choice. A strong GitHub README and
coherent Markdown paths are independently valuable and fully reviewable now.
