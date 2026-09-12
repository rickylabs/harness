# Research — route identity over UHP `2026-08-11`

**Stage B.** Run `route-identity-uhp--s10`. Issue [#288](https://github.com/rickylabs/harness/issues/288).

---

## Summary, for a reader on a phone

Four route fields. Over UHP, **one of the four is observable**.

| Route field | Requestable on the wire? | Echoed back observably? | Answer |
|---|---|---|---|
| `model` | **yes** | **yes, and required** | **observable** |
| `provider` | no | no | **unobservable** |
| `effort` | no | no | **unobservable** |
| `cwd` | no | no | **unobservable, and unrequestable** |

Consequence, before any code is read: a UHP observation can only ever fill one of the four slots
`compareRouteIdentity` needs. The other three arrive as `null`, `invalid` is non-empty, and
`RouteStatus` is `unknown` on **every** UHP route. `isRouteEvidenceVerified` therefore returns
`false` on every UHP route, permanently, as the protocol stands.

That is the finding. The `RouteSource` defect named in the brief is real and confirmed (§6), but it
is **not** the binding constraint. Fixing `RouteSource` alone would not make one UHP route
verifiable, because there is nothing on the wire for three of the four labels to point at.

Plus one field added to scope mid-run by the coordinator: `metadata.model_fallback` (§5). The
specification is **silent** on whether it is emitted unconditionally. Presence-as-signal is the
fail-closed reading and should be kept, with a named risk.

---

## 0. Sources, all retrieved 2026-09-12

The specification is published in three layers, and the layers disagree about which is normative
for what. From the OpenAPI document's own `info.description`, `uhp-2026-08-11.openapi.yaml:10-12`:

> This document is normative for **structure**. The prose specification in `protocol/versions/` is
> normative for **behaviour**; where they disagree about behaviour, the prose wins, because
> behaviour is not expressible in OpenAPI.

and, two lines later:

> Conformance is defined by the suite in `protocol/conformance/`, not by this document.

So this note cites all three, and says which layer each claim rests on.

| Layer | Retrieved from | Local copy used for line numbers |
|---|---|---|
| Prose (normative for behaviour) | `https://raw.githubusercontent.com/HarnessRouter/harnessrouter/main/protocol/versions/2026-08-11/<chapter>.md` | `/tmp/uhp/<chapter>.md` |
| OpenAPI (normative for structure) | `https://unifiedharnessprotocol.org/schema/uhp-2026-08-11.openapi.yaml` | `/tmp/uhp.openapi.yaml` (40,505 bytes) |
| Conformance suite (defines compliance) | `https://raw.githubusercontent.com/HarnessRouter/harnessrouter/main/protocol/conformance/uhp_conformance/checks.py` | `/tmp/uhp-checks.py` (1,306 lines) |

Human-readable chapter URLs, all under `https://unifiedharnessprotocol.org/spec/2026-08-11/`:
[`architecture`](https://unifiedharnessprotocol.org/spec/2026-08-11/architecture),
[`lifecycle`](https://unifiedharnessprotocol.org/spec/2026-08-11/lifecycle),
[`harnesses`](https://unifiedharnessprotocol.org/spec/2026-08-11/harnesses),
[`tasks`](https://unifiedharnessprotocol.org/spec/2026-08-11/tasks),
[`streaming`](https://unifiedharnessprotocol.org/spec/2026-08-11/streaming),
[`sessions`](https://unifiedharnessprotocol.org/spec/2026-08-11/sessions),
[`files`](https://unifiedharnessprotocol.org/spec/2026-08-11/files),
[`errors`](https://unifiedharnessprotocol.org/spec/2026-08-11/errors),
[`security`](https://unifiedharnessprotocol.org/spec/2026-08-11/security),
[`schema`](https://unifiedharnessprotocol.org/spec/2026-08-11/schema).
Index and version confirmation: [`unifiedharnessprotocol.org`](https://unifiedharnessprotocol.org/)
publishes `2026-08-11` as the current version.

None of the evidence below comes from a fixture written by this run.

---

## 1. `model` — **observable**

**Chapter: Tasks §1.1 and §1.3.**

Requestable. Tasks §1.1 request-field table, `tasks.md:30`:

> `model` | string | no | Canonical model id. Omitted means the harness's default.

Structurally, `CreateResponseRequest` at `uhp-2026-08-11.openapi.yaml:788`:

> `model: { type: string, description: Canonical model id. Omitted means the harness default. }`

Echoed, and **required**. `Response` at `openapi.yaml:823` lists its required properties:

> `required: [id, object, created_at, status, output, model]`

and at `openapi.yaml:836`:

> `model: { type: string, description: The model that actually ran. }`

Tasks §1.3 makes the substitution path explicit rather than silent, `tasks.md:87-105`. If the
requested model cannot be served, a server MUST do exactly one of: fail with `422` and
`code: "model_unavailable"`, or substitute the harness's authorized default **and record the
substitution** via `metadata.requested_model`, `metadata.model_fallback` and
`metadata.model_fallback_reason`. The chapter then states the client-side consequence outright,
`tasks.md:104-105`:

> A client can therefore always answer "did the model I asked for actually run?" by comparing
> `model` with `metadata.requested_model`.

Behaviourally confirmed by conformance check **T-03**, "The response names the model that actually
ran", `checks.py:296-305`, which asserts `d.get("model")` is truthy with the failure message
`"response has no `model`, so a client cannot tell what ran"`.

**Verdict: `model` is requestable and observably echoed. It is the only route field of the four that
is.**

---

## 2. `provider` — **unobservable**

**Chapters: Harnesses §2 and §3; Tasks §1.1 and §1.3; Errors §*.**

There is no `provider` field in `CreateResponseRequest` (`openapi.yaml:778-819`) and no `provider`
field in `Response`, including its `metadata` object (`openapi.yaml:821-864`). A repository-wide
grep of the OpenAPI document returns the token `provider` exactly once outside prose: the error code
`provider_error` at `openapi.yaml:1054`. Errors §* describes it, `errors.md:93`:

> `provider_error` | failed response | The upstream model provider refused or failed.

That is the whole of `provider` on the UHP wire: a failure code. A provider exists behind the
server, and the client learns of it only when it breaks.

Three adjacent concepts exist and **none of them is the model provider of a completed task**:

1. **`Harness.base`** — `openapi.yaml:645-652`, Harnesses §2. Examples `codex`, `claude-code`,
   `hermes`. The chapter forecloses reading it as an identity, `harnesses.md:65-69`:

   > `base` values are not enumerated by this specification. A server MAY support bases this
   > document has never heard of, and a client MUST treat `base` as an opaque string — anything else
   > means the protocol has to be revised every time a harness is released, which is exactly the
   > coupling UHP exists to remove.

   `base` is the *harness* identity (which CLI is running), not the *model provider*. Conflating
   them is a fabricated agreement waiting to happen: a `codex`-based harness routed to an Anthropic
   model would report `base: "codex"` and satisfy a check that was asking who served the tokens.
   See the owner fork in `proposal-routesource-uhp.md` §4.

2. **`Model.backend`** — `openapi.yaml:762-775`, Harnesses §3. A per-model grouping key returned by
   `GET /v1/models` and `GET /v1/harnesses/{harness_id}/models`, `harnesses.md:76-100`. It is
   **discovery-time catalogue data**, not task-time observation. It never appears in `Response`.

3. **`ModelCatalog.backends` / `HarnessModels.backend`** — `openapi.yaml:739-761`. Same layer, same
   limitation.

So the best a client can do is *infer*: take `Response.model`, then issue a **second, separate
request** to `/v1/models` and look up which `backend` that id is grouped under. That is inference
across two calls at two different times against a catalogue the spec explicitly says is computed
live — Harnesses §3.1, `harnesses.md:103-107`:

> `available: true` means the server can serve that model for that harness **right now** — a
> credential exists and the provider can reach it. […] A server MUST compute `available`, not
> assert it.

A live-computed catalogue is exactly the thing that can have changed between the task and the
lookup. Under the standing fail-closed rule, inference from a second request is not observation.

**Verdict: `provider` is neither requestable nor echoed. Unobservable.**

---

## 3. `effort` — **unobservable**

**Chapters: Tasks §1.1 and §1.4; Streaming §2.4.**

The Tasks §1.1 request-field table (`tasks.md:27-41`) is complete and enumerates thirteen fields:
`input`, `model`, `metadata`, `stream`, `previous_response_id`, `instructions`, `store`,
`max_output_tokens`, `max_step`, `timeout_seconds`, `tools`, `include`, `background`. **There is no
reasoning-effort, reasoning-level, thinking-budget or equivalent field.** `CreateResponseRequest`
(`openapi.yaml:778-819`) carries the same thirteen and no more. Neither `Response` nor
`Response.metadata` defines any effort field (`openapi.yaml:821-864`).

The word "reasoning" does appear in the protocol, and it is a different thing. Streaming §2.4,
`streaming.md:74-83`, defines `response.reasoning_summary_part.added`,
`response.reasoning_summary_text.delta` and `response.reasoning_summary_part.done`, then says:

> Reasoning is a *summary*, not a verbatim chain of thought. A server MUST NOT be required to expose
> raw model reasoning, and a client MUST treat reasoning as optional […]

Tasks §3.1 lists the matching output item, `tasks.md:227`: "`reasoning` | The agent's summarised
thinking, in `summary[].text`". These report *that the agent thought* and a prose summary of it.
Neither reports *the effort setting the task ran at*. A summary is not a setting.

### 3.1 The extension-field argument, and why it still fails closed

Both `CreateResponseRequest` and `Response.metadata` carry `additionalProperties: true`
(`openapi.yaml:819`, `:861`). A client *may* therefore put `effort` on the wire, and a server *may*
echo something. Tasks §1.1 governs what that means, `tasks.md:43-50`:

> A server MUST ignore request fields it does not understand rather than rejecting the request. A
> client MUST NOT rely on an unknown field having an effect.
>
> Ignoring MUST be observable. When a server does not act on a field the request carried, it MUST
> name that field in `metadata.ignored_fields` on the response — an array of request-field names, in
> any order. […] A silently ignored field is indistinguishable from an honoured one, and a client
> cannot tell which it got.

This is the strongest argument available that effort could be *partially* signalled, and it must be
stated precisely, because it is tempting and it is not enough:

- `ignored_fields` is a **negative acknowledgement channel**. Absence of `"effort"` from it asserts
  that the server acted on the field. It does **not** report *what effort actually ran*. Route
  identity compares values, not booleans, so a negative acknowledgement cannot fill the `effort`
  slot.
- `tasks.md:44` is explicit that a client **MUST NOT rely on an unknown field having an effect**.
  Reading acted-on-ness out of `ignored_fields` for a field UHP never defined is exactly that
  reliance.
- The conformance suite does not test the general case. **T-09** (`checks.py:915-933`) and **T-10**
  (`checks.py:936-948`) verify `ignored_fields` only for `tools` and `include`, the two fields Tasks
  §1.4 reserves. No check exercises an arbitrary vendor extension. So a server can omit `"effort"`
  from `ignored_fields` while ignoring it, and still pass conformance.

**Verdict: `effort` is not a defined request field and has no defined echo. Unobservable. An
extension field is not an exception to this; it is the failure mode the rule exists to catch.**

---

## 4. `cwd` — **unobservable, and unrequestable**

**Chapters: Architecture §*, Lifecycle §4, Sessions §1, Security §5.**

This is the sharpest case, because the working directory is a **first-class concept in UHP that is
deliberately never named on the wire**.

The concept is load-bearing throughout the spec. Architecture, `architecture.md:86`:

> A **session** is a chain of responses that share conversational context and a working directory.

Lifecycle §4, `lifecycle.md:134`:

> A session MUST preserve, across tasks in the chain: conversational context, the working directory
> and its files, and the configured harness.

Sessions §1, `sessions.md:5-6` and `:22`:

> A session is what makes a second task cheaper than the first: the conversation is still there, and
> so is the working directory. […] The server MUST: run the new task in the same session, with the
> same working directory and its files;

Security §5, `security.md:87-88`:

> A server MUST refuse a second concurrent task in the same session (`session_busy`) — two agents in
> one working directory is not a defined state […]

And yet: a grep across all eleven prose chapters, the full OpenAPI document and the conformance
suite finds **no field named `cwd`, `working_directory`, `workingDirectory`, `workspace` or
`path`-of-workspace** in any request or response object. The working directory is **server-owned**.
The client neither chooses it nor is told it.

The only handle the client receives is an opaque correlator. Lifecycle §4, `lifecycle.md:133`:

> A session is created by the server when the first task of a chain runs. Its id MUST be reported in
> the response's `metadata.session_id`.

Confirmed behaviourally by conformance check **T-04**, "The response reports its session",
`checks.py:308-314`, whose failure message is `"response metadata has no session_id, so the session
cannot be continued or inspected"`. A session id proves *continuity of* a working directory across
tasks. It reveals nothing about *which* directory, so it cannot be compared against a requested path.

**Verdict: `cwd` cannot be requested and cannot be observed. It is the one route field for which
both sides of the comparison are missing over UHP.**

---

## 5. Added to scope mid-run — `metadata.model_fallback`: **specification is silent**

Asked by the coordinator during this run: is `metadata.model_fallback` emitted **unconditionally**,
or **only when a fallback actually occurred**? It matters because Atelier Cockpit currently treats
**presence of the key** as the mismatch signal, taken fail-closed as a guess rather than a decision.
If the router emits the key unconditionally with a falsy value, presence-as-signal makes every run a
mismatch and destroys the signal.

Answered under the same rule as the other four fields, from the specification only.

**The specification never addresses the non-substitution case.** The evidence, in full:

1. **Structure is silent.** `openapi.yaml:855` is the entire structural definition:

   > `model_fallback: { type: boolean }`

   No `description`. No `default`. Not in any `required` list — `Response.metadata` declares no
   required properties at all (`openapi.yaml:845-861`).

2. **The contrast is informative.** Its sibling two lines above, `openapi.yaml:852-854`, *is*
   explicitly conditional:

   > `requested_model:` / `type: string` / `description: Present when the server ran a different
   > model than was requested.`

   The spec authors stated a presence condition for `requested_model` and did not state one for
   `model_fallback`. That is silence, not an implied "unconditional".

3. **Prose mentions it exactly once.** Across all eleven chapters, `model_fallback` appears at
   `tasks.md:98` and nowhere else — inside the §1.3 worked example of a substitution. The governing
   sentence, `tasks.md:93-95`, covers only the substitution branch: "**Substitute** the harness's
   authorized default, and record the substitution in the response". No sentence says what the
   response carries when no substitution happened.

4. **Conformance does not settle it either — and it had the chance to.** Check **T-03**,
   `checks.py:296-305`, reads in full:

   > `if meta.get("requested_model") and meta["requested_model"] != d["model"]:`
   > `    assert meta.get("model_fallback") is True, (`
   > `        "the server substituted a model but did not set metadata.model_fallback")`

   The assertion fires **only inside** the substitution branch. A server that emits
   `model_fallback: false` on every response passes T-03. A server that omits the key entirely when
   nothing was substituted also passes T-03. There is no counterpart check.

   This matters because the suite authors demonstrably *do* write the negative half when they intend
   one: **T-10** (`checks.py:936-948`) exists purely as "the other half of T-09", asserting that a
   server does **not** report `ignored_fields` entries for fields the client never sent. They wrote
   that negative check for `ignored_fields` and wrote no equivalent for `model_fallback`.

5. **The protocol knows how to mandate unconditional emission, and did not here.** `Capabilities`,
   `openapi.yaml:624-630`:

   > A server reports `false` for a capability it does not implement rather than omitting it, so a
   > client can distinguish "not supported" from "server predates this field". A client treats an
   > absent key as `false`.

   That is the unconditional-with-falsy-value convention, spelled out, for a different object. It is
   not applied to `model_fallback`.

### 5.1 The answer, and what to keep

**Specification verdict: silent. Both behaviours are conformant.** Under the standing rule, that
makes `model_fallback` emission semantics **unobservable until proven otherwise against a live
router**, and presence-as-signal is the reading to keep, because it errs toward refusal.

Two things Cockpit should carry with it, both spec-cited:

- **Presence-as-signal carries a live "always refuses" risk**, and this note cannot retire it. If
  HarnessRouter emits the key unconditionally, the F10 gate refuses every run. That is a fail-closed
  failure, not a fail-open one, but it is still a failure, and it will look like a bug in Cockpit
  rather than in the router. It is a one-request observation against a live instance to settle.
- **There is a stronger trigger the specification actually endorses, and it is not the presence of
  `model_fallback`.** Tasks §1.3, `tasks.md:104-105`, tells clients to answer the question by
  comparing `model` against `metadata.requested_model`; the conformance suite models substitution as
  exactly `requested_model` present **and** `!= model` (`checks.py:302`). Unlike `model_fallback`,
  `requested_model` has a stated presence condition (`openapi.yaml:854`), so presence-as-signal *is*
  spec-backed there. Recommendation for #286: trigger on the union — `requested_model` present and
  differing from `model`, **or** `model_fallback` truthy — and keep presence-as-signal on
  `model_fallback` only until a live router is observed.
- One correctness note on the framing that reached this run: the value was described as
  `model_fallback: "false"`, a string. `openapi.yaml:855` types it `boolean`. A JSON string `"false"`
  is **non-conformant**, and it is also truthy in JavaScript, so it would trip a truthiness test as
  well as a presence test. That hazard is a server non-conformance hazard, not a shape the
  specification permits.

This section is a research answer only. Implementing the F10 gate stays in #286.

---

## 6. The repository side, read from the code

### 6.1 The contract as it stands

`packages/subagents/src/route.ts` carries the whole contract, as the brief states.

- `ROUTE_FIELDS` is exactly `provider`, `model`, `effort`, `cwd` — `route.ts:2`.
- `RouteStatus` is `known | mismatch | unknown` — `route.ts:6`.
- `RouteSource` is a closed union of eight literals — `route.ts:14-22`. Four `request.*`/`provider.*`
  labels for the requested side, four `thread/start.result.*` labels for the observed side.
- `RouteValueEvidence.value` is `string | null`, documented at `route.ts:32` as "Invalid, absent and
  blank values are represented as null; their raw value is never retained."
- `compareRouteIdentity` — `route.ts:142-166`. Status precedence at `route.ts:159-163`:
  `invalid.length > 0 ? "unknown" : mismatches.length > 0 ? "mismatch" : "known"`. **Unknown takes
  precedence over mismatch**, and this is deliberate — `route.ts:139-140` documents it as "Unknown
  takes precedence, while valid differences remain visible in an unknown diagnostic."
- `isRouteEvidenceVerified` — `route.ts:174-192`.

### 6.2 The suspected defect: **confirmed**

`isRouteEvidenceVerified` at `route.ts:180-181`:

```
if (requestedItem?.source !== REQUESTED_SOURCES[field]) return false;
if (observedItem?.source !== OBSERVED_SOURCES[field]) return false;
```

`OBSERVED_SOURCES` (`route.ts:65-70`) is a single, module-level
`Readonly<Record<RouteField, RouteSource>>` binding every field to one `thread/start.result.*`
label — the in-tree codex protocol's vocabulary, produced at
`packages/provider-codex/src/protocol.ts:172-219`.

The brief's suspicion is **confirmed**: the predicate demands exact equality against a
single-dialect map. A UHP provider labelling its model observation `uhp/responses.result.model`
would be rejected by `route.ts:181` regardless of what the server reported. Under the current
predicate every UHP route is unverifiable by construction.

### 6.3 …but it is not the binding constraint

This is the part the brief asked to be decided rather than deferred, and the ordering matters.

Suppose `RouteSource` grew a UHP arm today and `OBSERVED_SOURCES` became dialect-aware. A UHP route
would still be unverifiable, because §2, §3 and §4 above establish that `provider`, `effort` and
`cwd` have **no wire field to read**. Their observed `value` is `null`, `invalid` is non-empty
(`route.ts:154-155`), status is `unknown` (`route.ts:159-161`), and `isRouteEvidenceVerified`
returns `false` at `route.ts:176`, before the source check at `:181` is ever reached.

So there are **two independent blockers**, and the protocol-level one is both upstream and larger:

| # | Blocker | Fixable in this repository? |
|---|---|---|
| 1 | `provider`, `effort`, `cwd` have no UHP wire representation | **No.** Requires a protocol change or a vendor extension with conformance backing. |
| 2 | `OBSERVED_SOURCES` is single-dialect, so UHP provenance cannot verify | Yes — `proposal-routesource-uhp.md`. |

Fixing 2 without 1 changes nothing observable. Fixing 2 *while believing it unblocks certification*
is the error this spike exists to prevent.

### 6.4 Consumers, and where the distinction is preserved

Read from the code; `RouteSource` itself is exported at `packages/subagents/src/index.ts:124` and
imported nowhere outside `route.ts` and `index.ts`.

- `packages/subagents/src/provider.ts:108-110` — `DispatchResult.route?` is optional, documented at
  `:107-109` as "Optional for compatibility with providers that predate route observation. Absence
  is" unverified. `isRouteVerified` at `:274-276` is `result.verdict === "accepted" &&
  isRouteEvidenceVerified(result.route)`.
- `packages/provider-codex/src/protocol.ts:172-276` — the only orchestrating consumer today.
- `packages/dsh-app/src/dry-run-internal.ts:93-98` — calls `compareRouteIdentity` then refuses with
  `kind: "route-unverified"` carrying **`status: route.status`** and a `fields` array.

That last one is where deliverable 5 bites. `dry-run.ts:47` types the refusal as
`{ kind: "route-unverified"; status: RouteStatus; fields: readonly RouteField[] }`. The `status`
field **does** carry the `mismatch`/`unknown` distinction across the seam. The `fields` array
**does not**: `dry-run-internal.ts:97-98` computes it as
`[...new Set([...route.mismatches, ...route.invalid.map(i => i.field)])]`, which unions a contradicted
field and an absent field into one list. A consumer reading `fields` alone cannot tell a
model-substitution safety signal from a benign absence. Only `status` separates them, and over UHP
`status` is pinned to `unknown` (§7). That combination is the failure mode the deliverable-5 tests
guard.

### 6.5 `packages/contracts` is not affected

Checked directly: `packages/contracts` carries no reference to `RouteStatus`, `RouteSource`,
`RouteIdentityEvidence` or route identity in any form, and has no dependency on
`@rickylabs/subagents`. Its `src/routes.ts` is the unrelated HTTP API surface (`API_PREFIX`,
`CommandName`, `COMMAND_METHOD`, `commandPath`). **No change proposed by this run touches the
published package.**

---

## 7. The finding that survives everything: `mismatch` is unreachable over UHP

This falls out of §1–§4 combined with `route.ts:159-163`, and it is the most operationally important
sentence in this note.

Over UHP, `provider`, `effort` and `cwd` are always `null` on the observed side, so `invalid` is
always non-empty, so **`status` is always `unknown`** — including when the server has explicitly told
you it substituted the model. A UHP model substitution, the one contradiction the protocol reports
loudly and on purpose (Tasks §1.3), is **collapsed into `unknown` by the three absent fields**.

The signal is not lost, but it moves. `compareRouteIdentity` still records the contradicted field in
`evidence.mismatches` (`route.ts:156`) and still renders it into `detail` — `route.ts:130-131` is
written for exactly this, emitting the differences inside an `route unknown:` diagnostic. So:

- a **benign absence** over UHP → `status: "unknown"`, `mismatches: []`
- a **server contradiction** over UHP → `status: "unknown"`, `mismatches: ["model"]`

Any consumer that discriminates on `status` alone treats a model substitution as a benign absence.
`mismatches` is the field that carries the safety signal over UHP, and #286 must read it.

---

## 8. Certification consequence, from `routing.v1.json`

Read from `packages/routing/config/routing.v1.json` (874 lines, `schemaVersion: 1`, name
`harness-compiled-table-transcription`). Read only; nothing under `packages/routing` was edited.

**Every lane declares an effort step, on every step of every chain.** There are 23 lanes and 40
chain steps in total, and `route.effort` is present on all 40. The effort vocabulary is
`["low","medium","high","xhigh","max"]` (`routing.v1.json` → `efforts.ordered`).

The 23 lanes by name, with each step's declared effort:

| Lane | Purpose | Declared effort, per chain step |
|---|---|---|
| `light_implementation` | implementation | `low` |
| `normal_implementation` | implementation | `medium` |
| `complex_implementation` | implementation | `medium`, `high` |
| `fast_iteration` | implementation | `max` |
| `deep_analysis` | analysis | `medium`, `high` |
| `planning_decisions` | orchestration | `high`, `high` |
| `major_ui_ux_design` | design | `xhigh` |
| `major_ui_ux_adversarial_review` | design | `xhigh` |
| `adversarial_design_eval` | **evaluation** | `high` |
| `documentation_review` | documentation | `high`, `high` |
| `documentation_authoring` | documentation | `low` |
| `docs_audit` | docs_audit | `medium` |
| `docs_polish` | docs_polish | `medium`, `xhigh`, `xhigh` |
| `chore_code` | implementation | `medium`, `max` |
| `claude_workflow` | claude_workflow | `low` |
| `research_extraction` | research_extraction | `low` |
| `formal_plan_evaluation` | **evaluation** | `medium`, `high`, `max`, `high` |
| `formal_impl_evaluation` | **evaluation** | `medium`, `xhigh`, `max`, `high` |
| `review_claude` | **evaluation** | `xhigh` |
| `review_codex_light` | **evaluation** | `high`, `high` |
| `review_codex` | **evaluation** | `low`, `low` |
| `review_codex_complex` | **evaluation** | `medium`, `medium` |
| `review_codex_fast` | **evaluation** | `medium`, `high` |

### 8.1 Which must refuse evaluator certification

The S10 gate is "certification lanes over UHP". Certification is the `purpose: "evaluation"` lanes.
**Eight lanes carry that purpose, and all eight must refuse evaluator certification while a UHP
route is unverified:**

1. `adversarial_design_eval` — `opencode`, `moonshotai/kimi-k3`, effort `high`
2. `formal_plan_evaluation` — 4 steps, efforts `medium` → `high` → `max` → `high`
3. `formal_impl_evaluation` — 4 steps, efforts `medium` → `xhigh` → `max` → `high`
4. `review_claude` — effort `xhigh`
5. `review_codex_light` — efforts `high`, `high`
6. `review_codex` — efforts `low`, `low`
7. `review_codex_complex` — efforts `medium`, `medium`
8. `review_codex_fast` — efforts `medium`, `high`

The reason is the same for all eight and it is not about which effort value they name. It is that
each declares an effort **at all**, and `effort` is the field §3 shows UHP cannot report. A
certification whose evaluator independence rests on "this evaluator ran at `xhigh`" has no evidence
for that claim over UHP. `doctrine/WORKFLOW.md:145-148` states the standing rule this run inherits:

> Use the exact configured provider/model identity and declared effort; a physical route mismatch
> needs a verified mapping correction, not an approximate effort or model choice.

An unverifiable effort is not an approximate effort; it is no effort evidence at all, which is
strictly worse.

`formal_plan_evaluation` and `formal_impl_evaluation` are the most acute, because they are the two
lanes Stage F and Stage G run on (`doctrine/WORKFLOW.md:96-125`), and because both step through four
distinct efforts spanning `medium` to `max`. A collapsed-to-`unknown` route means the fallback chain
cannot be shown to have advanced at all.

**The other 15 lanes also declare an effort and are equally unverifiable over UHP.** They are not on
the S10 gate only because the gate is scoped to certification. They should not be read as safe.

### 8.2 The operative form of the refusal today

There is no `uhp` transport in the configuration. Transports appearing across all 40 chain steps are
exactly `native` and `openrouter`. So the certification consequence is **prospective and
preventive**: UHP must not be admitted as a transport for any `purpose: "evaluation"` lane until a
route over it can be verified. Nothing is currently mis-certifying; the ruling is a gate on #286, not
a repair.

---

## 9. Contradictions surfaced, not averaged

Per `doctrine/WORKFLOW.md:64-67`, contradictions are surfaced rather than resolved in synthesis.

1. **Vendor intent vs. wire behaviour.** Vendor prose describes UHP as unifying "how skills, tools,
   models, context, permissions, environments, sessions, files, and artifacts connect to each
   harness" ([press release, 2026-08-14](https://www.financialcontent.com/article/marketersmedia-2026-8-14-harnessrouter-open-sources-the-worlds-first-unified-interface-for-agent-harnesses-and-the-unified-harness-protocol)).
   "Environments" and "context" sound like `cwd` and `effort`. The specification itself defines
   neither on the wire. Per the standing citation bar, vendor prose is citable for intent and not
   for behaviour. **Behaviour wins; the fields are unobservable.**
2. **UHP's own transparency principle vs. its field set.** The spec argues hard and well that silent
   divergence is the cardinal sin — Tasks §1.1 "A silently ignored field is indistinguishable from an
   honoured one"; Tasks §1.3 "A server that substitutes silently makes every measurement downstream
   wrong". It then applies that principle to `model` alone. `effort` and `cwd` are not exempted; they
   are simply absent from the object model, so the principle has nothing to bite on. This is a gap in
   UHP, not a decision by UHP, and it is the right thing to raise upstream.
