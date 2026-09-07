# durable-state--e6a — review focus

This is a coordinator checklist for the independent evaluator, not a verdict.

- Competing open/recovery calls must contest the same successor generation. No stale observer can create a different generation while a live successor writes. Release waits for queued work and never removes a successor claim.
- All public writes are serialized; every returned state must be detached from mutable caller objects. Invalid JSON values or getters must not silently become another durable input through canonical coercion.
- Full identity tuples must be compared rather than trusting a truncated digest as collision-free identity. Repository/milestone partitions and checkpoint schemas must agree.
- Replay committed receipts after a checkpoint before finalizing orphaned pending entries; otherwise a checkpoint cut can invent unknown despite a committed receipt. Once unknown is final, no public transition may settle it as unsent.
- Child crash tests must name an exact reached hook, be killed only after its signal, assert SIGKILL termination, reopen through explicit stale recovery, and remove the mkdtemp root even after assertion failure. Only owned children are killed.
- Constructor/open initialization must not replace a missing or corrupt checkpoint with empty when history exists. Sequence gaps, trailing garbage and schema/version/digest failures refuse rather than repair.
- Any failed write/sync must return named failure and poison further writes if disk state may have changed; close must not report durable success after an unresolved write failure.
- Static source contains no operational fixture data. Runtime clock/owner values may be injected, but defaults cannot inspect private host files. Network filesystems and power loss remain unverified boundaries, not behavior claimed by a process-kill test.
