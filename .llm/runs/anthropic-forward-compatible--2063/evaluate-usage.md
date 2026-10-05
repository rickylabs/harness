# IMPL-EVAL round 3 — standard Messages usage retention (issue #2063 release-acceptance audit)

## Verdict: PASS

Evaluated HEAD `9e375a1765234d179c4945480d68e69ac2f6c906` ("fix(ai/anthropic): retain usage
across standard Messages frames"); diff scope `00bc2e2d2..9e375a176`; all work confined to the
detached evaluation worktree
`/home/agent/projects/netscript/worktrees/eval-anthropic-2063` (worktree state clean apart from
untracked run artifacts; neither file restoration needed an exception path — both restores were
verified byte-identical). This is the standard-release-acceptance repair for the known Normalized
usage loss (message_start `input_tokens` lost because the SDK's normalized usage takes
`message_delta` only); it is not a new feature, no new transport, no SDK private API and no
dependency/config change (`deno.lock`, `packages/ai/deno.json` untouched in the range).

## 1. Change semantics verified against the public SDK seam

`packages/ai/src/adapters/tanstack-chat-client.ts:57-64` adds the owned public
`ProviderUsageObserver` (observe/read) wired through `ChatClientMeta.createUsageObserver`
(tanstack-chat-client.ts:98-99). Anthropic's observer (`createAnthropicUsageObserver`,
`packages/ai/src/adapters/anthropic.adapter.ts:283-352`) reads only
`message_start.message.usage` and `message_delta.usage`, replacing cumulative reported values and
retaining earlier cache/server fields for later-but-incomplete deltas; whitelist accepts only
safe non-negative integer scalars (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`, `server_tool_use.web_search_requests/web_fetch_requests`) — everything
else (strings, objects like the fixture's `unrelated` marker) never enters `read()` output.

Public seam correct in the actual runtime:
- `chat()` exposes `debug?: DebugOption` (`@tanstack/ai@0.52.0` `dist/esm/activities/chat/index.d.ts:204`).
- `DebugConfig` categories are exactly `provider/output/middleware/tools/agentLoop/config/errors/request/sandbox`;
  per `dist/esm/logger/resolve.js`, a partially specified `DebugConfig` **defaults omitted flags to
  `true`** — so the fix's explicit `false` on the other eight categories
  (tanstack-chat-client.ts:227-235) is required and correct (`undefined` debug would also enable
  `errors` only-by-default ConsoleLogger noise).
- The `provider` category emits raw provider frames as `{ chunk: event }`
  (`@tanstack/ai-anthropic@0.18.3` `dist/esm/adapters/text.js:488` `logger.provider(…, { chunk: event })`),
  and `InternalLogger.provider` routes through the user logger's `debug` level
  (`dist/esm/logger/internal-logger.js:51`) — public `Logger` shape is the four-level
  `debug/info/warn/error`, matching the sink the fix constructs.
- Finish replacement is additive: `{ ...event, usage: observer.read() ?? event.usage }` keeps all
  other finish fields; `read() === undefined` falls back to SDK-normalized usage
  (tanstack-chat-client.ts:252-257); observers are created per `stream()` call, so nothing carries
  across turns; the abort path is untouched (abort test among the 11).
- Other providers omit `createUsageObserver`, keeping `debug: undefined` default behavior.

## 2. Independent regression-first reproduction (this worktree)

Sources at `9e375a176` checked out; the two source files temporarily restored with
`git restore --source=00bc2e2d2 -- packages/ai/src/adapters/anthropic.adapter.ts
packages/ai/src/adapters/tanstack-chat-client.ts` **while keeping the HEAD test file** (fixture
`message_start` input 3/output 1, final `message_delta` output-only 8). Everything below runs the
CI binary `/home/agent/.local/share/mise/installs/deno/2.9.5/bin/deno` (which the structured
wrapper inherits via `Deno.execPath()`):

- Exact-name filter read from HEAD line 213:
  `anthropic: selected additive ID, native options and request credentials reach Messages unchanged`.
- `deno check` on that state exits 0 — the failure is not a compiler error.
- Result: **`AssertionError: Values are not equal.` diff `-0 +3`** (promptTokens actual 0 vs
  expected 3), wrapper exit 1 — receipt `receipts/usage-eval-before.json` with
  `"summary":{"passed":0,"failed":1}` + `"exitCode":1`.
- Both source files restored from `9e375a176` immediately afterwards and byte-compared OK, even
  though the run passed.

## 3. Fixed-state runs (CI Deno 2.9.5, exact filenames)

- Complete new regression file — 11 tests: `receipts/usage-eval-regression.json` →
  11 passed / 0 failed, `"exitCode":0`.
- Full `packages/ai/tests plugins/ai` selection: `receipts/usage-eval-ai-suite.json` →
  **202 passed / 0 failed, `"exitCode":0`** (202 = fresh successor of the historical 201 + the new
  usage test; the historical full-root 5425-pass/2-fail/19-ignored evidence and prior 2 passing
  reruns remain historical and are superseded by this fresh run).
- The split-usage test (`tests/anthropic_forward_compatible_test.ts:259-317`) independently
  proves within the suite: cumulative replacement (turn-1 finish 6/8/14 with
  `cacheWriteTokens:4`, `cachedTokens:7`, `serverToolUse:{webSearchRequests:2,
  webFetchRequests:1}`), no per-turn carry-over (turn-2 `{9,4,13}`), and undefined finish usage
  on a turn that reports no frames — no stale fallback; the `unrelated` string key never
  escapes; all five console methods (`log/debug/info/warn/error`) are mocked by
  `withMessagesTransport` and the secret-safety asserts run for every wire test, proving the
  observer logs nothing.

## 4. Published-consumer rehearsal only (no author-tree execution)

`qualify-published-consumer.ts --source-rehearsal` (read from the author run dir, **copied and
executed only inside this eval worktree**, script's own temp-dir child environment offline):
`receipts/usage-eval-source-rehearsal.json` → `mode:"source-rehearsal"`, `outcome:"PASS"`,
passed 11 / failed 0, graph exit 0, public typecheck exit 0, exact isolated graph
`@tanstack/ai@0.52.3` + `@tanstack/ai-anthropic@0.18.3…`, and
`publishedConsumerProof:false`. This rehearses release packaging; the locally published exact
`0.0.7` does not expose the new public `models` type and `0.0.8` is absent, so no real
published-consumer proof exists at this HEAD.

## 5. Retained prior evidence (scope anchor at `51d8e10d5`)

The catalog/additive-ID/native-option semantics proved in rounds 1-2 remain in force, anchored
by `51d8e10d5` from the retained `evaluate.md` in this run directory (eval worktree copy) and its
receipts; the historical author-side evidence (full-root suite, CLI E2E lack of Aspire/Docker,
and the earlier worklog disclosures) remains historical and unchanged in character.

## 6. Objective release limits (do not read source PASS as release proof)

1. **Published-consumer proof outstanding:** stable `@netscript/ai@0.0.8` is not published;
   published `0.0.7` rejects the new config surface (public `models` type). The rehearsal is a
   local stand-in and sets `publishedConsumerProof:false`; a real qualification must run against
   the exact published stable version via the same script (no `--source-rehearsal`).
2. **No paid Anthropic inference** was run; Messages compatibility remains mock-wire-based, and
   the merge-repair now covers standard `message_start`+`message_delta` usage retention for the
   stream path recorded by the SDK fixtures.
3. `deno task e2e:cli` scaffold.runtime remains unblocked-merge-unverified in this environment
   (no `aspire` binary, Docker daemon offline) — historical status retained; merge-readiness
   still requires a green CLI E2E where Aspire/Docker exist.
4. Expense guard: evaluation route ran within the operator-authorized ≤0.50 USD guard on
   OpenCode Go (provider_default); exact billing not independently attested.
5. Round policy: matrix route GLM 5.3 Flash/Zhipu `provider_default`, maxRounds 5 /
   re-steer-same-session / notify-after-3; this is round 3 with prior rounds' same-session
   correction retained; no profile files were read this round; no author-checkout, push, commit,
   or board action occurred. No source repair was necessary — findings list is empty beyond the
   limits above.

## 7. Receipts (this worktree, `.llm/runs/anthropic-forward-compatible--2063/receipts/`)

`usage-eval-before.json` (exit 1, `-0/+3` AssertionError), `usage-eval-regression.json` (11/0,
exit 0), `usage-eval-ai-suite.json` (202/0, exit 0), `usage-eval-source-rehearsal.json` (PASS,
11/0, rehearsal mode). Raw wrapper/stderr output stays inside receipts or `/ephemeral`; every
key/credential in evidence is a `test-*` fixture string.
