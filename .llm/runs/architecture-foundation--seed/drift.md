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
