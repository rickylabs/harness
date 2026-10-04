/**
 * The half of the adapter that has no socket in it.
 *
 * Framing and translation are where an OpenAI-compatible stream actually goes wrong, and both are
 * reachable from a test with nothing running: `sseData` takes strings and `translateStream` takes
 * payloads, so every hazard below is expressible as an array of literals. That is the whole reason
 * the transport is a separate seam.
 *
 * The chunk-boundary tests feed one character at a time on purpose. A framing bug that only appears
 * when a `data:` line is split across two network reads is the kind that passes every local test and
 * fails against a real server under load.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StreamChunk, TokenUsage } from "@deepseek-ai/dsh-llm";

import {
  MAX_PROVIDER_MESSAGE,
  liftProviderMessage,
  readBody,
  sseData,
  translateStream,
} from "./stream.js";

async function* pieces(...parts: readonly string[]): AsyncIterable<string> {
  for (const part of parts) yield part;
}

/** One string delivered one character at a time — the worst framing a socket can produce. */
async function* trickle(text: string): AsyncIterable<string> {
  for (const character of text) yield character;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of source) out.push(value);
  return out;
}

const events = (body: string): Promise<string[]> => collect(sseData(trickle(body)));

const translate = (...payloads: readonly string[]): Promise<StreamChunk[]> =>
  collect(translateStream(pieces(...payloads)));

function only<K extends StreamChunk["type"]>(
  chunks: readonly StreamChunk[],
  type: K,
): Extract<StreamChunk, { type: K }>[] {
  return chunks.filter((chunk): chunk is Extract<StreamChunk, { type: K }> => chunk.type === type);
}

function finishOf(chunks: readonly StreamChunk[]): Extract<StreamChunk, { type: "finish" }> {
  const last = chunks[chunks.length - 1];
  if (last === undefined || last.type !== "finish") {
    throw new Error(`the stream did not end with a finish chunk: ${JSON.stringify(chunks)}`);
  }
  return last;
}

function failureCode(chunks: readonly StreamChunk[]): string {
  const reason = finishOf(chunks).reason;
  if (reason.kind !== "error" && reason.kind !== "aborted") {
    throw new Error(`the stream finished with ${reason.kind}, which carries no failure`);
  }
  return reason.failure.code;
}

/** One frame of the shape every OpenAI-compatible server sends. */
const delta = (fields: Record<string, unknown>, finish?: string): string =>
  JSON.stringify({
    choices: [{ delta: fields, finish_reason: finish ?? null }],
  });

describe("SSE framing", () => {
  it("reassembles an event split across every possible boundary", async () => {
    assert.deepEqual(await events('data: {"a":1}\n\n'), ['{"a":1}']);
  });

  it("accepts CRLF line endings", async () => {
    assert.deepEqual(await events("data: one\r\n\r\ndata: two\r\n\r\n"), ["one", "two"]);
  });

  it("ignores comment lines, which is how a server keeps a connection alive", async () => {
    assert.deepEqual(await events(": keep-alive\ndata: one\n\n"), ["one"]);
  });

  it("ignores fields it does not act on", async () => {
    // `event`, `id` and `retry` are legal SSE and carry no content for any server we address.
    assert.deepEqual(await events("event: message\nid: 7\ndata: one\n\n"), ["one"]);
  });

  it("joins multiple data lines of one event with a newline", async () => {
    assert.deepEqual(await events("data: first\ndata: second\n\n"), ["first\nsecond"]);
  });

  it("strips exactly one leading space, and keeps the second", async () => {
    assert.deepEqual(await events("data:  padded\n\n"), [" padded"]);
  });

  it("yields a final event that never got its blank line", async () => {
    // Several servers close the socket straight after the last frame. That frame is the one
    // carrying `finish_reason`, so dropping it turns every complete answer into an incomplete one.
    assert.deepEqual(await events("data: one\n\ndata: two\n"), ["one", "two"]);
  });

  it("yields a final event that got neither a blank line nor a newline", async () => {
    assert.deepEqual(await events("data: one"), ["one"]);
  });

  it("emits nothing for a body with no data fields at all", async () => {
    assert.deepEqual(await events(": just a comment\n\n"), []);
  });
});

describe("reading a provider's own error text", () => {
  it("lifts the message every OpenAI-compatible server puts in the same place", () => {
    assert.equal(liftProviderMessage('{"error":{"message":"model not found"}}'), "model not found");
  });

  it("declines an HTML error page, a bare string, and a non-string message", () => {
    assert.equal(liftProviderMessage("<html>502 Bad Gateway</html>"), undefined);
    assert.equal(liftProviderMessage('"just a string"'), undefined);
    assert.equal(liftProviderMessage('{"error":{"message":404}}'), undefined);
    assert.equal(liftProviderMessage('{"error":{"message":"   "}}'), undefined);
  });

  it("bounds what it carries forward", () => {
    const long = "x".repeat(MAX_PROVIDER_MESSAGE + 50);
    const lifted = liftProviderMessage(JSON.stringify({ error: { message: long } }));
    assert.equal(lifted?.length, MAX_PROVIDER_MESSAGE + 1, "the ellipsis is the extra character");
    assert.equal(lifted?.endsWith("…"), true);
  });

  it("collects a body out of whatever pieces it arrived in", async () => {
    assert.equal(await readBody(pieces("{", '"a"', ":1}")), '{"a":1}');
  });
});

describe("translating a stream", () => {
  it("opens a text block once, accumulates it, and closes it before the finish", async () => {
    const chunks = await translate(
      delta({ content: "Hel" }),
      delta({ content: "lo" }),
      delta({}, "stop"),
      "[DONE]",
    );
    assert.deepEqual(
      chunks.map((chunk) => chunk.type),
      ["block-start", "text-delta", "text-delta", "block-end", "finish"],
    );
    assert.deepEqual(
      only(chunks, "text-delta").map((chunk) => chunk.text),
      ["Hel", "lo"],
    );
    const [end] = only(chunks, "block-end");
    assert.deepEqual(end?.block, { type: "text", text: "Hello" });
    assert.deepEqual(finishOf(chunks).reason, { kind: "stop" });
  });

  it("puts usage before the finish even when it arrives in a later frame", async () => {
    // dsh's ordering invariant, and the reason the finish is held back rather than emitted on
    // sight: every server sends the usage frame *after* the one carrying `finish_reason`.
    const chunks = await translate(
      delta({ content: "hi" }, "stop"),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }),
    );
    const types = chunks.map((chunk) => chunk.type);
    assert.deepEqual(types.slice(-2), ["usage", "finish"]);
  });

  it("keeps the three input counts disjoint", async () => {
    const chunks = await translate(
      delta({ content: "hi" }, "stop"),
      JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 30 },
          completion_tokens_details: { reasoning_tokens: 8 },
        },
      }),
    );
    const [reported] = only(chunks, "usage");
    const expected: TokenUsage = {
      inputTokens: 70,
      outputTokens: 20,
      cacheReadTokens: 30,
      reasoningTokens: 8,
      totalTokens: 120,
    };
    assert.deepEqual(reported?.usage, expected);
  });

  it("floors the subtraction rather than reporting a negative count", async () => {
    const chunks = await translate(
      delta({ content: "hi" }, "stop"),
      JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 1,
          prompt_tokens_details: { cached_tokens: 9 },
        },
      }),
    );
    assert.equal(only(chunks, "usage")[0]?.usage.inputTokens, 0);
  });

  it("omits usage entirely when the server reported none", async () => {
    const chunks = await translate(delta({ content: "hi" }, "stop"));
    assert.deepEqual(only(chunks, "usage"), [], "a zero would be invented, not measured");
  });

  it("gives reasoning its own block, opened before the answer", async () => {
    const chunks = await translate(
      delta({ reasoning_content: "thinking" }),
      delta({ content: "answer" }, "stop"),
    );
    assert.deepEqual(
      chunks.map((chunk) => chunk.type),
      ["block-start", "reasoning-delta", "block-start", "text-delta", "block-end", "block-end", "finish"],
    );
    const [reasoning, text] = only(chunks, "block-end");
    assert.deepEqual(reasoning?.block, { type: "reasoning", text: "thinking" });
    assert.deepEqual(text?.block, { type: "text", text: "answer" });
  });

  it("accepts the other spelling of a reasoning delta", async () => {
    const chunks = await translate(delta({ reasoning: "hmm" }, "stop"));
    assert.equal(only(chunks, "reasoning-delta")[0]?.text, "hmm");
  });

  it("accumulates a tool call's arguments across fragments and keeps them raw", async () => {
    const chunks = await translate(
      delta({ tool_calls: [{ index: 0, id: "call_a", function: { name: "search", arguments: '{"q' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '":"x"}' } }] }),
      delta({}, "tool_calls"),
    );
    const [end] = only(chunks, "block-end");
    assert.deepEqual(end?.block, {
      type: "tool-call",
      id: "call_a",
      name: "search",
      arguments: '{"q":"x"}',
    });
    assert.deepEqual(finishOf(chunks).reason, { kind: "tool-calls" });
  });

  it("correlates a call whose first fragment carried no id", async () => {
    const chunks = await translate(
      delta({ tool_calls: [{ index: 1, function: { name: "ping", arguments: "{}" } }] }),
      delta({}, "tool_calls"),
    );
    assert.equal(only(chunks, "tool-call-delta")[0]?.id, "call_1");
  });

  it("orders closing blocks by the order they opened", async () => {
    const chunks = await translate(
      delta({ content: "a" }),
      delta({ tool_calls: [{ index: 0, id: "t", function: { name: "f", arguments: "{}" } }] }),
      delta({}, "tool_calls"),
    );
    assert.deepEqual(
      only(chunks, "block-end").map((chunk) => chunk.index),
      [0, 1],
    );
  });

  it("reports a stream that simply stopped, rather than calling it a stop", async () => {
    // The house's most expensive bug shape: a truncated answer that reports success is
    // indistinguishable from a complete one.
    const chunks = await translate(delta({ content: "half an ans" }));
    assert.equal(failureCode(chunks), "INCOMPLETE_STREAM");
    assert.equal(only(chunks, "block-end")[0]?.block.type, "text", "what arrived is still reported");
  });

  it("reports an error frame under the provider's own code, and stops reading", async () => {
    const chunks = await translate(
      delta({ content: "a" }),
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "slow down" } }),
      delta({ content: "never read" }, "stop"),
    );
    assert.equal(failureCode(chunks), "rate_limit_exceeded");
    assert.equal(only(chunks, "text-delta").length, 1);
  });

  it("bounds a mid-stream error message the same way an error body is bounded", async () => {
    const chunks = await translate(
      JSON.stringify({ error: { message: "y".repeat(MAX_PROVIDER_MESSAGE + 50) } }),
    );
    const reason = finishOf(chunks).reason;
    assert.equal(reason.kind, "error");
    if (reason.kind !== "error") return;
    assert.equal(reason.failure.message.length, MAX_PROVIDER_MESSAGE);
  });

  it("reports an event that is not JSON rather than skipping it", async () => {
    assert.equal(failureCode(await translate("{not json")), "MALFORMED_EVENT");
  });

  it("treats a content filter as an error, not a stop", async () => {
    assert.equal(failureCode(await translate(delta({ content: "a" }, "content_filter"))), "CONTENT_FILTER");
  });

  it("refuses to map an unrecognised finish reason onto stop", async () => {
    assert.equal(failureCode(await translate(delta({}, "banana"))), "UNKNOWN_FINISH_REASON");
  });

  it("maps a truncation to max-tokens under either spelling", async () => {
    assert.deepEqual(finishOf(await translate(delta({}, "length"))).reason, { kind: "max-tokens" });
    assert.deepEqual(finishOf(await translate(delta({}, "max_tokens"))).reason, {
      kind: "max-tokens",
    });
  });

  it("ignores empty payloads, keep-alives and the terminator", async () => {
    assert.equal(failureCode(await translate("", "[DONE]")), "INCOMPLETE_STREAM");
  });

  it("survives a frame whose shape is nothing like the protocol", async () => {
    // Everything read off a socket is untrusted, and a frame we cannot read is not a frame that
    // should end a stream — only one we can read and that says something wrong is.
    const chunks = await translate("[1,2,3]", '{"choices":"not an array"}', delta({}, "stop"));
    assert.deepEqual(finishOf(chunks).reason, { kind: "stop" });
  });
});
