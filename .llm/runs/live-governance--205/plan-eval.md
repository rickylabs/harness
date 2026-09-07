## Final plan evaluation — `live-governance--205`, round 2 as amended (D24 normative), commit `0de23e7`

**Verdict: PASS** — for implementation of a reviewable PR, with the six binding notes below. Not a full #205 live-acceptance claim, and the plan does not make one.

### D24 verified against source (all six attack vectors closed)

1. **Admission event aligns the actual log schema; no invented producer.** The event is an existing `TelemetryEvent` — `{at, runId, kind:"governance.admission", detail}` — verified against `sink.ts:32-40` ("free-form on purpose… the sink is a pipe, not a schema authority"; `kind` open) and `observability.ts:283-309` (`runId` required, `kind` non-empty, `detail` object). `runId` is log identity, never published; `parseEvents`' silent `at`-replacement (`observability.ts:294-303`) is explicitly not used for freshness; detail is validated through the existing governance parser; newest-per-item/regime selection, duplicate collapse, conflict→unavailable, malformed-newest cannot resurrect a superseded refusal. Producer is E5 #66 wiring, demonstrated only synthetically via the existing writer CLI; routing state rejected (`routing-state-machine.ts:50-67` — `affectedSession` is a session, detection can lag the effect); unavailability keeps the live source incomplete. Unknown ≠ unsent; admission ≠ execution — both honored.
2. **Probe is an operational dependency, not a build one; forbidden paths structurally denied.** Spawn vector pinned by L17 (`--allow-env=<name> --allow-net=<host>` only — no read/write/run, no `--now`); env-first credential verified (`lib/provider-credential.ts:78-79`), injectable deps verified (`provider-usage.ts:77-83`), receipt proved execution with file access denied; the netscript *tasks* are correctly rejected because `deno.json:79,81` grants `--allow-read`; validity bound travels with the serialized result rather than being pinned; service-injection seam removes Deno/network from Node tests; no package-graph change (`check-project-graph.mjs` sees nothing new). No product code exists yet at this head — confirmed.
3. **Timing, isolation, freshness, oversized/future payloads.** Completion clock with leaves ≤ completion; expired legs discarded with explicit notes, never restamped; envelope expiry = earliest remaining leg expiry; no-successful-leg → unavailable; explicit `--now` may deliberately make a live observation future-invalid/stale; D12/L11a/L11b hold the leaf-vs-envelope line; `maxBytes` 1…4 MiB with an oversize refusal row; future leaves rejected by the shipped parser (`observations.ts:167-172`, `:342`). Requested-source failure ⇒ `ok=false` ⇒ `complete:false`/exit 3 while successful legs render; all-unconfigured ⇒ unavailable, not empty-success; file mode unchanged.
4. **Spend is exact.** Endpoint fixed to `https://openrouter.ai/api/v1/key`, `redirect:error`, bounded, timeout; window enum → `usage/usage_daily/usage_weekly/usage_monthly` with a fixed reader-owned label; `ceilingUsd` null; no BYOK addition, no balance inference, no ceiling/window mismatch; provider label fixed; response label/user metadata never leaves the parser.
5. **Cgroup scope honest.** Configured cgroup-v2 directory only — no auto-discovery, no v1 fallback, no host claim; unlimited ⇒ explicitly unknown (this container's `memory.max` is unlimited, so capacity stays unknown here); a finite unrelated ancestor is not a dispatch-host limit; known used bytes preserved with headroom unknown; `os.totalmem()` never used.
6. **Gates and citations real.** All cited upstream/in-repo lines verified this session. Gates now include `check:lifecycle`/`check:links`/`check:metadata`, root build, full workspace tests. Receipts are labeled reachability-only; "no criterion is claimed closed"; PR carries a Part-of-#205 relationship, no closing keyword, humans merge.

### Binding implementation notes (D24 governs; earlier shorthand must not be the implemented reading)

1. Error-policy paragraph (`plan.md:252-253`, "exit 0 when a leg is unread") is superseded by D24 bullet 2 — write the docs/failure table from D24.
2. Descriptor `url` validation (`plan.md:230-231`) must enforce exactly the OpenRouter key endpoint, not any absolute `https:`.
3. Mapping row's "fixed `windowMinutes` per window id" (`plan.md:244`) is superseded — durations/labels are validated source configuration, never guessed.
4. L3 must assert `binding:false` plus the binding-unobserved note, not "binding".
5. D21's "v1 fallback path" phrase is superseded by D24 bullet 6.
6. If partial capacity rendering (known used / unknown total) is implemented, widen the `render.ts` mutation row beyond "D12 only" — the shipped `headroom()` (`render.ts:99-101`) currently renders the whole line unknown when either field is null; D24 permits but does not require the partial display. Also: document only total/monthly spend windows as receipt-observed; daily/weekly fail unread if the endpoint omits them.

### Remaining live-acceptance unknowns (exact, no fabricated passes)

- **Criterion 1, capacity:** closes at the authorized cgroup scope only if S6 exercises a finite reading; here `memory.max` is unlimited, so capacity remains explicitly `unknown`; physical-host scope is a standing unknown, never substituted.
- **Criterion 2:** `unknown` until a gate with authority records an item-scoped admission (E5 #66); the producer shape is defined and the read path is synthetically tested only.
- **Criterion 5:** S6 is the integration check at the already-authorized read-only scope; the two receipts prove reachability, nothing more.
- **Criterion 6:** the exact-head evaluator states per-criterion status; closure only against actual receipts.

Dependencies, exact: netscript upstream `8ba53bc…` as a read-only operational checkout behind an adapter; `OPENCODE_API_KEY`/`OPENROUTER_API_KEY` env-only; a `deno` binary at runtime; the shipped parser/renderer/projection; contracts frozen at 0.1.0; zero new workspace edges.

Route: same session, `glm_5_3` `provider_default` per both matrix receipts (`seat3-live205-plan-review-matrix.json`, `seat3-live205-recovery-matrix.json`); only provider capability changed in ordered transport fallback; prior refused/stalled attempts were not treated as verdicts; no sibling downgrade. Implementation of S1–S6 is authorized; no product mutation occurred before this PASS.

[source: same independent GLM reviewer session; topic: current plan gate; date: 2026-09-07]
