# Drift — architecture-foundation--seed

Deviations from plan or doctrine, with dispositions. Append-only.

---

### D-1 — Doctrine written before the run that designs it

**Deviation.** `.llm/harness/{WORKFLOW,PRINCIPLES}.md` were authored in the same commit that
opened this run, rather than being derived from the run's own conclusions.

**Why.** A run needs doctrine to be a run. Bootstrapping is circular by necessity.

**Disposition.** Accepted, with a constraint: this doctrine is a **transcription** of what
already ran in `netscript` and `website`, not a design. It is evidence, not conclusion. Stage D
may replace it wholesale, and if the run's conclusions contradict it, the conclusions win.

---

### D-2 — Runs are durable here, contradicting the ported doctrine

**Deviation.** `.llm/runs/` in this repository is committed and reviewed. The `website` doctrine
this pattern came from treats runs as ephemeral and gitignored (`.llm/tmp/run/`).

**Why.** The same contradiction appeared in `autocorner/website` PR #14, which used a durable
`.llm/runs/` directory and logged it as accepted drift D-4/D-5 rather than resolving it.

**Disposition.** Accepted **provisionally**, and escalated. This is not a preference here — it is
the run's central architectural question, recorded in `research.md` §6 and destined to become
Decision D-1 of `plan.md`. The provisional choice is durable, because a run that designs itself
must be reviewable. If Stage E locks a different position, this repository migrates to match its
own decision.

---

### D-3 — Stage B closed partially before handoff

**Deviation.** The run was committed and handed off with Stage B incomplete: the external leg is
started and the document leg has not begun.

**Why.** The opening session was a chat session without a working tree on the product. Handing
off at a clean stage boundary was preferred over completing Stage B in a session that could not
also perform Stages C–G.

**Disposition.** Accepted. `supervisor.md` and `context-pack.md` both record Stage B as partial,
and `research.md` §7–§8 name exactly what is missing. Stage C must not open until Stage B closes.

**Resolved 2026-08-14.** Both legs completed in this session. `research.md` §7 covers nine
subjects; §8 covers PR #14's 20 artifacts and both sibling doctrine trees. Stage B is closed and
the ledger in `supervisor.md` is updated.

---

### D-4 — Stage I was lost when the doctrine was transcribed into this repository

**Deviation.** `.llm/harness/WORKFLOW.md` in this repository defines stages **A–H**. The doctrine
it transcribes — `netscript/.llm/harness/workflow/seed-run.md` — defines **A–I**, where Stage I is
*handoff*: implementation lanes are launched from GitHub plus the design packs, **never from the
planning session's chat history**. `autocorner/website` PR #14 executed against A–I and its
`orchestration/agent-briefs.md` enforces the Stage I rule explicitly.

**Why.** Transcription loss. The stage was dropped, not rejected; nothing in this repository argues
against it.

**Disposition.** **Recorded, not fixed.** `.llm/harness/` is outside this run's declared mutation
surface, so this session did not edit it. Stage I is load-bearing — it is the rule that stops a
run's authority leaking back into an unreviewable chat transcript — and it must be reinstated when
Stage D reworks the doctrine. Tracked in `research.md` §8.11.

---

### D-5 — The verdict vocabulary has forked three ways and one verdict has no upstream definition

**Deviation.** `.llm/harness/WORKFLOW.md` in this repository asserts the verdict vocabulary is
*"used identically in Stage F and Stage G so that automation can read them"*. It is not. Four
distinct sets exist across three repositories and one run:

| Source | Verdicts |
|---|---|
| `netscript/.llm/harness/evaluator/verdict-definitions.md` | `PASS`, `FAIL_PLAN`, `FAIL_FIX`, `FAIL_RESCOPE`, `FAIL_DEBT` |
| `website/.llm/harness/WORKFLOW.md` §3 | `PASS`, `FAIL_FIX`, `FAIL_RESCOPE` |
| this repository's `WORKFLOW.md` | `PASS`, `PASS AFTER NARROW FIXES`, `FAIL_FIX`, `FAIL_RESCOPE` |
| PR #14 as emitted | `FAIL_FIX (narrow)` → `PASS AFTER NARROW FIXES` → `PASS` |

`PASS AFTER NARROW FIXES` appears in **neither** source doctrine — it was invented in flight by
PR #14's reviewer and then transcribed here as if inherited. `FAIL_PLAN` and `FAIL_DEBT`, which
have precise upstream definitions and distinct remedies, were dropped.

**Why.** Doctrine was copied by hand between repositories with no schema and no validation. This is
exactly the failure mode the product is being designed to remove.

**Disposition.** **Recorded as evidence, not fixed.** `.llm/harness/` is out of surface. This is
not a defect to patch quietly — it is the strongest available demonstration that shared doctrine
drifts without a distribution mechanism, and it belongs in Stage C's synthesis as such. Tracked in
`research.md` §8.10.

---

### D-6 — §4 of `research.md` was corrected rather than rewritten

**Deviation.** §4 claimed that "lifecycle phases" transferred unchanged in the `autocorner/website`
port. The document leg falsified this. Rather than editing the original sentence away, the claim
was left in place with an inline correction block, and §9 was added as a corrections register.

**Why.** The doctrine forbids rewriting history to make a run look cleaner than it was
(`PRINCIPLES.md`; `WORKFLOW.md` "record it in `drift.md` rather than rewriting history"). A
falsified claim that has already been read by another session must remain visible with its
correction attached.

**Disposition.** Accepted, and proposed as a pattern: **a corrections register (§9) is a better
mechanic than in-place editing for any artifact that is read before it is finished.** Candidate
addition to the product's artifact contract at Stage D.

---

### D-7 — The decision and drift ID namespaces collide

**Deviation.** Inherited from PR #14 and reproduced here: decisions are `D-n` and drift entries are
also `D-n`. PR #14 has both a decision `D-14` and a drift entry `D-14`, disambiguated only by
context. This run has drift `D-1`…`D-7` and will have plan decisions `D-0`…`D-n`.

**Why.** Copied from the exemplar without examining it.

**Disposition.** **Accepted for this run, flagged for the product.** Renaming mid-run would break
cross-references already written into `research.md` and `context-pack.md`. The product's artifact
contract must **not** inherit the collision — recommended namespaces are `D-` decisions, `DR-`
drift, `F-` forks, `S-` spikes, `R-` risks. Tracked in `research.md` §8.6.

---

### D-8 — Sibling repositories were read through the GitHub API rather than fetched

**Deviation.** PR #14's branch was **not** fetched into the local `website` clone. Artifacts were
retrieved through the GitHub contents API pinned at `29b2a7f4` and written to session scratch
storage outside any repository.

**Why.** `netscript` and `website` are declared read-only doctrine sources. A `git fetch` mutates
the local object store and ref namespace, which is a mutation even though no file changes.

**Disposition.** Accepted, and recommended as standing practice for read-only doctrine sources.

