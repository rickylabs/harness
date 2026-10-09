/**
 * Opening the event stream, when the server is slow to say hello or the provider is shut down first.
 *
 * The stream counts as open only once `opencode serve` greets the subscription. Until then a dispatch
 * is waiting, and these cases pin what that wait may and may not do: it is bounded, a shutdown ends
 * it and lets go of the request, and a greeting that arrives after the shutdown launches nothing.
 * Driven through the real SDK adapter over a fake `fetch`, so the abort reaches the transport the
 * provider actually uses.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { request, server, settle } from "../fixtures/provider.js";

/** Hold the event loop open while the provider's own unref'd timers are the only pending work. */
async function awake<T>(body: () => Promise<T>): Promise<T> {
  const hold = setTimeout(() => {}, 30_000);
  try {
    return await body();
  } finally {
    clearTimeout(hold);
  }
}

describe("opening the event stream", () => {
  it("refuses a dispatch whose stream sends nothing within the bound, and lets go of it", async () => {
    const fake = server({ greet: false, readyTimeoutMs: 20 });

    const result = await awake(() => fake.provider.dispatch(request(), "r1"));
    await settle();

    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /sent nothing within 20ms/);
    assert.match(result.detail, /nothing was launched/);
    assert.deepEqual(fake.calls, []);
    assert.equal(fake.streamRequests[0]?.signal.aborted, true);
    assert.equal(fake.channel()?.cancelled, true);
    assert.equal(fake.provider.busState().connected, false);
    assert.deepEqual(fake.provider.records(), []);
  });

  it("settles a dispatch waiting on the open when the provider shuts down, and aborts the request", async () => {
    const fake = server({ greet: false });

    const pending = fake.provider.dispatch(request(), "r1");
    await settle();
    assert.equal(fake.streamCalls.length, 1);

    await fake.provider.shutdown();
    const result = await pending;
    await settle();

    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /shut down/);
    assert.equal(fake.streamRequests[0]?.signal.aborted, true);
    assert.equal(fake.channel()?.cancelled, true);
    assert.deepEqual(fake.calls, []);
  });

  it("never creates or prompts a session for a greeting that arrives after shutdown", async () => {
    const fake = server({ greet: false });

    const pending = fake.provider.dispatch(request(), "r1");
    await settle();
    await fake.provider.shutdown();
    try {
      // The reader has been cancelled; a server that writes anyway is the case being pinned.
      fake.channel()?.send({ type: "server.connected", properties: {} });
    } catch {
      // A cancelled stream refuses the write, which is the same outcome by a shorter road.
    }
    const result = await pending;
    await settle();

    assert.equal(result.verdict, "refused");
    assert.deepEqual(fake.paths(), []);
    assert.equal(fake.streamCalls.length, 1);
    assert.equal(fake.provider.busState().connected, false);
  });

  it("still connects when the greeting comes inside the bound", async () => {
    const fake = server({ greet: false });

    const pending = fake.provider.dispatch(request(), "r1");
    await settle();
    fake.channel()?.send({ type: "server.connected", properties: {} });
    const result = await pending;

    assert.equal(result.verdict, "accepted");
    assert.deepEqual(fake.paths(), ["POST /session", "POST /session/ses_1/prompt_async"]);
    assert.equal(fake.provider.busState().connected, true);
  });
});
