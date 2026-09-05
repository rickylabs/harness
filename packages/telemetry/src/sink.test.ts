/**
 * The sink's controls.
 *
 * Every claim here is about the filesystem, so every test drives the real sink against a real temp
 * directory. A rotation policy that is only proven against a fake writer proves the fake.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { byteLength, createFileSink, createMemorySink, createTeeSink } from "./sink.js";

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
  it("keeps writing to the survivors when one sink throws", async () => {
    // This is the case that matters: the transport is down for the same reason the run is wedged,
    // and the local file is the only record that will exist.
    const good = createMemorySink();
    const bad = {
      notes: [] as string[],
      write: () => Promise.reject(new Error("transport down")),
    };
    const tee = createTeeSink([bad, good]);

    await tee.write(event(1));
    assert.equal(good.events.length, 1);
    assert.match(tee.notes.join("\n"), /transport down/);
  });
});
