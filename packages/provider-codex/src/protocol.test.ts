import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRouteVerified, isSafeToRetry } from "@rickylabs/subagents";

import {
  startVerifiedCodexTurn,
  type CodexJsonRpcRequest,
  type CodexProtocolPort,
  type CodexStartRequest,
} from "./protocol.js";

const REQUEST: CodexStartRequest = {
  runId: "run-1",
  registrationId: "codex-app-server",
  modelProvider: "openai",
  model: "gpt-test",
  effort: "medium",
  cwd: "/work/repo",
  input: "Do the bounded task.",
};

const OBSERVED_KEYS = {
  provider: "modelProvider",
  model: "model",
  effort: "reasoningEffort",
  cwd: "cwd",
} as const;

function threadResponse(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    result: {
      thread: { id: "thread-1" },
      modelProvider: "openai",
      model: "gpt-test",
      reasoningEffort: "medium",
      cwd: "/work/repo",
      ...overrides,
    },
  };
}

function turnResponse(id: string, turnId: unknown = "turn-1"): Record<string, unknown> {
  return { id, result: { turn: { id: turnId } } };
}

const threadReply = (overrides: Record<string, unknown> = {}) =>
  (request: CodexJsonRpcRequest): unknown => threadResponse(request.id, overrides);

const turnReply = (turnId: unknown = "turn-1") =>
  (request: CodexJsonRpcRequest): unknown => turnResponse(request.id, turnId);

class QueuePort implements CodexProtocolPort {
  readonly requests: CodexJsonRpcRequest[] = [];
  readonly #responses: (unknown | ((request: CodexJsonRpcRequest) => unknown))[];

  constructor(...responses: (unknown | ((request: CodexJsonRpcRequest) => unknown))[]) {
    this.#responses = responses;
  }

  async request(request: CodexJsonRpcRequest): Promise<unknown> {
    this.requests.push(request);
    const response = this.#responses.shift();
    if (response instanceof Error) throw response;
    return typeof response === "function" ? response(request) : response;
  }
}

describe("startVerifiedCodexTurn", () => {
  it("returns acknowledged thread and turn ids with mandatory verified evidence", async () => {
    const port = new QueuePort(threadReply(), turnReply());
    const result = await startVerifiedCodexTurn(port, REQUEST);

    assert.deepEqual(result.run, {
      runId: "run-1",
      provider: "codex-app-server",
      external: "thread-1",
    });
    assert.equal(result.verdict, "accepted");
    assert.equal(result.turnId, "turn-1");
    assert.equal(result.route?.status, "known");
    assert.equal(isRouteVerified(result), true);
    assert.equal(port.requests.length, 2);
    assert.deepEqual(port.requests[0], {
      id: port.requests[0]?.id,
      method: "thread/start",
      params: {
        modelProvider: "openai",
        model: "gpt-test",
        cwd: "/work/repo",
        config: { model_reasoning_effort: "medium" },
      },
    });
    assert.deepEqual(port.requests[1], {
      id: port.requests[1]?.id,
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [{ type: "text", text: "Do the bounded task.", textElements: [] }],
      },
    });
    assert.equal("model" in (port.requests[1]?.params ?? {}), false);
    assert.equal("effort" in (port.requests[1]?.params ?? {}), false);
    assert.equal("cwd" in (port.requests[1]?.params ?? {}), false);
  });

  for (const [field, value] of [
    ["provider", "other-provider"],
    ["model", "other-model"],
    ["effort", "high"],
    ["cwd", "/work/other"],
  ] as const) {
    it(`refuses a complete ${field} mismatch before useful input`, async () => {
      const port = new QueuePort(
        threadReply({ [OBSERVED_KEYS[field]]: value }),
      );
      const result = await startVerifiedCodexTurn(port, REQUEST);
      assert.equal(result.verdict, "refused");
      assert.equal(result.run?.external, "thread-1");
      assert.equal(result.route?.status, "mismatch");
      assert.deepEqual(result.route?.mismatches, [field]);
      assert.equal(port.requests.filter(({ method }) => method === "turn/start").length, 0);
      assert.equal(isSafeToRetry(result), true);
      assert.match(result.detail, /correct the requested route or server configuration before retry/);
      assert.match(result.detail, /unchanged settings may produce the same refusal/);
      assert.match(result.detail, /nothing useful was sent/);
    });
  }

  for (const field of Object.keys(OBSERVED_KEYS) as (keyof typeof OBSERVED_KEYS)[]) {
    for (const [label, value] of [
      ["missing", undefined],
      ["null", null],
      ["empty", ""],
      ["blank", "  "],
      ["wrong type", 42],
    ] as const) {
      it(`keeps ${label} response ${field} unknown and sends no turn`, async () => {
        const port = new QueuePort((request: CodexJsonRpcRequest) => {
          const raw = threadResponse(request.id);
          const resultBody = raw.result as Record<string, unknown>;
          if (label === "missing") delete resultBody[OBSERVED_KEYS[field]];
          else resultBody[OBSERVED_KEYS[field]] = value;
          return raw;
        });
        const result = await startVerifiedCodexTurn(port, REQUEST);
        assert.equal(result.verdict, "unknown");
        assert.equal(result.route?.status, "unknown");
        assert.equal(port.requests.filter(({ method }) => method === "turn/start").length, 0);
        assert.equal(isSafeToRetry(result), false);
      });
    }
  }

  for (const [label, raw] of [
    ["unreadable response", "not an object"],
    ["wrong response id", threadResponse("other-request")],
    ["error response", (request: CodexJsonRpcRequest) => ({ id: request.id, error: { message: "sensitive detail" } })],
    ["renamed version-skewed keys", (request: CodexJsonRpcRequest) => ({
      id: request.id,
      result: {
        thread: { id: "thread-1" },
        providerName: "openai",
        modelName: "gpt-test",
        effortName: "medium",
        workingDirectory: "/work/repo",
      },
    })],
    ["request echo without response keys", (request: CodexJsonRpcRequest) => ({
      id: request.id,
      result: {
        thread: { id: "thread-1" },
        params: {
          modelProvider: "openai",
          model: "gpt-test",
          cwd: "/work/repo",
          config: { model_reasoning_effort: "medium" },
        },
      },
    })],
  ] as const) {
    it(`fails safely for ${label}`, async () => {
      const port = new QueuePort(raw);
      const result = await startVerifiedCodexTurn(port, REQUEST);
      assert.equal(result.verdict, "unknown");
      assert.equal(port.requests.filter(({ method }) => method === "turn/start").length, 0);
      assert.equal(isSafeToRetry(result), false);
      assert.doesNotMatch(result.detail, /sensitive detail/);
    });
  }

  it("reads effort from result.reasoningEffort rather than request config", async () => {
    const port = new QueuePort(threadReply({ reasoningEffort: "low" }));
    const result = await startVerifiedCodexTurn(port, REQUEST);
    assert.equal(result.verdict, "refused");
    assert.deepEqual(result.route?.mismatches, ["effort"]);
    assert.match(result.detail, /thread\/start\.result\.reasoningEffort/);
    assert.equal(port.requests.length, 1);
  });

  it("keeps a known difference and an invalid field in an unknown result", async () => {
    const port = new QueuePort(threadReply({
      modelProvider: "other-provider",
      reasoningEffort: null,
    }));
    const result = await startVerifiedCodexTurn(port, REQUEST);
    assert.equal(result.verdict, "unknown");
    assert.deepEqual(result.route?.mismatches, ["provider"]);
    assert.deepEqual(result.route?.invalid, [{ side: "observed", field: "effort" }]);
    assert.match(result.detail, /invalid observed effort/);
    assert.match(result.detail, /other-provider/);
    assert.equal(port.requests.length, 1);
  });

  it("does not send anything for a relative requested cwd", async () => {
    const port = new QueuePort();
    const result = await startVerifiedCodexTurn(port, { ...REQUEST, cwd: "work/repo" });
    assert.equal(result.verdict, "unknown");
    assert.equal(result.route?.status, "unknown");
    assert.deepEqual(port.requests, []);
  });

  it("snapshots requested route values before awaiting the port", async () => {
    let resolveThread: (value: unknown) => void = () => {};
    const requests: CodexJsonRpcRequest[] = [];
    const port: CodexProtocolPort = {
      request: async (request) => {
        requests.push(request);
        if (request.method === "turn/start") return turnResponse(request.id);
        return await new Promise((resolve) => {
          resolveThread = resolve;
        });
      },
    };
    const mutable = { ...REQUEST };
    const pending = startVerifiedCodexTurn(port, mutable);
    mutable.model = "mutated-after-send";
    mutable.effort = "high";
    mutable.cwd = "/mutated";
    resolveThread(threadResponse(requests[0]?.id ?? ""));
    const result = await pending;
    assert.equal(result.verdict, "accepted");
    assert.equal(result.route?.requested.model.value, "gpt-test");
    assert.equal(result.route?.requested.effort.value, "medium");
    assert.equal(result.route?.requested.cwd.value, "/work/repo");
    assert.equal(requests[0]?.params.model, "gpt-test");
  });

  it("mints independent ids and rejects concurrent cross-delivery", async () => {
    const requests: CodexJsonRpcRequest[] = [];
    let firstResolve: (value: unknown) => void = () => {};
    let secondResolve: (value: unknown) => void = () => {};
    const port: CodexProtocolPort = {
      request: async (request) => {
        requests.push(request);
        return await new Promise((resolve) => {
          if (requests.length === 1) firstResolve = resolve;
          else secondResolve = resolve;
        });
      },
    };
    const first = startVerifiedCodexTurn(port, { ...REQUEST, runId: "run-a" });
    const second = startVerifiedCodexTurn(port, { ...REQUEST, runId: "run-b" });
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0]?.id, requests[1]?.id);
    firstResolve(threadResponse(requests[1]?.id ?? ""));
    secondResolve(threadResponse(requests[0]?.id ?? ""));
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map(({ verdict }) => verdict), ["unknown", "unknown"]);
    assert.equal(requests.filter(({ method }) => method === "turn/start").length, 0);
  });

  it("makes a missing thread id unknown even when route fields match", async () => {
    const port = new QueuePort(threadReply({ thread: { id: "" } }));
    const result = await startVerifiedCodexTurn(port, REQUEST);
    assert.equal(result.verdict, "unknown");
    assert.equal(result.route?.status, "unknown");
    assert.doesNotMatch(result.detail, /route verified/);
    assert.equal(port.requests.length, 1);
  });

  it("turns an unreadable thread response accessor into unknown", async () => {
    const raw = new Proxy({}, { get: () => { throw new Error("private getter detail"); } });
    const port = new QueuePort(raw);
    const result = await startVerifiedCodexTurn(port, REQUEST);
    assert.equal(result.verdict, "unknown");
    assert.equal(port.requests.length, 1);
    assert.doesNotMatch(result.detail, /private getter detail/);
  });

  it("turns an unreadable turn response accessor into post-send unknown", async () => {
    const raw = new Proxy({}, { get: () => { throw new Error("private getter detail"); } });
    const port = new QueuePort(threadReply(), raw);
    const result = await startVerifiedCodexTurn(port, REQUEST);
    assert.equal(result.verdict, "unknown");
    assert.equal(port.requests.length, 2);
    assert.equal(result.run?.external, "thread-1");
    assert.doesNotMatch(result.detail, /private getter detail/);
  });

  for (const [label, turnOutcome] of [
    ["wrong id", turnResponse("other-turn")],
    ["error", (request: CodexJsonRpcRequest) => ({ id: request.id, error: { message: "private raw error" } })],
    ["malformed body", (request: CodexJsonRpcRequest) => ({ id: request.id, result: {} })],
    ["empty turn id", turnReply("")],
    ["wrong-type turn id", turnReply(7)],
    ["port rejection", new Error("private rejection")],
  ] as const) {
    it(`keeps a post-send ${label} unknown and non-retryable`, async () => {
      const port = new QueuePort(threadReply(), turnOutcome);
      const result = await startVerifiedCodexTurn(port, REQUEST);
      assert.equal(result.verdict, "unknown");
      assert.equal(result.turnId, null);
      assert.equal(port.requests.filter(({ method }) => method === "turn/start").length, 1);
      assert.equal(isSafeToRetry(result), false);
      assert.doesNotMatch(result.detail, /private raw error|private rejection/);
    });
  }
});
