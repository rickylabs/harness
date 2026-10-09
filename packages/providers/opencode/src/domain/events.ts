/**
 * The event stream: reading an item, and what an event means for a run.
 *
 * `GET /event` — `event.subscribe()` in `@opencode-ai/sdk` — is one endless stream for the whole
 * server, not one per session. That is why this provider holds a single connection and routes by
 * session id, and it is why `observe` on a run is a read of memory rather than a request — the same
 * property `provider-claude` gets from holding a generator, obtained here from holding a stream.
 *
 * Framing, decoding and JSON parsing are the SDK's. What is left here is what is not the SDK's job:
 * deciding whether an item is an event at all, which session it is about, and what it means.
 *
 * ## What is deliberately not read
 *
 * `message.part.updated` carries the agent's own output — the text it is writing, tool calls, file
 * contents. None of it enters a `RunRecord`, a detail string, or telemetry. The event is a heartbeat
 * and its *type* is all that is kept. A coordinator needs to know a run is working; it does not need
 * a copy of the work, and a copy is a copy of whatever the agent happened to be reading.
 */

import { bagOf, stringAt } from "./api.js";

/** One event off the bus. `properties` is `unknown` because every reader below checks it. */
export interface OpencodeEvent {
  readonly type: string;
  readonly properties: unknown;
}

/**
 * Read one item off the stream, or `null` if it is not an event. Never throws.
 *
 * The SDK has already reassembled the frame and parsed its JSON; a `data:` payload that was not JSON
 * arrives as a string, which is not an event.
 */
export function readEvent(value: unknown): OpencodeEvent | null {
  const bag = bagOf(value);
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
