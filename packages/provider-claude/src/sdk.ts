/**
 * The slice of `@anthropic-ai/claude-agent-sdk` this package uses, declared rather than imported.
 *
 * ## Why the SDK is not a dependency
 *
 * Measured against `@anthropic-ai/claude-agent-sdk@0.3.263`: the main package unpacks to 5,028,300
 * bytes, its `linux-x64` platform binary to **215,662,653**, and it declares three peers — `zod`,
 * `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` — that pnpm installs on its behalf. CI runs
 * `pnpm install --frozen-lockfile` on every job inside a fifteen-minute budget, on a private
 * repository whose minutes are billed. Paying ~216 MB of platform binary and three transitive peers
 * per job to obtain *types* for a module whose tests never call the real thing is the wrong trade.
 *
 * So the boundary is structural, and the honesty that buys is stated once here: **nothing in this
 * file has been checked against the vendor's own declarations.** A structural type that is subtly
 * wrong compiles perfectly and fails on the box. Two habits follow from that, and they are the
 * reason this module exists at all rather than being spread through the provider:
 *
 * 1. **Nothing is read off a message by property access.** Every field the provider needs comes out
 *    of a reader in this file that checks the shape at runtime and returns `null` when the message
 *    is not what it was assumed to be. A renamed field becomes a run that reports `unknown`, which
 *    is a state the contract has a meaning for, rather than a `TypeError` in a background loop.
 * 2. **The stream is typed `unknown`.** Anything the vendor yields is assignable to it, so no
 *    release of theirs can fail to satisfy `QueryFn` for a reason that is really about our guess.
 *
 * The guess that remains is `SdkUserMessage`, because that one travels the other way — we construct
 * it. It is one interface with one constructor and one test pinning its bytes, so correcting it is a
 * one-line diff rather than an excavation.
 *
 * ## Streaming input, and what it decides
 *
 * `query()` accepts either a string prompt or an `AsyncIterable` of user messages. The difference is
 * not stylistic: `Query.interrupt()` exists only in the streaming form. Every capability this
 * provider declares beyond `observe` is downstream of taking the iterable — a provider that can only
 * fire and forget is the coordinator this repository exists to replace.
 */

/** Options passed to `query()`. Only the fields this package sets are declared. */
export interface QueryOptions {
  /** Model id, verbatim as the matrix pinned it. See `translateModel` for what that means here. */
  readonly model?: string;
  /** Working directory for the run. */
  readonly cwd?: string;
  /** Full environment for the child process. Built by `isolatedEnv`. */
  readonly env?: Record<string, string>;
  /** Aborting this ends the run and reaps the child. One per run, never shared. */
  readonly abortController?: AbortController;
  /** Upper bound on agent turns, when the caller sets one. */
  readonly maxTurns?: number;
}

/**
 * A user message pushed into a streaming-input run.
 *
 * The one shape in this file we construct rather than read, and therefore the one a wrong guess
 * breaks silently: a message the CLI cannot parse is dropped, the steer reports `delivered`, and
 * nobody learns otherwise until a run ignores an instruction. `userMessage` is its only constructor
 * and `sdk.test.ts` pins the result field by field, so the correction #49 may bring back is small.
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

/**
 * What `query()` returns.
 *
 * `interrupt` is optional here and not in the vendor's declaration, because it is absent in
 * string-prompt mode and this interface has to describe both. The provider asks whether it is a
 * function before calling it, which is also what makes the fallback path — abort the controller —
 * reachable when a release removes it.
 */
export interface AgentQuery extends AsyncIterable<unknown> {
  interrupt?: () => Promise<void>;
}

/** The vendor entry point, injected. `dsh-app` binds the real one; the suite binds a fake. */
export type QueryFn = (input: {
  readonly prompt: AsyncIterable<SdkUserMessage>;
  readonly options: QueryOptions;
}) => AgentQuery;

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
