# PRINCIPLES

Short on purpose. If a rule here is not load-bearing, delete it.

---

### 1. Code is truth

Documentation, specifications and prior runs describe intent. The code describes behaviour.
Where they disagree, the code wins and the disagreement is a finding.

### 2. Artifacts over chat

A conclusion that exists only in a conversation does not exist. Chat is a transport; the run
directory is the record. This is what makes the work survive a dead daemon, a closed laptop,
or a switch of vendor.

### 3. Citations or it is not a claim

Every load-bearing statement carries a repository path, a document page, or a URL retrieved
during the run. Beliefs are permitted — as spikes, labelled as such, never as inputs to a
locked decision.

### 4. Owner forks are raised, not resolved

When a question depends on what the owner wants rather than on what is true, stop. File it
numbered, with a recommendation and the cost of being wrong. An agent that quietly picks the
reasonable-looking option has destroyed the one thing the owner was needed for.

### 5. Nothing mutates before the gate

Plans are locked, attacked, and evaluated before the board, the code, or the world is
touched. A plan that has not survived an adversarial reader has not been reviewed.

### 6. Gates must be able to run

A gate that cannot execute in the current repository is **unproven**, and must be recorded as
unproven. It is never assumed green. If there is no CI, saying "CI will catch it" is a
statement about a future repository, not this one.

### 7. Deterministic work belongs in the daemon

If an agent is asked to do the same thing the same way repeatedly, that is a defect in the
harness, not a task. Rescue, restart, health-check, sync and supervision are deterministic.
Spending model tokens on them is the failure mode this product exists to remove.

### 8. Mechanics are portable, knowledge is not

Doctrine, templates, lifecycle and verdicts transfer to any repository unchanged. Domain
knowledge, profiles and skills do not and must be rewritten per project. Never let the two
mix in one file — that is what makes a harness unportable.

### 9. Non-duplication

Each fact has one home. Harness doctrine lives in `.llm/harness/`. Durable project knowledge
lives in the knowledge base. Run-specific reasoning lives in the run directory. A fact in two
places is a future contradiction.

### 10. Summary first

Every artifact opens with what it concluded, before how it got there. Assume the reader is on
a phone, between meetings, deciding whether to open a desktop.

### 11. Local first, vendor neutral

The harness must not depend on which agent client opened it. Claude Code, Codex, opencode and
Copilot are interchangeable transports over the same run directory. Any doctrine that only
works in one of them is a bug.
