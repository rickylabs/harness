# profiles/

A **profile** is the working process a dispatched agent adopts before it does anything else.

The dispatcher injects this line into every brief that names one:

> FIRST read `profiles/<name>.md` in the repo root (if present) — it defines your working
> process for this task, including any evaluation models to use.

So a profile file is not documentation *about* a process. It is the process, addressed to the
agent that just woke up holding it.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §5–§6 for how a profile reaches an agent.

---

## The contract

Every profile states five things, in this order, near the top:

| Field | Means |
| --- | --- |
| `run-mode` | which doctrine file governs the run shape |
| `skill` | which agent skill to activate first |
| `state` | the control-plane artifact this run maintains, if any |
| `gate` | the command whose exit code is the verdict |
| `routing` | which matrix row selects the model, and what may not be overridden |

Then the phases, in order, each one saying what it produces and what proves it.

---

## Rules that hold for every profile

1. **Query the matrix; never reconstruct it.** Run the matrix CLI with `--json`. Do not derive
   a routing decision by reading source with `grep`, `sed` or `awk`.
2. **Record requested versus observed.** Every launch records the model, effort, transport,
   role, tier, session reference and branch it *asked for* and the ones it *got*. A run without
   that record is not a valid run (ARCHITECTURE.md I1).
3. **Never self-certify.** The agent that produced work never evaluates it. Evaluator and
   generator are separate sessions from different vendor families (I2).
4. **Privileged tiers need authority.** `complex` and `architecture` require a named authorizer
   and a non-empty rationale. A brief asking for one without both is refused, not downgraded
   silently — refuse and say why (I3).
5. **Blocked means a decision exists.** Do not stop without filing a decision record carrying a
   question, the options, your recommendation, and the cost of being wrong (I4, §8).
6. **A gate that cannot run is unproven.** Record it as unproven. Never assume it green, and
   never substitute a narrower command and call it the gate.

---

## The three profiles

| Profile | For | Shape |
| --- | --- | --- |
| [`leaf`](leaf.md) | one scoped change, one branch, one PR | slices, each gated and signed off |
| [`milestone-coordinator`](milestone-coordinator.md) | a whole milestone | 4 fixed lanes, bounded WIP, a validator gate |
| [`rfc`](rfc.md) | a question that needs an answer, not a change | research swarm, then one filed RFC |

---

## Adding one

A new profile needs a real second user. Two runs that differ only in prose are one profile with
a parameter, not two profiles. Add it in a PR that names the run it was extracted from.
