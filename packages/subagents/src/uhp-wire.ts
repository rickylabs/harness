/**
 * The Unified Harness Protocol wire contract, version `2026-08-11` — types and closed vocabularies
 * only, no behaviour.
 *
 * ## Why this file exists separately from the mock
 *
 * Spike S10 (#288) declared these shapes inside `uhp-mock.ts`, which was correct while the only
 * consumer was a test. Spike S11 (#289) adds a real stream adapter that the package exports, and a
 * production module must not import from a mock — `scripts/check-compiled-policy.mjs` allows literal
 * `model` and `effort` assignments in `uhp-mock.ts` on the stated grounds that nothing production
 * imports it, and that allowance has to stay true. So the declarations moved down here, where both
 * the adapter and the mock can depend on them, and `uhp-mock.ts` re-exports them unchanged for the
 * S10 tests that already import them from there.
 *
 * Nothing in this file executes. It is the protocol, transcribed, with the clause each shape comes
 * from named beside it.
 *
 * ## What a transcription proves
 *
 * That this repository's code agrees with a document. Not that any server does. Every claim below is
 * cited to the published specification, retrieved during the S10 and S11 runs; none of it is
 * evidence about a live HarnessRouter, which is issue #294 and is blocked on infrastructure.
 *
 * Retrieved 2026-09-12 against UHP `2026-08-11`:
 *
 *   https://unifiedharnessprotocol.org/spec/2026-08-11/tasks
 *   https://unifiedharnessprotocol.org/spec/2026-08-11/streaming
 *   https://unifiedharnessprotocol.org/spec/2026-08-11/lifecycle
 *   https://unifiedharnessprotocol.org/spec/2026-08-11/sessions
 *   https://unifiedharnessprotocol.org/schema/uhp-2026-08-11.openapi.yaml
 */

/* -------------------------------------------------------------------------------------------------
 * Response and request
 * ---------------------------------------------------------------------------------------------- */

/**
 * `Response.metadata`. `additionalProperties: true` in the schema, so a server MAY volunteer keys
 * this protocol never defined. That permission is exactly why `observeUhpRoute` must not read them.
 */
export interface UhpResponseMetadata {
  /**
   * The session this response ran in. Lifecycle §4: "A session is created by the server when the
   * first task of a chain runs. Its id MUST be reported in the response's `metadata.session_id`",
   * and conformance check T-04 fails a response without one because "the session cannot be continued
   * or inspected". Sessions §1 adds that a continued task MUST "report the same `metadata.session_id`",
   * which is what makes a *changed* id a server violation rather than a routine surprise.
   */
  readonly session_id?: string;
  /** Present when the server ran a different model than was requested (openapi.yaml:852-854). */
  readonly requested_model?: string;
  readonly model_fallback?: boolean;
  readonly model_fallback_reason?: string;
  /** Request fields the server did not act on, by name (Tasks 1.1). */
  readonly ignored_fields?: readonly string[];
  /** Undefined-by-UHP extension keys a non-conformant or vendor-extended server might add. */
  readonly [extension: string]: unknown;
}

/** `Response`. `required: [id, object, created_at, status, output, model]` (openapi.yaml:823). */
export interface UhpResponse {
  readonly id: string;
  readonly object: "response";
  readonly created_at: number;
  readonly status: "in_progress" | "completed" | "failed" | "incomplete" | "cancelled";
  readonly output: readonly unknown[];
  /** "The model that actually ran" (openapi.yaml:836). Required. */
  readonly model?: string;
  readonly metadata?: UhpResponseMetadata;
  readonly [extension: string]: unknown;
}

/** `CreateResponseRequest` (openapi.yaml:778-819), narrowed to what route identity cares about. */
export interface UhpCreateRequest {
  readonly input: string;
  readonly model?: string;
  readonly stream?: boolean;
  /**
   * The response this task continues. Sessions §1: a client continues a chain by sending
   * `previous_response_id`, and the server MUST then "run the new task in the same session, with the
   * same working directory and its files", give the harness the earlier conversational context, use
   * the same configured harness, and "report the same `metadata.session_id`".
   *
   * The chain is on response ids rather than session ids because "the response id is what the client
   * already has", and it "leaves room for a server to branch from an earlier response later" — which
   * is why `uhp-session.ts` keys runs on our `runId` and treats the session id as a correlator, not
   * as an identity.
   *
   * An unknown id is a `404` with `code: "response_not_found"`; an expired session is a `404` with
   * `code: "session_expired"`. Both are transport failures, and #287 maps a 404 to `unknown`.
   */
  readonly previous_response_id?: string;
  readonly metadata?: { readonly harness_id?: string; readonly [extension: string]: unknown };
  /** Undefined-by-UHP keys. `additionalProperties: true` permits sending them; nothing honours them. */
  readonly [extension: string]: unknown;
}

/* -------------------------------------------------------------------------------------------------
 * Lifecycle vocabulary — Lifecycle §4
 * ---------------------------------------------------------------------------------------------- */

/**
 * The five statuses a response can report, verbatim from Lifecycle §4:
 *
 *   in_progress  "Accepted and running"                                            non-terminal
 *   completed    "The harness finished the work and produced a result"              terminal
 *   failed       "The task could not be completed; `error` explains why"            terminal
 *   incomplete   "The harness stopped at a budget — step limit or time limit —
 *                 with partial output"                                             terminal
 *   cancelled    "The client cancelled it; partial output MAY be present"           terminal
 *
 * `cancelled` is kept apart from `failed` by the specification itself — "A `cancelled` task MUST
 * report `cancelled`, not `failed`" — because the client asked for the stop, so it is not an error.
 * #287 maps it to `finished` with a `stopped` stop verdict for the same reason.
 */
export const UHP_LIFECYCLE_STATUSES = [
  "in_progress",
  "completed",
  "failed",
  "incomplete",
  "cancelled",
] as const;

export type UhpLifecycleStatus = (typeof UHP_LIFECYCLE_STATUSES)[number];

/** The four statuses from which no further frame may arrive. `in_progress` is the only other one. */
export const UHP_TERMINAL_STATUSES = ["completed", "failed", "incomplete", "cancelled"] as const;

export type UhpTerminalStatus = (typeof UHP_TERMINAL_STATUSES)[number];

export function isUhpLifecycleStatus(value: unknown): value is UhpLifecycleStatus {
  return typeof value === "string" && (UHP_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

export function isUhpTerminalStatus(value: unknown): value is UhpTerminalStatus {
  return typeof value === "string" && (UHP_TERMINAL_STATUSES as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------------------------------
 * Stream vocabulary — Streaming §1 and §2
 * ---------------------------------------------------------------------------------------------- */

/**
 * The three terminal *event* types, and the reason the list is shorter than the status list.
 *
 * Streaming §1 enumerates the terminal events as `response.completed`, `response.incomplete` and
 * `response.failed`. **There is no `response.cancelled` event.** A cancellation arrives as
 * `response.failed` carrying `status: "cancelled"` in the response object, and the chapter states
 * the rule this whole module is arranged around:
 *
 *   > "The status field, not the event name, is authoritative."
 *
 * So an adapter that switches on the event name reports a cancelled task as failed — a false
 * accusation against an operator who pressed stop. `readUhpStream` therefore uses the event name
 * only to recognise *that* a frame is terminal, and `response.status` to decide *what happened*.
 */
export const UHP_TERMINAL_EVENTS = [
  "response.completed",
  "response.incomplete",
  "response.failed",
] as const;

export type UhpTerminalEvent = (typeof UHP_TERMINAL_EVENTS)[number];

export function isUhpTerminalEvent(value: unknown): value is UhpTerminalEvent {
  return typeof value === "string" && (UHP_TERMINAL_EVENTS as readonly string[]).includes(value);
}

/**
 * The non-terminal lifecycle events. `response.created` is the first event of every stream and
 * carries the initial response with `status: in_progress`.
 *
 * These carry a *claim about state*. They carry no evidence that anything grew, which is why
 * `uhp-stream.ts` mints no freshness evidence from them. See requirement A of #289.
 */
export const UHP_LIFECYCLE_EVENTS = ["response.created", "response.in_progress"] as const;

export type UhpLifecycleEvent = (typeof UHP_LIFECYCLE_EVENTS)[number];

/**
 * The delta events: output that was produced, in pieces, while the task ran.
 *
 * Streaming §2 shape, quoted verbatim from the chapter:
 *
 *   data: {"type":"response.output_text.delta","sequence_number":7,"item_id":"msg_1",
 *          "output_index":0,"content_index":0,"delta":"Sum"}
 *
 * A delta is the strongest freshness evidence a UHP stream carries: tokens exist that did not exist
 * before, and they exist because work happened.
 */
export const UHP_DELTA_EVENTS = [
  "response.output_text.delta",
  "response.reasoning_summary_text.delta",
  "response.function_call_arguments.delta",
] as const;

export type UhpDeltaEvent = (typeof UHP_DELTA_EVENTS)[number];

/**
 * The output-item events. `response.output_item.added` carries `output_index` and a shell `item`;
 * `response.output_item.done` carries the complete `item`.
 *
 * Freshness evidence, one step weaker than a delta and honestly so: an item boundary says a unit of
 * output opened or closed, which is a real event with a real time, without saying how much was in it.
 */
export const UHP_ITEM_EVENTS = ["response.output_item.added", "response.output_item.done"] as const;

export type UhpItemEvent = (typeof UHP_ITEM_EVENTS)[number];

/**
 * Structurally valid events that contribute no freshness evidence.
 *
 * They are real events and a conformant server emits them; they are simply not growth. A content
 * part opening, a text run closing, an annotation landing and a reasoning part boundary all describe
 * the *shape* of output that the deltas and items already accounted for. Counting them again would
 * make a stream look busier than the work it did, and "busier than the work it did" is the specific
 * false green `@rickylabs/telemetry` exists to refuse (#85).
 */
export const UHP_INERT_EVENTS = [
  "response.content_part.added",
  "response.content_part.done",
  "response.output_text.done",
  "response.output_text.annotation.added",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.function_call_arguments.done",
] as const;

/**
 * The error event. Streaming §1: "An `error` event MUST be followed by a terminal event. A stream
 * that emits `error` and then stops without a terminal event is malformed."
 *
 * It carries `code`, `message` and `param`. It does not end the stream, so an adapter that treats it
 * as terminal reports a recovered task as a dead one, and an adapter that ignores it accepts a
 * malformed stream as a complete one. `readUhpStream` does neither: it records the error and refuses
 * the stream if no terminal frame follows.
 */
export const UHP_ERROR_EVENT = "error" as const;

/** Every event type the specification defines, for membership tests and for exhaustiveness. */
export const UHP_EVENT_TYPES = [
  ...UHP_LIFECYCLE_EVENTS,
  ...UHP_TERMINAL_EVENTS,
  ...UHP_DELTA_EVENTS,
  ...UHP_ITEM_EVENTS,
  ...UHP_INERT_EVENTS,
  UHP_ERROR_EVENT,
] as const;

export type UhpEventType = (typeof UHP_EVENT_TYPES)[number];

/* -------------------------------------------------------------------------------------------------
 * Version negotiation — Lifecycle §1
 * ---------------------------------------------------------------------------------------------- */

/**
 * The protocol version this adapter was written against.
 *
 * Lifecycle §1: "UHP versions are dates […] A client MAY declare the version it was written against"
 * with the `UHP-Version` header, and a server that cannot serve the named version "MUST fail the
 * request with `400` and `code: "unsupported_protocol_version"` […] It MUST NOT silently serve a
 * different version". Declaring it is therefore strictly better than omitting it: omission asks for the
 * server's choice and gets it, which is a route decision taken by a deployment rather than by this
 * repository.
 */
export const UHP_VERSION = "2026-08-11" as const;

/** The request and response header carrying the version actually used (Lifecycle §1). */
export const UHP_VERSION_HEADER = "uhp-version" as const;

/* -------------------------------------------------------------------------------------------------
 * The harness object — Harnesses §1 and §2
 * ---------------------------------------------------------------------------------------------- */

/**
 * One configured harness, as `GET /v1/harnesses` returns it.
 *
 * `Harness.required` is `[id, name, base]` (`openapi.yaml`), `id` carries the pattern `^chrn_`, and the
 * chapter is explicit that `base` is opaque, Harnesses §2:
 *
 *   > `base` values are not enumerated by this specification. A server MAY support bases this document
 *   > has never heard of, and a client MUST treat `base` as an opaque string.
 *
 * Only the four fields the drift check compares are declared. The rest of the object — prompts, MCP
 * servers, skills, budgets — is real and is deliberately not transcribed: a field this repository does
 * not compare is a field it must not appear to depend on. `additionalProperties: true` is honoured by
 * the index signature.
 */
export interface UhpHarness {
  readonly id: string;
  readonly name: string;
  readonly base: string;
  readonly defaultModel?: string;
  readonly [extension: string]: unknown;
}

/* -------------------------------------------------------------------------------------------------
 * The error envelope — Errors §1 and §3
 * ---------------------------------------------------------------------------------------------- */

/**
 * `Error`. `required: [type, code, message]`.
 *
 * `code` is the machine-readable half and the only field this adapter branches on. `message` is
 * human-readable and, per Errors §1, "MUST be safe to show a user. It MUST NOT contain credentials,
 * internal hostnames, file paths, or stack traces" — which is a promise made by the server, not by us,
 * so nothing here forwards it into anything durable a consumer reads.
 */
export interface UhpError {
  readonly type?: string;
  readonly code?: string;
  readonly message?: string;
  readonly param?: string | null;
  readonly detail?: unknown;
  readonly [extension: string]: unknown;
}

/** `ErrorEnvelope`: `required: [error]`. Every non-2xx response carries one (Errors §1). */
export interface UhpErrorEnvelope {
  readonly error?: UhpError;
  readonly [extension: string]: unknown;
}

/**
 * The error codes this adapter distinguishes, verbatim from Errors §3.
 *
 * Not the whole set — a code nothing branches on is a code this list would only pretend to handle. Each
 * one below changes a verdict in `uhp-provider.ts`:
 *
 *   harness_not_found   404  the pinned console id resolves to nothing: drift, and the dispatch is refused
 *   response_not_found  404  an unknown continuation id: unknown, never a synthesized terminal state
 *   session_expired     404  the chain was forgotten: unknown, and the first turn may be retried
 *   session_busy        409  a task is already running in this session, so the message did not land
 *   harness_mismatch    409  the task named a different harness than the session it continues
 *   model_unavailable   422  the requested model cannot be served and the server chose to fail
 *   unsupported_base    422  the console's base is not one this server supports
 */
export const UHP_ERROR_CODES = [
  "harness_not_found",
  "response_not_found",
  "session_expired",
  "session_busy",
  "harness_mismatch",
  "model_unavailable",
  "unsupported_base",
] as const;

export type UhpErrorCode = (typeof UHP_ERROR_CODES)[number];

/** Read `error.code` from an envelope, or `null`. Only the code is machine-readable; the message is not. */
export function uhpErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const error = (body as UhpErrorEnvelope).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as UhpError).code;
  return typeof code === "string" && code.trim().length > 0 ? code : null;
}
