/**
 * The Claude Agent SDK's messages, read through checked readers and never by property access.
 *
 * The stream `query()` yields is typed `unknown` (see `src/ports/sdk.ts` for why the SDK is a port
 * rather than a dependency), so every field the provider needs comes out of a reader here that
 * checks the shape at runtime and returns `null` when a message is not what it was assumed to be. A
 * renamed field becomes a run that reports `unknown` rather than a `TypeError` in a background loop.
 * `SdkUserMessage` is the one shape this file constructs rather than reads.
 */

/**
 * A user message pushed into a streaming-input run.
 *
 * The one shape in this file we construct rather than read, and therefore the one a wrong guess
 * breaks silently: a message the CLI cannot parse is dropped, the steer reports `delivered`, and
 * nobody learns otherwise until a run ignores an instruction. `userMessage` is its only constructor
 * and `tests/domain/sdk-messages.test.ts` pins the result field by field, so the correction #49 may
 * bring back is small.
 */
export interface SdkUserMessage {
  readonly type: "user";
  readonly message: { readonly role: "user"; readonly content: string };
  /** `null` at the top level; a tool-use id only for messages nested inside one. */
  readonly parent_tool_use_id: string | null;
  /** Ignored by the SDK in streaming-input mode, which assigns the real one. */
  readonly session_id: string;
}

/** Build the message a prompt or a steer travels as. */
export function userMessage(content: string, sessionId = ""): SdkUserMessage {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

/** A record with unknown values — the widest thing a reader can safely index. */
type Bag = Readonly<Record<string, unknown>>;

function bagOf(value: unknown): Bag | null {
  return typeof value === "object" && value !== null ? (value as Bag) : null;
}

function stringAt(bag: Bag, key: string): string | null {
  const value = bag[key];
  return typeof value === "string" ? value : null;
}

function numberAt(bag: Bag, key: string): number | null {
  const value = bag[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The `system`/`init` message: the first thing a healthy run emits, and the run's identity. */
export interface InitLine {
  /** The vendor's session id. Becomes `RunRef.external`. */
  readonly sessionId: string;
  /** The model the CLI resolved, which is not necessarily the one we asked for. */
  readonly model: string | null;
  /** The directory the run actually started in. */
  readonly cwd: string | null;
}

/**
 * Read an init message, or `null` if this is not one.
 *
 * A message with `type: "system"` and `subtype: "init"` but no `session_id` is *not* an init line:
 * the session id is the only reason the provider waits for this message, so a message that lacks it
 * has told us nothing and must not resolve the wait.
 */
export function readInit(message: unknown): InitLine | null {
  const bag = bagOf(message);
  if (bag === null) return null;
  if (stringAt(bag, "type") !== "system" || stringAt(bag, "subtype") !== "init") return null;
  const sessionId = stringAt(bag, "session_id");
  if (sessionId === null || sessionId === "") return null;
  return { sessionId, model: stringAt(bag, "model"), cwd: stringAt(bag, "cwd") };
}

/** The `result` message: the end of a turn, and everything the run cost. */
export interface ResultLine {
  /** `success`, `error_max_turns`, `error_during_execution`, or whatever a release adds. */
  readonly subtype: string | null;
  /** Whether the SDK called this an error. Absent is not an error. */
  readonly isError: boolean;
  readonly numTurns: number | null;
  readonly durationMs: number | null;
  readonly costUsd: number | null;
}

/** Read a result message, or `null` if this is not one. */
export function readResult(message: unknown): ResultLine | null {
  const bag = bagOf(message);
  if (bag === null) return null;
  if (stringAt(bag, "type") !== "result") return null;
  return {
    subtype: stringAt(bag, "subtype"),
    isError: bag["is_error"] === true,
    numTurns: numberAt(bag, "num_turns"),
    durationMs: numberAt(bag, "duration_ms"),
    costUsd: numberAt(bag, "total_cost_usd"),
  };
}

/**
 * Whether a message is one side of a turn.
 *
 * Used only as a liveness heartbeat — "something is still happening" — so it deliberately does not
 * look inside `message`. Nothing the agent says reaches this package's state, and nothing the agent
 * says reaches telemetry through it.
 */
export function isTurn(message: unknown): boolean {
  const type = bagOf(message)?.["type"];
  return type === "assistant" || type === "user";
}
