/**
 * SSE consumption over UHP, and the freshness invariant that must survive it.
 *
 * Spike S11, issue #289. Run artifacts: `.llm/runs/uhp-stream-adapter--s11/`.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 *
 * They prove what this repository does with a given sequence of bytes. They prove nothing about what a
 * real HarnessRouter sends: every stream below was written from the published specification, by
 * `uhp-mock.ts`, on a host with no container runtime and no reachable router. The live round-trip is
 * issue #294 and is recorded as unproven in `verification.md`.
 *
 * TESTING STANDARD APPLIED HERE
 *
 * An assertion that holds equally for the correct and the defective behaviour is not coverage. So each
 * fail-closed test names the lenient behaviour it is excluding and asserts something that separates the
 * two — for a refused stream, not merely "it did not succeed" but that the partial output is
 * unreachable, which is the thing a lenient decoder would have handed back. The mutations run against
 * this suite are listed in `verification.md`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UHP_BROKEN_STREAMS,
  UHP_LIFECYCLE_FIXTURES,
  decodeUhpStream,
  encodeUhpFrames,
  startUhpMock,
  terminalEventFor,
  uhpStreamBody,
  uhpStreamFrames,
} from "./uhp-mock.js";
import {
  DEFAULT_UHP_WINDOWS,
  consumeUhpStream,
  createUhpStreamReader,
  readUhpStream,
  uhpFreshness,
  type UhpFreshnessEvidence,
  type UhpStreamRefusal,
  type UhpStreamState,
} from "./uhp-stream.js";
import { UHP_LIFECYCLE_STATUSES, type UhpLifecycleStatus } from "./uhp-wire.js";

const T0 = "2026-09-12T10:00:00.000Z";

/** A clock that advances a fixed step per call, so every frame gets its own timestamp. */
function clockFrom(start: string, stepMs: number): () => string {
  let at = Date.parse(start);
  return () => {
    const reading = new Date(at).toISOString();
    at += stepMs;
    return reading;
  };
}

function plus(start: string, ms: number): string {
  return new Date(Date.parse(start) + ms).toISOString();
}

/** The one stream shape the happy path uses: two text deltas inside one output item. */
function completedBody(): string {
  return uhpStreamBody(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["Sum", "mary"], item: true });
}

function refusalOf(state: UhpStreamState): UhpStreamRefusal | "not-refused" {
  return state.ok ? "not-refused" : state.refusal;
}

describe("UHP SSE consumption — incremental frames and the terminal frame", () => {
  it("reads deltas, output items and the terminal frame into one finished state", () => {
    const state = consumeUhpStream(completedBody(), clockFrom(T0, 1_000));
    assert.ok(state.ok);
    assert.ok(state.done);
    assert.equal(state.status, "completed");
    assert.equal(state.response.id, UHP_LIFECYCLE_FIXTURES.completed.id);
    // The initial response arrives on `response.created` and is kept: it carries the id and session a
    // continuation needs before the task has finished.
    assert.equal(state.created?.id, UHP_LIFECYCLE_FIXTURES.completed.id);
    assert.equal(state.created?.status, "in_progress");
    // Incremental output is assembled in order. "marySum" would pass a length check and be wrong.
    assert.equal(state.text, "Summary");
    assert.equal(state.ignored, 0);
    assert.equal(state.error, null);
  });

  it("mints growth evidence from deltas and output items, and from nothing else", () => {
    const state = consumeUhpStream(completedBody(), clockFrom(T0, 1_000));
    assert.ok(state.ok && state.done);
    // item.added, two deltas, item.done. The content-part and output_text.done frames are real events
    // and are not growth; counting them would make the stream look busier than the work it did.
    assert.deepEqual(state.freshness.map((item) => item.kind), ["item", "delta", "delta", "item"]);
    assert.deepEqual(
      state.freshness.map((item) => item.at),
      [T0, plus(T0, 1_000), plus(T0, 2_000), plus(T0, 3_000)],
    );
  });

  it("gives the same answer however the bytes are chunked", () => {
    const body = completedBody();
    const whole = consumeUhpStream(body, clockFrom(T0, 0));
    const reader = createUhpStreamReader(clockFrom(T0, 0));
    // Seven is chosen to split frames, the blank-line separator, and a JSON string mid-token.
    for (let index = 0; index < body.length; index += 7) reader.push(body.slice(index, index + 7));
    const chunked = reader.end();
    assert.ok(whole.ok && whole.done);
    assert.ok(chunked.ok && chunked.done);
    assert.equal(chunked.text, whole.text);
    assert.equal(chunked.status, whole.status);
    assert.equal(chunked.frames, whole.frames);
  });

  it("reports an open stream as open, with partial text, and only closes on the terminal frame", () => {
    const frames = uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["Sum", "mary"], item: true });
    const terminalFrame = frames[frames.length - 1];
    assert.ok(terminalFrame !== undefined);
    const reader = createUhpStreamReader(clockFrom(T0, 1_000));
    reader.push(encodeUhpFrames(frames.slice(0, -1)));

    const open = reader.state();
    assert.ok(open.ok);
    assert.equal(open.done, false);
    assert.equal(open.text, "Summary");
    assert.equal(open.created?.id, UHP_LIFECYCLE_FIXTURES.completed.id);

    // The same bytes, now closed. Only the terminal frame changes `done`, and `end()` on the open
    // stream would have refused it as truncated — which the fail-closed suite below pins.
    reader.push(encodeUhpFrames(frames).split("\n\n").slice(-2).join("\n\n"));
    const closed = reader.end();
    assert.ok(closed.ok && closed.done);
    assert.equal(closed.status, "completed");
  });

  it("ignores a keep-alive comment without consuming a sequence number", () => {
    const body = completedBody();
    // An SSE comment line is how a server holds a connection open. A reader that counted it as an event
    // would refuse every long-running stream with a sequence error.
    const withKeepAlive = `: keep-alive\n\n${body}`;
    const state = consumeUhpStream(withKeepAlive, clockFrom(T0, 1_000));
    assert.ok(state.ok && state.done);
    assert.equal(state.text, "Summary");
  });

  it("counts an undefined-by-UHP event type instead of trusting or refusing it", () => {
    const frames = [...uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["a"] })];
    frames.splice(2, 0, { type: "response.something_new", delta: "x", item: {} });
    const state = consumeUhpStream(encodeUhpFrames(frames), clockFrom(T0, 1_000));
    assert.ok(state.ok && state.done);
    assert.equal(state.ignored, 1);
    // It looked like growth and like an item. It contributed neither, because we do not know what it is.
    assert.deepEqual(state.freshness.map((item) => item.kind), ["delta"]);
    assert.equal(state.text, "a");
  });
});

describe("UHP SSE consumption — all five lifecycle statuses", () => {
  it("covers every status the protocol defines, so none can be added without a test", () => {
    assert.deepEqual([...UHP_LIFECYCLE_STATUSES].sort(), [
      "cancelled",
      "completed",
      "failed",
      "in_progress",
      "incomplete",
    ]);
  });

  const terminal: readonly UhpLifecycleStatus[] = ["completed", "failed", "incomplete", "cancelled"];
  for (const status of terminal) {
    it(`reads ${status} from the response object, which is the authoritative field`, () => {
      const fixture = status === "completed"
        ? UHP_LIFECYCLE_FIXTURES.completed
        : status === "failed"
        ? UHP_LIFECYCLE_FIXTURES.failed
        : status === "incomplete"
        ? UHP_LIFECYCLE_FIXTURES.incomplete
        : UHP_LIFECYCLE_FIXTURES.cancelled;
      const state = consumeUhpStream(uhpStreamBody(fixture, { deltas: ["x"] }), clockFrom(T0, 1_000));
      assert.ok(state.ok && state.done);
      assert.equal(state.status, status);
      assert.equal(state.response.status, status);
    });
  }

  it("does not report a cancelled task as failed, though its terminal EVENT is response.failed", () => {
    // The distinction this test exists for. Streaming §1 has no `response.cancelled` event: "A cancelled
    // task terminates with `response.failed` carrying `status: cancelled` in the response object", and
    // "The status field, not the event name, is authoritative."
    //
    // An adapter that switched on the event name would report `failed` here and look entirely
    // reasonable doing it. Asserting only `status !== "completed"` would pass under that bug.
    assert.equal(terminalEventFor("cancelled"), "response.failed");
    const body = uhpStreamBody(UHP_LIFECYCLE_FIXTURES.cancelled, { deltas: ["par", "tial"] });
    assert.match(body, /"type":"response\.failed"/);
    assert.doesNotMatch(body, /"type":"response\.cancelled"/);

    const state = consumeUhpStream(body, clockFrom(T0, 1_000));
    assert.ok(state.ok && state.done);
    assert.equal(state.status, "cancelled");
    assert.notEqual(state.status, "failed");
    // Lifecycle §4: "Terminal responses MUST retain whatever output was produced". A cancelled task's
    // partial output is real and is kept.
    assert.equal(state.text, "partial");
  });

  it("treats in_progress as a stream that has not ended, never as an outcome", () => {
    // `in_progress` is the one non-terminal status, so a stream carrying it has no terminal event. The
    // reader's open state says so, and `end()` refuses rather than promoting the last frame.
    assert.equal(terminalEventFor("in_progress"), "none");
    const body = uhpStreamBody(UHP_LIFECYCLE_FIXTURES.running, { deltas: ["work"] });
    const reader = createUhpStreamReader(clockFrom(T0, 1_000));
    reader.push(body);

    const open = reader.state();
    assert.ok(open.ok);
    assert.equal(open.done, false);
    assert.equal(open.text, "work");

    const ended = reader.end();
    assert.equal(refusalOf(ended), "truncated");
  });
});

describe("freshness is computed from evidence timestamps and cannot be derived from a status", () => {
  // Requirement A of #289. The defect being excluded: mapping `in_progress` to `live` and a terminal
  // status to `quiet`, which produces a green board for an agent that has produced nothing in hours.
  //
  // `assert(state !== "live")` would NOT cover this — it holds for the correct implementation and for
  // several wrong ones. Each test below asserts a distinction instead.

  it("does not compile a lifecycle status into freshness evidence", () => {
    // A compile-time proof, which is the strongest form available: these are type errors, so `tsc`
    // fails if the signature ever widens enough to accept them. `node --test` runs the compiled output,
    // so this test passing at all means the build already rejected the violation.
    // @ts-expect-error a lifecycle status is not a freshness kind
    const asStatus: UhpFreshnessEvidence[] = [{ at: T0, kind: "in_progress" }];
    // @ts-expect-error freshness evidence cannot be constructed outside the reader: the brand is private
    const forged: UhpFreshnessEvidence = { at: T0, kind: "delta" };
    // And at runtime, a cast that got past review is refused rather than trusted.
    assert.deepEqual(uhpFreshness(asStatus as UhpFreshnessEvidence[], T0), {
      state: "quiet",
      from: "none",
      at: null,
      ageMs: null,
    });
    assert.equal(uhpFreshness([forged], T0).state, "quiet");
  });

  it("gives a completed run with no growth the same freshness as a running one: none", () => {
    // The core of requirement A, stated as an equality. A status-driven implementation cannot satisfy
    // it: `completed` and `in_progress` are opposite claims and produce identical freshness, because
    // neither is evidence.
    const completed = consumeUhpStream(uhpStreamBody(UHP_LIFECYCLE_FIXTURES.completed, {}), clockFrom(T0, 0));
    assert.ok(completed.ok && completed.done);
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.freshness, []);

    const running = createUhpStreamReader(clockFrom(T0, 0));
    running.push(uhpStreamBody(UHP_LIFECYCLE_FIXTURES.running, {}));
    const open = running.state();
    assert.ok(open.ok);
    assert.equal(open.done, false);
    assert.deepEqual(open.freshness, []);

    const now = plus(T0, 60_000);
    assert.deepEqual(uhpFreshness(completed.freshness, now), uhpFreshness(open.freshness, now));
    assert.equal(uhpFreshness(completed.freshness, now).state, "quiet");
  });

  it("moves to live only on a delta or an item, and then only while it is recent", () => {
    const state = consumeUhpStream(completedBody(), clockFrom(T0, 1_000));
    assert.ok(state.ok && state.done);
    const newest = plus(T0, 3_000);

    const live = uhpFreshness(state.freshness, plus(newest, 60_000));
    assert.equal(live.state, "live");
    assert.equal(live.at, newest);
    assert.equal(live.from, "item");
    assert.equal(live.ageMs, 60_000);

    const recent = uhpFreshness(state.freshness, plus(newest, DEFAULT_UHP_WINDOWS.liveMs + 1_000));
    assert.equal(recent.state, "recent");

    const quiet = uhpFreshness(state.freshness, plus(newest, DEFAULT_UHP_WINDOWS.recentMs + 1_000));
    assert.equal(quiet.state, "quiet");

    // Three different states from one evidence set and three clocks. A status-derived implementation
    // would return one state for all three, because the status never moved.
    assert.equal(new Set([live.state, recent.state, quiet.state]).size, 3);
  });

  it("keeps a terminal status from making a stale run look fresh, or a live one look finished", () => {
    // The two false readings a status-derived freshness produces, both excluded on the same evidence.
    const stale = consumeUhpStream(completedBody(), clockFrom("2026-09-01T00:00:00.000Z", 1_000));
    assert.ok(stale.ok && stale.done);
    assert.equal(stale.status, "completed");
    // Eleven days later. The run is finished and its growth is ancient: quiet, not live.
    assert.equal(uhpFreshness(stale.freshness, T0).state, "quiet");

    const runningReader = createUhpStreamReader(clockFrom(T0, 1_000));
    runningReader.push(uhpStreamBody(UHP_LIFECYCLE_FIXTURES.running, { deltas: ["a", "b"], item: true }));
    const open = runningReader.state();
    assert.ok(open.ok && !open.done);
    // An unfinished run whose growth is seconds old is live. The status says `in_progress` in both
    // directions and decided neither.
    assert.equal(uhpFreshness(open.freshness, plus(T0, 5_000)).state, "live");
  });

  it("takes the newest timestamp rather than the strongest kind, and drops what it cannot date", () => {
    const state = consumeUhpStream(completedBody(), clockFrom(T0, 60_000));
    assert.ok(state.ok && state.done);
    const verdict = uhpFreshness(state.freshness, plus(T0, 180_000 + 1_000));
    // The last growth was an item boundary, three minutes after the first delta. Reporting the delta
    // because a delta is "stronger" would misdate the node by three minutes.
    assert.equal(verdict.from, "item");
    assert.equal(verdict.at, plus(T0, 180_000));

    assert.equal(uhpFreshness(state.freshness, "not a date").state, "quiet");
    assert.equal(uhpFreshness([], T0).from, "none");
  });

  it("never reports stalled, because a running claim is not freshness", () => {
    // `stalled` needs a claim that something is running, which is a lifecycle status, which this path
    // must not see. `@rickylabs/telemetry` owns that join (#206). The type excludes it; this pins the
    // behaviour over every clock a caller could pass.
    const state = consumeUhpStream(completedBody(), clockFrom(T0, 1_000));
    assert.ok(state.ok && state.done);
    const clocks = [T0, plus(T0, 1), plus(T0, 3_000), plus(T0, 10 ** 9), "1970-01-01T00:00:00.000Z"];
    for (const now of clocks) {
      const observed: string = uhpFreshness(state.freshness, now).state;
      assert.notEqual(observed, "stalled");
    }
  });
});

describe("UHP SSE consumption fails closed: truncated, out-of-order and malformed frames", () => {
  const expected: Readonly<Record<string, UhpStreamRefusal>> = {
    truncatedBetweenFrames: "truncated",
    truncatedMidFrame: "truncated",
    outOfOrder: "sequence-broken",
    droppedFrame: "sequence-broken",
    duplicatedFrame: "sequence-broken",
    malformedJson: "unparseable-frame",
    jsonNotObject: "unparseable-frame",
    untypedFrame: "untyped-frame",
    createdNotFirst: "created-misplaced",
    frameAfterTerminal: "frame-after-terminal",
    terminalStillRunning: "non-terminal-status",
    errorWithoutTerminal: "error-without-terminal",
    deltaWithoutText: "frame-unreadable",
  };

  it("has a case for every broken stream the mock can produce", () => {
    assert.deepEqual(Object.keys(UHP_BROKEN_STREAMS).sort(), Object.keys(expected).sort());
  });

  for (const [name, refusal] of Object.entries(expected)) {
    it(`refuses ${name} as ${refusal} rather than partially applying it`, () => {
      const body = UHP_BROKEN_STREAMS[name as keyof typeof UHP_BROKEN_STREAMS];
      const state = consumeUhpStream(body, clockFrom(T0, 1_000));

      // The specific refusal, not merely "not ok". A decoder that collapsed every fault into one word
      // would pass an `assert(!state.ok)` suite while making a truncated stream indistinguishable from
      // a server that cannot count.
      assert.equal(refusalOf(state), refusal);
      assert.equal(state.ok, false);

      // And nothing partial is reachable. This is the assertion a lenient decoder fails: it would hand
      // back the frames it did understand, and a caller would apply them.
      const reachable = state as unknown as Record<string, unknown>;
      assert.equal(reachable["response"], undefined);
      assert.equal(reachable["text"], undefined);
      assert.equal(reachable["freshness"], undefined);
      assert.equal(reachable["done"], undefined);
      // A refusal is described, never quoted: no payload bytes ride along in the diagnostic.
      assert.ok(!state.ok && state.detail.length > 0);
    });
  }

  it("keeps the partial output of a truncated stream out of the refusal entirely", () => {
    // `truncatedBetweenFrames` carried "Sum" and "mary" before the connection died. The tempting
    // behaviour is to return that text with a flag. The refusal must not contain it anywhere, because
    // once it is reachable it will be rendered, and a killed run will read as a short answer.
    const state = consumeUhpStream(UHP_BROKEN_STREAMS.truncatedBetweenFrames, clockFrom(T0, 1_000));
    assert.equal(state.ok, false);
    assert.ok(!JSON.stringify(state).includes("Summary"));
    assert.ok(!JSON.stringify(state).includes("mary"));
  });

  it("stays refused when a frame that would have been valid arrives after the damage", () => {
    // Stickiness, and the test has to be built with care to prove it. Pushing *any* later bytes is not
    // enough: after a refusal the sequence counter has stopped, so a fresh stream starting at 0 is
    // refused a second time for a new reason, and a reader that had silently reset would still look
    // refused. A mutation that dropped stickiness survived exactly that version of this test.
    //
    // So the repair frame is numbered to fit: `terminalStillRunning` is refused at frame 2, the counter
    // expects 3, and this frame is a correctly numbered, well-formed terminal event. A reader that reset
    // would accept it and report a finished run — which is the fabricated completion at issue.
    const reader = createUhpStreamReader(clockFrom(T0, 1_000));
    reader.push(UHP_BROKEN_STREAMS.terminalStillRunning);
    assert.equal(refusalOf(reader.state()), "non-terminal-status");

    const repair = `data: ${
      JSON.stringify({
        type: "response.completed",
        sequence_number: 3,
        response: UHP_LIFECYCLE_FIXTURES.completed,
      })
    }\n\n`;
    reader.push(repair);
    const after = reader.state();
    assert.equal(after.ok, false);
    assert.equal(refusalOf(after), "non-terminal-status");
    assert.equal((after as unknown as Record<string, unknown>)["response"], undefined);
    assert.equal((after as unknown as Record<string, unknown>)["done"], undefined);
    assert.equal(refusalOf(reader.end()), "non-terminal-status");

    // And the counter really was at 3, so the repair frame was genuinely acceptable-looking rather than
    // rejected for a second reason. Without this, the test above proves nothing.
    const fresh = createUhpStreamReader(clockFrom(T0, 1_000));
    // Three undamaged frames — created, in_progress, one delta — so this reader also expects 3 next.
    fresh.push(encodeUhpFrames(uhpStreamFrames(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["x"] }).slice(0, 3)));
    fresh.push(repair);
    const accepted = fresh.end();
    assert.ok(accepted.ok && accepted.done);
    assert.equal(accepted.status, "completed");
  });

  it("refuses an empty stream instead of reporting a finished run", () => {
    assert.equal(refusalOf(consumeUhpStream("", clockFrom(T0, 0))), "truncated");
    assert.equal(refusalOf(readUhpStream([], clockFrom(T0, 0))), "truncated");
  });

  it("accepts an error event that is followed by a terminal event, and keeps the error", () => {
    // The legal shape, kept next to the illegal one so the rule is visibly about the missing terminal
    // event and not about errors being fatal.
    const body = uhpStreamBody(UHP_LIFECYCLE_FIXTURES.failed, {
      deltas: ["par"],
      error: { code: "provider_error", message: "upstream refused the request" },
    });
    const state = consumeUhpStream(body, clockFrom(T0, 1_000));
    assert.ok(state.ok && state.done);
    assert.equal(state.status, "failed");
    assert.equal(state.error?.code, "provider_error");
    assert.notEqual(refusalOf(state), "error-without-terminal");
  });

  it("carries every refusal through decodeUhpStream as no response at all", () => {
    for (const body of Object.values(UHP_BROKEN_STREAMS)) {
      assert.equal(decodeUhpStream(body), undefined);
    }
    // And the conformant stream still decodes, so the check above is not vacuous.
    assert.equal(decodeUhpStream(completedBody())?.id, UHP_LIFECYCLE_FIXTURES.completed.id);
  });
});

describe("UHP SSE consumption over a real socket", () => {
  it("reads a streamed task from the loopback server with the same verdict as the fixture", async () => {
    const mock = await startUhpMock(UHP_LIFECYCLE_FIXTURES.completed, { deltas: ["Sum", "mary"], item: true });
    try {
      const exchange = await mock.send({ input: "Summarise README.md", stream: true });
      assert.equal(exchange.httpStatus, 200);
      assert.ok(exchange.contentType.startsWith("text/event-stream"));

      const state = consumeUhpStream(exchange.body, clockFrom(T0, 1_000));
      assert.ok(state.ok && state.done);
      assert.equal(state.status, "completed");
      assert.equal(state.text, "Summary");
      assert.equal(state.freshness.length, 4);
    } finally {
      await mock.close();
    }
  });

  it("reads a cancelled task over the socket without calling it failed", async () => {
    const mock = await startUhpMock(UHP_LIFECYCLE_FIXTURES.cancelled, { deltas: ["par", "tial"] });
    try {
      const exchange = await mock.send({ input: "long task", stream: true });
      const state = consumeUhpStream(exchange.body, clockFrom(T0, 1_000));
      assert.ok(state.ok && state.done);
      assert.equal(state.status, "cancelled");
      assert.notEqual(state.status, "failed");
      assert.equal(state.text, "partial");
    } finally {
      await mock.close();
    }
  });
});
