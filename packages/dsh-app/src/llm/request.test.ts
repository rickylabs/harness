/**
 * What actually goes on the wire, and what is refused before anything does.
 *
 * Two properties get more attention here than the rest, because both are the kind that fails
 * silently. The first is that **no refusal ever quotes a credential** — a planted key is asserted
 * absent from every message, not merely absent from the one message that was written with it in
 * mind. The second is that **content the wire has no slot for is either translated or refused, never
 * dropped**: a request whose image quietly vanished comes back with a confident answer about a
 * picture that was never sent, and nothing downstream can tell that apart from a real one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ToolCallId,
  attributionHeaders,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from "@deepseek-ai/dsh-llm";
import type { ContentBlock, GenerateOptions, Message } from "@deepseek-ai/dsh-llm";
import { MIN_REASONING_BUDGET, type Endpoint, resolveEndpoint } from "@rickylabs/llm-local";

import { REQUEST_REFUSALS, buildRequest, requestRefusalCode } from "./request.js";
import type { RequestVerdict } from "./request.js";

/** A value that would be a disaster to find in a log. Never a real key, and never a plausible one. */
const PLANTED_KEY = "sk-planted-canary-000111222333";

function endpointFor(backend: string): Endpoint {
  const resolved = resolveEndpoint(backend);
  if (!resolved.ok) throw new Error(`${backend} does not resolve: ${resolved.message}`);
  return resolved.endpoint;
}

const OPENROUTER = endpointFor("openrouter");
const LM_STUDIO = endpointFor("lm-studio");

const user = (text: string): Message =>
  createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: "lm-studio",
    model: "a-model",
    messages: [user("hello")],
    ...overrides,
  };
}

function sent(verdict: RequestVerdict): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  if (!verdict.ok) throw new Error(`the request was refused: ${verdict.reason} — ${verdict.message}`);
  return {
    url: verdict.request.url,
    headers: verdict.request.headers,
    body: JSON.parse(verdict.request.body) as Record<string, unknown>,
  };
}

function refused(verdict: RequestVerdict): { reason: string; message: string } {
  if (verdict.ok) throw new Error(`the request was built when it should have been refused`);
  return { reason: verdict.reason, message: verdict.message };
}

/** The `messages` array, typed loosely because this is what a server would see. */
function wireMessages(body: Record<string, unknown>): Record<string, unknown>[] {
  const messages = body["messages"];
  assert.equal(Array.isArray(messages), true, "a request always carries a messages array");
  return messages as Record<string, unknown>[];
}

describe("aiming and filling a request", () => {
  it("sends to the completions route derived from the endpoint", () => {
    const { url } = sent(buildRequest({ endpoint: LM_STUDIO, options: options() }));
    assert.equal(url, `${LM_STUDIO.baseUrl}/chat/completions`);
  });

  it("asks for a stream, and for the usage that only comes when asked for", () => {
    const { body, headers } = sent(buildRequest({ endpoint: LM_STUDIO, options: options() }));
    assert.equal(body["stream"], true);
    assert.deepEqual(body["stream_options"], { include_usage: true });
    assert.equal(headers["accept"], "text/event-stream");
    assert.equal(headers["content-type"], "application/json");
  });

  it("carries the attribution every provider request is required to carry", () => {
    const { headers } = sent(buildRequest({ endpoint: LM_STUDIO, options: options() }));
    for (const [key, value] of Object.entries(attributionHeaders())) {
      assert.equal(headers[key], value, key);
    }
  });

  it("sends no authorization to a backend that asks for none", () => {
    const { headers } = sent(buildRequest({ endpoint: LM_STUDIO, options: options() }));
    assert.equal("authorization" in headers, false);
  });

  it("omits every optional field the caller omitted", () => {
    const { body } = sent(buildRequest({ endpoint: LM_STUDIO, options: options() }));
    for (const key of ["temperature", "max_tokens", "stop", "tools"]) {
      assert.equal(key in body, false, `${key} was invented`);
    }
  });

  it("sends the optional fields the caller supplied", () => {
    const { body } = sent(
      buildRequest({
        endpoint: LM_STUDIO,
        options: options({
          temperature: 0,
          maxTokens: MIN_REASONING_BUDGET,
          stop: ["\n\n"],
          tools: [{ name: "search", description: "find", parameters: { type: "object" } }],
        }),
      }),
    );
    assert.equal(body["temperature"], 0, "zero is a value, not an absence");
    assert.equal(body["max_tokens"], MIN_REASONING_BUDGET);
    assert.deepEqual(body["stop"], ["\n\n"]);
    assert.deepEqual(body["tools"], [
      {
        type: "function",
        function: { name: "search", description: "find", parameters: { type: "object" } },
      },
    ]);
  });

  it("does not send an empty stop list or an empty tool list", () => {
    const { body } = sent(
      buildRequest({ endpoint: LM_STUDIO, options: options({ stop: [], tools: [] }) }),
    );
    assert.equal("stop" in body, false);
    assert.equal("tools" in body, false);
  });

  it("passes the caller's abort signal through untouched", () => {
    const controller = new AbortController();
    const verdict = buildRequest({
      endpoint: LM_STUDIO,
      options: options({ signal: controller.signal }),
    });
    assert.equal(verdict.ok, true);
    if (!verdict.ok) return;
    assert.equal(verdict.request.signal, controller.signal);
  });
});

describe("the system prompt", () => {
  it("leads the conversation when there is one", () => {
    const { body } = sent(
      buildRequest({ endpoint: LM_STUDIO, options: options({ system: "be brief" }) }),
    );
    assert.deepEqual(wireMessages(body)[0], { role: "system", content: "be brief" });
  });

  it("is not sent when it is only whitespace", () => {
    const { body } = sent(
      buildRequest({ endpoint: LM_STUDIO, options: options({ system: "   \n " }) }),
    );
    assert.equal(wireMessages(body)[0]?.["role"], "user");
  });
});

describe("translating a conversation", () => {
  it("keeps roles and text in order", () => {
    const messages: Message[] = [
      user("first"),
      createAssistantMessage({
        content: [{ type: "text", text: "second" }],
        source: { provider: "lm-studio", model: "a-model" },
      }),
      user("third"),
    ];
    const { body } = sent(buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) }));
    assert.deepEqual(wireMessages(body), [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);
  });

  it("drops a reasoning block rather than re-sending the model its own scratchpad", () => {
    const messages: Message[] = [
      createAssistantMessage({
        content: [
          { type: "reasoning", text: "the user probably means X" },
          { type: "text", text: "X." },
        ],
        source: { provider: "lm-studio", model: "a-model" },
      }),
    ];
    const { body } = sent(buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) }));
    assert.deepEqual(wireMessages(body), [{ role: "assistant", content: "X." }]);
  });

  it("skips a message that had nothing but reasoning in it", () => {
    const messages: Message[] = [
      user("first"),
      createAssistantMessage({
        content: [{ type: "reasoning", text: "hmm" }],
        source: { provider: "lm-studio", model: "a-model" },
      }),
    ];
    const { body } = sent(buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) }));
    assert.deepEqual(wireMessages(body), [{ role: "user", content: "first" }]);
  });

  it("carries an assistant turn's tool calls beside its text", () => {
    const messages: Message[] = [
      createAssistantMessage({
        content: [
          { type: "text", text: "looking" },
          { type: "tool-call", id: ToolCallId("call_a"), name: "search", arguments: '{"q":"x"}' },
        ],
        source: { provider: "lm-studio", model: "a-model" },
      }),
    ];
    const { body } = sent(buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) }));
    assert.deepEqual(wireMessages(body), [
      {
        role: "assistant",
        content: "looking",
        tool_calls: [
          { id: "call_a", type: "function", function: { name: "search", arguments: '{"q":"x"}' } },
        ],
      },
    ]);
  });

  it("keeps a tool call whose turn carried no text at all", () => {
    const messages: Message[] = [
      createAssistantMessage({
        content: [
          { type: "tool-call", id: ToolCallId("call_a"), name: "search", arguments: "{}" },
        ],
        source: { provider: "lm-studio", model: "a-model" },
      }),
    ];
    const { body } = sent(buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) }));
    assert.equal(wireMessages(body).length, 1, "a call-only turn is the common shape, not an empty one");
  });

  it("turns a tool result into a correlated tool message", () => {
    const messages: Message[] = [
      createToolResultMessage({
        callId: ToolCallId("call_a"),
        content: [{ type: "text", text: "42" }],
        isError: false,
      }),
    ];
    const { body } = sent(buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) }));
    assert.deepEqual(wireMessages(body), [{ role: "tool", tool_call_id: "call_a", content: "42" }]);
  });

  it("marks a failed tool result, because the wire has no slot that says so", () => {
    const messages: Message[] = [
      createToolResultMessage({
        callId: ToolCallId("call_a"),
        content: [{ type: "text", text: "connection refused" }],
        isError: true,
      }),
    ];
    const { body } = sent(buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) }));
    const [only] = wireMessages(body);
    assert.equal(only?.["content"], "[tool error] connection refused");
  });
});

describe("refusals", () => {
  it("names a stable code for every refusal it can produce", () => {
    // A caller routes on the code. One that exists only as a literal three levels down is one
    // nobody can enumerate to handle.
    for (const reason of REQUEST_REFUSALS) {
      const code = requestRefusalCode(reason);
      assert.equal(typeof code, "string");
      assert.notEqual(code, "");
    }
  });

  it("refuses a credentialed backend with no credential, and says which variable to set", () => {
    const verdict = buildRequest({ endpoint: OPENROUTER, options: options() });
    const { reason, message } = refused(verdict);
    assert.equal(reason, "missing-credential");
    assert.match(message, /openrouter/);
  });

  it("treats a blank credential as no credential", () => {
    const verdict = buildRequest({ endpoint: OPENROUTER, options: options(), credential: "   " });
    assert.equal(refused(verdict).reason, "missing-credential");
  });

  it("refuses a credential no header could carry", () => {
    const verdict = buildRequest({
      endpoint: OPENROUTER,
      options: options(),
      credential: `${PLANTED_KEY} with a space`,
    });
    const { reason, message } = refused(verdict);
    assert.equal(reason, "invalid-credential");
    assert.equal(message.includes(PLANTED_KEY), false, "the refusal quoted the key it refused");
  });

  it("binds a usable credential to exactly one header and nothing else", () => {
    const { headers, body, url } = sent(
      buildRequest({ endpoint: OPENROUTER, options: options(), credential: `  ${PLANTED_KEY}  ` }),
    );
    assert.equal(headers["authorization"], `Bearer ${PLANTED_KEY}`, "trimmed, then bound");
    assert.equal(url.includes(PLANTED_KEY), false, "the key reached the URL");
    assert.equal(JSON.stringify(body).includes(PLANTED_KEY), false, "the key reached the body");
    const elsewhere = Object.entries(headers).filter(([key]) => key !== "authorization");
    for (const [key, value] of elsewhere) {
      assert.equal(value.includes(PLANTED_KEY), false, `the key reached the ${key} header`);
    }
  });

  it("refuses a ceiling below the reasoning floor rather than clamping it", () => {
    const verdict = buildRequest({
      endpoint: LM_STUDIO,
      options: options({ maxTokens: MIN_REASONING_BUDGET - 1 }),
    });
    const { reason, message } = refused(verdict);
    assert.equal(reason, "budget-floor");
    assert.match(message, /lm-studio/, "a refusal names where it applied");
  });

  it("refuses an image rather than sending a request about a picture that never arrived", () => {
    const image = { type: "image", attachment: { id: "att_1" } } as unknown as ContentBlock;
    const messages: Message[] = [
      createUserMessage({
        content: [{ type: "text", text: "what is this" }, image],
        source: { kind: "user" },
      }),
    ];
    const verdict = buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) });
    assert.equal(refused(verdict).reason, "image-content");
  });

  it("refuses an image nested inside a tool result too", () => {
    const image = { type: "image", attachment: { id: "att_1" } } as unknown as ContentBlock;
    const messages: Message[] = [
      createToolResultMessage({
        callId: ToolCallId("call_a"),
        content: [image],
        isError: false,
      }),
    ];
    const verdict = buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) });
    assert.equal(refused(verdict).reason, "image-content");
  });

  it("refuses a conversation that emptied out during translation", () => {
    const messages: Message[] = [
      createAssistantMessage({
        content: [{ type: "reasoning", text: "only thinking" }],
        source: { provider: "lm-studio", model: "a-model" },
      }),
    ];
    const verdict = buildRequest({ endpoint: LM_STUDIO, options: options({ messages }) });
    assert.equal(refused(verdict).reason, "empty-conversation");
  });

  it("checks the credential before anything the caller sent", () => {
    // The order is the order of remedies: bind the credential, raise the ceiling, then look at the
    // history. A request with two things wrong reports the one the operator fixes first.
    const verdict = buildRequest({
      endpoint: OPENROUTER,
      options: options({ maxTokens: 1, messages: [] }),
    });
    assert.equal(refused(verdict).reason, "missing-credential");
  });
});
