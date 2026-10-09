/**
 * `steer`, `stop`, deadlines, `shutdown` and `createProvider`, against a fake server behind the real
 * SDK adapter.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conformanceProblems } from "@rickylabs/subagents";

import { createSdkServer } from "../../src/adapters/sdk-server.js";
import { DEFAULT_ID } from "../../src/application/options.js";
import { OpencodeProvider } from "../../src/application/provider.js";
import { at, ok, ref, request, respond, server, text, unreachable, until, BASE_URL } from "../fixtures/provider.js";

describe("steer", () => {
  it("delivers a second prompt into the same session, on the run's own model", async () => {
    // Re-reading configuration here would let an interjection silently switch the model mid-run.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    const result = await fake.provider.steer(ref("r1"), "also update the changelog");

    assert.equal(result.verdict, "delivered");
    assert.match(result.detail, /queued into session ses_1/);
    assert.deepEqual(at(fake.calls, 2).body, {
      model: { providerID: "openrouter", modelID: "z-ai/glm-5.2" },
      parts: [{ type: "text", text: "also update the changelog" }],
    });
  });

  it("refuses an empty message and a run that is over", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    const blank = await fake.provider.steer(ref("r1"), "   ");
    assert.equal(blank.verdict, "refused");
    assert.match(blank.detail, /blank turn/);

    await fake.emit({ type: "session.idle", properties: { sessionID: "ses_1" } });
    const late = await fake.provider.steer(ref("r1"), "one more thing");
    assert.equal(late.verdict, "refused");
    assert.match(late.detail, /the run is finished/);
  });

  it("is unknown for a run it does not hold, and for a reply that never came", async () => {
    const fake = server();
    assert.equal((await fake.provider.steer(ref("nope"), "x")).verdict, "unknown");

    await fake.provider.dispatch(request(), "r1");
    fake.prompt = unreachable("socket hang up");
    const lost = await fake.provider.steer(ref("r1"), "x");
    assert.equal(lost.verdict, "unknown");
    assert.match(lost.detail, /may or may not have been queued/);
  });

  it("is refused when the server read the message and said no", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    fake.prompt = text(409, "session is busy");

    const result = await fake.provider.steer(ref("r1"), "x");

    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /HTTP 409/);
  });
});

describe("stop", () => {
  it("aborts the session and records the reason", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    const result = await fake.provider.stop(ref("r1"), "superseded by #56");

    assert.equal(result.verdict, "stopped");
    assert.match(result.detail, /aborted session ses_1: superseded by #56/);
    assert.equal(at(fake.paths(), 2), "POST /session/ses_1/abort");
    assert.equal(at(fake.provider.records(), 0).detail, "stopped: superseded by #56");
  });

  it("reports already-over when the server says there was nothing to abort", async () => {
    // The run is over either way, but it was not this call that ended it — and telemetry that says
    // otherwise is a sentence claiming we did something we did not.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    fake.abort = ok(200, false);

    const result = await fake.provider.stop(ref("r1"), "budget");

    assert.equal(result.verdict, "already-over");
    assert.match(result.detail, /had nothing to abort/);
    const record = at(fake.provider.records(), 0);
    assert.equal(record.liveness, "finished");
    assert.equal(record.detail.startsWith("stopped:"), false);
  });

  it("is unknown when the reply is not a boolean, rather than guessing at it", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    fake.abort = ok(200, { aborted: true });

    const result = await fake.provider.stop(ref("r1"), "budget");

    assert.equal(result.verdict, "unknown");
    assert.match(result.detail, /other than a boolean/);
  });

  it("splits refused from unknown the way the transport does", async () => {
    const refusing = server();
    await refusing.provider.dispatch(request(), "r1");
    refusing.abort = text(403, "not yours");
    const refused = await refusing.provider.stop(ref("r1"), "budget");
    assert.equal(refused.verdict, "refused");
    assert.match(refused.detail, /the run may still be alive/);

    const silent = server();
    await silent.provider.dispatch(request(), "r1");
    silent.abort = unreachable("socket hang up");
    assert.equal((await silent.provider.stop(ref("r1"), "budget")).verdict, "unknown");
  });

  it("is already-over for a run that has finished, and unknown for one it never had", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await fake.emit({ type: "session.idle", properties: { sessionID: "ses_1" } });

    const result = await fake.provider.stop(ref("r1"), "too late");
    assert.equal(result.verdict, "already-over");
    assert.equal(fake.paths().includes("POST /session/ses_1/abort"), false);

    assert.equal((await fake.provider.stop(ref("nope"), "x")).verdict, "unknown");
  });

  it("makes a stop in flight read the session disappearing as success", async () => {
    // Identical event, opposite meaning, and the difference is whether somebody asked. Without it,
    // every successful cancellation lands on the board as a failed run.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    fake.abort = unreachable("socket hang up");
    assert.equal((await fake.provider.stop(ref("r1"), "budget")).verdict, "unknown");

    await fake.emit({ type: "session.deleted", properties: { id: "ses_1" } });

    const record = at(fake.provider.records(), 0);
    assert.equal(record.liveness, "finished");
    assert.equal(record.detail, "stopped: budget");
  });
});

describe("timeouts", () => {
  it("stops a run that outlives the deadline it was dispatched with", async () => {
    const fake = server();

    await fake.provider.dispatch(request({ timeout: "1ms" }), "r1");
    await until(() => fake.paths().includes("POST /session/ses_1/abort"), "the abort");

    assert.equal(at(fake.provider.records(), 0).detail, "stopped: timeout after 1ms");
  });

  it("does not arm one for a dispatch that named no deadline", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.equal(fake.paths().includes("POST /session/ses_1/abort"), false);
  });
});

describe("shutdown", () => {
  it("closes the stream and leaves the runs alone", async () => {
    // Runs here belong to a server that outlives this process. Reaping them on the way out would turn
    // every coordinator restart into an outage.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    await fake.provider.shutdown();

    assert.equal(fake.provider.busState().connected, false);
    assert.match(fake.provider.busState().detail, /shut down/);
    assert.equal(fake.paths().includes("POST /session/ses_1/abort"), false);
    assert.equal(at(fake.provider.records(), 0).liveness, "queued");
  });
});

describe("createProvider", () => {
  it("takes the configured id, and defaults to one a RunRef can carry", () => {
    assert.equal(server().provider.id, DEFAULT_ID);
    const named = new OpencodeProvider({
      server: createSdkServer({ baseUrl: BASE_URL, fetch: async () => respond(unreachable("unused")) }),
      id: "opencode-n5air",
    });
    assert.equal(named.id, "opencode-n5air");
    assert.deepEqual(conformanceProblems(named), []);
  });
});
