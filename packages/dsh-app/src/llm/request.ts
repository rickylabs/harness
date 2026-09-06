/**
 * A `GenerateOptions` becomes an HTTP request, or says why it cannot.
 *
 * All three destinations speak `openai-completions` — `endpoint.ts` derives the routes once for
 * exactly that reason — so there is one translation here rather than three.
 *
 * ## Refusals are values, and they are checked in configuration-first order
 *
 * A missing credential and an image in the history are both refusals, but only one of them is the
 * operator's to fix before the next request, so the credential is checked first. The order is the
 * order of remedies: bind the credential, raise the ceiling, then look at what the caller sent.
 *
 * ## No message in this file can carry a credential
 *
 * The key is read from the environment by the caller and reaches this file as one argument. It is
 * placed in exactly one header and named in exactly no message: a refusal says *the credential for
 * openrouter is not set* and names the variable to set, never a prefix, a length, or a fingerprint.
 * `endpoint.ts` reaches the same rule from the other side, refusing to quote an override at all.
 *
 * ## What the wire has no slot for
 *
 * Two content blocks do not survive translation, and they are treated differently on purpose.
 *
 * A **reasoning block** is dropped. It is the model's own prior scratchpad; the chat-completions
 * wire format has nowhere to put one, and re-sending it as ordinary text would present the model's
 * thinking back to it as though a user had written it. A message left with nothing after the drop is
 * skipped rather than sent empty.
 *
 * An **image block** is refused. It carries information the model needs and cannot get any other
 * way, so silently dropping it would send a request whose answer is about a picture that was never
 * there — a success-coded failure, and the expensive kind. In practice a caller reaching us through
 * `ctx.llm.stream` never gets here with one: `resolveModel` declares `inputModalities: ["text"]`, so
 * the runtime replaces images with deterministic text placeholders before dispatch. This refusal is
 * the second line, for a caller holding the adapter directly.
 *
 * A **failed tool result** keeps its failure. `ToolResultBlock.isError` has no slot in the `tool`
 * role either, and a failure that reads on the wire exactly like a success is how a model concludes
 * a broken tool worked. It is rendered as a leading marker in the result text instead.
 */

import { attributionHeaders, normalizeApiKey } from "@deepseek-ai/dsh-llm";
import type { ContentBlock, GenerateOptions, Message, ToolSchema } from "@deepseek-ai/dsh-llm";
import { type Endpoint, completionsUrl, reasoningBudget } from "@rickylabs/llm-local";

import type { WireRequest } from "./transport.js";

/** Why a request could not be built. */
export const REQUEST_REFUSALS = [
  "missing-credential",
  "invalid-credential",
  "budget-floor",
  "image-content",
  "empty-conversation",
] as const;
export type RequestRefusal = (typeof REQUEST_REFUSALS)[number];

/**
 * The stable code each refusal reports as.
 *
 * Two of them are dsh's own — `MISSING_CREDENTIAL` and `INVALID_CREDENTIAL` — because the runtime
 * already defines those and a caller routing on code should not have to learn a second spelling for
 * a condition dsh has named. The rest are ours, and are spelled the same way for the same reason:
 * consumers route on the code, never on the message text.
 */
const REQUEST_REFUSAL_CODES: Readonly<Record<RequestRefusal, string>> = {
  "missing-credential": "MISSING_CREDENTIAL",
  "invalid-credential": "INVALID_CREDENTIAL",
  "budget-floor": "BUDGET_FLOOR",
  "image-content": "IMAGE_UNSUPPORTED",
  "empty-conversation": "EMPTY_CONVERSATION",
};

/** The code a refusal reports as, for a `finish` chunk's failure. */
export const requestRefusalCode = (reason: RequestRefusal): string => REQUEST_REFUSAL_CODES[reason];

/** The answer to "can this request be sent". */
export type RequestVerdict =
  | { readonly ok: true; readonly request: WireRequest }
  | { readonly ok: false; readonly reason: RequestRefusal; readonly message: string };

function refuse(reason: RequestRefusal, message: string): RequestVerdict {
  return { ok: false, reason, message };
}

/** Everything needed to aim and fill a request, with the credential passed rather than discovered. */
export interface RequestInputs {
  readonly endpoint: Endpoint;
  readonly options: GenerateOptions;
  /**
   * The credential exactly as the environment held it, or absent when nothing was set.
   *
   * Passed in rather than read here so that the one place a secret enters this package is a call
   * site the tests control, and so that nothing in this file needs `process.env`.
   */
  readonly credential?: string | undefined;
}

/** One `tool_calls` entry of an assistant turn. */
interface WireToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

/** One entry of the `messages` array. */
type WireMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string; readonly tool_calls?: WireToolCall[] }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

/**
 * The marker a failed tool result carries.
 *
 * A fixed prefix rather than a rephrasing of the tool's own text, so a model that has seen one has
 * seen them all, and so nothing here has to guess what a particular failure means.
 */
const TOOL_ERROR_PREFIX = "[tool error] ";

/** Text of a block list, with reasoning dropped. Returns null when an image is present. */
function flattenText(content: readonly ContentBlock[]): string | null {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
      continue;
    }
    if (block.type === "image") return null;
    // `reasoning` is dropped; `tool-call` and `tool-result` are handled by the caller, which walks
    // the same list. Nesting a tool result inside a tool result is not a shape dsh produces.
  }
  return parts.join("");
}

/** The `tool` messages a user turn's tool results become. Null when one carried an image. */
function toolMessages(content: readonly ContentBlock[]): WireMessage[] | null {
  const messages: WireMessage[] = [];
  for (const block of content) {
    if (block.type !== "tool-result") continue;
    const text = flattenText(block.content);
    if (text === null) return null;
    messages.push({
      role: "tool",
      tool_call_id: block.toolCallId,
      content: block.isError === true ? `${TOOL_ERROR_PREFIX}${text}` : text,
    });
  }
  return messages;
}

/** The `tool_calls` an assistant turn requested. */
function toolCalls(content: readonly ContentBlock[]): WireToolCall[] {
  const calls: WireToolCall[] = [];
  for (const block of content) {
    if (block.type !== "tool-call") continue;
    calls.push({
      id: block.id,
      type: "function",
      function: { name: block.name, arguments: block.arguments },
    });
  }
  return calls;
}

/**
 * Translate the conversation.
 *
 * A user turn carrying tool results becomes one `tool` message per result — detected by block type
 * rather than by `MessageSource`, because the block is what the wire format needs and a message
 * whose source says `tool` but whose content says otherwise would still have to be translated by
 * its content.
 */
function translateMessages(messages: readonly Message[]): WireMessage[] | null {
  const wire: WireMessage[] = [];
  for (const message of messages) {
    const results = message.content.some((block) => block.type === "tool-result");
    if (results) {
      const translated = toolMessages(message.content);
      if (translated === null) return null;
      wire.push(...translated);
      continue;
    }

    const text = flattenText(message.content);
    if (text === null) return null;

    if (message.role === "assistant") {
      const calls = toolCalls(message.content);
      if (text === "" && calls.length === 0) continue;
      wire.push(
        calls.length === 0
          ? { role: "assistant", content: text }
          : { role: "assistant", content: text, tool_calls: calls },
      );
      continue;
    }

    if (text === "") continue;
    wire.push({ role: message.role, content: text });
  }
  return wire;
}

/** Tool schemas, in the shape the chat-completions API asks for. */
function translateTools(tools: readonly ToolSchema[]): readonly unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

/**
 * Build the request, or refuse.
 *
 * `stream_options.include_usage` is sent because without it a streaming response carries no usage at
 * all, and a run whose cost is unknown is a run nobody can account for. A server that ignores the
 * field simply sends no usage chunk, which `stream.ts` already treats as "not reported" rather than
 * as zero — inventing a zero would be worse than admitting the gap.
 */
export function buildRequest(inputs: RequestInputs): RequestVerdict {
  const { endpoint, options } = inputs;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...attributionHeaders(),
  };

  if (endpoint.credentialed) {
    const raw = inputs.credential;
    if (raw === undefined || raw.trim() === "") {
      return refuse(
        "missing-credential",
        `${endpoint.backend} requires a credential and none was supplied. Set it in the ` +
          "environment the daemon runs in; it is never read from the profile, because a profile is " +
          "committed and a credential must not be.",
      );
    }
    const key = normalizeApiKey(raw);
    if (!key.ok) {
      return refuse(
        "invalid-credential",
        `the credential supplied for ${endpoint.backend} is ${
          key.reason === "empty" ? "empty once trimmed" : "not a usable key: it contains characters no header may carry"
        }. Its value is not quoted here, and no message in this package quotes it.`,
      );
    }
    headers.authorization = `Bearer ${key.value}`;
  }

  if (options.maxTokens !== undefined) {
    // Unconditional, per `budget.ts`: scoping the floor to "reasoning models" would need a registry
    // of which models reason, and that fact changes under us in a vendor point release.
    const budget = reasoningBudget(options.maxTokens);
    if (!budget.ok) {
      return refuse("budget-floor", `${budget.message} (${endpoint.backend}, ${options.model})`);
    }
  }

  const conversation = translateMessages(options.messages);
  if (conversation === null) {
    return refuse(
      "image-content",
      `the request for ${options.model} carries an image, and these endpoints are registered as ` +
        "text-only. Reaching this through `ctx.llm.stream` is not possible — the runtime replaces " +
        "images with text placeholders for a text-only model — so a caller seeing this is holding " +
        "the adapter directly and should project the history first.",
    );
  }

  // A system prompt that is only whitespace is not sent: it costs tokens, says nothing, and some
  // servers reject an empty system turn outright.
  const system = options.system === undefined ? "" : options.system.trim();
  const wireMessages: WireMessage[] =
    system === "" ? conversation : [{ role: "system", content: system }, ...conversation];

  if (wireMessages.length === 0) {
    return refuse(
      "empty-conversation",
      `the request for ${options.model} has no messages left after translation. A request with an ` +
        "empty conversation is refused here rather than sent, because the 400 it comes back with " +
        "reads as a malformed body rather than as an empty history.",
    );
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: wireMessages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options.temperature !== undefined) body["temperature"] = options.temperature;
  if (options.maxTokens !== undefined) body["max_tokens"] = options.maxTokens;
  if (options.stop !== undefined && options.stop.length > 0) body["stop"] = options.stop;
  if (options.tools !== undefined && options.tools.length > 0) {
    body["tools"] = translateTools(options.tools);
  }

  return {
    ok: true,
    request: {
      url: completionsUrl(endpoint),
      headers,
      body: JSON.stringify(body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  };
}
