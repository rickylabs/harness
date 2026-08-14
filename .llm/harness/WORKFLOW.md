# WORKFLOW

The run lifecycle. Eight stages, A through H. Nothing mutates the world before Stage G passes.

This is the model that produced `autocorner/website` PR #14. It is stated here in
project-neutral terms because it is intended to ship as the portable core of the product.

---

## Run identity

Every run has a directory:

```
.llm/runs/<slug>/
```

`<slug>` is `<topic>--<qualifier>`, lowercase, hyphenated, stable for the life of the run.
It appears in the branch name, the PR title, and every artifact header. One run, one slug,
one branch, one PR.

**Runs in this repository are durable and committed.** They are reviewed as pull requests and
kept. This is a deliberate divergence from the ephemeral `.llm/tmp/run/` convention used in
`autocorner/website`, and it is itself an open architectural question for the product — see
the seed run's Decision register.

---

## Stages

### A — Supervisor

Establish who is working, on what baseline, and what they are permitted to touch.

Produces `supervisor.md`: model and session identity, host, baseline commit SHA, the
declared **mutation surface** (the exact paths this run may write), and the surfaces it must
not touch. Anything later found outside the declared surface is drift, not scope.

### B — Discovery

Build the corpus. Three legs, all held to the same citation bar:

- **Repo leg** — what the code actually does, read from the code.
- **Document leg** — specifications, offers, prior runs, RFCs, tickets.
- **External leg** — vendor documentation, release notes, upstream source. Verified, dated, and linked.

Produces `research.md`. A finding without a citation is not a finding.

### C — Synthesis

Reconcile the three legs. Surface contradictions rather than averaging them. Contradictions
between sources become owner forks in Stage E; they are never silently resolved here.

### D — Design packs

Produce the design artifacts, explicitly marked as **drafts**, carrying a no-mutation notice.
Typically under `architecture/`, `orchestration/`, and where a board is involved, `board/`.

### E — Plan lock

Produces `plan.md`, containing all of:

- **Decisions** — numbered, each with rationale and the alternative rejected.
- **Owner forks** — numbered, each with question, options, recommendation, cost-if-wrong.
- **Spikes** — every unverified load-bearing claim has an owning spike or an explicit integration gate.
- **Dependency DAG** — what unblocks what.
- **Risk register** — with likelihood, impact, and the gate that catches it.

Once locked, changes to the plan are recorded in `drift.md` and not edited in place.

### F — Adversarial review

A **separate session** attacks the plan. Not the author. The reviewer looks for unstated
assumptions, unsourced claims, decisions taken on the owner's behalf, and gates that cannot
actually run.

Produces `adversarial-review.md` with a per-finding disposition. Verdict is one of
`PASS`, `PASS AFTER NARROW FIXES`, `FAIL_FIX`, `FAIL_RESCOPE`.

### G — Plan evaluation

The gate. Produces `plan-eval.md` with a single verdict.

Until this reads `PASS`, **no mutation of the world is permitted** — no issues filed, no
milestones created, no labels, no product code, no deployments.

### H — Ratification and execution

The owner ratifies the forks in-turn. Only then does the run mutate anything, and it does so
in one shot from a manifest so the operation is reviewable and repeatable.

---

## Continuous artifacts

Maintained across every stage, not owned by one:

| File | Purpose |
|---|---|
| `context-pack.md` | The single file that resumes this run cold. Written for a reader with no history. |
| `worklog.md` | Timestamped progress. Append-only. |
| `drift.md` | Every deviation from plan or doctrine, with a disposition. |

`context-pack.md` is load-bearing. It is what lets you switch CLI, machine, or vendor
mid-run without losing the thread. Keep it current or the run is not resumable.

---

## Verdict vocabulary

Used identically in Stage F and Stage G so that automation can read them.

| Verdict | Meaning |
|---|---|
| `PASS` | Proceed. |
| `PASS AFTER NARROW FIXES` | Proceed once the listed, bounded fixes land. No re-review needed. |
| `FAIL_FIX` | The plan is sound; specific parts are wrong. Fix and re-run this stage. |
| `FAIL_RESCOPE` | The plan is addressing the wrong problem. Return to Stage C. |
