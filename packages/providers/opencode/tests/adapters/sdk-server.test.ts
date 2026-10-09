/**
 * The SDK adapter: every call through `@opencode-ai/sdk`, every reply turned into an outcome.
 *
 * The client is real; only `fetch` is fake. So these cases pin both halves of the seam — the
 * requests the SDK actually builds for this package, and the outcome each kind of reply becomes. The
 * outcomes are what decide `refused` against `unknown`, so a `4xx`, a `5xx`, a dropped connection and
 * an unreadable reply each have a case.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { baseUrlProblems, createSdkServer } from "../../src/adapters/sdk-server.js";
import { refutes, EXCERPT_LIMIT, type StreamOutcome } from "../../src/domain/outcome.js";
import {
  BASE_URL,
  eventChannel,
  json,
  record,
  respond,
  text,
  unreachable,
  type Recorded,
  type Reply,
} from "../support/fake-fetch.js";

/** A server port over a `fetch` that answers every request with `reply` and records it. */
function serverReplying(reply: () => Reply | Response, headers?: Record<string, string>) {
  const calls: Recorded[] = [];
  const fetch = (async (request: Request): Promise<Response> => {
    calls.push(await record(request));
    const next = reply();
    return next instanceof Response ? next : respond(next);
  }) as typeof globalThis.fetch;
  const server = createSdkServer({ baseUrl: BASE_URL, fetch, ...(headers === undefined ? {} : { headers }) });
  return { server, calls };
}

function opened(outcome: StreamOutcome): AsyncIterable<unknown> {
  if (outcome.kind !== "open") throw new Error(`expected an open stream, got: ${outcome.detail}`);
  return outcome.events;
}

describe("baseUrlProblems", () => {
  it("accepts an ordinary server url", () => {
    assert.deepEqual(baseUrlProblems(BASE_URL), []);
    assert.deepEqual(baseUrlProblems("https://opencode.example.invalid/opencode"), []);
  });

  it("refuses a host:port written without a scheme", () => {
    // The reason the check reads `protocol` rather than trusting the constructor: this string is a
    // perfectly valid URL whose scheme is the host, and every request built on it would reach nothing.
    assert.equal(new URL("opencode-host:1").protocol, "opencode-host:");
    assert.equal(new URL("opencode-host:1").hostname, "");
    // Both problems, not the first one: the port looked like a host and the scheme looked like one
    // too, and a configuration error is cheaper to fix when the message names everything wrong.
    const problems = baseUrlProblems("opencode-host:1");
    assert.equal(problems.length, 2);
    assert.match(problems.join(" "), /parses as a url and reaches nothing/);
    assert.match(problems.join(" "), /names no host/);
  });

  it("refuses an empty url and a non-url", () => {
    assert.deepEqual(baseUrlProblems("   "), ["the server url is empty"]);
    assert.equal(baseUrlProblems("http://").length, 1);
  });
});

describe("the requests the SDK builds", () => {
  it("creates a session with the title and nothing else, and reads the reply", async () => {
    const { server, calls } = serverReplying(() => json(200, { id: "ses_1" }));
    assert.deepEqual(await server.createSession("harness r1"), { kind: "ok", status: 200, body: { id: "ses_1" } });
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.path, "/session");
    assert.deepEqual(calls[0]?.body, { title: "harness r1" });
  });

  it("prompts asynchronously with the model and one text part, and no agent unless asked", async () => {
    const { server, calls } = serverReplying(() => ({ status: 204 }));
    const model = { providerID: "openrouter", modelID: "z-ai/glm-5.2" };
    const outcome = await server.prompt("ses_1", { model, parts: [{ type: "text", text: "do it" }] });
    assert.equal(outcome.kind, "ok");
    assert.equal(calls[0]?.path, "/session/ses_1/prompt_async");
    assert.deepEqual(calls[0]?.body, { model, parts: [{ type: "text", text: "do it" }] });

    await server.prompt("ses_1", { model, parts: [{ type: "text", text: "x" }], agent: "build" });
    assert.equal((calls[1]?.body as { agent?: string }).agent, "build");
  });

  it("escapes a session id, because the server chooses it and a path is built out of it", async () => {
    // Unescaped, an abort of session `a/b` would be a request to somewhere else entirely, which a
    // server may well answer.
    const { server, calls } = serverReplying(() => json(200, true));
    await server.abort("a/b");
    assert.equal(calls[0]?.path, "/session/a%2Fb/abort");
  });

  it("aborts and deletes by session, and passes the bare boolean back", async () => {
    const { server, calls } = serverReplying(() => json(200, false));
    assert.deepEqual(await server.abort("ses_1"), { kind: "ok", status: 200, body: false });
    await server.remove("ses_1");
    assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
      "POST /session/ses_1/abort",
      "DELETE /session/ses_1",
    ]);
  });

  it("adds the configured headers to every request", async () => {
    const { server, calls } = serverReplying(() => json(200, true), { "x-proxy": "yes" });
    await server.abort("ses_1");
    assert.equal(calls[0]?.headers.get("x-proxy"), "yes");
  });
});

describe("the outcome each reply becomes", () => {
  it("treats an empty 204 as a successful answer", async () => {
    const { server } = serverReplying(() => ({ status: 204 }));
    assert.equal((await server.abort("ses_1")).kind, "ok");
  });

  it("reports a 4xx as a refutation, with an excerpt rather than the body", async () => {
    const { server } = serverReplying(() => json(422, { error: "y".repeat(500) }));
    const outcome = await server.createSession("t");
    assert.equal(outcome.kind, "http");
    assert.equal(refutes(outcome), true);
    if (outcome.kind !== "http") throw new Error("expected http");
    assert.equal(outcome.status, 422);
    assert.ok(outcome.detail.length <= EXCERPT_LIMIT + 1);
  });

  it("carries a 504 through as an http outcome that refutes nothing", async () => {
    const { server } = serverReplying(() => text(504, "upstream took too long"));
    const outcome = await server.prompt("ses_1", { model: { providerID: "p", modelID: "m" }, parts: [] });
    // Both halves matter. It is an `http` outcome, so the status survives into the detail a human
    // reads; and it refutes nothing, so no verb downstream may call it `refused`.
    assert.deepEqual(outcome, { kind: "http", status: 504, detail: "upstream took too long" });
    assert.equal(refutes(outcome), false);
  });

  it("reports a rejected fetch as unreachable", async () => {
    const { server } = serverReplying(() => unreachable("ECONNREFUSED"));
    const outcome = await server.abort("ses_1");
    assert.deepEqual(outcome, { kind: "unreachable", detail: "ECONNREFUSED" });
    assert.equal(refutes(outcome), false);
  });

  it("reports a json reply that does not parse as malformed, not as a failure to reach", async () => {
    const { server } = serverReplying(() => ({ status: 200, text: "not json", contentType: "application/json" }));
    const outcome = await server.abort("ses_1");
    assert.equal(outcome.kind, "malformed");
    assert.equal(refutes(outcome), false);
  });

  it("reports an html page where an api was expected as malformed", async () => {
    const { server } = serverReplying(() => ({ status: 200, text: "<html>hello</html>", contentType: "text/html" }));
    assert.equal((await server.abort("ses_1")).kind, "malformed");
  });
});

describe("the event stream", () => {
  it("opens on the server's greeting and yields every event after it, parsed", async () => {
    const channel = eventChannel();
    const { server, calls } = serverReplying(() => channel.response);
    const events = opened(await server.events(new AbortController().signal));
    channel.send({ type: "session.idle", properties: { sessionID: "ses_1" } });
    channel.close();
    const seen: unknown[] = [];
    for await (const event of events) seen.push(event);
    assert.deepEqual(seen, [
      { type: "server.connected", properties: {} },
      { type: "session.idle", properties: { sessionID: "ses_1" } },
    ]);
    assert.equal(calls[0]?.path, "/event");
  });

  it("carries a multi-byte character split across two chunks", async () => {
    // A socket splits wherever it likes, including through the middle of a character; a decoder that
    // did not carry the partial byte would cost the event its JSON.
    const channel = eventChannel();
    const { server } = serverReplying(() => channel.response);
    const events = opened(await server.events(new AbortController().signal));
    const bytes = new TextEncoder().encode('data: {"type":"x","properties":{"t":"é"}}\n\n');
    const cut = bytes.indexOf(0xc3) + 1;
    channel.raw(bytes.slice(0, cut));
    channel.raw(bytes.slice(cut));
    channel.close();
    const seen: unknown[] = [];
    for await (const event of events) seen.push(event);
    assert.deepEqual(seen[1], { type: "x", properties: { t: "é" } });
  });

  it("reports an error status as closed, and tries once rather than retrying forever", async () => {
    const { server, calls } = serverReplying(() => ({ status: 503 }));
    const outcome = await server.events(new AbortController().signal);
    assert.equal(outcome.kind, "closed");
    if (outcome.kind !== "closed") throw new Error("expected closed");
    assert.match(outcome.detail, /503/);
    assert.equal(calls.length, 1);
  });

  it("reports a rejected fetch as closed, with the reason", async () => {
    const { server } = serverReplying(() => unreachable("no route to host"));
    assert.deepEqual(await server.events(new AbortController().signal), { kind: "closed", detail: "no route to host" });
  });

  it("keeps a connection that breaks mid-stream distinct from one that ends", async () => {
    const channel = eventChannel();
    const { server } = serverReplying(() => channel.response);
    const events = opened(await server.events(new AbortController().signal));
    channel.fail(new Error("connection reset"));
    await assert.rejects(async () => {
      for await (const event of events) void event;
    }, /connection reset/);
  });
});
