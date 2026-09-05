/**
 * The sink's controls.
 *
 * Every claim here is about the filesystem, so every test drives the real sink against a real temp
 * directory. A rotation policy that is only proven against a fake writer proves the fake.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  byteLength,
  createFileSink,
  createMemorySink,
  createTeeSink,
  type SessionTelemetrySink,
  type TelemetryEvent,
} from "./sink.js";

/** An event whose `runId` cannot be read. Ordinary as far as the runtime is concerned. */
const hostile = (): TelemetryEvent =>
  ({
    at: "2026-09-05T00:00:00.000Z",
    kind: "tick",
    get runId(): string {
      throw new Error("runId getter exploded");
    },
  }) as unknown as TelemetryEvent;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-telemetry-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const event = (n: number) => ({ at: "2026-09-05T00:00:00.000Z", runId: `r${n}`, kind: "tick" });

describe("createFileSink", () => {
  it("creates the directory it was pointed at, rather than failing the run", async () => {
    const dir = join(root, "observability", "nested");
    const sink = createFileSink({ directory: dir, policy: { name: "t.jsonl", maxBytes: 4096, maxGenerations: 2 } });
    await sink.write(event(1));
    assert.equal((await stat(join(dir, "t.jsonl"))).isFile(), true);
    assert.deepEqual(sink.notes, []);
  });

  it("keeps the live file under the bound across many writes", async () => {
    // The bound is the reason this package is allowed to run on the same box as the agents.
    const line = byteLength(`${JSON.stringify(event(1))}\n`);
    const sink = createFileSink({
      directory: root,
      policy: { name: "t.jsonl", maxBytes: line * 3, maxGenerations: 2 },
    });
    for (let i = 0; i < 40; i += 1) await sink.write(event(i));

    for (const name of await readdir(root)) {
      const size = (await stat(join(root, name))).size;
      assert.ok(size <= line * 3, `${name} is ${size} bytes, over the bound`);
    }
  });

  it("keeps exactly the configured number of generations and no more", async () => {
    const line = byteLength(`${JSON.stringify(event(1))}\n`);
    const sink = createFileSink({
      directory: root,
      policy: { name: "t.jsonl", maxBytes: line, maxGenerations: 2 },
    });
    for (let i = 0; i < 20; i += 1) await sink.write(event(i));

    const files = (await readdir(root)).sort();
    assert.deepEqual(files, ["t.1.jsonl", "t.2.jsonl", "t.jsonl"]);
  });

  it("moves the evicted generation to the cold tier instead of deleting it", async () => {
    const line = byteLength(`${JSON.stringify(event(1))}\n`);
    const archive = join(root, "archives");
    const hot = join(root, "observability");
    const sink = createFileSink({
      directory: hot,
      archiveDirectory: archive,
      policy: { name: "t.jsonl", maxBytes: line, maxGenerations: 1 },
    });
    for (let i = 0; i < 6; i += 1) await sink.write(event(i));

    const cold = await readdir(archive);
    assert.ok(cold.length > 0, "nothing reached the cold tier");
    assert.ok(
      cold.every((n) => n.startsWith("t.1-") && n.endsWith(".jsonl")),
      `unexpected cold-tier names: ${cold.join(", ")}`,
    );
  });

  it("writes an oversized record and says so, rather than dropping it silently", async () => {
    // A dropped record nobody hears about is the exact failure this package exists to delete.
    const sink = createFileSink({
      directory: root,
      policy: { name: "t.jsonl", maxBytes: 10, maxGenerations: 1 },
    });
    await sink.write({ ...event(1), detail: { padding: "x".repeat(200) } });

    assert.equal(sink.notes.length, 1);
    assert.match(sink.notes[0] ?? "", /over the 10-byte bound/);
    const text = await readFile(join(root, "t.jsonl"), "utf8");
    assert.match(text, /xxxxx/);
  });

  it("holds the bound across separate sinks writing the same file", async () => {
    // The promise chain coordinates one instance. On this box the fleet is many processes writing
    // one `~/observability` directory, and thirty-two instances each saw an empty file and appended:
    // 3,478 bytes under a 220-byte policy, with no note (finding F-3 on #105). Separate instances
    // are as close as a single-process test gets, and they contend for the same lock, which is a
    // directory on disk rather than anything held in this heap.
    const line = byteLength(`${JSON.stringify(event(1))}\n`);
    const policy = { name: "t.jsonl", maxBytes: line * 2, maxGenerations: 3 };
    const sinks = Array.from({ length: 8 }, () => createFileSink({ directory: root, policy }));
    await Promise.all(sinks.map((sink, i) => sink.write(event(i))));

    for (const name of await readdir(root)) {
      const found = await stat(join(root, name));
      if (!found.isFile()) continue; // The lock is a directory, and may not have been swept yet.
      assert.ok(found.size <= line * 2, `${name} is ${found.size} bytes, over the bound`);
    }
  });

  it("says so when a generation cannot be rotated out, instead of blanking the live file", async () => {
    // Every eviction and rename error used to be discarded and the live file truncated anyway, which
    // turned a rotation failure into silent data loss: the preceding record was simply gone and
    // `notes` was empty. A directory where the oldest generation belongs is the review's own probe.
    const line = byteLength(`${JSON.stringify(event(1))}\n`);
    const sink = createFileSink({
      directory: root,
      policy: { name: "t.jsonl", maxBytes: line, maxGenerations: 2 },
    });
    await sink.write(event(1));
    await mkdir(join(root, "t.2.jsonl"), { recursive: true });
    await writeFile(join(root, "t.2.jsonl", "occupied"), "x", "utf8");
    await sink.write(event(2));

    const text = await readFile(join(root, "t.jsonl"), "utf8");
    assert.match(text, /"runId":"r1"/, "a failed rotation destroyed the record already on disk");
    assert.match(text, /"runId":"r2"/, "the new record was not written");
    assert.match(sink.notes.join("\n"), /rotation abandoned before writing r2/);
  });

  it("gives every archived generation a name of its own", async () => {
    // Five rotations inside one millisecond kept three records and silently overwrote two, because
    // the cold-tier name was `Date.now()` and nothing else.
    const line = byteLength(`${JSON.stringify(event(1))}\n`);
    const archive = join(root, "archives");
    const sink = createFileSink({
      directory: join(root, "observability"),
      archiveDirectory: archive,
      policy: { name: "t.jsonl", maxBytes: line, maxGenerations: 1 },
    });
    for (let i = 0; i < 6; i += 1) await sink.write(event(i));

    const cold = await readdir(archive);
    assert.ok(cold.length > 1, "not enough generations reached the cold tier to collide");
    assert.equal(new Set(cold).size, cold.length, "two generations share a cold-tier name");
    const runIds = new Set<string>();
    for (const name of cold) {
      for (const m of (await readFile(join(archive, name), "utf8")).matchAll(/"runId":"(r\d+)"/g)) {
        runIds.add(m[1] ?? "");
      }
    }
    assert.equal(runIds.size, cold.length, `${cold.length} archives hold only ${runIds.size} runs`);
  });

  it("serializes concurrent writes, so the bound is not a race", async () => {
    // Two appends that each read the size before either writes would both decide not to rotate.
    const line = byteLength(`${JSON.stringify(event(1))}\n`);
    const sink = createFileSink({
      directory: root,
      policy: { name: "t.jsonl", maxBytes: line * 2, maxGenerations: 3 },
    });
    await Promise.all(Array.from({ length: 30 }, (_, i) => sink.write(event(i))));

    for (const name of await readdir(root)) {
      assert.ok((await stat(join(root, name))).size <= line * 2, `${name} breached the bound`);
    }
  });

  it("survives an event whose own runId throws when it is read", async () => {
    // A `TelemetryEvent` comes from a caller this package does not control, and this one is a
    // perfectly ordinary object as far as the runtime is concerned. The error handler used to read
    // `event.runId` a second time, so the handler threw too and the write rejected (finding F-1).
    const sink = createFileSink({
      directory: root,
      policy: { name: "t.jsonl", maxBytes: 4096, maxGenerations: 1 },
    });

    await assert.doesNotReject(() => sink.write(hostile()));
    assert.match(sink.notes.join("\n"), /an unidentified run/);
  });

  it("keeps taking writes after one of them fails", async () => {
    // The queue was chained with `queue.then(...)` and no rejection handler, so the first rejection
    // *was* the queue when the next write chained onto it: one bad event silenced the sink for the
    // rest of the process, and every later write rejected with the first one's error.
    const sink = createFileSink({
      directory: root,
      policy: { name: "t.jsonl", maxBytes: 4096, maxGenerations: 1 },
    });

    await sink.write(hostile());
    await assert.doesNotReject(() => sink.write(event(2)));
    assert.match(await readFile(join(root, "t.jsonl"), "utf8"), /"runId":"r2"/);
  });

  it("turns an unserializable record into a note and keeps going", async () => {
    const sink = createFileSink({
      directory: root,
      policy: { name: "t.jsonl", maxBytes: 4096, maxGenerations: 1 },
    });
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    await sink.write({ ...event(1), detail: circular });
    await sink.write(event(2));
    assert.equal(sink.notes.length, 1);
    assert.match(sink.notes[0] ?? "", /sink write failed for r1/);
    assert.match(await readFile(join(root, "t.jsonl"), "utf8"), /"runId":"r2"/);
  });

  it("turns a write failure into a note rather than an exception", async () => {
    // A run must never fail because telemetry did.
    const sink = createFileSink({
      directory: join(root, "gone"),
      policy: { name: "t.jsonl", maxBytes: 4096, maxGenerations: 1 },
    });
    await sink.write(event(1));
    await rm(join(root, "gone"), { recursive: true, force: true });
    // The directory is created once; removing it under the sink is exactly the operational case.
    await assert.doesNotReject(() => sink.write(event(2)));
  });
});

describe("createTeeSink", () => {
  /** A transport that fails in whatever way a test needs, without touching the disk. */
  const transport = (write: () => Promise<void>): SessionTelemetrySink => ({ notes: [], write });

  it("keeps writing to the survivors when one sink rejects", async () => {
    // This is the case that matters: the transport is down for the same reason the run is wedged,
    // and the local file is the only record that will exist.
    const good = createMemorySink();
    const tee = createTeeSink([transport(() => Promise.reject(new Error("transport down"))), good]);

    await tee.write(event(1));
    assert.equal(good.events.length, 1);
    assert.match(tee.notes.join("\n"), /sink 0 did not take the record \(transport down\)/);
  });

  it("invokes every leg even when an earlier one throws on the way in", async () => {
    // The legs were built with `sinks.map((s) => s.write(event))`, so a *synchronous* throw escaped
    // before `allSettled` ever saw a promise: the caller rejected, and a transport sitting ahead of
    // the disk sink in the array stopped the disk sink being invoked at all (finding F-2 on #105).
    // Array order deciding whether the local record exists is precisely backwards.
    const good = createMemorySink();
    const tee = createTeeSink([
      transport(() => {
        throw new Error("transport down");
      }),
      good,
    ]);

    await assert.doesNotReject(() => tee.write(event(1)));
    assert.equal(good.events.length, 1, "the leg after the throwing one was never invoked");
    assert.match(tee.notes.join("\n"), /sink 0 did not take the record/);
  });

  it("stops waiting for a leg that never settles", async () => {
    // A transport that accepts the record and then says nothing would otherwise hang the run that
    // is writing to it — forever, with the disk record already safely on disk.
    const good = createMemorySink();
    // Released only after the assertions below, so `write` demonstrably returned without it — and
    // the test does not leave a promise pending for the runner to trip over on the way out.
    let release = (): void => {};
    const stuck = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tee = createTeeSink([transport(() => stuck), good], { timeoutMs: 20 });

    try {
      await assert.doesNotReject(() => tee.write(event(1)));
      assert.equal(good.events.length, 1);
      assert.match(
        tee.notes.join("\n"),
        /sink 0 did not take the record \(did not settle within 20 ms\)/,
      );
    } finally {
      release();
    }
  });

  it("reports which leg failed, so a note names the sink and not just the fault", async () => {
    const tee = createTeeSink([
      createMemorySink(),
      transport(() => Promise.reject(new Error("relay refused"))),
    ]);

    await tee.write(event(1));
    assert.match(tee.notes.join("\n"), /sink 1 /);
  });
});
