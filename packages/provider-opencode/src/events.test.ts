/**
 * Framing, reading and classification.
 *
 * `feed` is a pure function precisely so that this file can drive it through the split points a real
 * socket produces — a frame arriving in three chunks, three frames arriving in one, a chunk ending
 * exactly on a boundary — instead of the tidy one-frame-per-chunk a fake would otherwise hand it.
 * Every one of those is something a loaded server does, and none of them is reachable through an
 * implementation that reassembles inside its own read loop.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classify,
  feed,
  readEvent,
  sessionOf,
  BUFFER_LIMIT,
  NO_FRAMES,
  type FrameState,
} from "./events.js";

/** Push a sequence of chunks through the fold and collect everything it emitted. */
function drive(chunks: readonly string[]): { readonly frames: string[]; readonly state: FrameState } {
  let state = NO_FRAMES;
  const frames: string[] = [];
  for (const chunk of chunks) {
    const step = feed(state, chunk);
    state = step.state;
    frames.push(...step.frames);
  }
  return { frames, state };
}

describe("feed", () => {
  it("emits a frame once its blank line arrives, and not before", () => {
    const first = feed(NO_FRAMES, "data: {\"type\":\"a\"}");
    assert.deepEqual(first.frames, []);
    const second = feed(first.state, "\n\n");
    assert.deepEqual(second.frames, ['{"type":"a"}']);
    assert.equal(second.state.buffer, "");
  });

  it("emits three frames from one chunk", () => {
    const { frames } = drive(["data: 1\n\ndata: 2\n\ndata: 3\n\n"]);
    assert.deepEqual(frames, ["1", "2", "3"]);
  });

  it("reassembles a frame split across three chunks", () => {
    const { frames } = drive(["data: {\"ty", "pe\":\"session.i", "dle\"}\n\n"]);
    assert.deepEqual(frames, ['{"type":"session.idle"}']);
  });

  it("keeps a partial frame in the buffer when a chunk ends mid-frame", () => {
    const { frames, state } = drive(["data: 1\n\ndata: 2"]);
    assert.deepEqual(frames, ["1"]);
    assert.equal(state.buffer, "data: 2");
  });

  it("handles a chunk that ends exactly on a boundary", () => {
    const { frames, state } = drive(["data: 1\n\n", "data: 2\n\n"]);
    assert.deepEqual(frames, ["1", "2"]);
    assert.equal(state.buffer, "");
  });

  it("accepts CRLF and bare CR line endings", () => {
    assert.deepEqual(drive(["data: 1\r\n\r\n"]).frames, ["1"]);
    assert.deepEqual(drive(["data: 1\r\r"]).frames, ["1"]);
  });

  it("joins a multi-line data field, as the grammar says", () => {
    assert.deepEqual(drive(["data: one\ndata: two\n\n"]).frames, ["one\ntwo"]);
  });

  it("ignores comment heartbeats and other fields", () => {
    // A `:` line is what keeps an idle connection open. Treating it as a frame would hand the reader
    // an empty payload every few seconds, and each one would fail to parse.
    assert.deepEqual(drive([": keep-alive\n\n"]).frames, []);
    assert.deepEqual(drive(["event: message\nid: 7\ndata: 1\n\n"]).frames, ["1"]);
    assert.deepEqual(drive(["event: message\nid: 7\n\n"]).frames, []);
  });

  it("tolerates a missing space after the field name", () => {
    assert.deepEqual(drive(["data:1\n\n"]).frames, ["1"]);
  });

  it("drops the buffer rather than growing without bound", () => {
    // A proxy that turns the stream into one long line costs events either way. Dropping is visible
    // as a run that stops updating; growing is invisible until the process dies holding every live
    // run's state.
    const { state } = drive([`data: ${"x".repeat(BUFFER_LIMIT + 10)}`]);
    assert.equal(state.buffer, "");
  });
});

describe("readEvent", () => {
  it("reads a typed event", () => {
    assert.deepEqual(readEvent('{"type":"session.idle","properties":{"sessionID":"s"}}'), {
      type: "session.idle",
      properties: { sessionID: "s" },
    });
  });

  it("returns null rather than throwing on anything else", () => {
    assert.equal(readEvent("not json"), null);
    assert.equal(readEvent("[1,2]"), null);
    assert.equal(readEvent("null"), null);
    assert.equal(readEvent('{"properties":{}}'), null);
    assert.equal(readEvent('{"type":""}'), null);
  });

  it("defaults absent properties to null instead of undefined", () => {
    assert.deepEqual(readEvent('{"type":"server.connected"}'), {
      type: "server.connected",
      properties: null,
    });
  });
});

describe("sessionOf", () => {
  it("reads an explicit session key in either spelling", () => {
    assert.equal(sessionOf({ type: "message.updated", properties: { sessionID: "s1" } }), "s1");
    assert.equal(sessionOf({ type: "message.updated", properties: { sessionId: "s2" } }), "s2");
  });

  it("reads it out of a nested part, info, message or session", () => {
    assert.equal(sessionOf({ type: "message.part.updated", properties: { part: { sessionID: "s" } } }), "s");
    assert.equal(sessionOf({ type: "message.updated", properties: { info: { sessionID: "s" } } }), "s");
    assert.equal(sessionOf({ type: "message.updated", properties: { message: { sessionID: "s" } } }), "s");
    assert.equal(sessionOf({ type: "session.updated", properties: { session: { sessionID: "s" } } }), "s");
  });

  it("reads a session event whose payload is the session itself", () => {
    assert.equal(sessionOf({ type: "session.idle", properties: { info: { id: "s" } } }), "s");
    assert.equal(sessionOf({ type: "session.deleted", properties: { id: "s" } }), "s");
  });

  it("does not read a message's own id as a session id", () => {
    // `info.id` on a message event is the message's. Attributing the event to it would route it to a
    // session that does not exist, which costs liveness silently.
    assert.equal(sessionOf({ type: "message.updated", properties: { info: { id: "msg_1" } } }), null);
  });

  it("prefers an explicit session key over an id that might be something else", () => {
    assert.equal(sessionOf({ type: "session.idle", properties: { sessionID: "s", id: "other" } }), "s");
  });

  it("is null when nothing names a session", () => {
    assert.equal(sessionOf({ type: "server.connected", properties: null }), null);
    assert.equal(sessionOf({ type: "message.updated", properties: { part: 7 } }), null);
  });
});

describe("classify", () => {
  it("recognises the four events that change a run's state", () => {
    assert.deepEqual(classify({ type: "server.connected", properties: null }), { kind: "connected" });
    assert.deepEqual(classify({ type: "session.idle", properties: {} }), { kind: "idle" });
    assert.deepEqual(classify({ type: "session.deleted", properties: {} }), { kind: "gone" });
    assert.equal(classify({ type: "session.error", properties: {} }).kind, "error");
  });

  it("treats message traffic as a heartbeat, keeping only the type", () => {
    // The event carries the agent's own output. None of it may reach a record, a detail or telemetry
    // — a coordinator needs to know a run is working, not a copy of whatever it was reading.
    const signal = classify({
      type: "message.part.updated",
      properties: { part: { text: "the contents of a private file" } },
    });
    assert.deepEqual(signal, { kind: "activity", detail: "message.part.updated" });
  });

  it("ignores everything it does not recognise, rather than failing on it", () => {
    // The bus will grow event types. A classifier that enumerated them would turn every vendor
    // release into a run that reports nothing.
    assert.deepEqual(classify({ type: "file.watcher.updated", properties: {} }), { kind: "ignored" });
    assert.deepEqual(classify({ type: "installation.updated", properties: {} }), { kind: "ignored" });
  });

  it("reads an error's name and message and nothing else", () => {
    const signal = classify({
      type: "session.error",
      properties: { error: { name: "ProviderAuthError", data: { message: "no key" } } },
    });
    assert.deepEqual(signal, { kind: "error", detail: "ProviderAuthError: no key" });
  });

  it("describes an error it cannot read rather than dumping the object", () => {
    const bare = classify({ type: "session.error", properties: { error: { extra: "x" } } });
    assert.deepEqual(bare, { kind: "error", detail: "the session reported an error with no detail" });
    const string = classify({ type: "session.error", properties: { error: "boom" } });
    assert.deepEqual(string, { kind: "error", detail: "boom" });
    assert.equal(classify({ type: "session.error", properties: null }).kind, "error");
  });
});
