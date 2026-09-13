# Profile: rfc

Answer a question that needs an answer, not a change. Research in parallel, reconcile, file one
standards-compliant RFC.

This profile **mutates no source**. Its only write to the world is the filed RFC.

| Field | Value |
| --- | --- |
| `run-mode` | `seed` — research and plan, no implementation |
| `skill` | the harness skill (`use harness`) |
| `state` | the run directory: `research.md`, `synthesis.md`, `plan.md`, `evaluate.md` |
| `gate` | owner ratification, then a single filing |
| `routing` | the matrix `deep-research` role — **transport-restricted, see below** |

---

## Routing is restricted here

Deep research runs on its declared route and its declared fallback only. Several transports are
**forbidden** for this role. Query the matrix with `--json --role deep-research` and take what it
gives you.

If no legal transport is reachable, that is a **recorded blocker and a decision record** — not a
reason to substitute a model you can reach. A research answer produced off-route is not an
answer, because nobody can tell later what produced it.

---

## Phases

### 1 — Frame

State the question in one sentence, and state what a good answer would let the owner decide.
If you cannot write that second sentence, the question is not ready and that is your finding.

### 2 — Swarm

Fan out across three legs, each held to the same citation bar:

- **Repo leg** — what the code actually does, read from the code.
- **Document leg** — specifications, prior runs, tickets, offers.
- **External leg** — vendor documentation, release notes, upstream source. Verified, dated, linked.

Each leg is a separate session. Produces `research.md`.

**A finding without a citation is not a finding.** Beliefs are permitted, labelled as spikes,
never as inputs to a locked recommendation.

### 3 — Reconcile

Produce `synthesis.md`. **Surface contradictions rather than averaging them.** Two sources that
disagree are a finding and often an owner fork. An agent that quietly picks the
reasonable-looking option has destroyed the reason the research was commissioned.

### 4 — Evaluate

A **separate session from a different vendor family** attacks the synthesis. Its job is to find
the claim that does not survive its own citation. Produces `evaluate.md`.

Unreviewed research is not research. If no legal evaluator is reachable, record the blocker and
stop — do not self-certify.

### 5 — File

One RFC, standards-compliant, in the target repository. It carries:

- the question, and what it lets the owner decide
- the options, each with its cost of being wrong
- a **recommendation** — a survey with no recommendation is not an RFC
- the open forks, numbered, that the owner must resolve
- the citations

Filing is a **one-shot mutation** and it happens after owner ratification. Draft first, ratify,
then file.

---

## Do not

- Do not open a pull request that changes source. This profile does not implement.
- Do not resolve an owner fork because it seemed obvious.
- Do not file without an evaluation round.
- Do not put fenced code blocks in anything that will be dispatched as a brief — the parser
  stops at a fence and the truncated brief runs anyway, silently.
