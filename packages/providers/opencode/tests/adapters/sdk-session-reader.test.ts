/**
 * The read adapter: the real SDK client over a fake `fetch` that serves a recorded 1.18.35 session.
 *
 * Pinned here: the requests the SDK builds for each read, the word each kind of reply becomes, the
 * byte cap that stops a reply before it is buffered, the event stream reduced to session ids, and the
 * per-frame cap that stops an event before the SDK buffers it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSdkSessionReader } from "../../src/adapters/sdk-session-reader.js";
import { BASE_URL, eventChannel, json, text, unreachable, type EventChannel } from "../fixtures/fake-fetch.js";
import { recordedFetch, recording } from "../fixtures/recorded-server.js";

const bounds = (maxBytes = 1_048_576) => ({ maxBytes, signal: new AbortController().signal });
const reader = (override?: Parameters<typeof recordedFetch>[0]) => {
  const served = recordedFetch(override);
  return { ...served, reader: createSdkSessionReader({ baseUrl: BASE_URL, fetch: served.fetch }) };
};
const bodyBytes = (path: string) => Buffer.byteLength(JSON.stringify(recording.replies[path]!.body));

describe("createSdkSessionReader", () => {
  it("reads a recorded session, its children and its latest messages through the SDK's own requests", async () => {
    const { reader: r, calls, urls } = reader();
    const root = recording.rootID;
    const session = await r.session(root, bounds());
    assert.equal(session.kind, "ok");
    assert.deepEqual(session.kind === "ok" && (session.body as { id: string }).id, root);
    assert.equal(session.bytes, bodyBytes(`/session/${root}`));
    const children = await r.children(root, bounds());
    assert.equal(children.kind === "ok" && (children.body as { parentID: string }[])[0]?.parentID, root);
    const messages = await r.messages(root, 101, bounds());
    assert.equal(messages.kind === "ok" && (messages.body as unknown[]).length, 8);
    assert.deepEqual(calls.map(call => [call.method, call.path]), [["GET", `/session/${root}`],
      ["GET", `/session/${root}/children`], ["GET", `/session/${root}/message`]]);
    // The bound travels as the SDK's own query parameter; the server returns the latest `limit`.
    assert.equal(urls[2]!.searchParams.get("limit"), "101");
  });

  it("keeps the server's own 404 for an unknown session distinct from every failure", async () => {
    const { reader: r } = reader();
    assert.equal((await r.session(recording.unknownID, bounds())).kind, "missing");
    assert.equal((await r.messages(recording.unknownID, 10, bounds())).kind, "missing");
    for (const reply of [json(500, { name: "UnknownError" }), json(503, {}), json(400, {}), unreachable("refused"),
      { status: 200, text: "{not json", contentType: "application/json" }]) {
      const { reader: failing } = reader(() => reply);
      assert.equal((await failing.session(recording.rootID, bounds())).kind, "unavailable", JSON.stringify(reply));
    }
    // Shape is never read here: a readable non-JSON 200 is `ok`, and the caller's checked reader refuses it.
    const { reader: html } = reader(() => text(200, "<html>not the api</html>"));
    const page = await html.session(recording.rootID, bounds());
    assert.equal(page.kind === "ok" && typeof page.body, "string");
  });

  it("cuts a reply off at its byte cap instead of parsing a prefix", async () => {
    const { reader: r } = reader();
    const path = `/session/${recording.rootID}/message`, size = bodyBytes(path);
    const capped = await r.messages(recording.rootID, 101, bounds(size - 1));
    assert.equal(capped.kind, "oversized");
    assert.ok(capped.bytes > size - 1 && capped.bytes <= size, String(capped.bytes));
    const exact = await r.messages(recording.rootID, 101, bounds(size));
    assert.equal(exact.kind, "ok"); assert.equal(exact.bytes, size);
  });

  it("abandons a read when its signal aborts", async () => {
    const { reader: r } = reader();
    const abort = new AbortController(); abort.abort();
    assert.equal((await r.session(recording.rootID, { maxBytes: 1_048_576, signal: abort.signal })).kind, "unavailable");
  });

  it("reduces the recorded event stream to the sessions its events name, and drops the rest", async () => {
    const channel = eventChannel(false);
    const fetch = (async () => channel.response) as typeof globalThis.fetch;
    const abort = new AbortController();
    const events = createSdkSessionReader({ baseUrl: BASE_URL, fetch }).sessionEvents(abort.signal);
    for (const event of recording.events) channel.send(event);
    channel.close();
    const opened = await events;
    assert.equal(opened.kind, "open");
    const seen: string[] = [];
    if (opened.kind === "open") for await (const session of opened.sessions) seen.push(session);
    // server.connected, plugin.added and server.heartbeat name no session; the rest name theirs.
    const named = recording.events.flatMap(event => {
      const id = (event as { properties?: { sessionID?: unknown } }).properties?.sessionID;
      return typeof id === "string" ? [id] : [];
    });
    assert.ok(named.length > 0 && named.length < recording.events.length);
    assert.ok(named.includes(recording.rootID));
    assert.deepEqual(seen, named);
  });

  it("reports a stream that never greets as closed", async () => {
    const channel = eventChannel(false);
    channel.close();
    const fetch = (async () => channel.response) as typeof globalThis.fetch;
    const opened = await createSdkSessionReader({ baseUrl: BASE_URL, fetch }).sessionEvents(new AbortController().signal);
    assert.equal(opened.kind, "closed");
  });
});

/** A stream capped at `maxEventFrameBytes`, over a channel the test writes to. */
async function capped(maxEventFrameBytes: number, write: (channel: EventChannel) => void) {
  const channel = eventChannel(), abort = new AbortController();
  const fetch = (async () => channel.response) as typeof globalThis.fetch;
  const opened = await createSdkSessionReader({ baseUrl: BASE_URL, fetch, maxEventFrameBytes }).sessionEvents(abort.signal);
  assert.equal(opened.kind, "open");
  write(channel);
  const seen: string[] = [];
  let failed = false;
  try { if (opened.kind === "open") for await (const session of opened.sessions) seen.push(session); }
  catch { failed = true; }
  return { seen, failed, cancelled: channel.cancelled };
}
const idle = (sessionID: string, pad = "") => ({ type: "session.idle", properties: { sessionID, pad } });

describe("the event frame cap", () => {
  it("is per frame, not per stream: any number of frames under it arrive whole, LF or CRLF delimited", async () => {
    const ids = Array.from({ length: 24 }, (_, i) => `ses_frame${i}`);
    const result = await capped(256, channel => {
      ids.forEach((id, i) => {
        if (i % 2 === 0) channel.send(idle(id));
        else channel.raw(`data: ${JSON.stringify(idle(id))}\r\n\r\n`);
      });
      channel.close();
    });
    assert.deepEqual(result, { seen: ids, failed: false, cancelled: false });
  });

  it("refuses a complete frame over the cap before it is delivered, and cancels the connection", async () => {
    const result = await capped(256, channel => {
      channel.send(idle("ses_before"));
      channel.send(idle("ses_oversized", "a".repeat(512)));
      channel.send(idle("ses_after"));
      channel.close();
    });
    assert.deepEqual(result, { seen: ["ses_before"], failed: true, cancelled: true });
  });

  // The server never ends either frame below and keeps the connection open: only the cap ends the read.
  it("refuses an unterminated frame as it grows, without waiting for a blank line that never comes", { timeout: 10_000 }, async () => {
    const result = await capped(256, channel => channel.raw(`data: ${"a".repeat(512)}`));
    assert.deepEqual(result, { seen: [], failed: true, cancelled: true });
  });

  it("counts a frame's CRLF-ended lines into one frame: a line end is not a blank line", { timeout: 10_000 }, async () => {
    const result = await capped(256, channel => channel.raw(`data: ${"a".repeat(40)}\r\n`.repeat(10)));
    assert.deepEqual(result, { seen: [], failed: true, cancelled: true });
  });

  it("aborting the signal ends the stream quietly and releases the connection", async () => {
    const channel = eventChannel(), abort = new AbortController();
    const fetch = (async () => channel.response) as typeof globalThis.fetch;
    const opened = await createSdkSessionReader({ baseUrl: BASE_URL, fetch }).sessionEvents(abort.signal);
    assert.equal(opened.kind, "open");
    channel.send(idle("ses_live"));
    const seen: string[] = [];
    if (opened.kind === "open") for await (const session of opened.sessions) { seen.push(session); abort.abort(); }
    assert.deepEqual([seen, channel.cancelled], [["ses_live"], true]);
  });
});
