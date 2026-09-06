# E3 hardening — critical-path sequence

Seat 3 owns coordination of #195–#200. These are prerequisites of #53 and the E6 live driver,
not an unowned side lane. Sequence: #195 and #197 pre-send checks; #196 ownership together
with #198 attributable liveness; #199 distinct waits; #200 bounded supervision. Every issue
retains a separate implementation PR and its own plan/implementation gates.

## Ordered work and rationale

1. **#195 route identity — research first.** Freeze observed provider/model/effort/cwd and the
   pre-turn comparison contract. Observe effort at thread/start. A mismatch is safely refused
   only before useful task submission; uncertain post-send failure remains unknown.
   [observed - netscript .llm/tools/agentic/codex/app-server-message.ts threadStartRequest]
   [observed - harness packages/subagents/src/provider.ts isSafeToRetry]
2. **#197 brief validation — research alongside #195.** Validate readable nonempty staged bytes,
   required use-harness/skill sections and line-ending normalization before creating work.
   This independent check can be designed without waiting for daemon transport discovery.
   [observed - netscript .llm/tools/agentic/codex/launch-codex-slice.ts validateHandoffContract]
3. **#196 ownership and #198 liveness — joint contract planning, separate code slices.** Reserve
   by canonical worktree, bind explicit thread identity, and require both for resume. Recovery
   consumes attributable liveness from #198. Never infer permission to reap from a missing
   launcher or a process substring. #196 can define storage/CAS first; safe reaping waits on
   #198 evidence semantics. [observed - netscript .llm/tools/agentic/codex/run-codex-slice.ts ownership check]
4. **#199 wake signals — after identity/evidence contracts.** Waiters bind the same RunRef;
   progress, idle, cancellation and heartbeat timeout are distinct results. Git changes cannot
   authorize a resume. [observed - netscript .llm/tools/agentic/codex/codex-watch.ts git and turn modes]
5. **#200 supervision — integrates the earlier contracts.** Bound turns and elapsed time,
   resume the owned thread only, preserve unknown, persist heartbeat/state and classify quota
   backoff. DONE requires the artifact/teardown gates; it is not a synonym for process exit 0.
   [observed - netscript .llm/tools/agentic/codex/run-codex-slice.ts parseDoneContract and remainingBudgetDelay]

#53's attach-only transport spike proceeds with #195/#197 research. It must not spawn or repair
this host's protected daemon. Integration of #53 requires all six contracts; the E6 driver
requires the resulting provider port. The current provider-codex stub stays inert until its
own reviewed implementation plan defines that mutation surface.

## New observation: identity, never recency

Source: https://github.com/rickylabs/harness/issues/196#issuecomment-5562228621
[observed - N5 2026-09-06, one recency-addressed runner alongside three id-addressed threads]

- Resume takes an explicit RunRef, resolves its recorded thread id and canonical worktree,
  and verifies the pair against durable ownership. No --last or most-recent lookup exists.
- Missing thread id, correct thread/wrong worktree, correct worktree/wrong thread, stale
  ownership generation and two callers racing for the same worktree must fail closed.
- A failed probe cannot release ownership. Launcher death does not establish daemon-thread
  death. Normal turn-idle does not release the lease of a still-supervised run.

## New observation: a matching string is not liveness

Source: https://github.com/rickylabs/harness/issues/198#issuecomment-5562278245
[observed - between-turns supervisor 2026-09-06, wrapper argv matched a nonexistent watcher]

- Running requires a positive, fresh signal attributable to the RunRef's thread/worktree:
  correlated daemon activity, heartbeat or last-activity evidence. A connected daemon alone
  does not establish that this particular thread is working.
- If a process scan is used, exclude the probe and its ancestor chain, reduce candidates to
  PIDs, then verify ownership against recorded PID/start identity and worktree/socket. A bare
  pgrep substring is never sufficient. Account for PID reuse and daemon/launcher distinction.
- Unattributable matches, unavailable probes, stale heartbeat, missing completion and truncated
  evidence preserve unknown/degraded diagnostics. Never default unknown to running.
- Proven thread execution loss without completion is failed; failure to observe the thread is
  unknown. Preserve stalled as a diagnostic without inventing a sixth public Liveness member.
- Regression fixtures: supervisor argv contains thread id with no agent; only ancestor matches;
  unrelated process quotes worktree; reused PID; disconnected observer with live daemon thread;
  stale heartbeat; confirmed completion; attributable recent running event. A watchdog must
  surface stale evidence rather than waiting indefinitely on an apparently healthy string.

## Shared brief requirements

Every delegated lane brief carries the observed-source tags above, the relevant netscript
framework docs and EIS contract/adapter references, Node + pnpm/service-adapter boundary,
exact mutation surface, negative fixtures and separate evaluation gates. It forbids real
credential/session snapshots in public evidence, unrelated host changes, implicit resume and
retry-on-unknown. No harness dispatch label is applied by this planning change.

## Status and next gates

#195/#197 enter research; #196/#198/#199/#200 enter plan with explicit predecessor ownership.
Planning does not claim implementation is running. Current matrix: straightforward bounded
contract slices use Sol medium plan/implementation and Opus medium plan evaluation; actual
scope must be checked before dispatch. PR 193's wider integration-plan review uses feature
plan-evaluation GLM 5.3 provider-default, the current pinned cell, not the retired named routes.
