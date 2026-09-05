# Harness (rickylabs/harness) — parked work from the N5 supervisor thread

**Status:** PARKED. Wrong thread — this session owns Wave 7 (blog/billing), not the harness
programme. Nothing was filed, committed, pushed, or commented anywhere. The board is untouched.
Hand this to the architect lane.

**Session:** https://claude.ai/code/session_01V4CCixt6nEXmFbYJN3pTy2
**Parked:** 2026-09-04

---

## 1. Verified on the box — Stage B, reproduced and sharpened

Run from `ai-agents`. This is the one item here that is *evidence*, not reading.

| Probe | Result |
|---|---|
| DNS `lm-studio` | `10.4.12.35` via `ai-shared` |
| DNS `llama-vulkan` | `10.4.12.37` via `ai-shared` |
| DNS `llama-rocm` | `10.4.12.39` via `ai-shared` |
| TCP `lm-studio:1234` | **Connection refused**, `time_connect=0.000000s` |
| TCP `llama-vulkan:8080` | **Connection refused**, `time_connect=0.000000s` |
| TCP `llama-rocm:8081` | **Connection refused**, `time_connect=0.000000s` |
| OpenRouter `/v1/models` | **HTTP 200** |

### Two corrections to the handoff's framing

**(a) "Refused", not "timeout", upgrades the conclusion from inference to proof.**
A refusal is an RST — the SYN reached the host and was actively rejected. A firewall DROP or a
routing fault times out instead. So L3 routing and DNS are proven good end to end, and the
diagnosis "services not listening" is now established rather than inferred.

**(b) It is very likely not a fault at all — it is documented behaviour.**
Issue #34 already records: *"The llama-rocm container's entrypoint is `sleep infinity` — starting it
does not start a server. The provider must health-check the endpoint, never infer readiness from
container state."* That exactly predicts all three observations: container up (DNS resolves),
**logs empty** (`sleep infinity` emits nothing), nothing listening (no server was ever started).
LM Studio `:1234` is the separate ordinary case of the server toggle being off.

**Consequence:** #65 should probably not be scoped as "repair a broken service". The durable fix is
the health-probe contract #34 already calls for, plus an explicit start step in the local-model
lane. Recommend confirming this reading before anyone spends a repair cycle.

**(c) Blocker for whoever picks this up:** these containers are **not reachable from `ai-agents`**.
This box's `DOCKER_HOST=tcp://netscript-dind:2375` — a dind daemon holding only
`rd-relay`, `pg-relay`, `postgres-cb583538`. `docker inspect lm-studio` → `No such object`. The
lm-studio/llama containers live on the **NAS host daemon**. Any inspect/start/repair must be driven
from the host, not from `ai-agents`. No host docker socket is mounted here.

**Routing verdict, unchanged:** route hosted. OpenRouter is the only confirmed-live seam.

---

## 2. DSH architecture extraction (primary source, docs fetched 2026-09-04)

Docs render as Markdown by appending `.md` to any page URL. Base:
`https://deepseek-harness.github.io/deepseek-harness/en/`

### 2.1 `workflow` — the deterministic coordinator primitive (highest-value finding)

**Not** a DAG or state-machine engine. It is a script-execution container running JS with top-level
await, returning JSON. The script controls its own flow via engine-provided hooks
`agent()`, `phase()`, `log()`, plus `parallel()` / `pipeline()` combinators.

```ts
interface WorkflowStartRequest {
  script: string
  meta: WorkflowMeta            // { name, description, whenToUse?, phases? }
  args?: unknown
  subagentProvider?: string     // <-- selects WHICH backend runs the children
  maxTotalAgents?: number
  parent: Agent
  signal?: AbortSignal
}
interface WorkflowResult {
  value: unknown
  stopReason: 'completed' | 'cancelled' | 'error'
  error?: string
  agentsStarted: number
}
interface WorkflowRun {
  readonly id: WorkflowRunId
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>   // never rejects
  cancel(reason?: string): void
  dispose(): Promise<void>
}
```

- Events are observe-only snapshots: `workflow/{start,phase,log,agent-start,agent-end,end}`.
  `workflow/end` deliberately omits the value (no mutable aliasing). A throwing subscriber is
  logged, never propagated; each listener gets a cloned payload.
- `WorkflowError` is `fatal: true` on hook misuse. `parallel()`/`pipeline()` **re-throw** fatal
  errors rather than mapping to `null`; per-item `null` is reserved for genuine child-run failure.
  Typos kill the script loudly.
- Durable Chat records via `dsh-tool-workflow`; invariant validator `dsh-tool-workflow/invariant`
  enforces one start per run, unique positive member seqs, paired endings, nothing open at end.
  Missing terminal facts at the log tail mean interruption, not corruption.

**Why it matters:** this is a code-first deterministic orchestrator whose execution backend is
selected *by name*. Combined with §2.2 it is the MASTER/COORDINATOR the programme is chasing.

### 2.2 `subagent` — named provider registry, remote backends explicitly supported

Feeds **#33** directly.

```ts
interface SubagentCapabilities {
  readonly agentOptions: boolean
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
interface SubagentProvider {
  readonly name: string
  readonly capabilities: SubagentCapabilities
  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun>
  prepareContinuable?(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec>
}
interface SubagentStartRequest {
  readonly label?: string
  readonly prompt: ContentBlock[]
  readonly parent: Agent
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions
  readonly outputSchema?: ObjectJsonSchema
  readonly maxDepth?: number
  readonly toolFilter?: ToolRestriction
  readonly persona?: string
}
interface SubagentRun {
  readonly id: SessionId
  readonly localAgent: Agent | undefined   // undefined for REMOTE providers
  readonly result: Promise<SubagentResult>
  dispose(): Promise<void>
}
interface SubagentResult {
  readonly output: ContentBlock[]
  readonly structured?: unknown
  readonly diagnostic?: string
  readonly stopReason: 'completed'|'aborted'|'error'|'max-tokens'|'refusal'
}
// registry
registerProvider(provider: SubagentProvider): () => void
getProvider(name: string): SubagentProvider | undefined
list(): string[]
```

Load-bearing details:

- **Capability discovery is two mechanisms.** Start-time flags are validated *before* `start()` and
  an unsupported request is rejected loud with `SubagentError('UNSUPPORTED_CAPABILITY')` — never
  silently degraded. Continuable support is discovered by **method presence**: no
  `prepareContinuable` ⇒ `startContinuable()` is refused.
- **Remote providers** return a parent-scoped lifecycle id with `localAgent: undefined`. Local
  one-shot runs must publish a child session before `start()` fulfils, record `parentSession` in the
  child header, and append the resolved descriptor before the first request.
- **Steering** on continuable children: `sendMessage()` routes by activation state — `running` ⇒
  steer nearest step; `waiting` ⇒ wake and steer same activation; no activation ⇒ cold-resume then
  steer. `interrupt(targetSessionId, authority)` exists. Authority derives from the exact live
  sender; delivery requires a direct ownership relationship.
- The provider's only role in continuables is `prepareContinuable()`. The manager owns composition,
  Agent creation, prompt delivery, cold resume, ownership and disposal.
- Settlement reaches the parent as a distinct `kind: 'subagent-settled'`, `form: 'notice'` message —
  deliberately not an agent message, because it is the manager stating what became of the child.
- Registration is effect-scoped and HMR-safe; removing a provider blocks new starts without
  revoking accepted runs. Result payloads are redacted (no tool inputs, file contents, env,
  credentials, raw protocol) and capped at 4096 UTF-8 bytes.

**Port, don't invent.** The netscript agentic suite already implements these mechanics:
`.llm/tools/agentic/codex/` → `launch-codex-slice.ts` ≈ `start()`, `codex-resume.ts` ≈
`sendMessage()`, `codex-watch.ts --mode turn` (fires on `task_complete`) ≈ result settlement,
`classify-codex-failure.ts` ≈ the `SubagentStopReason` taxonomy, `app-server-message.ts` ≈ the
transport, `launcher-route.ts` ≈ capability descriptors. Also `agy-live.ts`, and
`.llm/tools/agentic/opencode/opencode-run.ts`. This corroborates #33's "no PTY needed" finding from
a second, independent direction.

### 2.3 `persistence` — swappable durability seam (Postgres is viable)

```ts
abstract locate(meta: SessionHeader): SessionLocation | undefined
abstract create(meta: SessionHeader, inheritedEventCount?: SessionLogOffset): Promise<void>
abstract append(id: SessionId, events: readonly SessionEvent[]): Promise<void>
abstract prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>
abstract load(id: SessionId): Promise<SessionInspection>
abstract inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>
abstract borrowSession(id: SessionId, signal?: AbortSignal): Promise<BorrowedSessionSource>
abstract readFrom(id: SessionId, fromSeq: SessionLogOffset, signal?: AbortSignal): Promise<SessionEventSuffix>
abstract list(signal?: AbortSignal): Promise<SessionHeader[]>
abstract listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>
```

- Shipped provider `dsh-session-persistence-jsonl`: append-only logical JSONL per session, stored as
  checksummed concatenated Zstandard frames by default, raw lines by config.
- Header carries format version, cwd, lineage (`isSeeded`, `parentSession`), created-at, origin,
  delegation depth, agent preset — travels separately from the event log.
- **Crash recovery does not truncate** (a single turn can be huge in a long-horizon task). It closes
  the orphaned turn with a synthetic `turn/end { reason: { kind: 'interrupted' } }`. `interrupted`
  is the only `TurnEndReason` the loop never naturally emits — so it is a reliable marker. Cold
  sessions only; live sessions reject synthetic boundaries.
- Fixed-window batching: the first pending event starts the window, later events join without
  resetting the deadline. `session/flush` cancels the wait and drains to quiescence.

### 2.4 `session-telemetry` — the E9 sink contract

```ts
interface SessionTelemetrySink {
  emit(record: SessionTelemetryRecord): void   // MUST be non-blocking enqueue
  flush?(): void
  shutdown(): Promise<void>
}
```

- Registered under service key `telemetry`; **one implementation per context — duplicate load throws.**
- Two record classes: **ledger** records mirror session-log events 1:1 carrying
  `session.id`/`event.type`/`event.seq`; **ops** records (`agent-error`, `shutdown`) deliberately
  omit `event.seq`.
- Only the first `assistant/chunk` per `(turn, step)` ships; the rest drop at capture.
- **Delivery is best-effort** — records can be lost (crash, reload) and duplicated (cursor-less
  re-adoption, SDK retries). Receivers dedupe ledger records on `(session.id, event.seq)`; ops
  records must tolerate duplicates. *This is why #86's disk backfill is not optional.*
- Redaction is the `session-telemetry/record` waterfall and **ships no built-in rules** — "exported
  data is exactly as clean as the rules a deployment mounts." Affects exports only, never the
  canonical log.

### 2.5 `typert` — the remote surface

- `InvocationDescriptor` is carrier-independent and generated locally on **both** host and client;
  it is never transmitted. Only a lightweight wire payload crosses.
- `TypertGateway` (host) accepts decoded `InvokeRemoteRequest` {namespace, method, wire args}.
  `TypertClientRemote` is mounted client-side via `$mount()` for typed namespace access.
- Params are `'json'` or `'lookup'` (host object references resolved via registered providers; the
  registry retains a lookup's wire declaration after its resolver unloads).
- Errors: gateway codes like `'gateway/lookup-unavailable'`; business and lookup-policy errors
  **retain identity**, infrastructure wraps only unrecognised exceptions.
- Streams yield `AsyncIterable<unknown>`; **cancellation is out-of-band `AbortSignal`**, not a wire
  argument.
- Docs cover invocation contracts only — no WebSocket framing or auth. Pair with the `remote.mux`
  surface named in #30 when specifying #79–#82.

### 2.6 `web-server` — carrier, and the security constraint

```ts
type WebRouteKind = 'exact' | 'prefix'
interface WebRoute { kind: WebRouteKind; path: string; handler(req, res): void|Promise<void> }
register(route: WebRoute): () => void
registerUpgrade(route: WebUpgradeRoute): () => void
registerFallback(handler: WebRoute['handler']): () => void
interface Config { host: '127.0.0.1'|'0.0.0.0'; port: number; compression?: 'none'|'gzip'; ... }
```

Matching is fixed: exact, then longest-prefix, then the single fallback seat. Registration order is
irrelevant; a second fallback registration **throws**. Index customisation via structured
`webserver/index-inject` rows plus raw `applyIndexTaps` escape hatch.

> **The carrier owns no TLS and no authentication.** "A non-loopback bind exposes the server unless
> the composition supplies those controls." `dsh web` enforces loopback and delegates Host/Origin
> validation to the Connection plugin.

Constrains any mobile-reachability design: security is the composition's job, not dsh's.

### 2.7 Other seams worth knowing

- **`goal`** — `GoalRef {id, revision}` with CAS (every accepted mutation increments revision);
  phases `active|paused|blocked|complete`; `GoalSnapshot {objective, phase, blockedReason?,
  maxGoalRounds}`; `GoalView` adds `roundsStarted/createdAt/updatedAt/activation`. Linked to
  sessions by durable `goal/change` events; only admitted `user/message` rounds advance
  `roundsStarted`. Natural fit for milestone/epic identity.
- **`jobs`** — `JobStart {kind,label,outputLimitBytes?,owner?,run(): JobHooks}`; hooks are
  `cancel(reason?)`, `done`, optional `readOutput()`. `JobOutcome.status` ∈
  `completed|killed|failed`. Consumers get immutable `JobSnapshot`s (never live registry state) with
  a `reported` flag. `maxConcurrentJobsPerOwner` default 10. Listeners `onJobDone`/`onJobsChanged`
  are effect-scoped. Authorization compares owner sessions using the **exact registered Agent
  instance**.
- **Cordis** — context is a service repository; a plugin claims a stable `ctx.<key>`; `inject`
  blocks activation until deps exist, so load order is expressed as service requirements, not boot
  sequencing. Five dispatch modes and **the mode is part of the event's public contract**:
  `emit` (fire-and-forget), `waterfall` (`(...args, next)` middleware), `parallel`, `serial`,
  `bail`. All registrations are `ctx.effect`s ⇒ reversible ⇒ HMR for free.
- **Providers config** — custom OpenAI-compatible gateway needs id, baseURL, `api`, credentials,
  ≥1 model. Models are **text-only by default**; vision needs explicit `input: [text, image]` or
  route-level `defaultInput`. Compat switches that matter: `supportsDeveloperRole: false`,
  `maxTokensField: max_tokens`. Model discovery calls `GET /models`; enter models manually where the
  endpoint lacks it. Directly relevant to #34's local providers.
  ```yaml
  llm-pi-ai:
    providers:
      my-gateway:
        apiKeyEnv: GATEWAY_API_KEY
        api: openai-completions
        baseURL: https://gateway.example/v1
        compat: { supportsDeveloperRole: false, maxTokensField: max_tokens }
        models: [ { id: vision-preview, input: [text, image] } ]
  ```
- **Python SDK** — `DeepSeekHarness(provider, model, max_tokens, cwd, dsh_home, profile)` as a
  context manager; lazily starts bundled `dsh --profile sdk-minimal` and reuses it until exit.
  `harness.run(task, session_id)` → `.final_response`. Sessions are uncompressed JSONL under
  `<dsh_home>/sessions`; reuse harness + session id to continue a durable conversation. Ships a
  matching native runtime wheel and the `dsh` command — **no separate Node install**.
- **Subsystem count** — 52 documented. Page slugs enumerated; note `agent-team`, `webhook`, `todo`,
  `extensions`, `attachment`, `feedback` were listed in the index but returned 404 as `.md` and were
  **not** retrieved. `agent-team` ("Agent Teams with implicit Lead and shared DAG, peer mailbox")
  is the most important gap — it may overlap the coordinator design in #36. **Recommend the
  architect lane retrieve it before finalising coordinator semantics.**

---

## 3. agy research report — COMPLETE

`agy-research.md` (60,141 bytes), Gemini 3.8 Flash high, cited throughout. Sections:

1. `runzhliu/deepseek-harness-docker` — packaging, Dockerfile/compose, upstream pinning, licence.
   Confirmed base `node:24-trixie` multi-stage (glibc 2.41 + build tools). **Feeds #47.**
2. `sorsama/deepseek-harness-mobile` — **now out of scope for this repo** (decision 4 puts both
   cockpits in netscript). Route to the netscript side rather than discarding.
3. `GithungDang/dsh-client-ui-mobile` — same.
4. t3.codes multi-CLI dispatch + agent-swarm PRs, subscription-vs-API auth. **Feeds #76.**
5. Transport comparison table across all four. **Feeds #47 and #76.**

Sections 2–3 were commissioned before the scope steer landed; the run was already in flight and is
subscription-billed, so it was allowed to complete rather than re-run. Not verified by me.

---

## 4. State of the board — untouched

Nothing filed, edited, commented, labelled, committed or pushed. No `harness` label applied
anywhere (correctly — it is the live dispatch trigger). The 49 leaves #40–#88, milestone M1 and
PR #89 are exactly as the architect lane left them.

Read but not acted on: #30 (+ handoff comment), #33, #34, #37, #58, #59, #60, #65, #74.

## 5. If this thread resumes

Next actions were to be, in order: #58 (tiers/family rule/fallback as data, `OPENROUTER_MODEL_IDS`
migrating in from `.llm/tools/agentic/config/models.ts`), #59 (probe on *metadata* — assert absence
of codex-cli's `Model metadata for '…' not found` warning), #60 (local capability matrix as data),
#74 (label→target mapping). None were started. §1(b) should be resolved first, since it may rescope
#65 from a repair to a health-probe contract.
