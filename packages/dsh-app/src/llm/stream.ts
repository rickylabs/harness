/**
 * Server-sent events in, `StreamChunk`s out.
 *
 * This is the fiddly half, and the reason the transport is a seam: framing is where an adapter
 * quietly loses content. An event boundary and a network read boundary have nothing to do with each
 * other, so a `data:` line arrives split down the middle; a server writes `\r\n`; a proxy injects
 * `: keep-alive` comments; a final event arrives with no trailing blank line. Every one of those is
 * a test here rather than an incident on the box.
 *
 * ## The invariant this file exists to hold
 *
 * dsh states it plainly: *adapters emit usage before the terminal finish and nothing afterward*. An
 * OpenAI-compatible server does the opposite — it sends `finish_reason` on the second-to-last chunk
 * and usage on the last one, after the choice list has gone empty. So the finish is held back until
 * the stream actually ends, every open block is closed in ascending index order, usage is emitted if
 * any arrived, and only then the finish. Nothing follows it.
 *
 * ## A stream that stops is not a stream that finished
 *
 * If the connection ends with no `finish_reason` anywhere, the finish is `error` /
 * `INCOMPLETE_STREAM`, never `stop`. This is the house's most expensive bug shape, and it is exactly
 * the shape a truncated stream takes: the caller gets whatever text arrived before the socket died,
 * with a finish reason that says the model was done. `budget.ts` was written after one instance of
 * it and `probe.ts` after another; this is the third place it would have appeared.
 *
 * ## Provider text is data
 *
 * A message lifted out of an error body can reach a run log, a receipt, and an issue body. Only
 * `error.message`, only when it is a string, and only the first {@link MAX_PROVIDER_MESSAGE}
 * characters of it — never the raw body, which on a misconfigured proxy is an HTML error page and on
 * a hostile one is whatever it wants to be.
 */

import { ToolCallId } from "@deepseek-ai/dsh-llm";
import type {
  ContentBlock,
  ContentBlockType,
  FinishReason,
  LlmFailure,
  StreamChunk,
  TokenUsage,
} from "@deepseek-ai/dsh-llm";

/** How much of a provider's own error text is carried forward. */
export const MAX_PROVIDER_MESSAGE = 200;

/**
 * Decode SSE framing into `data` payloads.
 *
 * Field parsing follows the event-stream rules that matter here: a line starting with `:` is a
 * comment, a field is everything before the first `:`, one optional leading space of the value is
 * stripped, and multiple `data` lines in one event join with a newline. Fields other than `data`
 * (`event`, `id`, `retry`) are ignored — no OpenAI-compatible server uses them for content, and
 * acting on one we do not understand would be worse than ignoring it.
 *
 * A payload still buffered when the stream ends is yielded. Some servers close after the last event
 * without the blank line that would have terminated it, and dropping that event would throw away
 * the chunk carrying `finish_reason`.
 */
export async function* sseData(chunks: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = "";
  let event: string[] = [];

  const field = (line: string): void => {
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    if ((colon < 0 ? line : line.slice(0, colon)) !== "data") return;
    const raw = colon < 0 ? "" : line.slice(colon + 1);
    event.push(raw.startsWith(" ") ? raw.slice(1) : raw);
  };

  for await (const chunk of chunks) {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const raw = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (line === "") {
        if (event.length > 0) {
          yield event.join("\n");
          event = [];
        }
        continue;
      }
      field(line);
    }
  }

  const tail = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
  if (tail !== "") field(tail);
  if (event.length > 0) yield event.join("\n");
}

// ---- Reading untrusted JSON ------------------------------------------------------------------
//
// Every helper below returns undefined rather than throwing, because the object being read came off
// a socket. A missing field and a field of the wrong type are the same thing to a caller: absent.

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/**
 * Lift a provider's own message out of an error body.
 *
 * `{"error": {"message": "..."}}` is the shape every OpenAI-compatible server uses. Anything else —
 * an HTML page, a bare string, a message that is not a string — yields nothing, and the caller says
 * only what it knows: the status.
 */
export function liftProviderMessage(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const error = asRecord(asRecord(parsed)?.["error"]);
  const message = asString(error?.["message"]);
  if (message === undefined || message.trim() === "") return undefined;
  const trimmed = message.trim();
  return trimmed.length <= MAX_PROVIDER_MESSAGE
    ? trimmed
    : `${trimmed.slice(0, MAX_PROVIDER_MESSAGE)}…`;
}

/** Collect a whole response body. Only for the error path — a success body is streamed. */
export async function readBody(chunks: AsyncIterable<string>): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return parts.join("");
}

/** A terminal `finish` chunk carrying a failure. The one way this file reports anything wrong. */
export function failureChunk(failure: LlmFailure): StreamChunk {
  return { type: "finish", reason: { kind: "error", failure } };
}

/** Build a failure without having to spell the optional fields at every call site. */
export function llmFailure(code: string, message: string, status?: number): LlmFailure {
  return { code, message, ...(status === undefined ? {} : { status }) };
}

/**
 * Translate a provider `finish_reason` string.
 *
 * `content_filter` becomes an error rather than a stop: the model did not finish answering, and a
 * caller that reads it as `stop` records a truncated answer as a complete one. An unrecognised value
 * is an error too, for the same reason — mapping the unknown onto `stop` is the guess that costs.
 */
function translateFinish(reason: string): FinishReason {
  if (reason === "stop") return { kind: "stop" };
  if (reason === "tool_calls" || reason === "function_call") return { kind: "tool-calls" };
  if (reason === "length" || reason === "max_tokens") return { kind: "max-tokens" };
  if (reason === "content_filter") {
    return {
      kind: "error",
      failure: llmFailure(
        "CONTENT_FILTER",
        "the provider stopped generation on its own content filter, so the answer is partial",
      ),
    };
  }
  return {
    kind: "error",
    failure: llmFailure(
      "UNKNOWN_FINISH_REASON",
      `the provider ended the stream with a finish reason this adapter does not recognise: ` +
        `${JSON.stringify(reason)}. It is reported rather than mapped onto "stop", because a ` +
        "reason nobody has read is not a reason to trust the answer.",
    ),
  };
}

/**
 * Translate a usage object.
 *
 * `inputTokens` is uncached input only, per dsh's disjointness rule, so cached tokens are subtracted
 * out of the provider's `prompt_tokens` rather than double-counted. The subtraction floors at zero:
 * a server reporting more cached tokens than prompt tokens is reporting something we cannot
 * reconcile, and a negative token count would propagate into a spend figure.
 */
function translateUsage(usage: Record<string, unknown>): TokenUsage | undefined {
  const prompt = asCount(usage["prompt_tokens"]);
  const completion = asCount(usage["completion_tokens"]);
  if (prompt === undefined || completion === undefined) return undefined;

  const cached = asCount(asRecord(usage["prompt_tokens_details"])?.["cached_tokens"]) ?? 0;
  const reasoning = asCount(asRecord(usage["completion_tokens_details"])?.["reasoning_tokens"]);
  const total = asCount(usage["total_tokens"]);

  return {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: completion,
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(reasoning === undefined || reasoning === 0 ? {} : { reasoningTokens: reasoning }),
    ...(total === undefined ? {} : { totalTokens: total }),
  };
}

/** One open content block, and what it has accumulated. */
interface OpenBlock {
  readonly index: number;
  readonly kind: ContentBlockType;
  text: string;
  /** Tool calls only. */
  readonly id?: string;
  name?: string;
}

function finishedBlock(block: OpenBlock): ContentBlock | undefined {
  if (block.kind === "text") return { type: "text", text: block.text };
  if (block.kind === "reasoning") return { type: "reasoning", text: block.text };
  if (block.kind === "tool-call" && block.id !== undefined) {
    return {
      type: "tool-call",
      id: ToolCallId(block.id),
      name: block.name ?? "",
      arguments: block.text,
    };
  }
  return undefined;
}

/**
 * The one place a stream of events becomes a stream of chunks.
 *
 * Block indices are this adapter's own, allocated in the order blocks open, and have nothing to do
 * with the provider's `tool_calls[].index` — that one is a slot number within a single message and
 * repeats across messages, while dsh's is a position in the response.
 *
 * A tool call whose first fragment carries no id gets `call_<slot>`. Every OpenAI-compatible server
 * observed so far sends the id on the first fragment; the fallback exists so that a server which
 * does not still produces a correlatable call rather than a block that can never be closed.
 */
export async function* translateStream(events: AsyncIterable<string>): AsyncIterable<StreamChunk> {
  const open = new Map<string, OpenBlock>();
  let nextIndex = 0;
  let usage: TokenUsage | undefined;
  let finish: FinishReason | undefined;
  let failed: LlmFailure | undefined;

  function* openBlock(key: string, kind: ContentBlockType, id?: string): Generator<StreamChunk> {
    const index = nextIndex;
    nextIndex += 1;
    open.set(key, { index, kind, text: "", ...(id === undefined ? {} : { id }) });
    yield { type: "block-start", index, blockType: kind };
  }

  function* closeAll(): Generator<StreamChunk> {
    const blocks = [...open.values()].sort((a, b) => a.index - b.index);
    open.clear();
    for (const block of blocks) {
      const finished = finishedBlock(block);
      if (finished !== undefined) yield { type: "block-end", index: block.index, block: finished };
    }
  }

  for await (const payload of events) {
    const data = payload.trim();
    if (data === "" || data === "[DONE]") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      failed = llmFailure(
        "MALFORMED_EVENT",
        "the provider sent a stream event that is not JSON. It is reported rather than skipped: a " +
          "skipped event is content silently missing from the answer.",
      );
      break;
    }

    const frame = asRecord(parsed);
    if (frame === undefined) continue;

    const errorBody = asRecord(frame["error"]);
    if (errorBody !== undefined) {
      failed = llmFailure(
        asString(errorBody["code"]) ?? "PROVIDER_ERROR",
        asString(errorBody["message"])?.slice(0, MAX_PROVIDER_MESSAGE) ??
          "the provider reported an error mid-stream and gave no message",
      );
      break;
    }

    const reportedUsage = asRecord(frame["usage"]);
    if (reportedUsage !== undefined) usage = translateUsage(reportedUsage) ?? usage;

    const choice = asRecord(asArray(frame["choices"])?.[0]);
    if (choice === undefined) continue;

    const delta = asRecord(choice["delta"]);
    if (delta !== undefined) {
      // Reasoning first: a model that thinks before it answers emits it before any text, and
      // opening the blocks in arrival order is what makes the indices mean anything.
      const reasoning = asString(delta["reasoning_content"]) ?? asString(delta["reasoning"]);
      if (reasoning !== undefined && reasoning !== "") {
        if (!open.has("reasoning")) yield* openBlock("reasoning", "reasoning");
        const block = open.get("reasoning");
        if (block !== undefined) {
          block.text += reasoning;
          yield { type: "reasoning-delta", index: block.index, text: reasoning };
        }
      }

      const content = asString(delta["content"]);
      if (content !== undefined && content !== "") {
        if (!open.has("text")) yield* openBlock("text", "text");
        const block = open.get("text");
        if (block !== undefined) {
          block.text += content;
          yield { type: "text-delta", index: block.index, text: content };
        }
      }

      for (const raw of asArray(delta["tool_calls"]) ?? []) {
        const call = asRecord(raw);
        if (call === undefined) continue;
        const slot = asCount(call["index"]) ?? 0;
        const key = `tool:${String(slot)}`;
        const fn = asRecord(call["function"]);
        const id = asString(call["id"]);
        if (!open.has(key)) {
          yield* openBlock(key, "tool-call", id ?? `call_${String(slot)}`);
        }
        const block = open.get(key);
        if (block === undefined) continue;
        const name = asString(fn?.["name"]);
        if (name !== undefined && name !== "") block.name = name;
        const argumentsDelta = asString(fn?.["arguments"]) ?? "";
        block.text += argumentsDelta;
        yield {
          type: "tool-call-delta",
          index: block.index,
          id: ToolCallId(block.id ?? `call_${String(slot)}`),
          ...(block.name === undefined ? {} : { name: block.name }),
          argumentsDelta,
        };
      }
    }

    // Recorded, not acted on. Usage arrives in a later frame whose choice list is empty, and
    // finishing here would trade the accounting for a few milliseconds.
    const reason = asString(choice["finish_reason"]);
    if (reason !== undefined) finish = translateFinish(reason);
  }

  yield* closeAll();
  if (usage !== undefined) yield { type: "usage", usage };

  if (failed !== undefined) {
    yield failureChunk(failed);
    return;
  }
  if (finish === undefined) {
    yield failureChunk(
      llmFailure(
        "INCOMPLETE_STREAM",
        "the provider closed the stream without a finish reason. Whatever arrived is reported as " +
          'incomplete rather than as a normal stop: a truncated answer that says "stop" is ' +
          "indistinguishable from a complete one, and that is the failure shape this repository " +
          "spends the most effort refusing to produce.",
      ),
    );
    return;
  }
  yield { type: "finish", reason: finish };
}
