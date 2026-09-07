import { loadRoutingConfiguration } from "@rickylabs/routing";
import { fileURLToPath } from "node:url";
/**
 * The adapter, with a canned socket.
 *
 * Every path through `stream()` is exercised here because every one of them is a refusal an operator
 * has to read and act on, and a refusal that names the wrong remedy is worse than a crash: it sends
 * someone to fix the thing that was not broken.
 *
 * The credential canary runs through several of these cases rather than one. `request.ts` already
 * proves no refusal *it* writes quotes a key; what this file proves is the composite — that a key
 * planted in the reader reaches exactly one header and appears in no chunk this adapter ever yields,
 * on the success path and on each failure path alike.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, LlmFailure, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { Backend } from "@rickylabs/llm-local";


import { ADAPTER_FAILURE_CODES, CREDENTIAL_REF, LocalLlmAdapter, PROVIDER_NAMES, envCredentials } from "./adapter.js";
import type { Transport, WireExchange, WireRequest } from "./transport.js";

const loadedRouting = await loadRoutingConfiguration({ path: fileURLToPath(import.meta.resolve("@rickylabs/routing/config/routing.v1.json")) });
assert.ok(loadedRouting.ok);
const routing = loadedRouting.loaded;
const PLANTED_KEY = "sk-planted-canary-000111222333";

async function* from(parts: readonly string[]): AsyncIterable<string> {
  for (const part of parts) yield part;
}

/** A body that never ends, to prove the error-body read is bounded. */
async function* endless(): AsyncIterable<string> {
  for (;;) yield "x".repeat(4096);
}

/** A body that fails halfway, to prove reading it never becomes the failure being reported. */
async function* truncated(): AsyncIterable<string> {
  yield '{"error":{"mess';
  throw new Error("socket reset");
}

function reached(status: number, ...body: readonly string[]): WireExchange {
  return { reached: true, status, chunks: from(body) };
}

/** An SSE body from a list of `data:` payloads. */
function sse(...payloads: readonly string[]): string {
  return payloads.map((payload) => `data: ${payload}\n\n`).join("");
}

interface Wire {
  readonly transport: Transport;
  readonly sent: WireRequest[];
}

function canned(exchange: WireExchange | (() => Promise<WireExchange>)): Wire {
  const sent: WireRequest[] = [];
  const transport: Transport = (request: WireRequest): Promise<WireExchange> => {
    sent.push(request);
    return typeof exchange === "function" ? exchange() : Promise.resolve(exchange);
  };
  return { transport, sent };
}

/** A transport nothing should ever reach. Reaching it is the assertion failing. */
const unreachable: Transport = () => {
  throw new Error("the transport was called for a request that should have been refused");
};

function adapter(options: {
  transport?: Transport;
  overrides?: Partial<Record<Backend, string>>;
  credential?: string;
}): LocalLlmAdapter {
  const { overrides, credential } = options;
  return new LocalLlmAdapter({
    placements: routing.configuration.placements,
    transport: options.transport ?? unreachable,
    ...(overrides === undefined ? {} : { overrides }),
    ...(credential === undefined ? {} : { credentials: (): string => credential }),
  });
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: "lm-studio",
    model: "n5air/qwen3.8-27b",
    messages: [createUserMessage({ content: [{ type: "text", text: "hi" }], source: { kind: "user" } })],
    ...overrides,
  };
}

async function run(
  instance: LocalLlmAdapter,
  options: GenerateOptions = request(),
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of instance.stream(options)) chunks.push(chunk);
  return chunks;
}

function finish(chunks: readonly StreamChunk[]): Extract<StreamChunk, { type: "finish" }> {
  const last = chunks[chunks.length - 1];
  if (last === undefined || last.type !== "finish") {
    throw new Error(`the stream did not end with a finish chunk: ${JSON.stringify(chunks)}`);
  }
  return last;
}

function failure(chunks: readonly StreamChunk[]): { kind: string } & LlmFailure {
  const reason = finish(chunks).reason;
  if (reason.kind !== "error" && reason.kind !== "aborted") {
    throw new Error(`the stream finished with ${reason.kind}, which carries no failure`);
  }
  return { kind: reason.kind, ...reason.failure };
}

describe("what the adapter says about itself", () => {
  it("names each of its three routes", () => {
    const instance = adapter({});
    for (const [id, name] of Object.entries(PROVIDER_NAMES)) {
      assert.deepEqual(instance.providerInfo(id), { id, name });
    }
  });

  it("echoes a provider it does not know rather than failing a display question", () => {
    // The runtime requires `info.id === provider`. Throwing here would break registration over a
    // name nobody was ever going to send a request to; `stream()` is where an unknown route is
    // refused, and refusing it twice buys nothing.
    assert.deepEqual(adapter({}).providerInfo("ollama"), { id: "ollama", name: "ollama" });
  });

  it("lists only the pairs the matrix says run", async () => {
    const listed = await adapter({}).listModels("lm-studio");
    const ids = listed.map((model) => model.id);
    assert.equal(ids.includes("n5air/qwen3.8-27b"), true, "a runs pair is listed");
    assert.equal(
      ids.includes("qwen/qwen3.8-flash"),
      false,
      "an unverified pair is not offered beside one that is known good",
    );
    assert.equal(
      ids.includes("z-ai/glm-5.3-flash"),
      false,
      "a refused pair is not listed",
    );
  });

  it("carries the matrix's own reason as the description, and claims text only", async () => {
    const [first] = await adapter({}).listModels("llama-rocm");
    if (first === undefined) throw new Error("llama-rocm lists nothing");
    assert.equal(first.provider, "llama-rocm");
    assert.equal(typeof first.description, "string");
    assert.notEqual(first.description, "");
    assert.deepEqual(first.inputModalities, ["text"]);
  });

  it("lists nothing for a backend it does not serve", async () => {
    assert.deepEqual(await adapter({}).listModels("ollama"), []);
  });

  it("resolves a model as text-only, and claims nothing else about it", async () => {
    const resolved = await adapter({}).resolveModel("openrouter", "some/model");
    assert.deepEqual(resolved, {
      provider: "openrouter",
      id: "some/model",
      name: "some/model",
      inputModalities: ["text"],
    });
  });

  it("resolves a model with no placement row, because absence is not a refusal", async () => {
    const resolved = await adapter({}).resolveModel("lm-studio", "something/nobody-recorded");
    assert.equal(resolved.id, "something/nobody-recorded");
  });

  it("keeps its failure codes enumerable", () => {
    assert.equal(new Set(ADAPTER_FAILURE_CODES).size, ADAPTER_FAILURE_CODES.length);
  });

  it("asks for a credential only where the backend needs one", () => {
    assert.equal(CREDENTIAL_REF["lm-studio"], null);
    assert.equal(CREDENTIAL_REF["llama-rocm"], null);
    assert.equal(CREDENTIAL_REF.openrouter, "OPENROUTER_API_KEY");
  });

  it("reads a credential from the environment it is handed, and no other", () => {
    const read = envCredentials({ OPENROUTER_API_KEY: PLANTED_KEY });
    assert.equal(read("OPENROUTER_API_KEY"), PLANTED_KEY);
    assert.equal(read("SOMETHING_ELSE"), undefined);
  });
});

describe("refusing before the wire", () => {
  it("reports an abort that arrived before anything was sent", async () => {
    const controller = new AbortController();
    controller.abort();
    const chunks = await run(adapter({}), request({ signal: controller.signal }));
    const reported = failure(chunks);
    assert.equal(reported.kind, "aborted", "nothing went wrong; the caller changed its mind");
    assert.equal(reported.code, "ABORTED");
  });

  it("refuses a provider it does not serve", async () => {
    const chunks = await run(adapter({}), request({ provider: "ollama" }));
    assert.equal(failure(chunks).code, "UNKNOWN_PROVIDER");
  });

  it("refuses an unusable base URL without quoting it", async () => {
    const secretish = "http://user:sk-planted-canary-000111222333@host/v1";
    const chunks = await run(
      adapter({ overrides: { "lm-studio": secretish } }),
      request(),
    );
    const reported = failure(chunks);
    assert.equal(reported.code, "ENDPOINT_REFUSED");
    assert.equal(reported.message.includes("sk-planted-canary"), false);
    assert.match(reported.message, /lm-studio/);
  });

  it("refuses a pair the matrix refuses, and says why", async () => {
    const chunks = await run(
      adapter({}),
      request({ provider: "lm-studio", model: "z-ai/glm-5.3-flash" }),
    );
    const reported = failure(chunks);
    assert.equal(reported.code, "MODEL_REFUSED");
    assert.match(reported.message, /absent-from-build/);
  });

  it("dispatches a pair nobody has tried, because naming both is the probe", async () => {
    const wire = canned(reached(200, sse('{"choices":[{"delta":{},"finish_reason":"stop"}]}')));
    const chunks = await run(
      adapter({ transport: wire.transport }),
      request({ provider: "lm-studio", model: "qwen/qwen3.8-flash" }),
    );
    assert.equal(wire.sent.length, 1, "an unverified pair is dispatchable, just not advertised");
    assert.deepEqual(finish(chunks).reason, { kind: "stop" });
  });

  it("names the variable to set when a credentialed route has no credential", async () => {
    const chunks = await run(
      adapter({}),
      request({ provider: "openrouter", model: "x-ai/grok-4.5" }),
    );
    const reported = failure(chunks);
    assert.equal(reported.code, "MISSING_CREDENTIAL");
    assert.match(reported.message, /OPENROUTER_API_KEY/);
  });

  it("refuses a ceiling below the reasoning floor before opening a socket", async () => {
    const chunks = await run(adapter({}), request({ maxTokens: 1 }));
    assert.equal(failure(chunks).code, "BUDGET_FLOOR");
  });
});

describe("what came back", () => {
  it("binds the credential to one header and repeats it nowhere", async () => {
    const wire = canned(reached(200, sse('{"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}')));
    const chunks = await run(
      adapter({ transport: wire.transport, credential: PLANTED_KEY }),
      request({ provider: "openrouter", model: "x-ai/grok-4.5" }),
    );
    const [only] = wire.sent;
    assert.equal(only?.headers["authorization"], `Bearer ${PLANTED_KEY}`);
    assert.equal(
      JSON.stringify(chunks).includes("sk-planted-canary"),
      false,
      "the key reached a chunk",
    );
  });

  it("keeps the credential out of a failure message too", async () => {
    const wire = canned(reached(401, '{"error":{"message":"invalid key"}}'));
    const chunks = await run(
      adapter({ transport: wire.transport, credential: PLANTED_KEY }),
      request({ provider: "openrouter", model: "x-ai/grok-4.5" }),
    );
    const reported = failure(chunks);
    assert.equal(reported.code, "AUTH");
    assert.equal(reported.status, 401);
    assert.match(reported.message, /invalid key/);
    assert.equal(reported.message.includes("sk-planted-canary"), false);
  });

  it("names a throttle as a throttle, because its remedy is to wait", async () => {
    const wire = canned(reached(429, "{}"));
    const chunks = await run(
      adapter({ transport: wire.transport, credential: PLANTED_KEY }),
      request({ provider: "openrouter", model: "x-ai/grok-4.5" }),
    );
    assert.equal(failure(chunks).code, "RATE_LIMIT");
  });

  it("reports every other status as a provider error carrying the status", async () => {
    const wire = canned(reached(503, '{"error":{"message":"upstream is down"}}'));
    const reported = failure(await run(adapter({ transport: wire.transport })));
    assert.equal(reported.code, "PROVIDER_ERROR");
    assert.equal(reported.status, 503);
    assert.match(reported.message, /upstream is down/);
    assert.match(reported.message, /lm-studio/, "a failure names where it happened");
  });

  it("says plainly when an error body had nothing to quote", async () => {
    const wire = canned(reached(502, "<html>502 Bad Gateway</html>"));
    const reported = failure(await run(adapter({ transport: wire.transport })));
    assert.match(reported.message, /no error message to quote/);
  });

  it("stops reading an error body that never ends", async () => {
    // Without a bound this hangs the daemon on a hostile or broken server, and a hang is the one
    // failure nobody gets a message about.
    const wire = canned({ reached: true, status: 500, chunks: endless() });
    assert.equal(failure(await run(adapter({ transport: wire.transport }))).code, "PROVIDER_ERROR");
  });

  it("still reports the status when the error body itself fails halfway", async () => {
    const wire = canned({ reached: true, status: 500, chunks: truncated() });
    const reported = failure(await run(adapter({ transport: wire.transport })));
    assert.equal(reported.code, "PROVIDER_ERROR");
    assert.equal(reported.status, 500);
  });

  it("reports an endpoint that could not be reached, and says nothing was spent", async () => {
    const wire = canned({ reached: false, error: "fetch failed" });
    const reported = failure(await run(adapter({ transport: wire.transport })));
    assert.equal(reported.code, "TRANSPORT");
    assert.match(reported.message, /fetch failed/);
    assert.match(reported.message, /nothing was spent/);
  });

  it("reads an abort as an abort even when the transport reported a fault", async () => {
    const controller = new AbortController();
    const wire = canned(() => {
      controller.abort();
      return Promise.resolve({ reached: false, error: "The operation was aborted" } as const);
    });
    const chunks = await run(
      adapter({ transport: wire.transport }),
      request({ signal: controller.signal }),
    );
    assert.equal(failure(chunks).kind, "aborted");
  });

  it("catches a transport that throws, which the daemon's own never does", async () => {
    const chunks = await run(adapter({ transport: unreachable }));
    const reported = failure(chunks);
    assert.equal(reported.code, "TRANSPORT");
    assert.match(reported.message, /threw/);
  });

  it("translates a successful stream end to end", async () => {
    const wire = canned(
      reached(
        200,
        sse(
          '{"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}',
          '{"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
          '{"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}',
          "[DONE]",
        ),
      ),
    );
    const chunks = await run(adapter({ transport: wire.transport }));
    assert.deepEqual(
      chunks.map((chunk) => chunk.type),
      ["block-start", "text-delta", "text-delta", "block-end", "usage", "finish"],
    );
    assert.deepEqual(finish(chunks).reason, { kind: "stop" });
  });

  it("aims at the endpoint's completions route", async () => {
    const wire = canned(reached(200, sse('{"choices":[{"delta":{},"finish_reason":"stop"}]}')));
    await run(adapter({ transport: wire.transport }));
    assert.equal(wire.sent[0]?.url, "http://lm-studio:1234/v1/chat/completions");
  });

  it("honours a base-URL override that resolves", async () => {
    const wire = canned(reached(200, sse('{"choices":[{"delta":{},"finish_reason":"stop"}]}')));
    await run(adapter({ transport: wire.transport, overrides: { "lm-studio": "http://box:9/v1/" } }));
    assert.equal(wire.sent[0]?.url, "http://box:9/v1/chat/completions");
  });

  it("reports a body that stopped mid-flight rather than ending without a finish", async () => {
    async function* faulty(): AsyncIterable<string> {
      yield 'data: {"choices":[{"delta":{"content":"half"},"finish_reason":null}]}\n\n';
      throw new Error("socket reset");
    }
    const wire = canned({ reached: true, status: 200, chunks: faulty() });
    const reported = failure(await run(adapter({ transport: wire.transport })));
    assert.equal(reported.code, "STREAM_FAULT");
    assert.match(reported.message, /socket reset/);
  });

  it("reads a mid-response abort as an abort, not as a fault", async () => {
    const controller = new AbortController();
    async function* cut(): AsyncIterable<string> {
      yield 'data: {"choices":[{"delta":{"content":"half"},"finish_reason":null}]}\n\n';
      controller.abort();
      throw new Error("This operation was aborted");
    }
    const wire = canned({ reached: true, status: 200, chunks: cut() });
    const chunks = await run(
      adapter({ transport: wire.transport }),
      request({ signal: controller.signal }),
    );
    assert.equal(failure(chunks).kind, "aborted");
  });

  it("always ends with exactly one finish chunk", async () => {
    const wire = canned(reached(500, "{}"));
    const chunks = await run(adapter({ transport: wire.transport }));
    assert.equal(chunks.filter((chunk) => chunk.type === "finish").length, 1);
  });
});


it("lists only the supplied project's placements and detaches later caller mutation", async () => {
  const supplied = { backends: ["lm-studio"], entries: [{ model: "isolated-project-model", backend: "lm-studio", verdict: "runs", why: "synthetic" }] };
  const adapter = new LocalLlmAdapter({ placements: supplied, transport: async () => { throw new Error("catalog must not call transport"); } });
  supplied.entries[0]!.model = "mutated";
  assert.deepEqual((await adapter.listModels("lm-studio")).map(m => m.id), ["isolated-project-model"]);
  assert.deepEqual(await adapter.listModels("openrouter"), []);
  const empty = new LocalLlmAdapter({ placements: { backends: [], entries: [] }, transport: async () => { throw new Error("catalog must not call transport"); } });
  assert.deepEqual(await empty.listModels("lm-studio"), []);
});
