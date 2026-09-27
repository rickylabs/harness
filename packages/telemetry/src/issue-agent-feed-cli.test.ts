import assert from "node:assert/strict";
import { it } from "node:test";
import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import { issueAgentFeedCommand } from "./issue-agent-feed-cli.js";
import type { IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";

const at = "2026-01-01T00:00:00.000Z";
const snapshot = (complete: boolean): IssueAgentTreeSnapshot => ({ schema: 1, protocol: 1, observedAt: at,
  validUntil: "2026-01-01T00:00:15.000Z",
  revision: createHash("sha256").update(String(complete)).digest("hex"), complete,
  reason: complete ? null : "source_unavailable", issues: [] });
class Capture extends Writable {
  readonly lines: string[] = [];
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString("utf8")); callback();
  }
}

it("emits sequenced full snapshots, heartbeat, and degradation after success", async () => {
  const output = new Capture(); let calls = 0, waits = 0;
  const code = await issueAgentFeedCommand(["--watch", "--interval-ms", "100"], {
    output, now: () => at, generation: () => "generation-a", env: {},
    collect: async () => { calls++; if (calls === 3) throw Error("PRIVATE-PATH-CANARY"); return snapshot(true); },
    wait: async () => { if (++waits === 3) output.emit("close"); },
  });
  assert.equal(code, 0);
  const frames = output.lines.map(line => JSON.parse(line));
  assert.deepEqual(frames.map(f => f.sequence), [0, 1, 2]);
  assert.deepEqual(frames.map(f => f.generation), ["generation-a", "generation-a", "generation-a"]);
  assert.deepEqual(frames.map(f => f.snapshot.complete), [true, true, false]);
  assert.equal(frames[2].snapshot.reason, "source_unavailable");
  assert.ok(!output.lines.join("").includes("PRIVATE-"));
});
it("a new process generation starts with seq zero and one-shot reports incompleteness", async () => {
  const output = new Capture();
  assert.equal(await issueAgentFeedCommand(["--json"], { output, now: () => at, collect: async () => snapshot(false) }), 3);
  assert.equal(JSON.parse(output.lines[0]!).complete, false);
  const next = new Capture();
  assert.equal(await issueAgentFeedCommand(["--watch"], { output: next, now: () => at, generation: () => "generation-b",
    collect: async () => snapshot(true), wait: async () => { next.emit("close"); } }), 0);
  assert.equal(JSON.parse(next.lines[0]!).sequence, 0);
  assert.equal(JSON.parse(next.lines[0]!).generation, "generation-b");
});
it("awaits the write callback before collecting a second snapshot", async () => {
  let release: (() => void) | undefined, collected = 0;
  const output = new Writable({ write(_chunk, _encoding, callback) { release = () => callback(); } });
  const task = issueAgentFeedCommand(["--watch"], { output, now: () => at, collect: async () => { collected++; return snapshot(true); },
    wait: async () => { output.emit("close"); } });
  for (let i = 0; i < 20 && !release; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(collected, 1);
  assert.ok(release);
  release();
  assert.equal(await task, 0);
  assert.equal(collected, 1);
});
it("closes an in-flight write when its consumer disconnects", async () => {
  let started = false;
  const output = new Writable({ write(_chunk, _encoding, _callback) { started = true; } });
  const task = issueAgentFeedCommand(["--watch"], { output, now: () => at, collect: async () => snapshot(true) });
  for (let i = 0; i < 20 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  output.emit("close");
  assert.equal(await task, 3);
});
it("normalizes oversized or invalid collector output to an incomplete bounded frame", async () => {
  const output = new Capture();
  const huge = { ...snapshot(true), unexpected: "PRIVATE-PATH-CANARY".repeat(200_000) } as IssueAgentTreeSnapshot;
  assert.equal(await issueAgentFeedCommand(["--json"], { output, now: () => at, collect: async () => huge }), 3);
  assert.equal(JSON.parse(output.lines[0]!).complete, false);
  assert.ok(output.lines[0]!.length < 1024);
  assert.ok(!output.lines[0]!.includes("PRIVATE-"));
});
it("fails a broken output without silently continuing the watch", async () => {
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(Error("broken")); } });
  const code = await issueAgentFeedCommand(["--watch"], { output, now: () => at, collect: async () => snapshot(true) });
  assert.equal(code, 3);
});
it("withholds a snapshot that expired during collection and bounds the watch interval", async () => {
  const output = new Capture(); let ticks = 0;
  const code = await issueAgentFeedCommand(["--json"], { output,
    now: () => ++ticks === 1 ? at : "2026-01-01T00:00:16.000Z",
    collect: async () => snapshot(true) });
  assert.equal(code, 3);
  const emitted = JSON.parse(output.lines[0]!);
  assert.equal(emitted.complete, false);
  assert.equal(emitted.reason, "source_unavailable");
  assert.equal(emitted.observedAt, "2026-01-01T00:00:16.000Z");
  assert.equal(await issueAgentFeedCommand(["--json", "--interval-ms", "15000"], {
    output: new Capture(), now: () => at, collect: async () => snapshot(true) }), 2);
});
