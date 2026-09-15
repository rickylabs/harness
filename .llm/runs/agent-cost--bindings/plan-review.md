# Independent plan review

Requested and observed model: qwen/qwen3.8-flash. Completion identity verified privately; no native identity published. Kimi attempt was INCONCLUSIVE, then the matrix Qwen fallback reviewed and passed the revised plan. Two intervening HTTP 429 responses were not passes.



PASS

The revised plan satisfies all task constraints and addresses each prior FAIL_FIX item without introducing regressions against the existing fences. Specific confirmations and minor notes:

**Guards preserved.** Root cost projection is a post-validation loop executing only after `nativeComplete`, duplicate-ID rejection, and the `roots.has(key)` single-binding check have all passed. Children are projected only after the existing while-loop's parent-chain and `duplicates.has(key)` checks. Dispatch-only roots (external === null) retain `unavailableAgentCost()` untouched. The `ancestry_unavailable` → `finish()` → `readAgentObservations` short-circuit remains unbroken.

**Token row semantics correct.** Ordered `TOKEN_FIELDS` matching the validator's whitelist (`inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens`) with `number(v, MAX_SAFE_INTEGER, true)` for safe-integer enforcement. Present-zero preserved (the `num()` helper returns 0); absent → field omitted; empty object → validator rejects (`Object.keys(x).length === 0`). No computed total. `costUsd` excluded from token row, carried only in `meteredSpend` as `amount` with `number(v, MAX_VALUE, false)`.

**Spend projection isolated.** Only `usage.costUsd` when finite and nonnegative; no inference from tokens, quota, or plan. Bad/future `updatedAt` refuses the run-usage rows (meteredSpend + runTokens) independently; the quota row is not affected by a usage timestamp defect.

**Quota selection defensible.** The "latest timestamp batch only" narrowing is strictly safer than per-window-latest and is justified by the account-switch-crossing rationale. Within that batch, (limitId, windowMinutes) grouping, same-timestamp conflict → unavailable, minimum remainingPercent across windows, `validUntil = resetsAt` boundary, reset-passed → `source_stale`/null — all match the task. No global account ID is fabricated; `scope: "subscription_account"` is a label, not a joinable key. The validator's `validUntil < capturedAt → bad()` for available rows enforces the stale rule at decode time.

**Revision hash incorporates cost.** Because the post-validation loop mutates the `AgentObservation` objects before `finish()` computes `digest(JSON.stringify({ agents, reason }))`, a usage change at the same `observedAt` shifts the embedded row revision and the collection revision. Canonical field order from fixed literals ensures permutation stability. No `origin`, `cwd`, or vendor path enters any hash or output row.

**Three independent builders.** A malformed `runTokens` measurement does not poison `meteredSpend` or `subscriptionHeadroom`; each row carries its own `availability`/`reason`. The existing `readAgentObservations.cost()` validator already enforces per-row independence.

**Cumulative semantics respected.** The Codex backfill assigns (not sums) `total_token_usage`; a resumed thread yields the same or larger cumulative figure for the same run. No per-turn split is attempted. The `sumUsage` helper is never invoked in this path.

One advisory (non-blocking): the `AGENT_UNAVAILABLE_REASONS` enum lacks a dedicated "timestamp_invalid" member; the implementation must map a bad/future `updatedAt` onto an existing reason (`source_unavailable` or `source_incomplete`) and document the choice in the projector so the validator never receives a reason string outside the enum.
