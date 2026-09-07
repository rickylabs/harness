# Context pack — architecture-foundation--seed

**Read this first.** It is written to resume the run cold, from any CLI, on any machine, with
no prior conversation. If it stops being sufficient for that, fix it before doing anything else.

---

## What this run is

Designing a standalone **agentic harness and toolchain product**, built on NetScript, that lets
any TypeScript project adopt the harness mechanism already proven in three unrelated codebases.

The run produces an architecture document. It produces no product code.

## Where it stands

Stage **A complete**, Stage **B complete**. Stage **C is unblocked and not started**. Mutation of
the world is blocked until Stage G passes.

| Artifact | State |
|---|---|
| `supervisor.md` | Complete — identity, baseline, mutation surface, pinned doctrine sources, stage ledger |
| `research.md` | **Complete for Stage B** — repo leg §2–§4, external leg §7 (nine subjects), document leg §8 (PR #14's 20 artifacts + both sibling doctrine trees), corrections §9, owner forks §10 |
| `drift.md` | Open, 8 entries |
| `worklog.md` | Current |
| `plan.md` | Not created — Stage E |

**If you are resuming cold, read `research.md` §1 (summary), then §8.9, §8.10 and §10.** Those three
sections contain everything Stage B changed about the plan.

## The single most important open question

**Who owns run state: git, or the daemon?**

The two live implementations disagree and PR #14 logged the disagreement as accepted drift
rather than resolving it. `research.md` §6 states the three candidate positions. Every
control-plane question — mobile observation, multi-machine, resume semantics, what the
dashboard reads — follows from this one choice. It becomes Decision D-1 when Stage E opens.

Do not design the dashboard before this is locked.

**Stage B reframed it.** §8.9 shows the two positions are each internally consistent *for the
lifecycle their repository actually runs*: a four-phase loop produces nothing worth keeping; a
nine-stage lifecycle produces a reviewable record. D-1 is therefore **downstream of owner fork OF-a
— "which lifecycle is the product"** — and should not be locked before it.

## What is already established (do not re-litigate)

1. **NetScript supplies the runtime spine.** Tasks, jobs, workers, sagas, triggers, streams,
   KV with optimistic concurrency, multi-runtime execution with per-task permissions, and
   bare-metal OS-service deployment all exist. `research.md` §3, cited to source.
2. **The doctrine's *artifacts* are portable; its *lifecycle* has never travelled on its own; domain
   knowledge does not transfer at all.** The Deno→Next/Sanity/bun port carried templates, profiles
   and a four-phase loop. The nine-stage lifecycle PR #14 executed was imported from NetScript by
   the operator at run time — the host repository could not supply it. **This gap is the product.**
   `research.md` §4 (corrected), §8.9.
3. **"Harness" names two different systems** in the existing evidence base — runtime and
   process. The product must assign the name deliberately. `research.md` §2.
4. **The competitive middle is empty, and the attempt to prove otherwise failed.** Nine subjects
   examined in §7. Every one records the interaction rather than the work; every gate that exists
   gates capability or merge, never phase transition; every review inspects the diff after mutation;
   **none requires evidence for a claim**. The two strongest near-misses are Cursor's Plan Mode
   (durable plan artifact + pre-execution gate, but IDE-only and unenforced) and OpenHands' Critic
   (a genuinely separate evaluator, but it fires after `FinishAction`). `research.md` §7.
5. **The reusable artifact contract is known in detail** — a stable core of nine files plus
   run-type extensions, and, more importantly, the mechanics that make it work: the draft-ID join
   key, deliberate narrative/manifest redundancy as a review instrument, the "exists today" gate
   column, the negative-case proof rule, the honesty rule, and the five-column fork table.
   `research.md` §8.1–§8.7.
6. **Doctrine measurably drifts between repositories that share it.** Three verdict vocabularies,
   one verdict invented in flight with no upstream definition, one whole lifecycle stage lost in
   transcription. Accidental but direct evidence for the product's premise. §8.10, §8.11,
   `drift.md` D-4/D-5.
7. **The acute strategic risk is GitHub platform absorption, not standardisation.** AGENTS.md and
   MCP standardise the layer *beneath* the substrate and show no trajectory toward it. GitHub
   already holds every component needed to formalise its informal research→plan→iterate loop.
   §7.9, fork OF-b.

## What must not be treated as established

Five findings in `research.md` §5 remain unverified (F-1, F-3, F-4, F-5, F-6) and each has an owning
spike. They may not be used as inputs to a locked decision.

- **F-2 is resolved — see §5.1. Verdict PARTIAL, and it goes against the claim.** NetScript's
  contracts and in-memory core execute on Bun; the deployable worker runtime does not, on Bun or
  Node, because `Deno.*` globals are called directly in runtime paths — including inside the
  provider auto-detection that is supposed to *select* the non-Deno fallback. **"Any TypeScript
  project" is not currently a true claim about the daemon.** Three positions are laid out in §5.1;
  the recommended framing for Stage C is contract-first, with the worker daemon stated as Deno-only.
- **F-6** — is Deno KV adequate as a run store for multi-machine, mobile-read workloads? Feeds
  directly into D-1. Still open, and now more urgent: F-2 shows the KV layer is where the Deno
  coupling actually lives.
- **F-1** — does a harness run map onto the saga model? Gates Stage D.

## Next actions, in order

1. **Stage C — synthesis.** Reconcile the three legs. Surface contradictions; do not average them.
   The four that must survive into Stage C intact:
   - the lifecycle-did-not-port finding (§8.9) *strengthens* the product case while *weakening* the
     evidence claim §4 originally made for it — both are true, do not blend them;
   - the substrate's two halves exist in different products, in the surfaces where they are least
     useful (§7.8);
   - the citation bar has no prior art anywhere in the market (§7.8);
   - run-state ownership is downstream of the lifecycle question, not parallel to it (§8.9).
2. **Answer owner forks OF-a and OF-b** (`research.md` §10) before Stage D. OF-a determines the
   product's shape; OF-b determines its positioning; D-1 depends on both. **These are owner
   decisions — do not take them.**
3. **Run spikes F-1 and F-6.** Both gate Stage D. F-2's result is recorded in §5. F-3, F-4 and F-5
   can run in parallel but do not block.
4. **Stage D design packs**, as drafts with a no-mutation notice:
   - `architecture/run-state-contract.md` — D-1 and everything downstream of it
   - `architecture/runtime-foundation.md` — what is inherited from NetScript, what is built
   - `architecture/agent-transport-contract.md` — Claude Code / Codex / opencode / Copilot as one port
   - `architecture/artifact-contract.md` — **new, and the most concrete deliverable**: the nine-file
     core, the ID namespaces (fixing the `D-n` collision, `drift.md` D-7), the evidence tag set
     including `[inferred]`, the fork table shape, the gate-matrix shape, the manifest schema
   - `orchestration/control-plane.md` — daemon ↔ dashboard ↔ agent-tree data flow
   - `architecture/portability-contract.md` — what ships as mechanics, what is scaffolded as knowledge
5. **Stage E** — lock `plan.md` with decisions, owner forks, spikes, DAG, risk register.
6. **Stage F** — adversarial review **in a separate session**, on a different model, unoriented:
   the reviewer gets the artifacts, not the supervisor's framing, and produces findings only.
7. **Stage G** — `plan-eval.md`. Only on `PASS` does anything mutate.
8. **Stage I exists and is missing from this repository's doctrine** — see `drift.md` D-4. Reinstate
   it when Stage D reworks the doctrine.

## Known owner forks already visible

Three were raised by Stage B with a recommendation and a cost-if-wrong — see `research.md` §10:

- **OF-a — which lifecycle is the product?** Nine-stage, four-phase, or both with the heavy one as
  an opt-in profile. Recommendation: both, light by default.
- **OF-b — on the GitHub platform, or independent of it?** Recommendation: independent substrate,
  GitHub-native by default.
- **OF-c — is `[inferred]` an admissible evidence class?** Recommendation: yes, with the reasoning
  shown inline so it can be attacked.

Four were already open and are unchanged. Not yet formally numbered — that happens in `plan.md` at
Stage E.

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
