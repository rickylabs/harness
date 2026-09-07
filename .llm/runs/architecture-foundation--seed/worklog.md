# Worklog — architecture-foundation--seed

Append-only. Timestamps are local (CEST).

---

## 2026-08-14

**15:47 — Run opened.** Brief received: build a standalone agentic harness and toolchain
product on NetScript, generalising a pattern already proven in three repositories. Explicitly a
rethink, not a mirror. Reference points given: t3.codes for the surface, Linear for the
direction.

**15:50 — Stage A.** Repository `rickylabs/harness` created, private. Doctrine sources pinned:
`netscript@f7898dba` (main), `eis-chat@a9b31d4` (master), `website@d77bcaf` (main). Mutation
surface declared in `supervisor.md`.

**15:52 — Stage B, repo leg.** Three parallel exploration passes over the pinned sibling
repositories. Findings recorded in `research.md` §2–§4.

Load-bearing outcomes:

- "Harness" names two distinct systems in the existing evidence base — runtime and process.
  The product cannot inherit the ambiguity. (§2)
- NetScript already supplies the runtime spine: `TaskDefinition` spans
  `deno | python | shell | powershell | dotnet | executable` with explicit per-task permissions;
  `JobDefinition` carries `correlationId`, `topic`, idempotency and retry; sagas provide
  versioned envelopes with transitions and compensation; `deploy up bare-metal` installs a
  supervised OS service via `OsServicePort`. (§3)
- The doctrine ported across Deno→Next/React/Sanity/bun with mechanics transferring cleanly and
  domain knowledge not at all. That asymmetry is the product seam. (§4)

**15:58 — Stage B, external leg started.** t3.codes and Linear characterised and cited. The
process substrate between them is owned by neither. Six further comparables named as
outstanding in §7; document leg not begun.

**16:05 — Contradiction surfaced.** The two live implementations disagree on run-state
ownership — ephemeral and gitignored in the `website` doctrine, durable and PR-reviewed in
PR #14, which logged it as accepted drift rather than resolving it. For a documentation-only
harness this is a preference; for a product with a daemon and a dashboard it is the central
data-communication decision. Recorded in `research.md` §6 with three candidate positions and
no preference expressed. Escalated to become Decision D-1 at Stage E.

**16:10 — Six spikes filed.** F-1…F-6 in `research.md` §5. Each is a load-bearing claim that
could not be verified at this baseline. F-1, F-2 and F-6 gate Stage D.

**16:15 — Seed commit.** Entry points, doctrine transcription, and Stage A/B artifacts
committed. Drift D-1, D-2 and D-3 recorded. Handing off at a clean stage boundary with Stage B
partial, per D-3.

**Gate status at handoff: mutation of the world BLOCKED.** Stage G has not run.

---

## 2026-08-14 — Stage B closure session

**Session opened.** Worktree session on `rickylabs-stage-b-discovery`. Read `context-pack.md`,
`AGENTS.md`, `.llm/harness/{WORKFLOW,PRINCIPLES}.md`, and all five existing run artifacts before
any mutation, per doctrine.

**External leg — three parallel passes.** Run as a **falsification attempt**, not a survey: each
pass was briefed to find a product that already owns the process substrate and to report it plainly
if found. Nine subjects covered against four fixed questions — unit of record, staged work with
gates, citation bar or adversarial review, where state lives.

- Conductor, Vibe Kanban, Sculptor
- OpenHands, Cursor cloud agents
- GitHub Copilot cloud agent, AGENTS.md trajectory, MCP trajectory

**Result: the thesis survived.** None of the nine owns the substrate. Recorded in `research.md` §7
with per-subject subsections and a comparison matrix. The useful output is not the verdict but the
four repeatable failure shapes in §7.8 — and the fact that **no subject anywhere requires evidence
for a claim**. The citation bar has no prior art in this market.

Two honest near-misses recorded rather than dismissed: Cursor's Plan Mode is a genuine durable plan
artifact behind a pre-execution gate, but IDE-only and unenforced; OpenHands' Critic is a genuinely
separate LLM evaluator with threshold-driven retry, but fires after `FinishAction`, i.e. after every
world mutation. Vibe Kanban's sunsetting and Sculptor's single-source evidence limitation are noted
as limitations on the evidence, not buried.

**§7.9 — strategic risk assessed.** AGENTS.md and MCP standardise the layer *beneath* the substrate
and show no trajectory toward it. The acute risk is **GitHub platform absorption on a 12–24 month
horizon**: it already holds the session record, the agents panel, hooks, a review agent and the
informal research→plan→iterate pattern. Its architecture is *permissive* rather than *prescriptive*,
and that is the only thing holding the seam open. Raised as owner fork OF-b, not resolved.

**Document leg — PR #14 read in full.** All 20 artifacts of
`Autocorner-J-C-C-Oberson/website#14` retrieved individually through the GitHub contents API pinned
at `29b2a7f4`, not from the PR body. The branch was deliberately **not** fetched into the local
clone, so the read-only doctrine sources are unmutated even at the ref level — `drift.md` D-8.
Read for mechanics only; domain content ignored throughout.

Extracted into `research.md` §8: the artifact set and each artifact's function, the decision
register shape, the five-column owner-fork table, the three layers of gate expression plus the six
gate-integrity rules, the filing-manifest contract, the cross-reference scheme, and the five-tag
evidence discipline. **§8.12 names what actually makes it work** — the draft-ID join key, deliberate
narrative/manifest redundancy as a review instrument, the "exists today" column, the negative-case
proof rule, the honesty rule.

**Document leg — both sibling doctrine trees read.** `netscript/.llm/harness/` (57 files) and
`website/.llm/harness/` compared file by file rather than by self-description. §8.8 tabulates what
each actually contains.

**16:50 — FALSIFICATION. `research.md` §4 was wrong.** The claim that "lifecycle phases" ported to
`autocorner/website` does not survive reading both trees. The `website` harness carries a
**four-phase** loop with no stage gates, no owner forks, no adversarial review, no plan-eval, no
gate matrix, no filing discipline. The nine-stage lifecycle PR #14 executed came from NetScript —
PR #14's own `supervisor.md` names `NetScript .llm/harness/workflow/seed-run.md` as its profile and
the Autocorner harness only as its host templates.

**The lifecycle was operator-carried, not repo-carried. It has exactly one instantiation outside
its home repository.** Recorded in §8.9 and §9. This *strengthens* the product case — the
distribution gap is real and demonstrated — while *weakening* the evidence claim §4 made for it.
Both are true; Stage C must not average them. It also reframes D-1: run-state ownership is
downstream of "which lifecycle is the product", not parallel to it.

**16:55 — Second falsification. The verdict vocabulary is not stable.** Three different sets across
three repositories, four in practice. `PASS AFTER NARROW FIXES` — carried in this repository's own
doctrine — was invented in flight by PR #14's reviewer and exists in no upstream definition.
`FAIL_PLAN` and `FAIL_DEBT` were dropped in transcription, as was **Stage I (handoff)** entirely.
Recorded as `drift.md` D-4 and D-5. Not fixed: `.llm/harness/` is outside this run's mutation
surface, and in any case this is the strongest available evidence for the product's premise, not a
defect to patch quietly.

**17:10 — Spike F-2 executed.** Resolved **PARTIAL**, against the claim. `@netscript/plugin-workers-core`
and `@netscript/plugin-workers` (both `0.0.6`) install cleanly on Node 22.20 and Bun 1.3.1. Bun
executes one job end to end through the in-memory core — `terminalStatus: "completed"`. Bun cannot
run the deployable runtime: `Temporal is not defined`, then `Deno is not defined`. Node never
executed, blocked by a transitive dependency using `using` syntax it cannot parse.

The decisive detail: `packages/kv/application/auto-detect.ts:123-166` reads `Deno.env` **to select
the fallback provider**. The documented Redis/in-memory fallbacks cannot rescue a non-Deno host
because the selection path itself requires Deno. **"Any TypeScript project" is not currently a true
claim about the daemon.** Recorded in `research.md` §5.1 with three candidate positions and a
recommended framing for Stage C; §3.5 corrected. No NetScript file was modified.

**17:20 — Owner forks raised, not resolved.** Three new forks in `research.md` §10 — OF-a (which
lifecycle is the product), OF-b (on the GitHub platform or independent of it), OF-c (is `[inferred]`
an admissible evidence class). Each carries options, a recommendation and a cost-if-wrong, per the
standing constraint. The four previously visible forks are unchanged.

**17:25 — Corrections register added.** `research.md` §9. Falsified claims were **not** edited away;
the original text stands with an inline correction block and a dated register entry. Proposed as a
reusable mechanic in `drift.md` D-6.

**17:30 — Stage B closed.** Ledger updated in `supervisor.md` with explicit closure conditions
checked. `context-pack.md` refreshed for cold resume. Drift D-3 marked resolved; D-4…D-8 added.

**Stage C is now unblocked.** The control plane and the dashboard remain **not designable** until
D-1 is locked — and D-1 is now known to depend on owner fork OF-a.

**Gate status: mutation of the world remains BLOCKED.** Stage G has not run.

---

### Next session starts here

Read `context-pack.md`, then `research.md` §1, §8.9, §8.10 and §10 — those four contain everything
Stage B changed.

Then open **Stage C (synthesis)**. Reconcile the three legs; surface the contradictions listed in
the context pack rather than averaging them. Do **not** design the control plane or the dashboard —
they depend on D-1, which depends on owner fork OF-a, which is the owner's to answer.

