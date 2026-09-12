# Research — `uhp-stream-adapter--s11`

Stage B. Three legs, one citation bar. Everything load-bearing below carries a URL retrieved during
this run (2026-09-12) or a repository path.

What this run did **not** do: reach a HarnessRouter. There is none on this host, there is no container
runtime, and none was started. Every behavioural claim about *this repository* is proven by tests;
every claim about *the protocol* is proven by the document; no claim about a live server is made
anywhere. See `verification.md`.

---

## 1. External leg — the published specification, retrieved today

Retrieved 2026-09-12 against UHP `2026-08-11`. Retrieval is through a summarising fetch, so quoted
strings below are the chapter's own words as returned; where a rule is load-bearing it is quoted rather
than paraphrased.

| Chapter | URL |
|---|---|
| Streaming | https://unifiedharnessprotocol.org/spec/2026-08-11/streaming |
| Lifecycle | https://unifiedharnessprotocol.org/spec/2026-08-11/lifecycle |
| Sessions | https://unifiedharnessprotocol.org/spec/2026-08-11/sessions |

Inherited from S10's retrieval of the same version, and not re-derived here: Tasks §1.1's exhaustive
thirteen-field request table, the `openapi.yaml` line references for `Response.required` and
`Response.model`, and conformance checks T-03 and T-04
(`.llm/runs/route-identity-uhp--s10/research.md`).

### 1.1 Streaming §1 — the event vocabulary

Eighteen event types are defined:

    response.created                          response.output_item.added
    response.in_progress                      response.output_item.done
    response.completed                        response.content_part.added
    response.incomplete                       response.content_part.done
    response.failed                           response.output_text.delta
    response.output_text.done                 response.output_text.annotation.added
    response.reasoning_summary_part.added     response.reasoning_summary_text.delta
    response.reasoning_summary_part.done      response.function_call_arguments.delta
    response.function_call_arguments.done     error

The framing rules, quoted:

- "Every event MUST carry `type` and `sequence_number`."
- `sequence_number` "MUST start at `0` and increase by exactly 1 per event within a stream", which
  lets clients "detect dropped messages rather than silently missing data".
- "`response.created` is the first event."
- "Exactly one terminal event is the last" — one of `response.completed`, `response.incomplete`,
  `response.failed`.
- "An `error` event MUST be followed by a terminal event. A stream that emits `error` and then stops
  without a terminal event is malformed."
- "A dropped connection MUST NOT abort the task. The work continues server-side."

Frame shape, quoted verbatim from §2:

    data: {"type":"response.output_text.delta","sequence_number":7,"item_id":"msg_1",
           "output_index":0,"content_index":0,"delta":"Sum"}

`response.output_item.added` "carries `output_index` and a shell `item`"; `response.output_item.done`
"carries the complete `item`".

### 1.2 Streaming §1 — two findings that correct S10, and one that shapes the design

**Finding 1. There is no `response.cancelled` event, and the status is authoritative.**

> "A cancelled task terminates with `response.failed` carrying `status: "cancelled"` in the response
> object."
> "The status field, not the event name, is authoritative."

S10's `decodeUhpStream` listed `response.cancelled` among its terminal event types. Harmless there —
it never fires — but the corollary is not harmless: an adapter that reads the **event name** to decide
what happened reports every cancelled task as `failed`. That is a false accusation against an operator
who pressed stop, and it hands a failure-keyed retry policy a reason to relaunch the work. This run
reads `response.status` and uses the event name only to recognise that a frame is terminal.
Recorded as `drift.md` D-2.

**Finding 2. No event carries a timestamp.** The chapter defines none, and the question was asked
explicitly on retrieval. Consequence for freshness: the only honest stamp available is the reading
clock at the moment a frame arrived. `Response.created_at` dates the *task*, not the growth, and using
it would report a nine-hour-old task as nine hours stale on the delta it emitted a second ago.
`uhp-stream.ts` stamps growth frames from an injected clock and says so in the field's own comment.

**Finding 3. The chapter is silent on unrecognised event types.** Asked directly; it does not say what
a client MUST do. This run accepts and counts them (`UhpStreamOpen.ignored`) rather than refusing the
stream, on the reading that an unknown frame cannot be growth and cannot be terminal — so ignoring it
can only under-report, never fabricate progress, and the terminal-event rule guarantees a run's end
always arrives on a known type. Marked as a reading, not as a rule, in the module.

### 1.3 Lifecycle §4 — the five statuses

Quoted:

| Status | Chapter's words | Terminal |
|---|---|---|
| `in_progress` | "Accepted and running" | no |
| `completed` | "The harness finished the work and produced a result" | yes |
| `failed` | "The task could not be completed; `error` explains why" | yes |
| `incomplete` | "The harness stopped at a budget — step limit or time limit — with partial output" | yes |
| `cancelled` | "The client cancelled it; partial output MAY be present" | yes |

Also: "A `cancelled` task MUST report `cancelled`, not `failed`", and "Terminal responses MUST retain
whatever output was produced before they became terminal."

`in_progress` merges accepted-and-queued with executing, so `RunLiveness`'s `queued` is unreachable
over UHP. Not a defect in either vocabulary: `provider.ts` keeps the split because divybot needs it,
and inventing it here would be a guess about a server that reported one word.

The chapter does **not** address how a cancellation reaches a streaming client, nor
`incomplete_details`. Streaming §1 answers the first (Finding 1). The second is unresolved and does not
block: #287 specifies the detail as `budget` regardless of which ceiling was hit, and the mock's
`incomplete_details: { reason: "max_step" }` is a plausible extra key, not a claim about the schema.

### 1.4 Sessions §1 — continuation

Quoted obligations on a server handed `previous_response_id`:

- "run the new task in the same session, with the same working directory and its files"
- give the harness "the conversational context of the earlier tasks"
- use the same configured harness
- **"report the same `metadata.session_id`"**

Errors: an unknown response id is `404` with `code: "response_not_found"`; an expired chain is `404`
with `code: "session_expired"`, "allowing clients to retry from scratch".

Design rationale, quoted: the protocol chains on response ids rather than session ids because "the
response id is what the client already has" and it "leaves room for a server to branch from an earlier
response later".

That last clause is the whole argument for keying the ledger on `runId`: if a server may branch, two
runs can share one `session_id`, and a ledger keyed on the session id has one silently overwrite the
other. It also matches `lease.ts`'s existing rule for a different vendor and a different reason,
which is the pattern being reused rather than invented.

The chapter does not discuss concurrent tasks in one session. Security §5 does, via S10's retrieval:
a server "MUST refuse a second concurrent task in the same session (`session_busy`) — two agents in
one working directory is not a defined state". That is why `nextUhpRequest` refuses locally instead of
sending a request the server will reject.

---

## 2. Document leg — what the board already decided

| Source | What it binds here |
|---|---|
| #289 (this issue) | The buildable half. SSE consumption, continuation, lifecycle mapping, three fail-closed requirements, mutation testing, no `provider-uhp`, no contract edit, no container, no live-router claim. |
| #287 | The lifecycle mapping table, verbatim, including `cancelled` → `finished` + `stopped` and `incomplete` → `failed` + `budget`. Also Decision 9: the stop verdict and budget detail ride on the versioned observation resource, **not** on `RunView` — which is why `packages/contracts` needed no change and this run proposes none. |
| #286 | `provider-uhp`, which depends on this and is out of scope. |
| #294 | The live clone/branch/commit/push/pull-request round-trip. Carries the owner-decision flag. Blocked on infrastructure. Nothing here may be read as satisfying it. |
| S10 / PR 292 | The mock, the codec, the fixture set, and the finding that `provider`, `effort` and `cwd` are unobservable over UHP — **an unevaluated generator verdict awaiting a non-Claude evaluator**, so no capability was deleted on its strength. |
| #206 | `RunLiveness` (what the executor says) and `LivenessVerdict` (what the evidence supports) are two questions with one former name. This run keeps them apart by construction. |
| #85 | Liveness is not progress. A node is green on a growing artifact, never on an open socket. |

---

## 3. Repo leg — what the code already does

| Path | Read for |
|---|---|
| `packages/subagents/src/route.ts` | `compareRouteIdentity`: `invalid.length > 0 ? "unknown" : mismatches.length > 0 ? "mismatch" : "known"`. The precedence that collapses a UHP substitution into `unknown`, and `mismatches` surviving it. |
| `packages/subagents/src/provider.ts` | `RunRef` (`runId`, `provider`, `external`), `RunLiveness`, `StopVerdict`, `Observation`, `DispatchVerdict`. The vocabulary this run maps into rather than beside. |
| `packages/provider-codex/src/protocol.ts` | The refusal ladder: `status === "unknown"` → `unknown`, then `status === "mismatch"` → `refused`. Correct in a dialect where all four fields are observable; the second branch is unreachable over UHP. **Not copied. Not edited.** |
| `packages/dsh-app/src/dry-run-internal.ts` | The shape that was copied: `if (!isRouteEvidenceVerified(route)) refuse({ kind: "route-unverified", status, fields: [...mismatches, ...invalid.map(i => i.field)] })` — decide on the strongest available negative, carry the status only to explain, and take the union of both negative kinds. |
| `packages/telemetry/src/liveness.ts` | `newest` + `classify`: freshness from timestamps, `claimsRunning` able only to make a node worse. `stalled` requires that claim, which is why this run cannot produce it and does not pretend to. |
| `packages/subagents/src/lease.ts` | Keyed on our run id, never the vendor's. The precedent `uhp-session.ts` follows. |
| `scripts/check-compiled-policy.mjs` | Literal `model`/`effort` assignments are refused outside an allowlist, and `uhp-mock.ts`'s entry is justified by "not imported by any production entry point". Load-bearing for the file layout this run chose. |

---

## 4. Synthesis — the three contradictions this run had to resolve

1. **A status is the most convenient freshness signal and the wrong one.** Resolved by removing the
   possibility rather than documenting the rule: no status parameter, a private brand on evidence, and
   a `kind` union that cannot spell a status.
2. **`unknown` is the honest verdict for an incomplete comparison, and it is the wrong verdict for a
   reported substitution.** Both are true. Resolved by separating the decision (from the negatives,
   contradiction outranking silence) from the explanation (the status, in the diagnostic).
3. **The event name is the obvious place to read an outcome, and the specification says it is not
   authoritative.** Resolved by reading `response.status`, and by shipping a fixture whose event name
   and status disagree so a regression is a red test rather than a code review.
