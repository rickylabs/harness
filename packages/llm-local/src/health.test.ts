import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { availabilityOf, mayDispatch } from "@rickylabs/routing";

import {
  READINESS,
  type Exchange,
  type Health,
  type Readiness,
  checkHealth,
  describeHealth,
  describeReadiness,
  isReady,
  parseModelsList,
  toObservation,
} from "./health.js";

const NOW = "2026-09-06T12:00:00.000Z";
const MODEL = "n5air/local-seat";

/** The codex warning `probe.ts` scans for. Planted in a response body on purpose below. */
const MARKER = "Model metadata for 'n5air/local-seat' not found. Defaulting to fallback metadata";

function modelsBody(ids: readonly string[], extra: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    object: "list",
    data: ids.map((id) => ({ id, object: "model", ...extra })),
  });
}

function health(exchange: Exchange, overrides: Partial<{ backend: string; servedAs: string }> = {}): Health {
  const verdict = checkHealth({
    backend: overrides.backend ?? "lm-studio",
    model: MODEL,
    ...(overrides.servedAs === undefined ? {} : { servedAs: overrides.servedAs }),
    exchange,
    at: NOW,
  });
  if (!verdict.ok) {
    throw new Error(`expected a health reading, got ${verdict.reason}`);
  }
  return verdict.health;
}

function answered(status: number, body: string): Exchange {
  return { reached: true, status, body };
}

describe("parseModelsList", () => {
  it("reads the shape all three services agree on", () => {
    assert.deepEqual(parseModelsList(modelsBody(["a", "b"])), ["a", "b"]);
  });

  it("reads an empty list as an empty list, not as a broken body", () => {
    // A server with nothing loaded is a different problem from a server that is not the service.
    assert.deepEqual(parseModelsList(modelsBody([])), []);
  });

  it("skips an entry with no usable id rather than failing on it", () => {
    const body = JSON.stringify({ data: [{ id: "a" }, { object: "model" }, { id: "" }, null, 7] });
    assert.deepEqual(parseModelsList(body), ["a"]);
  });

  it("answers null for anything that is not a models list", () => {
    for (const body of ["", "not json", "<html>502</html>", "[]", "null", '{"error":"nope"}', '{"data":7}']) {
      assert.equal(parseModelsList(body), null, JSON.stringify(body));
    }
  });
});

describe("checkHealth — the five outcomes", () => {
  it("is ready when the endpoint answered and lists the model", () => {
    const reading = health(answered(200, modelsBody([MODEL, "other"])));
    assert.equal(reading.readiness, "ready");
    assert.equal(isReady(reading), true);
  });

  it("is not-loaded when the server is up and the model is not", () => {
    // The LM Studio failure this check exists for: the socket is listening, the load failed, and a
    // liveness ping reports the backend healthy.
    const reading = health(answered(200, modelsBody(["something-else"])));
    assert.equal(reading.readiness, "not-loaded");
    assert.equal(isReady(reading), false);
    assert.ok(reading.detail.includes("1 model"));
  });

  it("is rejected on a non-2xx, and says which kind of problem the status is", () => {
    assert.ok(health(answered(401, "")).detail.includes("credential"));
    assert.ok(health(answered(403, "")).detail.includes("credential"));
    assert.ok(health(answered(404, "")).detail.includes("/v1"));
    assert.ok(health(answered(503, "")).detail.includes("not a routing problem"));
    for (const status of [401, 404, 500]) {
      assert.equal(health(answered(status, "")).readiness, "rejected");
    }
  });

  it("is unreadable when something answered and it was not the service", () => {
    const reading = health(answered(200, "<html><title>nginx</title></html>"));
    assert.equal(reading.readiness, "unreadable");
  });

  it("is unreachable when nothing answered", () => {
    const reading = health({ reached: false, error: "connect ECONNREFUSED 10.0.0.4:8081" });
    assert.equal(reading.readiness, "unreachable");
    assert.ok(reading.detail.includes("ECONNREFUSED"));
  });

  it("quotes the client error, which is safe only because the URL could not carry a secret", () => {
    const reading = health({ reached: false, error: "fetch failed: http://lm-studio:1234/v1/models" });
    assert.ok(reading.detail.includes("lm-studio:1234"));
  });

  it("clips a client error that arrived as a stack trace", () => {
    const reading = health({ reached: false, error: "x".repeat(4000) });
    assert.ok(reading.detail.length < 400);
  });
});

describe("checkHealth — the served name is given, never guessed", () => {
  it("matches on servedAs when the endpoint spells the model differently", () => {
    const reading = health(answered(200, modelsBody(["qwen3.8-27b-instruct"])), {
      servedAs: "qwen3.8-27b-instruct",
    });
    assert.equal(reading.readiness, "ready");
    // The pin is what gets recorded; the wire name is not smuggled into it.
    assert.equal(reading.model, MODEL);
    assert.equal(reading.servedAs, "qwen3.8-27b-instruct");
  });

  it("reports not-loaded rather than inventing a spelling table", () => {
    assert.equal(health(answered(200, modelsBody(["qwen3.8-27b-instruct"]))).readiness, "not-loaded");
  });
});

describe("checkHealth — where the failure is actually read (#57, criterion 3)", () => {
  it("sends a failed load to the app's own log directory, not to the container's stdout", () => {
    const reading = health(answered(200, modelsBody(["something-else"])));
    assert.ok(reading.diagnostics.includes("/config/.lmstudio/server-logs/"));
    assert.ok(!reading.diagnostics.includes("nerdctl"));
  });

  it("sends an unreadable answer to the same place, because that is also a load problem", () => {
    assert.ok(health(answered(200, "<html>")).diagnostics.includes(".lmstudio"));
  });

  it("does not send a dead socket to a log file that is empty for a good reason", () => {
    const reading = health({ reached: false, error: "ECONNREFUSED" });
    assert.ok(!reading.diagnostics.includes(".lmstudio"));
    assert.ok(reading.diagnostics.includes("sleep infinity"));
  });

  it("has nothing to point at when nothing failed", () => {
    const reading = health(answered(200, modelsBody([MODEL])));
    assert.equal(reading.diagnostics, "Nothing failed.");
    assert.ok(!describeHealth(reading).includes("see "));
  });

  it("points an operator at the evidence in one line", () => {
    assert.ok(describeHealth(health(answered(200, modelsBody([])))).includes(".lmstudio"));
  });
});

describe("checkHealth — a target no dispatch could have used is not a server problem", () => {
  it("propagates the endpoint refusal instead of reporting unreachable", () => {
    const verdict = checkHealth({
      backend: "openrouter",
      model: MODEL,
      baseUrl: "https://sk-planted@relay.example/v1",
      exchange: { reached: false, error: "never sent" },
      at: NOW,
    });
    assert.equal(verdict.ok, false);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.reason, "credentials-in-url");
    assert.ok(!verdict.message.includes("sk-planted"));
  });

  it("refuses a backend it does not describe", () => {
    const verdict = checkHealth({
      backend: "ollama",
      model: MODEL,
      exchange: answered(200, modelsBody([MODEL])),
      at: NOW,
    });
    assert.equal(verdict.ok, false);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.reason, "unknown-backend");
  });
});

describe("nothing from the response body is quoted", () => {
  it("keeps a hostile models list out of the detail line", () => {
    const reading = health(answered(200, modelsBody([MODEL], { description: MARKER })));
    assert.equal(reading.readiness, "ready");
    assert.ok(!reading.detail.includes("Defaulting to fallback metadata"));
    assert.ok(!describeHealth(reading).includes("Defaulting to fallback metadata"));
  });

  it("keeps it out of the projected observation, where it could steer a routing verdict", () => {
    // `probe.ts` scans `output` for that marker and answers `degraded` when it finds it. If the far
    // end could write into that field, a server would be able to demote itself — or, worse, a
    // compromised one could make a healthy destination look degraded and push work elsewhere.
    const observation = toObservation(health(answered(200, modelsBody([MODEL], { note: MARKER }))));
    if (observation === null) throw new Error("expected an observation");
    assert.ok(!JSON.stringify(observation).includes("fallback metadata"));

    const verdict = availabilityOf({ target: "lm-studio", model: MODEL, observation }, NOW);
    assert.equal(verdict.availability, "available");
    assert.notEqual(verdict.availability, "degraded");
  });
});

describe("toObservation — what a reading is worth in routing's vocabulary", () => {
  function verdictFor(exchange: Exchange): ReturnType<typeof availabilityOf> {
    const observation = toObservation(health(exchange));
    return availabilityOf(
      { target: "lm-studio", model: MODEL, ...(observation === null ? {} : { observation }) },
      NOW,
    );
  }

  it("makes a ready reading dispatchable, and on probe evidence rather than a constant", () => {
    const verdict = verdictFor(answered(200, modelsBody([MODEL])));
    assert.equal(verdict.availability, "available");
    assert.equal(verdict.source, "probe");
    assert.equal(mayDispatch(verdict), true);
  });

  it("makes a dead socket unavailable", () => {
    const verdict = verdictFor({ reached: false, error: "ECONNREFUSED" });
    assert.equal(verdict.availability, "unavailable");
    assert.equal(mayDispatch(verdict), false);
  });

  it("makes a refusal unknown — something answered, and nothing was established", () => {
    const verdict = verdictFor(answered(401, ""));
    assert.equal(verdict.availability, "unknown");
    assert.equal(mayDispatch(verdict), false);
  });

  it("makes an unreadable answer unknown for the same reason", () => {
    assert.equal(verdictFor(answered(200, "<html>")).availability, "unknown");
  });

  it("declines to project not-loaded rather than write a false reachability claim", () => {
    // `Observation.reachable` means *the destination answered at all*, and here it did. Saying
    // otherwise would get the verdict right by lying in a record telemetry keeps. The fact lives on
    // the `Health` value instead.
    const reading = health(answered(200, modelsBody(["something-else"])));
    assert.equal(reading.readiness, "not-loaded");
    assert.equal(toObservation(reading), null);
  });

  it("still fails closed when it declines", () => {
    const verdict = verdictFor(answered(200, modelsBody(["something-else"])));
    assert.equal(verdict.availability, "unknown");
    assert.equal(mayDispatch(verdict), false);
  });

  it("records the pin, the backend and the moment", () => {
    const observation = toObservation(health(answered(200, modelsBody([MODEL]))));
    if (observation === null) throw new Error("expected an observation");
    assert.equal(observation.target, "lm-studio");
    assert.equal(observation.model, MODEL);
    assert.equal(observation.observedAt, NOW);
  });
});

describe("vocabulary", () => {
  it("describes every readiness state, with no duplicates", () => {
    const seen = new Set<string>();
    for (const readiness of READINESS) {
      const text = describeReadiness(readiness);
      assert.ok(text.length > 0, readiness);
      assert.ok(!seen.has(text), readiness);
      seen.add(text);
    }
  });

  it("is ready and nothing else", () => {
    const notReady: readonly Readiness[] = READINESS.filter((state) => state !== "ready");
    assert.equal(notReady.length, 4);
  });
});
