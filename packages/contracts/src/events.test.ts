import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVENT_KINDS,
  MUX_PATH,
  PROTOCOL_VERSION,
  readServerEvent,
  type EventKind,
  type ServerEvent,
} from "./events.js";
import { API_PREFIX } from "./routes.js";

/** `true` only when the two string unions have exactly the same members. */
export type Mutual<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

export type Assert<T extends true> = T;

/**
 * The runtime list and the type union are the same set.
 *
 * `readServerEvent` decides whether a frame is understood by consulting the list; the fold switches
 * on the union. A member in one and not the other is an event that either parses and cannot be
 * handled, or is handled and never parses.
 */
export type _KindsCoverUnion = Assert<Mutual<EventKind, ServerEvent["kind"]>>;

function frame(kind: string, seq: number, payload: unknown = {}): unknown {
  return { kind, generation: 7, seq, at: "2026-09-05T00:00:00.000Z", payload };
}

test("event kinds are unique and the stream lives under the api prefix", () => {
  assert.equal(new Set(EVENT_KINDS).size, EVENT_KINDS.length);
  assert.ok(MUX_PATH.startsWith(`${API_PREFIX}/`));
  assert.equal(PROTOCOL_VERSION, 1);
});

test("a well-formed frame of every known kind reads", () => {
  for (const kind of EVENT_KINDS) {
    const reading = readServerEvent(frame(kind, 3));
    assert.equal(reading.ok, true, kind);
    assert.equal(reading.ok && reading.event.kind, kind);
  }
});

test("an unknown kind still reports its generation and seq", () => {
  // This is the whole reason the verdict has three cases. A server that has learned to report
  // something new is normal; losing the sequence number would make every forward-compatible
  // addition look to the fold exactly like a dropped frame, and trigger a resync that fetches the
  // same unreadable event again.
  const reading = readServerEvent(frame("run.paused", 12));
  assert.equal(reading.ok, false);
  assert.ok(!reading.ok && reading.reason === "unknown-kind");
  if (!reading.ok && reading.reason === "unknown-kind") {
    assert.equal(reading.kind, "run.paused");
    assert.equal(reading.generation, 7);
    assert.equal(reading.seq, 12);
  }
});

test("a kind named after a prototype method is unknown, not accepted", () => {
  const reading = readServerEvent(frame("toString", 1));
  assert.equal(reading.ok, false);
  assert.ok(!reading.ok && reading.reason === "unknown-kind");
});

test("a frame that is not an object is unreadable", () => {
  for (const value of [null, undefined, 3, "hello", true]) {
    const reading = readServerEvent(value);
    assert.equal(reading.ok, false);
    assert.ok(!reading.ok && reading.reason === "unreadable");
  }
});

test("a frame missing an envelope field is unreadable, not an unknown kind", () => {
  const cases: readonly Record<string, unknown>[] = [
    { generation: 1, seq: 0, at: "t", payload: {} },
    { kind: "hello", seq: 0, at: "t", payload: {} },
    { kind: "hello", generation: 1, at: "t", payload: {} },
    { kind: "hello", generation: 1, seq: 0, payload: {} },
    { kind: "hello", generation: 1, seq: 0, at: "t" },
  ];
  for (const value of cases) {
    const reading = readServerEvent(value);
    assert.equal(reading.ok, false, JSON.stringify(value));
    assert.ok(!reading.ok && reading.reason === "unreadable", JSON.stringify(value));
  }
});

test("a non-integer seq is unreadable, because gap detection is integer arithmetic", () => {
  const reading = readServerEvent({
    kind: "hello",
    generation: 1,
    seq: 1.5,
    at: "t",
    payload: {},
  });
  assert.equal(reading.ok, false);
  assert.ok(!reading.ok && reading.reason === "unreadable");
});

test("a payload the contract does not recognise is not rejected", () => {
  // A published contract that refused a payload carrying an unfamiliar field would make every
  // additive server change a breaking one. The envelope is what the fold's correctness rests on, so
  // the envelope is what is checked.
  const reading = readServerEvent(frame("task.removed", 4, { number: 79, futureField: "x" }));
  assert.equal(reading.ok, true);
});

test("a null payload is a payload", () => {
  // Absent and null are different: a server that means "nothing" says so, and the envelope check
  // must not turn that into a parse failure.
  const reading = readServerEvent({
    kind: "hello",
    generation: 1,
    seq: 0,
    at: "t",
    payload: null,
  });
  assert.equal(reading.ok, true);
});
