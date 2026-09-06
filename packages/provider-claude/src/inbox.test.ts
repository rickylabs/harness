/**
 * The queue that makes `steer` and `stop` mean anything.
 *
 * Small enough to read in one sitting, so the tests are about the two orderings that are easy to get
 * wrong and expensive to get wrong: a message pushed in the same tick as the close (it must still be
 * delivered — "say this, then finish" is the ordinary shape of a steer that ends a run), and a push
 * after the close (it must be *refused*, because a queued-and-never-read message reported as
 * delivered is a coordinator believing it steered a run it did not).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Inbox } from "./inbox.js";

interface Note {
  readonly text: string;
}

/** Collect a whole stream. Only safe on an inbox that is closed or will be. */
async function drain(inbox: Inbox<Note>): Promise<string[]> {
  const seen: string[] = [];
  for await (const note of inbox.stream()) seen.push(note.text);
  return seen;
}

describe("delivering what was queued", () => {
  it("hands messages to the consumer in the order they were pushed", async () => {
    const inbox = new Inbox<Note>();
    inbox.push({ text: "one" });
    inbox.push({ text: "two" });
    inbox.close();
    assert.deepEqual(await drain(inbox), ["one", "two"]);
  });

  it("drains what is queued before honouring the close", async () => {
    // The steer-then-stop shape. Closing first and losing the message would make `steer` report
    // `delivered` for a message no agent ever saw.
    const inbox = new Inbox<Note>();
    inbox.push({ text: "last word" });
    inbox.close();
    assert.deepEqual(await drain(inbox), ["last word"]);
  });

  it("ends an empty stream immediately once closed", async () => {
    const inbox = new Inbox<Note>();
    inbox.close();
    assert.deepEqual(await drain(inbox), []);
  });

  it("wakes a consumer that is already parked", async () => {
    const inbox = new Inbox<Note>();
    const collected = drain(inbox);
    await Promise.resolve();
    inbox.push({ text: "arrived late" });
    inbox.close();
    assert.deepEqual(await collected, ["arrived late"]);
  });

  it("keeps waking a consumer across several parks", async () => {
    const inbox = new Inbox<Note>();
    const collected = drain(inbox);
    for (const text of ["a", "b", "c"]) {
      await Promise.resolve();
      inbox.push({ text });
    }
    inbox.close();
    assert.deepEqual(await collected, ["a", "b", "c"]);
  });
});

describe("refusing what cannot be delivered", () => {
  it("says so when the inbox is closed, rather than queueing into nothing", async () => {
    const inbox = new Inbox<Note>();
    assert.equal(inbox.push({ text: "in time" }), true);
    inbox.close();
    assert.equal(inbox.push({ text: "too late" }), false);
    assert.deepEqual(await drain(inbox), ["in time"]);
  });

  it("closes idempotently", () => {
    const inbox = new Inbox<Note>();
    inbox.close();
    inbox.close();
    assert.equal(inbox.closed, true);
  });
});

describe("counting", () => {
  it("reports what is waiting and what has been taken", async () => {
    // `steer` reports the queue depth back to the caller, so these two numbers end up in a detail
    // line a person reads. They should mean what they say.
    const inbox = new Inbox<Note>();
    assert.equal(inbox.pending, 0);
    assert.equal(inbox.delivered, 0);

    inbox.push({ text: "one" });
    inbox.push({ text: "two" });
    assert.equal(inbox.pending, 2);
    assert.equal(inbox.delivered, 0);

    inbox.close();
    await drain(inbox);
    assert.equal(inbox.pending, 0);
    assert.equal(inbox.delivered, 2);
  });
});
