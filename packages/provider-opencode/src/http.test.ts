/**
 * The transport, and the four outcomes it has to keep apart.
 *
 * The split these tests exist for is `answered`. A `409` and a dropped connection are the same
 * JavaScript event and opposite facts, and everything downstream — whether a dispatch is `refused`
 * or `unknown`, and therefore whether `isSafeToRetry` licenses a second agent onto a branch — is
 * decided by which of the two this file produces.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  answered,
  baseUrlProblems,
  createTransport,
  describeOutcome,
  excerpt,
  joinUrl,
  EXCERPT_LIMIT,
  type FetchFn,
  type FetchInit,
  type FetchResponse,
} from "./http.js";

interface Call {
  readonly url: string;
  readonly init: FetchInit;
}

interface Fake {
  readonly fetch: FetchFn;
  readonly calls: Call[];
}

/** A `fetch` that answers with whatever the test says, and records what it was asked. */
function fakeFetch(reply: (url: string, init: FetchInit) => Promise<FetchResponse>): Fake {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return await reply(url, init);
    },
  };
}

function replying(status: number, text: string): FetchResponse {
  return { status, text: async () => text };
}

describe("baseUrlProblems", () => {
  it("accepts an ordinary server url", () => {
    assert.deepEqual(baseUrlProblems("http://127.0.0.1:4096"), []);
    assert.deepEqual(baseUrlProblems("https://n5.example/opencode"), []);
  });

  it("refuses a host:port written without a scheme", () => {
    // The reason the check reads `protocol` rather than trusting the constructor: this string is a
    // perfectly valid URL with scheme `n5:`, and every request built on it would reach nothing.
    assert.equal(new URL("n5:4096").protocol, "n5:");
    assert.equal(new URL("n5:4096").hostname, "");
    // Both problems, not the first one: the port looked like a host and the scheme looked like one
    // too, and a configuration error is cheaper to fix when the message names everything wrong.
    const problems = baseUrlProblems("n5:4096");
    assert.equal(problems.length, 2);
    assert.match(problems.join(" "), /parses as a url and reaches nothing/);
    assert.match(problems.join(" "), /names no host/);
  });

  it("refuses an empty url and a non-url", () => {
    assert.deepEqual(baseUrlProblems("   "), ["the server url is empty"]);
    assert.equal(baseUrlProblems("http://").length, 1);
  });
});

describe("joinUrl", () => {
  it("does not double or drop the separator", () => {
    assert.equal(joinUrl("http://h:1", "/session"), "http://h:1/session");
    assert.equal(joinUrl("http://h:1/", "/session"), "http://h:1/session");
    assert.equal(joinUrl("http://h:1///", "/session"), "http://h:1/session");
    assert.equal(joinUrl("http://h:1", "session"), "http://h:1/session");
  });
});

describe("excerpt", () => {
  it("collapses whitespace and names an empty body", () => {
    assert.equal(excerpt("  a\n\n b  "), "a b");
    assert.equal(excerpt("   "), "(empty body)");
  });

  it("truncates rather than dumping a body", () => {
    const long = excerpt("x".repeat(EXCERPT_LIMIT * 3));
    assert.equal(long.length, EXCERPT_LIMIT + 1);
    assert.ok(long.endsWith("…"));
  });
});

describe("answered", () => {
  it("is true only when the server said something we could read", () => {
    assert.equal(answered({ kind: "ok", status: 200, body: null }), true);
    assert.equal(answered({ kind: "http", status: 409, detail: "busy" }), true);
    // Deliberate: the server responded, but what it said is unreadable, and "it did something and we
    // do not know what" is exactly what `unknown` is for.
    assert.equal(answered({ kind: "malformed", detail: "not json" }), false);
    assert.equal(answered({ kind: "unreachable", detail: "ECONNREFUSED" }), false);
  });
});

describe("describeOutcome", () => {
  it("gives every outcome a sentence", () => {
    assert.equal(describeOutcome({ kind: "ok", status: 204, body: null }), "HTTP 204");
    assert.match(describeOutcome({ kind: "http", status: 500, detail: "boom" }), /HTTP 500: boom/);
    assert.match(describeOutcome({ kind: "malformed", detail: "x" }), /could not read/);
    assert.match(describeOutcome({ kind: "unreachable", detail: "x" }), /could not be reached/);
  });
});

describe("createTransport http", () => {
  it("sends json and parses a json reply", async () => {
    const fake = fakeFetch(async () => replying(200, JSON.stringify({ id: "ses_1" })));
    const { http } = createTransport({ baseUrl: "http://h:1", fetch: fake.fetch });

    const outcome = await http({ method: "POST", path: "/session", body: { title: "t" } });

    assert.deepEqual(outcome, { kind: "ok", status: 200, body: { id: "ses_1" } });
    const call = fake.calls[0];
    if (call === undefined) throw new Error("no call recorded");
    assert.equal(call.url, "http://h:1/session");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.body, '{"title":"t"}');
    assert.equal(call.init.headers?.["content-type"], "application/json");
  });

  it("sends no body and no content type when there is nothing to send", async () => {
    const fake = fakeFetch(async () => replying(200, "true"));
    const { http } = createTransport({ baseUrl: "http://h:1", fetch: fake.fetch });

    const outcome = await http({ method: "POST", path: "/session/a/abort" });

    assert.deepEqual(outcome, { kind: "ok", status: 200, body: true });
    const call = fake.calls[0];
    if (call === undefined) throw new Error("no call recorded");
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.headers?.["content-type"], undefined);
  });

  it("treats an empty body as a successful answer, because 204 is one", async () => {
    const fake = fakeFetch(async () => replying(204, ""));
    const { http } = createTransport({ baseUrl: "http://h:1", fetch: fake.fetch });

    assert.deepEqual(await http({ method: "POST", path: "/p" }), {
      kind: "ok",
      status: 204,
      body: null,
    });
  });

  it("adds the configured headers to every request", async () => {
    const fake = fakeFetch(async () => replying(200, "true"));
    const { http } = createTransport({
      baseUrl: "http://h:1",
      fetch: fake.fetch,
      headers: { "x-proxy": "yes" },
    });

    await http({ method: "GET", path: "/global/health" });

    assert.equal(fake.calls[0]?.init.headers?.["x-proxy"], "yes");
  });

  it("reports a 4xx as answered, with an excerpt rather than the body", async () => {
    const fake = fakeFetch(async () => replying(422, `{"error":"${"y".repeat(500)}"}`));
    const { http } = createTransport({ baseUrl: "http://h:1", fetch: fake.fetch });

    const outcome = await http({ method: "POST", path: "/p", body: {} });

    assert.equal(outcome.kind, "http");
    assert.equal(answered(outcome), true);
    if (outcome.kind !== "http") throw new Error("expected http");
    assert.equal(outcome.status, 422);
    assert.ok(outcome.detail.length <= EXCERPT_LIMIT + 1);
  });

  it("reports a thrown fetch as unreachable", async () => {
    const fake = fakeFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const { http } = createTransport({ baseUrl: "http://h:1", fetch: fake.fetch });

    const outcome = await http({ method: "POST", path: "/p" });

    assert.deepEqual(outcome, { kind: "unreachable", detail: "ECONNREFUSED" });
    assert.equal(answered(outcome), false);
  });

  it("reports an unreadable body as malformed, not as a failure to reach", async () => {
    const { http } = createTransport({
      baseUrl: "http://h:1",
      fetch: async () => ({
        status: 200,
        text: async () => {
          throw new Error("stream closed");
        },
      }),
    });

    const outcome = await http({ method: "GET", path: "/x" });

    assert.equal(outcome.kind, "malformed");
    assert.equal(answered(outcome), false);
  });

  it("reports a non-json 200 as malformed", async () => {
    const fake = fakeFetch(async () => replying(200, "<html>hello</html>"));
    const { http } = createTransport({ baseUrl: "http://h:1", fetch: fake.fetch });

    const outcome = await http({ method: "GET", path: "/x" });

    assert.equal(outcome.kind, "malformed");
  });
});

describe("createTransport stream", () => {
  async function* bytes(chunks: readonly string[]): AsyncIterable<Uint8Array> {
    const encoder = new TextEncoder();
    for (const chunk of chunks) yield encoder.encode(chunk);
  }

  async function collect(source: AsyncIterable<string>): Promise<string[]> {
    const out: string[] = [];
    for await (const chunk of source) out.push(chunk);
    return out;
  }

  it("decodes bytes to text and asks for an event stream", async () => {
    const fake = fakeFetch(async () => ({
      status: 200,
      text: async () => "",
      body: bytes(["data: a\n", "\n"]),
    }));
    const { stream } = createTransport({ baseUrl: "http://h:1", fetch: fake.fetch });

    const outcome = await stream({ path: "/event", signal: new AbortController().signal });

    assert.equal(outcome.kind, "open");
    if (outcome.kind !== "open") throw new Error("expected open");
    assert.deepEqual(await collect(outcome.chunks), ["data: a\n", "\n"]);
    assert.equal(fake.calls[0]?.init.headers?.["accept"], "text/event-stream");
  });

  it("carries a multi-byte character across a chunk boundary", async () => {
    // A real socket splits wherever it likes, including through the middle of a character. A decoder
    // without `{ stream: true }` turns that into a replacement character in the middle of a JSON
    // payload, which then fails to parse and silently costs an event.
    const encoded = new TextEncoder().encode("é");
    const first = encoded.slice(0, 1);
    const second = encoded.slice(1);
    async function* split(): AsyncIterable<Uint8Array> {
      yield first;
      yield second;
    }
    const { stream } = createTransport({
      baseUrl: "http://h:1",
      fetch: async () => ({ status: 200, text: async () => "", body: split() }),
    });

    const outcome = await stream({ path: "/event", signal: new AbortController().signal });
    if (outcome.kind !== "open") throw new Error("expected open");

    assert.equal((await collect(outcome.chunks)).join(""), "é");
  });

  it("reports an error status without opening", async () => {
    const { stream } = createTransport({
      baseUrl: "http://h:1",
      fetch: async () => replying(503, "down"),
    });

    const outcome = await stream({ path: "/event", signal: new AbortController().signal });

    assert.equal(outcome.kind, "http");
  });

  it("refuses to pretend a body it cannot iterate is an empty stream", async () => {
    const { stream } = createTransport({
      baseUrl: "http://h:1",
      fetch: async () => ({ status: 200, text: async () => "", body: { not: "iterable" } }),
    });

    const outcome = await stream({ path: "/event", signal: new AbortController().signal });

    assert.equal(outcome.kind, "unreachable");
    if (outcome.kind !== "unreachable") throw new Error("expected unreachable");
    assert.match(outcome.detail, /cannot be iterated/);
  });

  it("reports a thrown fetch as unreachable", async () => {
    const { stream } = createTransport({
      baseUrl: "http://h:1",
      fetch: async () => {
        throw new Error("no route to host");
      },
    });

    const outcome = await stream({ path: "/event", signal: new AbortController().signal });

    assert.deepEqual(outcome, { kind: "unreachable", detail: "no route to host" });
  });
});
