/**
 * Mock UHP loopback server and fixture set for route-identity testing.
 *
 * WHAT THIS FILE IS EVIDENCE OF, AND WHAT IT IS NOT
 *
 * This is a mock. It proves what *this repository* does when handed a given wire shape. It proves
 * nothing whatsoever about what a real HarnessRouter returns. Read that sentence before trusting any
 * test that imports this module: a fixture that echoes a value and a test that then reports the
 * value "observable" is a fabricated PASS, and it is the specific failure spike S10
 * (issue #288) exists to prevent.
 *
 * Whether a field is genuinely observable over UHP is settled by the published specification, not by
 * anything here. That reading is recorded in `.llm/runs/route-identity-uhp--s10/research.md`, and
 * its conclusion is:
 *
 *   model     requestable and echoed, echo REQUIRED       -> observable
 *   provider  no request field, no response field          -> unobservable
 *   effort    no request field, no response field          -> unobservable
 *   cwd       no request field, no response field          -> unobservable AND unrequestable
 *
 * Citations, all retrieved 2026-09-12 against UHP `2026-08-11`:
 *
 *   model      Tasks 1.1 request table and Tasks 1.3 substitution rule
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/tasks
 *              `Response.required` includes `model`; `model` is "The model that actually ran"
 *              https://unifiedharnessprotocol.org/schema/uhp-2026-08-11.openapi.yaml (lines 823, 836)
 *   provider   absent from `CreateResponseRequest` and `Response`; the only occurrence in the
 *              protocol is the failure code `provider_error`
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/errors
 *   effort     absent from the Tasks 1.1 request table, which is exhaustive. The protocol's only
 *              "reasoning" surface is the reasoning *summary* stream, which reports that the agent
 *              thought and not the effort it ran at
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/streaming (section 2.4)
 *   cwd        a first-class concept that is deliberately never named on the wire. A session shares
 *              "conversational context and a working directory", and the server owns it; the client
 *              receives only an opaque `metadata.session_id`
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/sessions (section 1)
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/lifecycle (section 4)
 *
 * There is no container runtime on this host and no reachable HarnessRouter instance. Per the owner
 * ruling of 2026-09-12, S10 develops against a local mock inside the test suite rather than blocking
 * on one. This module is that mock. It is intentionally the smallest thing that can carry a real
 * HTTP request and a real `text/event-stream`, because a fixture that never crosses a socket cannot
 * show that the stream decoder is also fail-closed.
 *
 * This module ships no behaviour the package exports. It is not re-exported from `index.ts` and it
 * is not part of the public surface of `@rickylabs/subagents`; it exists so that issue #286 can
 * build `provider-uhp` against a wire shape that was written from the specification rather than from
 * an implementation's memory of it.
 */

import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { RouteIdentityInput } from "./route.js";
import { consumeUhpStream } from "./uhp-stream.js";
import type {
  UhpCreateRequest,
  UhpResponse,
  UhpResponseMetadata,
  UhpTerminalEvent,
} from "./uhp-wire.js";

/* -------------------------------------------------------------------------------------------------
 * Wire types — moved, not deleted
 * ---------------------------------------------------------------------------------------------- */

/**
 * `UhpResponse`, `UhpCreateRequest` and `UhpResponseMetadata` were declared here by spike S10 and now
 * live in `./uhp-wire.ts`, with their clause citations intact and `previous_response_id` added for
 * the session continuation S11 (#289) builds.
 *
 * They moved because S11 exports a real stream adapter from `index.ts`, and a production module must
 * not import from a mock: `scripts/check-compiled-policy.mjs` permits the literal `model` and
 * `effort` assignments in the fixtures below on the recorded grounds that no production entry point
 * imports this file, and that sentence has to keep being true. The types are re-exported from here so
 * every S10 importer keeps working unchanged.
 */
export type { UhpCreateRequest, UhpResponse, UhpResponseMetadata } from "./uhp-wire.js";

/* -------------------------------------------------------------------------------------------------
 * The observation adapters
 * ---------------------------------------------------------------------------------------------- */

/**
 * The conformant adapter — MOVED, not deleted.
 *
 * `observeUhpRoute` and the four field readers it composes now live in `./uhp-gate.ts`, with their
 * clause citations intact, because #286's `uhp-provider.ts` needs them and a production module must not
 * import a mock. `scripts/check-compiled-policy.mjs` permits the literal `model` and `effort`
 * assignments in the fixtures below on the recorded grounds that no production entry point imports this
 * file, and that sentence has to keep being true. The re-export keeps every S10 and S11 importer working
 * unchanged.
 *
 * The behaviour is unchanged apart from the three unreportable fields being observed as `null` rather
 * than `undefined`; `compareRouteIdentity` renders both as `{ value: null }`, and
 * `uhp-gate.test.ts` pins that the two inputs produce identical evidence.
 */
export {
  observeUhpRoute,
  readUhpCwd,
  readUhpEffort,
  readUhpModel,
  readUhpProvider,
} from "./uhp-gate.js";

/**
 * The credulous adapter — DELIBERATELY WRONG. Do not use it outside its one regression test.
 *
 * This reads undefined-by-UHP extension keys out of `metadata` and reports them as observations. A
 * cooperative fixture that sets `metadata.effort` then makes this adapter produce a verified route,
 * and a test written against it would report "effort is observable over UHP" while having proved
 * only that the fixture's author typed the value twice.
 *
 * It is kept, named and tested so the failure mode is a documented artefact rather than a mistake
 * waiting to be made again. The test that uses it asserts that it manufactures a PASS, which is the
 * evidence that `observeUhpRoute` is right to refuse.
 */
export function observeUhpRouteCredulous(response: UhpResponse): RouteIdentityInput {
  const meta = response.metadata ?? {};
  return { provider: meta["provider"], model: response.model, effort: meta["effort"], cwd: meta["cwd"] };
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

/** The route this repository asks for. Mirrors a `formal_impl_evaluation` step shape. */
export const UHP_REQUESTED: RouteIdentityInput = {
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "xhigh",
  cwd: "/work/harness",
};

function response(over: Partial<UhpResponse> & { readonly metadata?: UhpResponseMetadata }): UhpResponse {
  return {
    id: "resp_s10",
    object: "response",
    created_at: 1_757_635_200,
    status: "completed",
    output: [],
    ...over,
  };
}

/**
 * The fixture set. Names are the shapes deliverable 3 requires, plus the two the specification
 * actually describes.
 *
 * Every fixture is written from the schema, not from an implementation. Where a fixture carries a
 * key UHP does not define, its name says so (`*Extended`) and the comment says which clause permits
 * it, so no reader can mistake it for protocol behaviour.
 */
export const UHP_FIXTURES = {
  /**
   * The conformant happy path. A completed task that reports the model that ran and the session it
   * ran in — which is everything UHP has to say about route identity.
   */
  conformant: response({
    model: "claude-opus-5",
    metadata: { session_id: "sess_s10" },
  }),

  /**
   * "All three fields present and agreeing" (deliverable 3, shape 1).
   *
   * READ THE NAME. This server volunteers `provider`, `effort` and `cwd` in `metadata`, which
   * `additionalProperties: true` permits and which no clause of UHP defines, requires or tests. The
   * values agree with `UHP_REQUESTED` on purpose. The correct behaviour of this repository when
   * handed this shape is to refuse it anyway: agreement on a field the protocol does not define is
   * not evidence, because any server can write anything there and a conformant server writes
   * nothing.
   */
  allThreeAgreeingExtended: response({
    model: "claude-opus-5",
    metadata: {
      session_id: "sess_s10",
      provider: "anthropic",
      effort: "xhigh",
      cwd: "/work/harness",
    },
  }),

  /**
   * "A field present and contradicting the request" (deliverable 3, shape 3) — the real one.
   *
   * Model substitution, exactly as Tasks 1.3 specifies it: the server could not serve
   * `claude-opus-5`, substituted the harness's authorized default, and reported the substitution
   * rather than pretending. This is the only contradiction UHP is capable of reporting, and it is
   * the model-substitution safety signal the `mismatch` status exists for.
   */
  modelSubstituted: response({
    model: "claude-sonnet-5",
    metadata: {
      session_id: "sess_s10",
      requested_model: "claude-opus-5",
      model_fallback: true,
      model_fallback_reason: "model 'claude-opus-5' is not available for this harness's backend",
    },
  }),

  /**
   * A contradiction on an undefined-by-UHP extension key. The server's `metadata.effort` disagrees
   * with the request. A credulous adapter would call this a `mismatch`; the conformant adapter never
   * sees it at all and calls the route `unknown`, because an undefined key cannot contradict any
   * more than it can agree.
   */
  effortContradictingExtended: response({
    model: "claude-opus-5",
    metadata: { session_id: "sess_s10", provider: "anthropic", effort: "low", cwd: "/work/harness" },
  }),

  /**
   * "Each field absent" (deliverable 3, shape 2) for the one field UHP defines. A response with no
   * `model` violates `Response.required` (openapi.yaml:823) and fails conformance check T-03, whose
   * message is "response has no `model`, so a client cannot tell what ran". A client must still
   * survive it, because a non-conformant server is a thing that exists.
   */
  modelAbsent: response({ metadata: { session_id: "sess_s10" } }),

  /** No `metadata` at all. The most degenerate shape a server can return and still be parseable. */
  bareMinimum: response({ model: "claude-opus-5" }),
} as const satisfies Readonly<Record<string, UhpResponse>>;

export type UhpFixtureName = keyof typeof UHP_FIXTURES;

/* -------------------------------------------------------------------------------------------------
 * SSE encoding — Streaming section 1
 * ---------------------------------------------------------------------------------------------- */

/**
 * Encode a response as the SSE frames a streaming UHP task produces.
 *
 * Rules honoured, from https://unifiedharnessprotocol.org/spec/2026-08-11/streaming section 1:
 * every event carries `type` and `sequence_number`; `sequence_number` starts at 0 and increases by
 * exactly 1; `response.created` is the first event and carries the initial response with
 * `status: in_progress`; the stream ends with exactly one terminal event.
 *
 * This is the three-frame minimum S10 needed. `uhpStreamBody` below writes the fuller streams S11
 * needs — deltas, output items, error events and the deliberately malformed shapes — and this
 * function is kept because the tests that pinned S10's findings are written against it.
 */
export function encodeUhpStream(final: UhpResponse): string {
  const created: UhpResponse = { ...final, status: "in_progress", output: [] };
  const frames = [
    { type: "response.created", sequence_number: 0, response: created },
    { type: "response.in_progress", sequence_number: 1, response: created },
    { type: "response.completed", sequence_number: 2, response: final },
  ];
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

/**
 * Which terminal *event* closes a stream for a given final status — and the reason this function is
 * not the identity.
 *
 * Streaming §1 defines three terminal events, `response.completed`, `response.incomplete` and
 * `response.failed`. **There is no `response.cancelled` event.** The chapter is explicit:
 *
 *   > "A cancelled task terminates with `response.failed` carrying `status: "cancelled"` in the
 *   > response object."
 *   > "The status field, not the event name, is authoritative."
 *
 * Retrieved 2026-09-12 against UHP `2026-08-11`. That is why the mock can produce a stream whose
 * event name and status disagree without being malformed, and why `uhp-stream.ts` reads the status.
 * An adapter that switched on the event name would report every cancelled task as failed.
 *
 * `in_progress` is not terminal, so it maps to `none`: the stream simply has not ended.
 */
export function terminalEventFor(status: UhpResponse["status"]): UhpTerminalEvent | "none" {
  switch (status) {
    case "completed":
      return "response.completed";
    case "incomplete":
      return "response.incomplete";
    case "failed":
    case "cancelled":
      return "response.failed";
    case "in_progress":
      return "none";
  }
}

/** What a scripted stream should contain beyond its lifecycle frames. */
export interface UhpStreamScript {
  /** Each string becomes one `response.output_text.delta`. */
  readonly deltas?: readonly string[];
  /** Wrap the deltas in `response.output_item.added` / `.done` and a content part. */
  readonly item?: boolean;
  /** Each string becomes one `response.reasoning_summary_text.delta`. */
  readonly reasoning?: readonly string[];
  /** Emit an `error` event before the terminal event. Streaming §1 requires a terminal one after it. */
  readonly error?: { readonly code: string; readonly message: string; readonly param?: string };
  /** Override the terminal event. `none` writes a stream that stops without one. */
  readonly terminal?: UhpTerminalEvent | "none";
}

/**
 * Build the frames of a streaming task, in order, without sequence numbers.
 *
 * Numbering is applied by `encodeUhpFrames` so that a test can reorder, drop or duplicate frames and
 * get the numbering a *server* would have produced — which is the only way to write an out-of-order
 * stream that is wrong in the way a real dropped frame is wrong.
 */
export function uhpStreamFrames(
  final: UhpResponse,
  script: UhpStreamScript = {},
): readonly Record<string, unknown>[] {
  const created: UhpResponse = { ...final, status: "in_progress", output: [] };
  const itemId = `${final.id}_msg`;
  const frames: Record<string, unknown>[] = [
    { type: "response.created", response: created },
    { type: "response.in_progress", response: created },
  ];
  if (script.item === true) {
    frames.push({
      type: "response.output_item.added",
      output_index: 0,
      item: { id: itemId, type: "message", status: "in_progress", content: [] },
    });
    frames.push({ type: "response.content_part.added", item_id: itemId, output_index: 0, content_index: 0 });
  }
  for (const text of script.reasoning ?? []) {
    frames.push({ type: "response.reasoning_summary_text.delta", item_id: itemId, output_index: 0, delta: text });
  }
  for (const text of script.deltas ?? []) {
    frames.push({
      type: "response.output_text.delta",
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: text,
    });
  }
  if (script.item === true) {
    frames.push({ type: "response.output_text.done", item_id: itemId, output_index: 0, content_index: 0 });
    frames.push({ type: "response.content_part.done", item_id: itemId, output_index: 0, content_index: 0 });
    frames.push({
      type: "response.output_item.done",
      output_index: 0,
      item: { id: itemId, type: "message", status: "completed", content: [] },
    });
  }
  if (script.error !== undefined) frames.push({ type: "error", ...script.error });
  const terminal = script.terminal ?? terminalEventFor(final.status);
  if (terminal !== "none") frames.push({ type: terminal, response: final });
  return frames;
}

/** Number a frame list and render it as an SSE body. The numbering a conformant server would write. */
export function encodeUhpFrames(frames: readonly Record<string, unknown>[]): string {
  return frames
    .map((frame, index) => `data: ${JSON.stringify({ ...frame, sequence_number: index })}\n\n`)
    .join("");
}

/** Script and encode in one step: the streaming body a conformant server would send. */
export function uhpStreamBody(final: UhpResponse, script: UhpStreamScript = {}): string {
  return encodeUhpFrames(uhpStreamFrames(final, script));
}

/** Number frames the way a server would, then hand the list back for a fixture to damage. */
function numbered(frames: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return frames.map((frame, index) => ({ ...frame, sequence_number: index }));
}

/** Render already-numbered frames verbatim, preserving whatever damage a fixture did to them. */
function render(frames: readonly Record<string, unknown>[]): string {
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

/**
 * Decode a UHP SSE body and return the response carried by the terminal event.
 *
 * Fail-closed by construction: a body with no terminal event yields `undefined` rather than the
 * last-seen response, because "the stream stopped early" and "the task finished" are different
 * facts and a decoder that conflates them reports a truncated run as a completed one.
 *
 * S11 made this a delegate to `readUhpStream` in `uhp-stream.ts` rather than a second decoder. Two
 * decoders drift, and the one that drifts is always the one no test is looking at. Everything S10's
 * tests pin is unchanged; the delegate is stricter, because it also enforces that `response.created`
 * comes first, that a terminal frame carries a terminal status, and that an `error` event is followed
 * by a terminal event.
 */
export function decodeUhpStream(body: string): UhpResponse | undefined {
  const state = consumeUhpStream(body);
  return state.ok && state.done ? state.response : undefined;
}

/* -------------------------------------------------------------------------------------------------
 * S11 fixtures — the five lifecycle statuses, and the streams that are wrong on purpose
 * ---------------------------------------------------------------------------------------------- */

/**
 * One response per lifecycle status, so the #287 mapping table can be exercised end to end.
 *
 * Separate from `UHP_FIXTURES` because that set is S10's evidence about route identity and is under
 * independent evaluation. These are S11's, they are about lifecycle rather than route, and keeping
 * them apart keeps each spike's fixtures legible as that spike's.
 */
export const UHP_LIFECYCLE_FIXTURES = {
  /** Accepted and running: the only non-terminal status, and the one a stream opens with. */
  running: response({
    id: "resp_s11_running",
    status: "in_progress",
    model: "claude-opus-5",
    metadata: { session_id: "sess_s11" },
  }),

  /** Finished the work and produced a result. */
  completed: response({
    id: "resp_s11_completed",
    status: "completed",
    model: "claude-opus-5",
    metadata: { session_id: "sess_s11" },
  }),

  /** Could not be completed. `error` explains why; the liveness word is `failed`. */
  failed: response({
    id: "resp_s11_failed",
    status: "failed",
    model: "claude-opus-5",
    metadata: { session_id: "sess_s11" },
    error: { code: "harness_error", message: "the harness exited before producing a result" },
  }),

  /**
   * The client cancelled it. Note the status on a stream closed by `response.failed`: that pairing is
   * what the specification prescribes, not a fixture quirk.
   */
  cancelled: response({
    id: "resp_s11_cancelled",
    status: "cancelled",
    model: "claude-opus-5",
    metadata: { session_id: "sess_s11" },
  }),

  /** Stopped at a step or time limit with partial output. #287 maps this to failed with `budget`. */
  incomplete: response({
    id: "resp_s11_incomplete",
    status: "incomplete",
    model: "claude-opus-5",
    metadata: { session_id: "sess_s11" },
    incomplete_details: { reason: "max_step" },
  }),
} as const satisfies Readonly<Record<string, UhpResponse>>;

export type UhpLifecycleFixtureName = keyof typeof UHP_LIFECYCLE_FIXTURES;

/**
 * A three-turn session, in order.
 *
 * Each response reports the same `metadata.session_id`, which Sessions §1 requires of a continued
 * chain — "report the same `metadata.session_id`" — and each is continued by sending its `id` as the
 * next request's `previous_response_id`.
 */
export const UHP_TURNS = [
  response({ id: "resp_turn_1", model: "claude-opus-5", metadata: { session_id: "sess_chain" } }),
  response({ id: "resp_turn_2", model: "claude-opus-5", metadata: { session_id: "sess_chain" } }),
  response({ id: "resp_turn_3", model: "claude-opus-5", metadata: { session_id: "sess_chain" } }),
] as const satisfies readonly UhpResponse[];

/** The session id every turn of `UHP_TURNS` reports. */
export const UHP_CHAIN_SESSION = "sess_chain" as const;

/**
 * Streams that are malformed, truncated or out of order — each one wrong in a specific way a lenient
 * decoder would accept as "mostly fine".
 *
 * The numbering is applied *before* the damage wherever the damage is a reordering or a loss, because
 * that is how a real stream arrives: the server numbered the frames it sent, and the network is what
 * dropped, duplicated or reordered them. A fixture that renumbered after the damage would describe a
 * server that cannot count, which is a different bug from the one being tested.
 */
export const UHP_BROKEN_STREAMS = {
  /** The connection died between frames: no terminal event, but every frame it sent was valid. */
  truncatedBetweenFrames: uhpStreamBody(UHP_LIFECYCLE_FIXTURES.completed, {
    deltas: ["Sum", "mary"],
    item: true,
    terminal: "none",
  }),

  /** The connection died mid-frame. The last bytes never became an event at all. */
  truncatedMidFrame: uhpStreamBody(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["Sum"], item: true })
    .slice(0, -40),

  /** Two frames delivered in the wrong order, with the numbering a server would have written. */
  outOfOrder: (() => {
    const frames = [
      ...numbered(uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["a", "b"], item: true })),
    ];
    const third = frames[3];
    const fourth = frames[4];
    if (third !== undefined && fourth !== undefined) {
      frames[3] = fourth;
      frames[4] = third;
    }
    return render(frames);
  })(),

  /** A frame lost in transit: the numbering skips, which is what the counter exists to reveal. */
  droppedFrame: (() => {
    const frames = numbered(uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["a", "b"] }));
    return render([...frames.slice(0, 2), ...frames.slice(3)]);
  })(),

  /** One frame delivered twice. The same sequence number arrives where the next one was due. */
  duplicatedFrame: (() => {
    const frames = numbered(uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["a"] }));
    const second = frames[1];
    return render(second === undefined ? frames : [...frames.slice(0, 2), second, ...frames.slice(2)]);
  })(),

  /** A `data:` payload that is not JSON. A parser that throws here takes the whole process with it. */
  malformedJson: 'data: {"type":"response.created","sequence_number":0,"response":{\n\n',

  /** A `data:` payload that is JSON but not an object. */
  jsonNotObject: 'data: ["response.created",0]\n\n',

  /** A frame with no `type`, which Streaming §1 makes mandatory on every event. */
  untypedFrame: 'data: {"sequence_number":0,"response":{"id":"resp_x"}}\n\n',

  /** A stream that does not begin with `response.created`. */
  createdNotFirst: render(numbered(uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, {}).slice(1))),

  /** A frame after the terminal event, which must be last. */
  frameAfterTerminal: encodeUhpFrames([
    ...uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["a"] }),
    { type: "response.output_text.delta", item_id: "late", output_index: 0, content_index: 0, delta: "late" },
  ]),

  /**
   * A terminal event whose response still reports `in_progress`. The status is authoritative, so this
   * is a server contradicting itself rather than a finished run.
   */
  terminalStillRunning: encodeUhpFrames(
    uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, { terminal: "response.completed" }).map((frame) =>
      frame["type"] === "response.completed"
        ? { ...frame, response: UHP_LIFECYCLE_FIXTURES.running }
        : frame
    ),
  ),

  /** An `error` event with no terminal event after it, which Streaming §1 calls malformed. */
  errorWithoutTerminal: uhpStreamBody(UHP_LIFECYCLE_FIXTURES.failed, {
    deltas: ["par", "tial"],
    error: { code: "provider_error", message: "upstream refused the request" },
    terminal: "none",
  }),

  /** A delta frame carrying no string `delta`. */
  deltaWithoutText: encodeUhpFrames([
    ...uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, {}).slice(0, 2),
    { type: "response.output_text.delta", item_id: "m", output_index: 0, content_index: 0 },
    { type: "response.completed", response: UHP_LIFECYCLE_FIXTURES.completed },
  ]),
} as const satisfies Readonly<Record<string, string>>;

export type UhpBrokenStreamName = keyof typeof UHP_BROKEN_STREAMS;

/* -------------------------------------------------------------------------------------------------
 * The loopback server
 * ---------------------------------------------------------------------------------------------- */

/** One HTTP exchange, with the status code intact — which a decoded response cannot carry. */
export interface UhpExchange {
  readonly httpStatus: number;
  readonly contentType: string;
  readonly body: string;
}

export interface UhpMock {
  readonly origin: string;
  /** POST /v1/responses, returning the decoded terminal response, over JSON or SSE. */
  post(body: UhpCreateRequest): Promise<UhpResponse | undefined>;
  /**
   * The same call, undecoded. `post` cannot express a 404 — it returns `undefined` for an unreadable
   * stream and for a missing response alike — and #287 maps a 404 to `unknown` rather than to
   * `failed`, so a test for that row needs the status code.
   */
  send(body: UhpCreateRequest): Promise<UhpExchange>;
  close(): Promise<void>;
}

/**
 * One JSON answer: a status code and a body, serialised verbatim.
 *
 * Deliberately `unknown` rather than a protocol type. The endpoints below are the ones #286's provider
 * calls, and half of what it must survive is a body that is *not* the shape the specification promises —
 * a harness listing that is an object, a cancel that returns an error envelope. A typed body would make
 * those fixtures unwritable.
 */
export interface UhpJsonReply {
  readonly httpStatus: number;
  readonly body: unknown;
}

/**
 * The endpoints beyond `POST /v1/responses`, added for #286.
 *
 * Each one is a real path this repository calls, with the chapter that defines it:
 *
 *   harnesses  `GET /v1/harnesses`                     Harnesses §1 — the console drift check reads it
 *   cancel     `POST /v1/responses/{id}/cancel`        Sessions §4 — the stop verb
 *   read       `GET /v1/responses/{id}`                Tasks §4 — the observe verb
 *
 * All three are optional, and an absent one is served as `404` by the fall-through, which is how a test
 * writes "this deployment does not answer that call" without a second server. This is the same mock S10
 * and S11 used, extended: a second one would drift, and the one that drifts is always the one no test is
 * looking at.
 */
export interface UhpEndpoints {
  readonly harnesses?: () => UhpJsonReply;
  readonly cancel?: (responseId: string) => UhpJsonReply;
  readonly read?: (responseId: string) => UhpJsonReply;
}

/** What the mock server should answer for one request. */
export interface UhpReply {
  readonly httpStatus: number;
  /** The response to serve. Omitted for an error reply, which carries `error` instead. */
  readonly response?: UhpResponse;
  /** An error body, e.g. `{ code: "response_not_found" }`. */
  readonly error?: { readonly code: string; readonly message?: string };
  /** The script used when the request asked for a stream. */
  readonly script?: UhpStreamScript;
}

function read(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => { text += chunk; });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
  });
}

/**
 * Start a UHP loopback server on an ephemeral port whose answers a handler decides.
 *
 * It binds `127.0.0.1` and port `0`, so tests never collide with each other or with anything on the
 * host, and it requires no container runtime — there is none on this host to require.
 *
 * A real deployment sends `Authorization: Bearer <token>`. The mock never reads one, and this
 * repository is public, so no credential appears here or in any fixture.
 */
export async function startUhpServer(
  handler: (request: UhpCreateRequest) => UhpReply,
  endpoints: UhpEndpoints = {},
): Promise<UhpMock> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw: unknown = JSON.parse((await read(req)) || "{}");
      const body = (typeof raw === "object" && raw !== null ? raw : {}) as UhpCreateRequest;
      const json = (reply: UhpJsonReply): void => {
        res.writeHead(reply.httpStatus, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      };
      const url = req.url ?? "";
      if (req.method === "GET" && url === "/v1/harnesses" && endpoints.harnesses !== undefined) {
        json(endpoints.harnesses());
        return;
      }
      const cancelling = /^\/v1\/responses\/([^/]+)\/cancel$/.exec(url);
      if (req.method === "POST" && cancelling !== null && endpoints.cancel !== undefined) {
        json(endpoints.cancel(decodeURIComponent(cancelling[1] ?? "")));
        return;
      }
      const reading = /^\/v1\/responses\/([^/]+)$/.exec(url);
      if (req.method === "GET" && reading !== null && endpoints.read !== undefined) {
        json(endpoints.read(decodeURIComponent(reading[1] ?? "")));
        return;
      }
      if (req.method !== "POST" || url !== "/v1/responses") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "not_found" } }));
        return;
      }
      const reply = handler(body);
      if (reply.response === undefined) {
        res.writeHead(reply.httpStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: reply.error ?? { code: "unknown" } }));
        return;
      }
      if (body.stream === true) {
        res.writeHead(reply.httpStatus, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.end(
          reply.script === undefined
            ? encodeUhpStream(reply.response)
            : uhpStreamBody(reply.response, reply.script),
        );
        return;
      }
      res.writeHead(reply.httpStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.response));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  async function send(payload: UhpCreateRequest): Promise<UhpExchange> {
    const encoded = JSON.stringify(payload);
    return await new Promise<UhpExchange>((resolve, reject) => {
      const outbound = httpRequest(
        `${origin}/v1/responses`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(encoded),
          },
        },
        (res) => {
          void read(res).then((text) =>
            resolve({
              httpStatus: res.statusCode ?? 0,
              contentType: String(res.headers["content-type"] ?? ""),
              body: text,
            })
          ).catch(reject);
        },
      );
      outbound.on("error", reject);
      outbound.end(encoded);
    });
  }

  return {
    origin,
    send,
    async post(payload) {
      const exchange = await send(payload);
      if (exchange.httpStatus !== 200) return undefined;
      if (exchange.contentType.startsWith("text/event-stream")) return decodeUhpStream(exchange.body);
      return JSON.parse(exchange.body) as UhpResponse;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

/**
 * Start a loopback server that answers every request with one fixture. S10's entry point, unchanged
 * in behaviour and now one line over `startUhpServer`.
 */
export function startUhpMock(
  fixture: UhpResponse,
  script?: UhpStreamScript,
  endpoints: UhpEndpoints = {},
): Promise<UhpMock> {
  return startUhpServer(
    () =>
      script === undefined
        ? { httpStatus: 200, response: fixture }
        : { httpStatus: 200, response: fixture, script },
    endpoints,
  );
}

/**
 * Start a loopback server that serves a scripted chain of turns, continuing on `previous_response_id`.
 *
 * The rules it enforces are the server's, from Sessions §1:
 *
 * - A request with no `previous_response_id` starts the chain and gets the first turn.
 * - A request continuing turn *n* gets turn *n + 1*.
 * - A request naming an id that is not in the chain gets `404 response_not_found`, the code the
 *   chapter specifies for an unknown response id, which #287 maps to `unknown`.
 * - A request continuing the last scripted turn also gets `404 response_not_found`: the script knows
 *   no successor. Documented rather than smoothed over, because a mock that invented one would be
 *   answering a question the fixture never asked.
 *
 * Every served turn reports the same `metadata.session_id`, because the specification requires it of a
 * continued chain. The fixture that violates that rule on purpose lives in the test that needs it, not
 * here: a mock whose default behaviour is non-conformant teaches the wrong lesson.
 */
export function startUhpTurnMock(
  turns: readonly UhpResponse[] = UHP_TURNS,
  script?: UhpStreamScript,
  endpoints: UhpEndpoints = {},
): Promise<UhpMock> {
  const serve = (served: UhpResponse): UhpReply =>
    script === undefined
      ? { httpStatus: 200, response: served }
      : { httpStatus: 200, response: served, script };
  const missing: UhpReply = {
    httpStatus: 404,
    error: { code: "response_not_found", message: "no such response id in this chain" },
  };
  return startUhpServer((request) => {
    const previous = request.previous_response_id;
    if (previous === undefined) {
      const first = turns[0];
      return first === undefined ? missing : serve(first);
    }
    const index = turns.findIndex((turn) => turn.id === previous);
    if (index < 0) return missing;
    const next = turns[index + 1];
    return next === undefined ? missing : serve(next);
  }, endpoints);
}
