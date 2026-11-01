/** Consumer watch behavior: fake deadlines, real native hints, validated full snapshots. */
import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";
import { Writable } from "node:stream";
import { getEventListeners } from "node:events";
import type { IssueAgentTreeFrame } from "@rickylabs/harness-contracts";
import { issueAgentFeedCommand, type IssueAgentFeedOptions } from "./issue-agent-feed-cli.js";
import { FeedClock, nativeChanges, settle, until } from "./fixtures/issue-agent-feed-wake.js";

async function watch(t: TestContext, hooks: {
  collect?: () => Promise<void>; write?: (done: () => void) => void;
} = {}) {
  const native = await nativeChanges(), clock = new FeedClock(), frames: IssueAgentTreeFrame[] = [];
  let scans = 0, active = 0, maxActive = 0;
  const signals: AbortSignal[] = [];
  const output = new Writable({ write(chunk: Buffer, _encoding, done) {
    frames.push(JSON.parse(chunk.toString("utf8")) as IssueAgentTreeFrame);
    if (hooks.write) hooks.write(done); else done();
  } });
  const collect = async (options: IssueAgentFeedOptions) => {
    scans++; active++; maxActive = Math.max(active, maxActive);
    await hooks.collect?.(); active--;
    return { schema: 1 as const, protocol: 1 as const, observedAt: options.now,
      validUntil: new Date(Date.parse(options.now) + 15_000).toISOString(), revision: "a".repeat(64),
      complete: true, reason: null, issues: [] };
  };
  const task = issueAgentFeedCommand(["--watch"], { output, changes: native.changes, collect, env: {},
    now: clock.now, elapsed: () => clock.elapsed, generation: () => "fixture-generation",
    wait(ms, signal) { signals.push(signal); return clock.wait(ms, signal); } });
  t.after(async () => { output.emit("close"); await task; await native.close(); });
  return { native, clock, frames, signals, output, task, get scans() { return scans; }, get maxActive() { return maxActive; } };
}

it("native wake publishes immediately, cancels the heartbeat, and adds nothing when unchanged", async t => {
  const f = await watch(t);
  await until(() => f.clock.timers.size === 1);
  f.clock.advance(137);
  f.native.send(100);
  await until(() => f.frames.length === 2);
  await settle();
  assert.equal(f.scans, 2); assert.equal(f.clock.elapsed, 137);
  assert.equal(f.frames[1]!.snapshot.observedAt, f.clock.now());
  assert.deepEqual(f.frames.map(frame => frame.sequence), [0, 1]);
  assert.ok(f.frames.every(frame => frame.generation === "fixture-generation"));
  assert.equal(f.clock.timers.size, 1, "event cancels the losing timer");
  assert.equal(f.signals[0]!.aborted, true);
  f.clock.advance(4863); await settle();
  assert.equal(f.frames.length, 2, "the cancelled original heartbeat cannot publish");
  assert.equal(f.scans, 2);
  f.clock.advance(137); await until(() => f.frames.length === 3);
  assert.equal(f.scans, 2, "consumed hint cannot cause a duplicate scan");
  assert.deepEqual(f.frames[2]!.snapshot, f.frames[1]!.snapshot, "heartbeat cannot renew freshness");
  for (const signal of f.signals.slice(0, -1)) {
    assert.equal(getEventListeners(signal, "abort").length, 0, "losing event waits remove listeners");
  }
});

it("hints during a scan coalesce into one follow-up and survive wait registration", async t => {
  let release: (() => void) | undefined;
  const f = await watch(t, { collect: () => new Promise<void>(resolve => { release = resolve; }) });
  await until(() => release !== undefined);
  f.native.send(100); await settle();
  const finish = release!; release = undefined; finish();
  await until(() => f.scans === 2);
  assert.equal(f.clock.elapsed, 0); assert.equal(f.maxActive, 1);
  assert.equal(f.frames.length, 1);
  release!(); await until(() => f.clock.timers.size === 1);
  await settle();
  assert.equal(f.scans, 2); assert.equal(f.frames.length, 2);
});

it("hints during output backpressure wait for the callback then cause exactly one reread", async t => {
  let release: (() => void) | undefined;
  const f = await watch(t, { write(done) { release = done; } });
  await until(() => release !== undefined);
  f.native.send(100); await settle();
  assert.equal(f.scans, 1); assert.equal(f.clock.timers.size, 0);
  const finish = release!; release = undefined; finish();
  await until(() => f.frames.length === 2);
  assert.equal(f.scans, 2); assert.equal(f.maxActive, 1);
  release!(); await until(() => f.clock.timers.size === 1);
  await settle(); assert.equal(f.scans, 2);
});

it("idle heartbeats do not scan and the 12-second safety reread repairs a missed hint", async t => {
  const f = await watch(t);
  await until(() => f.clock.timers.size === 1);
  for (const ms of [5000, 5000]) {
    f.clock.advance(ms); await until(() => f.clock.timers.size === 1); await settle();
    assert.equal(f.scans, 1);
  }
  assert.equal(f.frames.length, 3);
  f.clock.advance(1999); await settle(); assert.equal(f.scans, 1);
  f.clock.advance(1); await until(() => f.scans === 2);
  await until(() => f.frames.length === 4);
  assert.equal(f.frames[3]!.snapshot.observedAt, f.clock.now());
});

it("a disconnected source publishes its loss once, with no extra reads on failed reconnects", async t => {
  const f = await watch(t);
  await until(() => f.clock.timers.size === 1);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.native.setAcknowledgment(false); f.native.clients[0]!.destroy();
  await until(() => f.frames.length === 2);
  await until(() => f.clock.timers.size === 1);
  for (let count = 1; count <= 3; count++) {
    t.mock.timers.tick(1000); await until(() => f.native.requests === count + 1);
    f.native.clients.at(-1)!.destroy(); await settle();
    assert.equal(f.frames.length, 2); assert.equal(f.scans, 2);
  }
  f.clock.advance(5000); await until(() => f.frames.length === 3);
  assert.equal(f.scans, 2, "outage heartbeat retains its last actual observation");
  f.clock.advance(5000); await until(() => f.frames.length === 4);
  f.clock.advance(2000); await until(() => f.scans === 3);
});

it("many heartbeat and event races leave only the current waiter registered", async t => {
  const f = await watch(t);
  await until(() => f.clock.timers.size === 1);
  for (let count = 0; count < 30; count++) {
    const before = f.frames.length;
    if (count % 2) { f.clock.advance(1); f.native.send(); } else f.clock.advance(5000);
    await until(() => f.frames.length === before + 1);
    await until(() => f.clock.timers.size === 1);
    for (const signal of f.signals.slice(0, -1)) {
      assert.equal(signal.aborted, true);
      assert.equal(getEventListeners(signal, "abort").length, 0);
    }
  }
});

it("consumer close and SIGTERM abort the event wait and its heartbeat", async t => {
  for (const signal of [false, true]) await t.test(signal ? "SIGTERM" : "output close", async t => {
    const f = await watch(t);
    await until(() => f.clock.timers.size === 1);
    if (signal) process.emit("SIGTERM"); else f.output.emit("close");
    assert.equal(await f.task, 0);
    assert.equal(f.clock.timers.size, 0);
    assert.ok(f.signals.every(signal => signal.aborted));
    f.clock.advance(12000); await settle(); assert.equal(f.frames.length, 1);
  });
});
