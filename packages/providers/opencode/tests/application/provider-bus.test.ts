/**
 * The bus and `observe`: events promoting and finishing runs, and what may honestly be said about a
 * run while the event stream is down or freshly reconnected.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_ID } from "../../src/application/options.js";
import { at, ref, request, server, unreachable } from "../fixtures/provider.js";

describe("the bus", () => {
  it("promotes a queued run to running, then finishes it when the session goes idle", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    await fake.emit({ type: "message.part.updated", properties: { part: { sessionID: "ses_1" } } });
    assert.equal((await fake.provider.observe(ref("r1"))).liveness, "running");

    await fake.emit({ type: "session.idle", properties: { sessionID: "ses_1" } });
    const done = await fake.provider.observe(ref("r1"));
    assert.equal(done.liveness, "finished");
    assert.match(done.detail, /went idle/);
  });

  it("fails a run whose session reports an error", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    await fake.emit({
      type: "session.error",
      properties: { sessionID: "ses_1", error: { name: "ProviderAuthError" } },
    });

    const observation = await fake.provider.observe(ref("r1"));
    assert.equal(observation.liveness, "failed");
    assert.match(observation.detail, /ProviderAuthError/);
  });

  it("ignores events for sessions it is not holding", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");

    await fake.emit({ type: "session.idle", properties: { sessionID: "somebody-elses" } });

    assert.equal(at(fake.provider.records(), 0).liveness, "queued");
  });

  it("resolves an unknown run by itself once an event arrives", async () => {
    const fake = server();
    fake.prompt = unreachable("socket hang up");
    await fake.provider.dispatch(request(), "r1");

    await fake.emit({ type: "message.updated", properties: { sessionID: "ses_1" } });

    assert.equal((await fake.provider.observe(ref("r1"))).liveness, "running");
  });
});

describe("observe", () => {
  it("says it has no record rather than guessing, for an unknown run or another provider's", async () => {
    const fake = server();

    const mine = await fake.provider.observe(ref("nope"));
    assert.equal(mine.liveness, "unknown");
    assert.match(mine.detail, /has no record of this run/);
    assert.match(mine.detail, /list the server's sessions before assuming otherwise/);

    const theirs = await fake.provider.observe({ runId: "r1", provider: "other", external: null });
    assert.equal(theirs.liveness, "unknown");
  });

  it("carries the artifact directory, and the run's own reference", async () => {
    const fake = server({ logDir: "/var/log/opencode" });
    await fake.provider.dispatch(request(), "r1");

    const observation = await fake.provider.observe(ref("r1"));

    assert.deepEqual(observation.artifacts, ["/var/log/opencode"]);
    assert.deepEqual(observation.run, { runId: "r1", provider: DEFAULT_ID, external: "ses_1" });
    assert.equal(observation.observedAt, "2026-01-01T00:00:00.000Z");
  });

  it("downgrades a live run to unknown when the stream is down, and says when it last knew", async () => {
    // The stale-snapshot failure, refused structurally: with the bus down the record is a photograph,
    // and rendering a photograph as current state is how a board starts lying.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await fake.emit({ type: "message.updated", properties: { sessionID: "ses_1" } });
    fake.stream = unreachable("ECONNREFUSED");
    await fake.drop();

    const observation = await fake.provider.observe(ref("r1"));

    assert.equal(observation.liveness, "unknown");
    assert.match(observation.detail, /cannot be confirmed/);
    assert.match(observation.detail, /it was running: working \(1 events\)/);
    assert.equal(fake.provider.busState().connected, false);
  });

  it("reconnects on demand, but does not treat the new socket as news about the run", async () => {
    // The subtler half of the stale-snapshot failure. A reconnect returns a connection, not the
    // events that were missed while there was none: `GET /event` is live-only and replays nothing.
    // The run may have gone idle inside the gap, so a record last written before it is still a
    // photograph — and reporting it as `queued` because a socket is up again would be the same lie
    // as reporting it while the socket was down, with better cover.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await fake.drop();
    assert.equal(fake.provider.busState().connected, false);

    const observation = await fake.provider.observe(ref("r1"));

    assert.equal(observation.liveness, "unknown");
    assert.match(observation.detail, /reconnected and replays nothing/);
    assert.match(observation.detail, /it was queued/);
    assert.equal(fake.streamCalls.length, 2);
    assert.equal(fake.provider.busState().connected, true);
  });

  it("speaks plainly again once the new connection has said something about the run", async () => {
    // And the gap closes on evidence, not on time. One event on the current connection is the run
    // accounted for again, which is what keeps the downgrade above from being permanent.
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await fake.drop();
    await fake.provider.observe(ref("r1"));

    await fake.emit({ type: "message.updated", properties: { sessionID: "ses_1" } });
    const observation = await fake.provider.observe(ref("r1"));

    assert.equal(observation.liveness, "running");
    assert.match(observation.detail, /working \(1 events\)/);
  });

  it("does not downgrade a finished run, because a fact about the past does not expire", async () => {
    const fake = server();
    await fake.provider.dispatch(request(), "r1");
    await fake.emit({ type: "session.idle", properties: { sessionID: "ses_1" } });
    fake.stream = unreachable("ECONNREFUSED");
    await fake.drop();

    const observation = await fake.provider.observe(ref("r1"));

    assert.equal(observation.liveness, "finished");
    // And it did not spend a reconnect asking about a run that is over.
    assert.equal(fake.streamCalls.length, 1);
  });
});
