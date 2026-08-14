# Context pack — architecture-foundation--seed

**Read this first.** It is written to resume the run cold, from any CLI, on any machine, with
no prior conversation. If it stops being sufficient for that, fix it before doing anything else.

---

## What this run is

Designing a standalone **agentic harness and toolchain product**, built on NetScript, that lets
any TypeScript project adopt the harness mechanism already proven in three unrelated codebases.

The run produces an architecture document. It produces no product code.

## Where it stands

Stage **A complete**, Stage **B partial**. Mutation of the world is blocked until Stage G passes.

| Artifact | State |
|---|---|
| `supervisor.md` | Complete — identity, baseline, mutation surface, pinned doctrine sources |
| `research.md` | Partial — repo leg drafted, external leg started, document leg not begun |
| `drift.md` | Open, 2 entries |
| `worklog.md` | Current |
| `plan.md` | Not created |

## The single most important open question

**Who owns run state: git, or the daemon?**

The two live implementations disagree and PR #14 logged the disagreement as accepted drift
rather than resolving it. `research.md` §6 states the three candidate positions. Every
control-plane question — mobile observation, multi-machine, resume semantics, what the
dashboard reads — follows from this one choice. It becomes Decision D-1 when Stage E opens.

Do not design the dashboard before this is locked.

## What is already established (do not re-litigate)

1. **NetScript supplies the runtime spine.** Tasks, jobs, workers, sagas, triggers, streams,
   KV with optimistic concurrency, multi-runtime execution with per-task permissions, and
   bare-metal OS-service deployment all exist. `research.md` §3, cited to source.
2. **The doctrine is portable; domain knowledge is not.** Proven by the Deno→Next/Sanity/bun
   port. This asymmetry is the product seam. `research.md` §4.
3. **"Harness" names two different systems** in the existing evidence base — runtime and
   process. The product must assign the name deliberately. `research.md` §2.
4. **The competitive middle is empty.** t3.codes owns the session surface, Linear owns the
   intent surface, neither owns the process substrate. `research.md` §7.

## What must not be treated as established

Six findings in `research.md` §5 (F-1…F-6) are unverified and each has an owning spike. They
may not be used as inputs to a locked decision. The two that gate the most downstream work:

- **F-2** — do NetScript plugins actually run on Node and Bun? If the daemon is Deno-only, "any
  TypeScript project" is a positioning constraint that must be stated, not a bug to fix later.
- **F-6** — is Deno KV adequate as a run store for multi-machine, mobile-read workloads? Feeds
  directly into D-1.

## Next actions, in order

1. **Close Stage B.** Finish the external leg — Conductor, Vibe Kanban, Sculptor, OpenHands,
   Cursor background agents, GitHub's Copilot coding-agent task model, and the AGENTS.md / MCP
   standardisation trajectory. Then the document leg: read PR #14's 20 artifacts individually
   rather than relying on its PR body.
2. **Run spikes F-1, F-2, F-6.** These three gate Stage D. F-3, F-4 and F-5 can run in parallel
   but do not block.
3. **Stage C synthesis.** Reconcile the three legs. Surface contradictions; do not average them.
4. **Stage D design packs**, as drafts with a no-mutation notice:
   - `architecture/run-state-contract.md` — D-1 and everything downstream of it
   - `architecture/runtime-foundation.md` — what is inherited from NetScript, what is built
   - `architecture/agent-transport-contract.md` — Claude Code / Codex / opencode / Copilot as one port
   - `orchestration/control-plane.md` — daemon ↔ dashboard ↔ agent-tree data flow
   - `architecture/portability-contract.md` — what ships as mechanics, what is scaffolded as knowledge
5. **Stage E** — lock `plan.md` with decisions, owner forks, spikes, DAG, risk register.
6. **Stage F** — adversarial review **in a separate session**. Not the author.
7. **Stage G** — `plan-eval.md`. Only on `PASS` does anything mutate.

## Known owner forks already visible

Not yet formally numbered — that happens in `plan.md` at Stage E. Recorded here so they are not
lost in the handoff.

- Licence and open-source posture. t3.codes is fully open source; that is a competitive fact
  with a strategic answer, not a technical one.
- Product name. `harness` is the repository name, chosen for the concept. Not ratified as the product name.
- Whether the product is the process harness alone, or unifies both senses of the word.
- Hosted control plane versus purely local, and whether a hosted plane is ever authoritative.

## Working agreements

- Sibling repositories are **read-only doctrine sources**. Pinned SHAs are in `supervisor.md`.
- Citation bar and no-silent-owner-decisions are standing constraints. See `AGENTS.md`.
- Deviations go in `drift.md` with a disposition. Do not rewrite locked artifacts in place.
- Runs in this repository are durable and committed — which is itself the subject of D-1, and is
  recorded as drift D-2 until D-1 ratifies it.
