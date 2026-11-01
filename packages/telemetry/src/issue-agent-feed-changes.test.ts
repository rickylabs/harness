/** Native hints invalidate; only a bounded subsequent snapshot establishes facts. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { nativeChanges, settle, until } from "./fixtures/issue-agent-feed-wake.js";
import { openIssueFeedChanges } from "./issue-agent-feed-changes.js";

it("native hints wake once, preserve the dirty bit before registration, and coalesce bursts", async t => {
  const f = await nativeChanges(); t.after(() => f.close());
  const abort = new AbortController(); t.after(() => abort.abort());
  const pending = f.changes.wait(abort.signal);
  f.send(100); await pending;
  // No consumer ran between the notification and this wait: it must not await a second event.
  let immediate = false;
  void f.changes.wait(abort.signal).then(() => { immediate = true; });
  await settle(); assert.equal(immediate, true);
  assert.equal(f.changes.consume(), true); assert.equal(f.changes.consume(), false);
  let spurious = false;
  const quiet = f.changes.wait(abort.signal).then(() => { spurious = true; }, () => {});
  await settle(); assert.equal(spurious, false);
  abort.abort(); await quiet;
});

it("fragmented frames wake only when complete and shutdown releases pending waits", async t => {
  const f = await nativeChanges(); t.after(() => f.close());
  const abort = new AbortController(); let woke = false;
  const wait = f.changes.wait(abort.signal).then(() => { woke = true; });
  f.clients[0]!.write('{"event":{"type":"runs_');
  await settle(); assert.equal(woke, false); assert.equal(f.changes.consume(), false);
  f.clients[0]!.write('changed"}}\n'); await wait;
  assert.equal(f.changes.consume(), true);
  const closed = f.changes.wait(abort.signal);
  f.changes.close(); await closed;
  await f.changes.wait(abort.signal);
  await settle(); assert.equal(f.changes.consume(), false, "shutdown is not source invalidation");
  abort.abort(); await assert.rejects(f.changes.wait(abort.signal), { name: "AbortError" });
});

it("loss and reconnect acknowledgment wake promptly with exactly one bounded retry", async t => {
  const f = await nativeChanges(); t.after(() => f.close());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abort = new AbortController(); t.after(() => abort.abort());
  const lost = f.changes.wait(abort.signal);
  f.clients[0]!.destroy(); await lost;
  assert.equal(f.changes.consume(), true); assert.equal(f.changes.consume(), false);
  t.mock.timers.tick(999); await settle(); assert.equal(f.requests, 1);
  const recovered = f.changes.wait(abort.signal);
  t.mock.timers.tick(1); await recovered;
  assert.equal(f.requests, 2); assert.equal(f.changes.consume(), true);
  assert.equal(f.changes.consume(), false);
  f.changes.close(); t.mock.timers.tick(12000); await settle(); assert.equal(f.requests, 2);
});

it("repeated unacknowledged reconnect failures never wake or mark unchanged evidence dirty", async t => {
  const f = await nativeChanges(false); t.after(() => f.close());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abort = new AbortController(); t.after(() => abort.abort());
  let woke = false;
  const quiet = f.changes.wait(abort.signal).then(() => { woke = true; }, () => {});
  for (let count = 1; count <= 3; count++) {
    f.clients.at(-1)!.destroy(); await settle();
    assert.equal(woke, false); assert.equal(f.changes.consume(), false);
    t.mock.timers.tick(999); await settle(); assert.equal(f.requests, count);
    t.mock.timers.tick(1); await until(() => f.requests === count + 1);
  }
  f.changes.close(); await quiet;
});

it("malformed and oversized acknowledged frames invalidate once then wait for reconnect", async t => {
  for (const frame of ["{broken\n", "{}\n", "x".repeat(65537)]) await t.test(`invalid frame length ${frame.length}`, async t => {
    const f = await nativeChanges(); t.after(() => f.close());
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const abort = new AbortController(); t.after(() => abort.abort());
    const lost = f.changes.wait(abort.signal);
    f.clients[0]!.write(frame); await lost;
    assert.equal(f.changes.consume(), true); assert.equal(f.changes.consume(), false);
    t.mock.timers.tick(999); await settle(); assert.equal(f.requests, 1);
    t.mock.timers.tick(1); await until(() => f.requests === 2);
    await until(() => f.changes.consume());
    assert.equal(f.changes.consume(), false);
  });
});

it("an unbound source leaves repair to the timer and supports abort and close", async () => {
  for (const socket of [undefined, "relative.sock"]) {
    const changes = openIssueFeedChanges(socket), abort = new AbortController();
    const pending = changes.wait(abort.signal);
    assert.equal(changes.consume(), false);
    abort.abort(); await assert.rejects(pending, { name: "AbortError" });
    changes.close(); await changes.wait(new AbortController().signal);
  }
});
