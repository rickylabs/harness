# Implementation evaluation

PASS for the product implementation, with two bounded source units covering the published types, projection, CLI, transport and reader. Author: OpenAI gpt-6-astra. Both reviewers are from different model families, returned exit 0 with PASS, and supplied an identified complete response.

## Projection, types and CLI

z-ai/glm-5.3-flash — exit 0. [Command and full returned verdict](attempts/08-impl-glm-projection.json).

**Verdict: PASS**

The projection, published types, and CLI are correct against the stated contract and privacy requirements:

**Projection** — `projectGoal` correctly handles `null` → `goal_absent` (matches `ThreadGoalGetResponse = { goal: ThreadGoal | null }`), non-object → `invalid_response`, identity check before field extraction, and enum-validated status. The caller's coverage-marker via `goal.tokenBudget.reason` works because `missingGoal` stamps the reason on every field, so `identity_mismatch`/`invalid_response` propagate. Goal RPC errors retain rows and only flip `complete` — no row erasure. Counters reject negative/non-safe-integer values. `publicThreadId` is a one-way hash with a namespaced domain string; no reverse lookup surface.

**Privacy** — `codexThreadEvidence` is a strict allowlist: only availability counts, reason sets, and reason counts per field; no values, no `threadId`, no objective/amounts/paths. `sensitive()` gates `cwd`/`gitOrigin`/`objective` behind the authorized opt-in. No source object is ever spread into public output.

**CLI** — The re-review fixes hold up: `write` awaits the write callback with a single outstanding message; `rejectWrite` clobbering is impossible given sequential awaits; stop is idempotent (double `close`, double reject no-op via promise semantics); `output.destroy()` in stop causes the pending callback to fire with an error, which is absorbed; final exit code checks `stopped`; interruption paths (after read, after initialize, during blocked write, EPIPE-style error, backpressure) all route through the fixed stop path with exit 3. Flag parsing rejects duplicates, unknown flags, non-numeric `--limit` values (including flag-like values), and caps at 5000. Listener cleanup in `finally` is safe — `destroy()` without an error argument emits no subsequent `error` event, so no unhandled-`error` crash window after removal.

**Non-blocking observation** (no action required): a present-but-non-object `t.status` or `t.gitInfo` is classified `field_absent` rather than `invalid_field` (via `object(...)?.type` → `undefined`). This is a defensible conservative reading for nested containers and does not affect row retention, coverage, or privacy, but it does slightly blur the absent/invalid distinction in evidence reason counts if that distinction ever becomes load-bearing.

## Transport and reader

moonshotai/kimi-k3 — exit 0. [Command and full returned verdict](attempts/14-impl-kimi-transport.json).

**Verdict: PASS**

Transport, request gating, bounds, lifecycle, notification, and coverage logic are internally consistent and fail-closed. Verified specifically:

- Read-only enforcement holds at both layers (method allowlist + server-sent requests → `read_only_violation`); initialize-first and one-shot ordering enforced via `serial`.
- Frame bounds (1 MiB), pending cap (8), page cap, cursor-repeat detection, cross-pass ID dedupe, and queue cap (128) all terminate safely; `fail()` is idempotent and cleans up timers, pending rejects, buffer, and child process.
- No missed-wake race in `events()` (no await between queue check and `wake` assignment; notifications arrive via async I/O); ended-drain ordering delivers buffered terminal events before return.
- Goal-RPC soft failures (rpc/identity/invalid_response) degrade coverage to incomplete without dropping rows; hard failures clear rows and report the reason — matches stated live behavior. Raw protocol values never surface in diagnostics; opaque IDs used in events.
- `open()` validates options before spawn, cleans up on initialize failure, and preserves the original failure reason.

Non-blocking observations (advisory only, no fix required):

1. `read()` installs a whole-scan timer equal to the per-request `timeoutMs`. Since requests are sequential, `timeoutMs` silently doubles as a total scan budget; at large `limit` (up to 5000, two passes + per-row goal RPCs) a healthy scan can still end in `request_timeout`, misattributing the cause. Consider documenting the cumulative semantics or scaling the outer budget.
2. Cross-pass duplicate thread ID (a thread flipping archived state mid-scan, possible since the snapshot is explicitly non-atomic) fails the entire read with `identity_mismatch` rather than deduplicating. Conservative direction is acceptable, but it converts a benign race into total read failure; tolerance here would improve robustness without weakening identity guarantees.

## Dispositions and limits

The real CLI findings from attempt 06 were fixed and re-reviewed in attempt 08. The generated goal response requires a goal property; omitted is invalid_response, while explicit null is goal_absent. The actual reader validates identities before calling the projector; see [dispositions](projection-dispositions.md).

The scan deadline deliberately shares timeoutMs with the per-request deadline; this is now stated explicitly in consumer documentation. Cross-pass duplicates deliberately refuse the read because a non-atomic scan cannot certify one version of that identity; no deduplication guess is introduced. The nested-container absence/invalid advisory does not change field availability.

All exhausted or errored review attempts remain INCONCLUSIVE in their individual receipts. No timeout or incomplete answer is a PASS. Source unit hashes are in [review-scope.json](review-scope.json). Test and mutation execution evidence remains separate from reviewer judgment. Owner supervisor sign-off remains pending.
