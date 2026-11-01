/** Test-only native subscription and monotonic timer controls for the public watch command. */
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { openIssueFeedChanges } from "../issue-agent-feed-changes.js";

/** Yield through real socket I/O without advancing a fake heartbeat or safety deadline. */
export async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "native fixture did not settle");
    await setImmediate();
  }
}
export async function settle(): Promise<void> { for (let i = 0; i < 10; i++) await setImmediate(); }

/** Owns one local source socket; every reconnect must send the same read-only subscription. */
export async function nativeChanges(acknowledge = true) {
  const root = await mkdtemp(join(tmpdir(), "iw-")), socket = join(root, "r.sock");
  const clients: Socket[] = [], live = new Set<Socket>();
  let requests = 0;
  const server = createServer(conn => {
    clients.push(conn); live.add(conn); conn.on("error", () => {});
    conn.on("close", () => live.delete(conn));
    conn.setEncoding("utf8"); let bytes = "";
    conn.on("data", (chunk: string) => {
      bytes += chunk;
      if (!bytes.includes("\n")) return;
      assert.deepEqual(JSON.parse(bytes), { id: "run-changes", method: "run.subscribe", params: {} });
      bytes = ""; requests++;
      if (acknowledge) conn.write(JSON.stringify({ id: "run-changes", result: { type: "subscription_started" } }) + "\n");
    });
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  const changes = openIssueFeedChanges(socket);
  await until(() => requests === 1);
  if (acknowledge) await until(() => changes.consume());
  return { changes, clients, get requests() { return requests; },
    setAcknowledgment(value: boolean) { acknowledge = value; },
    send(count = 1) { clients.at(-1)!.write((JSON.stringify({ event: { type: "runs_changed" } }) + "\n").repeat(count)); },
    ack() { clients.at(-1)!.write(JSON.stringify({ id: "run-changes", result: { type: "subscription_started" } }) + "\n"); },
    async close() {
      changes.close(); for (const conn of live) conn.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    } };
}

/** Abort-aware fake timer: exposes outstanding resources as well as monotonic time. */
export class FeedClock {
  elapsed = 0;
  readonly timers = new Map<() => void, number>();
  readonly now = () => new Date(Date.parse("2026-01-01T00:00:00.000Z") + this.elapsed).toISOString();
  readonly wait = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cleanup = () => { this.timers.delete(done); signal.removeEventListener("abort", abort); };
    const done = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal.reason); };
    this.timers.set(done, this.elapsed + ms); signal.addEventListener("abort", abort, { once: true });
  });
  advance(ms: number): void {
    this.elapsed += ms;
    for (const [done, at] of this.timers) if (at <= this.elapsed) done();
  }
}
