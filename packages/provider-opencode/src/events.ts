/**
 * The event stream: framing, reading, and what an event means for a run.
 *
 * `GET /event` is one endless `text/event-stream` for the whole server, not one per session. That is
 * why this provider holds a single connection and routes by session id, and it is why `observe` on a
 * run is a read of memory rather than a request — the same property `provider-claude` gets from
 * holding a generator, obtained here from holding a socket.
 *
 * ## Framing is a pure fold, deliberately
 *
 * A chunk off a socket is not a frame. One frame can arrive in three chunks, three frames can arrive
 * in one, and a multi-byte character can be split down the middle (which `http.ts`'s decoder handles
 * before text reaches here). Every one of those is a real thing a real server does under load, and
 * none of them happen to a fake that yields one tidy frame per chunk. So framing is `feed`: a
 * function from a buffer and a chunk to a new buffer and whatever frames completed, testable against
 * exactly the split points that break naive implementations.
 *
 * ## What is deliberately not read
 *
 * `message.part.updated` carries the agent's own output — the text it is writing, tool calls, file
 * contents. None of it enters a `RunRecord`, a detail string, or telemetry. The event is a heartbeat
 * and its *type* is all that is kept. A coordinator needs to know a run is working; it does not need
 * a copy of the work, and a copy is a copy of whatever the agent happened to be reading.
 */

/** Where framing has got to. A value, so the fold has no hidden state. */
export interface FrameState {
  readonly buffer: string;
}

export const NO_FRAMES: FrameState = { buffer: "" };

export interface FrameStep {
  readonly state: FrameState;
  /** The `data:` payloads of every frame that completed in this chunk, in order. */
  readonly frames: readonly string[];
}

/**
 * How much unframed text may accumulate before the buffer is dropped.
 *
 * A server that stops sending blank lines — or a proxy that turns the stream into one long line —
 * would otherwise grow this buffer without bound for the life of the process. Dropping loses events,
 * which is visible as a run that stops updating; growing without bound is not visible until the
 * process dies holding every live run's state.
 */
export const BUFFER_LIMIT = 1_000_000;

/** Newlines as the SSE grammar defines them: CRLF, LF or a bare CR all end a line. */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * The `data:` payload of one frame, or `null` for a frame that carries none.
 *
 * Comment lines (`:` first) are the heartbeat a server sends to keep an idle connection open, and
 * carry no data by definition. Other fields — `event:`, `id:`, `retry:` — are read past rather than
 * rejected: this stream puts its type inside the JSON, and a frame that also names it in a field is
 * not a frame we should refuse.
 */
function payloadOf(frame: string): string | null {
  const lines = frame.split("\n");
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":") || line === "") continue;
    if (!line.startsWith("data:")) continue;
    const value = line.slice("data:".length);
    data.push(value.startsWith(" ") ? value.slice(1) : value);
  }
  return data.length === 0 ? null : data.join("\n");
}

/** Fold one chunk of stream text into the buffer, emitting whatever frames it completed. */
export function feed(state: FrameState, chunk: string): FrameStep {
  const text = state.buffer + normalize(chunk);
  const blocks = text.split("\n\n");
  // The last block is whatever has not been terminated yet, and stays in the buffer. A chunk that
  // ends exactly on a boundary leaves an empty string there, which is correct and not a frame.
  const tail = blocks.pop() ?? "";
  const frames: string[] = [];
  for (const block of blocks) {
    const payload = payloadOf(block);
    if (payload !== null) frames.push(payload);
  }
  const buffer = tail.length > BUFFER_LIMIT ? "" : tail;
  return { state: { buffer }, frames };
}

/** One event off the bus. `properties` is `unknown` because every reader below checks it. */
export interface OpencodeEvent {
  readonly type: string;
  readonly properties: unknown;
}

function bagOf(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringAt(bag: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = bag[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** Parse a frame payload, or `null` if it is not an event. Never throws. */
export function readEvent(payload: string): OpencodeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const bag = bagOf(parsed);
  if (bag === null) return null;
  const type = stringAt(bag, "type");
  if (type === null) return null;
  return { type, properties: bag["properties"] ?? null };
}

/**
 * Which session an event is about, or `null`.
 *
 * Several spellings are probed because the bus carries several shapes: a session event whose
 * `properties` *is* the session (`info.id`), a session event that names it (`sessionID`), and a
 * message event that nests it under the part or the message. Guessing wrong here does not corrupt
 * anything — an event attributed to no session is ignored — but it does cost liveness, so the
 * cheapest correct answer is to look in every place it is known to live. Order matters: an explicit
 * session key beats an `id` that might be the message's.
 */
export function sessionOf(event: OpencodeEvent): string | null {
  const properties = bagOf(event.properties);
  if (properties === null) return null;
  const direct = stringAt(properties, "sessionID") ?? stringAt(properties, "sessionId");
  if (direct !== null) return direct;
  for (const key of ["part", "info", "message", "session"]) {
    const nested = bagOf(properties[key]);
    if (nested === null) continue;
    const id = stringAt(nested, "sessionID") ?? stringAt(nested, "sessionId");
    if (id !== null) return id;
  }
  // A session event whose payload is the session itself. Checked last, because on a message event
  // `info.id` is the message's id and would attribute the event to a session that does not exist.
  if (event.type.startsWith("session.")) {
    const info = bagOf(properties["info"]);
    const id = info === null ? null : stringAt(info, "id");
    if (id !== null) return id;
    return stringAt(properties, "id");
  }
  return null;
}

/**
 * What an event means for a run.
 *
 * Deliberately coarse. The bus has more event types than this and will grow more; a classifier that
 * enumerated them would turn every vendor release into a run that reports nothing. `ignored` is the
 * default and is not a failure.
 */
export type Signal =
  | { readonly kind: "connected" }
  | { readonly kind: "activity"; readonly detail: string }
  | { readonly kind: "idle" }
  | { readonly kind: "gone" }
  | { readonly kind: "error"; readonly detail: string }
  | { readonly kind: "ignored" };

/**
 * The error an event reports, in one line.
 *
 * Read from `error.name` and `error.data.message` if they are there, and otherwise described by its
 * absence. Never the whole object: a server error can carry a config dump, and this string ends up
 * in a detail that ends up in telemetry.
 */
function errorLine(properties: unknown): string {
  const bag = bagOf(properties);
  if (bag === null) return "the session reported an error with no detail";
  const error = bagOf(bag["error"]);
  if (error === null) return stringAt(bag, "error") ?? "the session reported an error with no detail";
  const name = stringAt(error, "name");
  const data = bagOf(error["data"]);
  const message = data === null ? null : stringAt(data, "message");
  if (name !== null && message !== null) return `${name}: ${message}`;
  return name ?? message ?? "the session reported an error with no detail";
}

export function classify(event: OpencodeEvent): Signal {
  switch (event.type) {
    case "server.connected":
      return { kind: "connected" };
    case "session.idle":
      return { kind: "idle" };
    case "session.error":
      return { kind: "error", detail: errorLine(event.properties) };
    case "session.deleted":
      return { kind: "gone" };
    default:
      // The heartbeat. Only the type is kept — see the module comment on what is not read.
      return event.type.startsWith("message.") || event.type === "session.updated"
        ? { kind: "activity", detail: event.type }
        : { kind: "ignored" };
  }
}
