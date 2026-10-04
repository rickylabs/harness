/**
 * The twenty lines that open a socket, against a socket.
 *
 * Everything else in this directory is reachable with no server running, which is why the seam
 * exists. This file is the exception, and it uses a loopback `node:http` server rather than a stubbed
 * `fetch`: a stub would re-assert the shape of the response object this code already assumes, and
 * the two things actually worth proving — that a body arrives in pieces before the response ends, and
 * that a multi-byte character split across two writes survives — are properties of a real stream.
 *
 * Nothing here reaches beyond `127.0.0.1`, and every server is closed in the test that started it.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { fetchTransport } from "./transport.js";
import type { WireExchange, WireRequest } from "./transport.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

interface Loopback {
  readonly url: string;
  readonly close: () => Promise<void>;
}

async function loopback(handler: Handler): Promise<Loopback> {
  const server: Server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/chat/completions`,
    close: async (): Promise<void> => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

/** A port nobody is listening on: bound, observed, then released. */
async function closedPort(): Promise<string> {
  const server = await loopback(() => {});
  const { url } = server;
  await server.close();
  return url;
}

function request(url: string, overrides: Partial<WireRequest> = {}): WireRequest {
  return { url, headers: { "content-type": "application/json" }, body: "{}", ...overrides };
}

async function collect(exchange: WireExchange): Promise<string> {
  if (!exchange.reached) throw new Error(`the endpoint was not reached: ${exchange.error}`);
  const parts: string[] = [];
  for await (const chunk of exchange.chunks) parts.push(chunk);
  return parts.join("");
}

describe("the transport, against a real socket", () => {
  it("sends the method, headers and body it was given", async () => {
    let seen: { method?: string; auth?: string; body?: string } = {};
    const server = await loopback((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => {
        seen = {
          ...(incoming.method === undefined ? {} : { method: incoming.method }),
          ...(typeof incoming.headers.authorization === "string"
            ? { auth: incoming.headers.authorization }
            : {}),
          body: Buffer.concat(chunks).toString("utf8"),
        };
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end("ok");
      });
    });
    try {
      const exchange = await fetchTransport()(
        request(server.url, {
          headers: { "content-type": "application/json", authorization: "Bearer token" },
          body: '{"model":"m"}',
        }),
      );
      assert.equal(await collect(exchange), "ok");
      assert.equal(seen.method, "POST");
      assert.equal(seen.auth, "Bearer token");
      assert.equal(seen.body, '{"model":"m"}');
    } finally {
      await server.close();
    }
  });

  it("yields the first piece before the response has ended", { timeout: 10_000 }, async () => {
    // If this ever buffers the whole body, the server below never writes its second piece and the
    // test times out — which is the correct failure. A streaming adapter that only streams once the
    // provider is finished is indistinguishable from a slow one, and a great deal less useful.
    let arrived: () => void = () => {};
    const firstSeen = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const server = await loopback((incoming, response) => {
      incoming.resume();
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("first");
      void firstSeen.then(() => {
        response.end("second");
      });
    });
    try {
      const exchange = await fetchTransport()(request(server.url));
      if (!exchange.reached) throw new Error(exchange.error);
      const parts: string[] = [];
      for await (const chunk of exchange.chunks) {
        parts.push(chunk);
        arrived();
      }
      assert.equal(parts.join(""), "firstsecond");
    } finally {
      await server.close();
    }
  });

  it("decodes a character split across two writes", async () => {
    const server = await loopback((incoming, response) => {
      incoming.resume();
      response.writeHead(200, { "content-type": "text/event-stream" });
      // The euro sign is three bytes; the split is mid-character on purpose. Decoding each write in
      // isolation yields replacement characters, which is what a non-streaming decoder produces.
      response.write(Buffer.from([0xe2, 0x82]));
      setTimeout(() => response.end(Buffer.from([0xac])), 20);
    });
    try {
      assert.equal(await collect(await fetchTransport()(request(server.url))), "€");
    } finally {
      await server.close();
    }
  });

  it("reports a non-2xx as reached, with its status and its body", async () => {
    const server = await loopback((incoming, response) => {
      incoming.resume();
      response.writeHead(429, { "content-type": "application/json" });
      response.end('{"error":{"message":"slow down"}}');
    });
    try {
      const exchange = await fetchTransport()(request(server.url));
      assert.equal(exchange.reached, true);
      if (!exchange.reached) return;
      assert.equal(exchange.status, 429);
      assert.equal(await collect(exchange), '{"error":{"message":"slow down"}}');
    } finally {
      await server.close();
    }
  });

  it("reports a response with no body as reached and empty", async () => {
    const server = await loopback((incoming, response) => {
      incoming.resume();
      response.writeHead(204);
      response.end();
    });
    try {
      const exchange = await fetchTransport()(request(server.url));
      assert.equal(exchange.reached, true);
      if (!exchange.reached) return;
      assert.equal(exchange.status, 204);
      assert.equal(await collect(exchange), "");
    } finally {
      await server.close();
    }
  });

  it("reports a refused connection as a value, not a throw", async () => {
    const exchange = await fetchTransport()(request(await closedPort()));
    assert.equal(exchange.reached, false);
    if (exchange.reached) return;
    assert.equal(typeof exchange.error, "string");
    assert.notEqual(exchange.error, "");
  });

  it("carries no part of the request into the error it reports", async () => {
    // A transport fault message is a Node diagnostic. If it ever became "failed to POST <request>",
    // every bound credential would be one connection refusal away from a log.
    const exchange = await fetchTransport()(
      request(await closedPort(), {
        headers: { authorization: "Bearer sk-planted-canary-000111222333" },
      }),
    );
    assert.equal(exchange.reached, false);
    if (exchange.reached) return;
    assert.equal(exchange.error.includes("sk-planted-canary"), false);
  });

  it("reports an abort before the response as a value", async () => {
    const server = await loopback((incoming) => {
      incoming.resume();
      // Never answers. The caller's signal is the only thing that ends this.
    });
    const controller = new AbortController();
    try {
      const pending = fetchTransport()(request(server.url, { signal: controller.signal }));
      controller.abort();
      const exchange = await pending;
      assert.equal(exchange.reached, false);
    } finally {
      await server.close();
    }
  });

  it("hands a rejected fetch back as a fault rather than letting it escape", async () => {
    const exploding: typeof fetch = () => Promise.reject(new Error("boom"));
    const exchange = await fetchTransport(exploding)(request("http://127.0.0.1:1/"));
    assert.deepEqual(exchange, { reached: false, error: "boom" });
  });

  it("describes a thrown non-error without assuming it is one", async () => {
    const odd: typeof fetch = () => Promise.reject("just a string");
    const exchange = await fetchTransport(odd)(request("http://127.0.0.1:1/"));
    assert.deepEqual(exchange, { reached: false, error: "just a string" });
  });
});
