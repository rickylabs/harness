import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BACKENDS, backendRecord } from "./backends.js";
import {
  ENDPOINT_REFUSALS,
  type Endpoint,
  completionsUrl,
  describeEndpoint,
  describeEndpointRefusal,
  modelsUrl,
  readinessRequest,
  resolveEndpoint,
} from "./endpoint.js";

/** The marker planted in every hostile override, so a leak is unmistakable in a diff. */
const SECRET = "sk-or-v1-planted";

function endpointOf(backend: string, override?: string | null): Endpoint {
  const verdict = resolveEndpoint(backend, override);
  if (!verdict.ok) {
    throw new Error(`expected an endpoint, got ${verdict.reason}`);
  }
  return verdict.endpoint;
}

function refusal(backend: string, override: string): { reason: string; message: string } {
  const verdict = resolveEndpoint(backend, override);
  if (verdict.ok) {
    throw new Error("expected a refusal");
  }
  return { reason: verdict.reason, message: verdict.message };
}

describe("resolveEndpoint — the table default", () => {
  it("resolves every backend the package describes", () => {
    for (const backend of BACKENDS) {
      const endpoint = endpointOf(backend);
      assert.equal(endpoint.backend, backend);
      assert.equal(endpoint.source, "default");
      assert.equal(endpoint.api, "openai-completions");
    }
  });

  it("carries the record's own credential requirement, rather than restating it", () => {
    for (const backend of BACKENDS) {
      const record = backendRecord(backend);
      if (record === null) throw new Error("unreachable");
      assert.equal(endpointOf(backend).credentialed, record.credentialed);
    }
  });

  it("treats an absent, null or blank override as no override at all", () => {
    // An unset environment variable reads as the empty string. A daemon that refuses to boot over
    // `LLM_BASE_URL=` in a compose file has refused the wrong thing.
    for (const override of [undefined, null, "", "   ", "\t\n"]) {
      const endpoint = endpointOf("lm-studio", override);
      assert.equal(endpoint.source, "default", JSON.stringify(override));
      assert.equal(endpoint.baseUrl, "http://lm-studio:1234/v1");
    }
  });

  it("names every known backend when it does not know one", () => {
    const { reason, message } = refusal("lmstudio", "http://host/v1");
    assert.equal(reason, "unknown-backend");
    for (const backend of BACKENDS) {
      assert.ok(message.includes(backend), backend);
    }
  });
});

describe("resolveEndpoint — an override from a deployment", () => {
  it("keeps scheme, host, port and path, and drops the trailing slash", () => {
    const endpoint = endpointOf("llama-rocm", "http://10.0.0.4:8081/v1/");
    assert.equal(endpoint.baseUrl, "http://10.0.0.4:8081/v1");
    assert.equal(endpoint.source, "override");
  });

  it("leaves a bare origin bare", () => {
    assert.equal(endpointOf("lm-studio", "http://box/").baseUrl, "http://box");
    assert.equal(endpointOf("lm-studio", "http://box").baseUrl, "http://box");
  });

  it("accepts https", () => {
    assert.equal(
      endpointOf("openrouter", "https://relay.example/api/v1").baseUrl,
      "https://relay.example/api/v1",
    );
  });

  it("refuses text that is not a URL", () => {
    assert.equal(refusal("lm-studio", "//host/v1").reason, "unparseable");
    assert.equal(refusal("lm-studio", "http://").reason, "unparseable");
  });

  it("refuses a scheme nothing here can send over, and names it", () => {
    const { reason, message } = refusal("lm-studio", "ftp://host/v1");
    assert.equal(reason, "not-http");
    assert.ok(message.includes("ftp"));
  });

  it("lands a host:port with no scheme in the same refusal, and says how to fix it", () => {
    // `new URL` reads `lm-studio:1234` as the scheme `lm-studio:`. The remedy is the same one the
    // message gives, so this is the right refusal even though the parse succeeded.
    const { reason, message } = refusal("lm-studio", "lm-studio:1234");
    assert.equal(reason, "not-http");
    assert.ok(message.includes("http://"));
  });

  it("refuses a URL carrying credential material", () => {
    assert.equal(refusal("openrouter", `https://${SECRET}@relay.example/v1`).reason, "credentials-in-url");
    assert.equal(
      refusal("openrouter", `https://user:${SECRET}@relay.example/v1`).reason,
      "credentials-in-url",
    );
  });

  it("refuses a query string rather than dropping it", () => {
    // Dropping it is the worst of the three options: the key is not sent, and the 401 that comes
    // back reads as a bad credential rather than as a discarded one.
    assert.equal(refusal("openrouter", `https://relay.example/v1?api-key=${SECRET}`).reason, "carries-query");
  });

  it("refuses a fragment, because a fragment was never going to be sent", () => {
    assert.equal(refusal("lm-studio", "http://box/v1#models").reason, "carries-fragment");
  });
});

describe("resolveEndpoint — no message quotes the override", () => {
  it("holds for every refusing shape, not only the two about credentials", () => {
    const hostile = [
      SECRET,
      `ftp://${SECRET}@host/v1`,
      `https://${SECRET}@relay.example/v1`,
      `https://user:${SECRET}@relay.example/v1`,
      `https://relay.example/v1?api-key=${SECRET}`,
      `https://relay.example/v1#${SECRET}`,
      `https://relay.example/${SECRET}`,
    ];
    for (const override of hostile) {
      const verdict = resolveEndpoint("openrouter", override);
      if (verdict.ok) {
        // The last shape is a legal URL; what matters is that nothing leaked on the way.
        assert.equal(verdict.endpoint.source, "override");
        continue;
      }
      assert.ok(
        !verdict.message.includes(SECRET),
        `${verdict.reason} quoted the override: ${verdict.message}`,
      );
    }
  });
});

describe("the two routes", () => {
  it("derives both from one base, for all three backends", () => {
    for (const backend of BACKENDS) {
      const endpoint = endpointOf(backend);
      assert.equal(modelsUrl(endpoint), `${endpoint.baseUrl}/models`);
      assert.equal(completionsUrl(endpoint), `${endpoint.baseUrl}/chat/completions`);
    }
  });

  it("never doubles a slash, whatever the override looked like", () => {
    for (const override of ["http://box/v1/", "http://box/v1//", "http://box/"]) {
      const endpoint = endpointOf("lm-studio", override);
      assert.ok(!modelsUrl(endpoint).includes("//models"), override);
      assert.ok(!completionsUrl(endpoint).includes("//chat"), override);
    }
  });
});

describe("readinessRequest", () => {
  it("asks the free route, and asks it with GET", () => {
    const endpoint = endpointOf("lm-studio");
    const request = readinessRequest(endpoint);
    assert.equal(request.method, "GET");
    assert.equal(request.url, modelsUrl(endpoint));
  });

  it("carries no header that could hold a credential", () => {
    for (const backend of BACKENDS) {
      const request = readinessRequest(endpointOf(backend));
      const names = Object.keys(request.headers).map((name) => name.toLowerCase());
      assert.ok(!names.includes("authorization"), backend);
      assert.ok(!names.includes("x-api-key"), backend);
      assert.ok(!names.some((name) => name.includes("key")), backend);
    }
  });

  it("says a credential is owed for the relay and only for the relay", () => {
    assert.equal(readinessRequest(endpointOf("openrouter")).credentialed, true);
    assert.equal(readinessRequest(endpointOf("lm-studio")).credentialed, false);
    assert.equal(readinessRequest(endpointOf("llama-rocm")).credentialed, false);
  });
});

describe("vocabulary", () => {
  it("describes every refusal, with no duplicates", () => {
    const seen = new Set<string>();
    for (const reason of ENDPOINT_REFUSALS) {
      const text = describeEndpointRefusal(reason);
      assert.ok(text.length > 0, reason);
      assert.ok(!seen.has(text), reason);
      seen.add(text);
    }
  });

  it("describes an endpoint by where it came from", () => {
    assert.equal(
      describeEndpoint(endpointOf("lm-studio")),
      "lm-studio: http://lm-studio:1234/v1 (default)",
    );
    assert.ok(describeEndpoint(endpointOf("lm-studio", "http://box/v1")).endsWith("(override)"));
  });
});
