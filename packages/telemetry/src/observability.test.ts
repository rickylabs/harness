/**
 * Where the log goes, and what a non-Node caller may put in it.
 *
 * Resolution is pure, so it is tested without a disk — every case here is a way the environment can
 * be wrong, and the property under test is always the same one: the answer is either what was asked
 * for or a note saying it was not. Nothing is absorbed.
 *
 * The one test that does touch a disk is the one that has to: that opening the resolved sink writes
 * to the resolved path, and evicts to the resolved cold tier. A location that is right in a return
 * value and wrong on the filesystem is the exact failure this module exists to make impossible.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  humanBytes,
  livePath,
  logPaths,
  openObservabilitySink,
  parseBytes,
  parseEvents,
  resolveObservability,
  ENV,
  EVENT_NOTE_CAP,
} from "./observability.js";
import { byteLength, DEFAULT_POLICY } from "./sink.js";

const HOME = "/home/agent";
const NOW = "2026-09-05T09:00:00.000Z";

describe("resolveObservability", () => {
  it("puts the log where the fleet already keeps its daemon logs", () => {
    // The convention on ai-agents, not a location this package invented: `archiver.log`,
    // `spare-reaper.log` and `codex-daemon.log` are already in ~/observability, and the cold tier is
    // already ~/archives. Writing somewhere else would be a second place to look.
    const target = resolveObservability(HOME);
    assert.equal(target.directory, join(HOME, "observability"));
    assert.equal(target.archiveDirectory, join(HOME, "archives"));
    assert.equal(livePath(target), join(HOME, "observability", "dsh-telemetry.jsonl"));
    assert.deepEqual(target.notes, []);
  });

  it("keeps the fleet's bound when the environment says nothing", () => {
    const target = resolveObservability(HOME);
    assert.deepEqual(target.policy, DEFAULT_POLICY);
  });

  it("takes the directory and the cold tier from the environment", () => {
    const target = resolveObservability(HOME, {
      [ENV.directory]: "/var/log/dsh",
      [ENV.archive]: "/mnt/cold",
    });
    assert.equal(target.directory, "/var/log/dsh");
    assert.equal(target.archiveDirectory, "/mnt/cold");
    assert.deepEqual(target.notes, []);
  });

  it('understands "none" as "keep no cold tier"', () => {
    // A box with no archive mount is a real configuration, and it must be sayable. Without this the
    // only way to express it is a path that does not exist, which fails at eviction time instead.
    const target = resolveObservability(HOME, { [ENV.archive]: "NONE" });
    assert.equal(target.archiveDirectory, null);
    assert.deepEqual(target.notes, []);
  });

  it("makes a relative directory absolute before anything is written to it", () => {
    // Resolved here rather than at append time: a daemon changes directory, and the path `where`
    // printed must be the path `record` wrote to an hour later.
    const target = resolveObservability(HOME, { [ENV.directory]: "logs" });
    assert.equal(isAbsolute(target.directory), true);
  });

  it("refuses to archive into the live directory, and says why", () => {
    // An evicted generation renamed back into the directory it came from is picked up by the next
    // rotation as a generation of its own, and the bound stops meaning anything.
    const target = resolveObservability(HOME, {
      [ENV.directory]: "/var/log/dsh",
      [ENV.archive]: "/var/log/dsh",
    });
    assert.equal(target.archiveDirectory, null);
    assert.match(target.notes.join("\n"), /same directory as the live log/);
  });

  it("takes a byte bound with a binary suffix", () => {
    const target = resolveObservability(HOME, { [ENV.maxBytes]: "32M" });
    assert.equal(target.policy.maxBytes, 32 * 1024 * 1024);
    assert.deepEqual(target.notes, []);
  });

  it("keeps the default bound when the value cannot be read, and names the variable", () => {
    // The failure this prevents: `32MB` silently parsed as 32 bytes, or silently ignored. Either way
    // the operator believes a bound that is not in force.
    const target = resolveObservability(HOME, { [ENV.maxBytes]: "32MB" });
    assert.equal(target.policy.maxBytes, DEFAULT_POLICY.maxBytes);
    assert.match(target.notes.join("\n"), /DSH_TELEMETRY_MAX_BYTES ignored/);
  });

  it("keeps no generations when asked to keep none", () => {
    const target = resolveObservability(HOME, { [ENV.generations]: "0" });
    assert.equal(target.policy.maxGenerations, 0);
    assert.deepEqual(target.notes, []);
    assert.deepEqual(logPaths(target), [livePath(target)]);
  });

  it("treats a blank variable as an unset one", () => {
    // `DSH_TELEMETRY_DIR=` in a unit file is how a variable is *cleared*, not how it is set to "".
    const target = resolveObservability(HOME, { [ENV.directory]: "   ", [ENV.archive]: "" });
    assert.equal(target.directory, join(HOME, "observability"));
    assert.equal(target.archiveDirectory, join(HOME, "archives"));
    assert.deepEqual(target.notes, []);
  });

  it("names every generation rotation will actually use", () => {
    const target = resolveObservability(HOME, { [ENV.generations]: "2" });
    assert.deepEqual(logPaths(target), [
      join(HOME, "observability", "dsh-telemetry.jsonl"),
      join(HOME, "observability", "dsh-telemetry.1.jsonl"),
      join(HOME, "observability", "dsh-telemetry.2.jsonl"),
    ]);
  });
});

describe("parseBytes", () => {
  it("reads a plain byte count", () => {
    assert.deepEqual(parseBytes("33554432"), { bytes: 33554432 });
  });

  it("reads the binary suffixes", () => {
    assert.deepEqual(parseBytes("4k"), { bytes: 4096 });
    assert.deepEqual(parseBytes("1M"), { bytes: 1024 * 1024 });
    assert.deepEqual(parseBytes("2g"), { bytes: 2 * 1024 * 1024 * 1024 });
  });

  it("refuses a bound of zero rather than making every record oversized", () => {
    assert.ok("problem" in parseBytes("0"));
  });

  it("refuses what it does not certainly understand", () => {
    for (const raw of ["32MB", "32 M", "thirty-two", "-1", "1.5M", ""]) {
      assert.ok("problem" in parseBytes(raw), `${raw} should not parse`);
    }
  });
});

describe("humanBytes", () => {
  it("says the bound the way it was written", () => {
    assert.equal(humanBytes(32 * 1024 * 1024), "32.0 MiB");
    assert.equal(humanBytes(4096), "4.0 KiB");
    assert.equal(humanBytes(512), "512 B");
  });
});

describe("parseEvents", () => {
  it("reads one JSON object per line", () => {
    const { events, notes } = parseEvents(
      '{"runId":"r1","kind":"turn"}\n{"runId":"r2","kind":"quota","at":"2026-09-04T00:00:00.000Z"}\n',
      NOW,
    );
    assert.deepEqual(notes, []);
    assert.deepEqual(events, [
      { at: NOW, runId: "r1", kind: "turn" },
      { at: "2026-09-04T00:00:00.000Z", runId: "r2", kind: "quota" },
    ]);
  });

  it("loses one bad line and nothing else, and names it", () => {
    // A shell hook writing at 03:00 gets truncated mid-line. Losing the whole batch over that is
    // exactly when it is least affordable.
    const { events, notes } = parseEvents(
      '{"runId":"r1","kind":"turn"}\n{"runId":"r2","kin\n{"runId":"r3","kind":"turn"}\n',
      NOW,
    );
    assert.deepEqual(
      events.map((e) => e.runId),
      ["r1", "r3"],
    );
    assert.deepEqual(notes, ["line 2 dropped: not JSON"]);
  });

  it("drops a line with no runId or no kind, because neither can be guessed", () => {
    const { events, notes } = parseEvents('{"kind":"turn"}\n{"runId":"r1"}\n[1,2]\n"text"\n', NOW);
    assert.deepEqual(events, []);
    assert.deepEqual(notes, [
      "line 1 dropped: no runId",
      "line 2 dropped: no kind",
      "line 3 dropped: not a JSON object",
      "line 4 dropped: not a JSON object",
    ]);
  });

  it("keeps an event whose time it could not read, and says it stamped it", () => {
    // Filling silently is how a log comes to disagree with itself about when something happened.
    const { events, notes } = parseEvents('{"runId":"r1","kind":"turn","at":"yesterday"}\n', NOW);
    assert.deepEqual(events, [{ at: NOW, runId: "r1", kind: "turn" }]);
    assert.match(notes.join("\n"), /"at" is not a time/);
  });

  it("keeps an event whose detail was not an object, without the detail", () => {
    const { events, notes } = parseEvents('{"runId":"r1","kind":"turn","detail":"oops"}\n', NOW);
    assert.deepEqual(events, [{ at: NOW, runId: "r1", kind: "turn" }]);
    assert.match(notes.join("\n"), /"detail" is not an object/);
  });

  it("carries a detail object through untouched", () => {
    const { events } = parseEvents('{"runId":"r1","kind":"turn","detail":{"issue":88}}\n', NOW);
    assert.deepEqual(events, [{ at: NOW, runId: "r1", kind: "turn", detail: { issue: 88 } }]);
  });

  it("ignores blank lines, including the trailing newline every writer emits", () => {
    const { events, notes } = parseEvents('\n\n{"runId":"r1","kind":"turn"}\n\n', NOW);
    assert.equal(events.length, 1);
    assert.deepEqual(notes, []);
  });

  it("names the first few bad lines and then counts the rest", () => {
    const { events, notes } = parseEvents("nope\n".repeat(40), NOW);
    assert.deepEqual(events, []);
    assert.equal(notes.filter((n) => n.includes("dropped: not JSON")).length, EVENT_NOTE_CAP);
    assert.ok(notes.includes("40 line(s) dropped in total"));
  });

  it("does not let one kind of remark crowd out the other", () => {
    // Five unreadable timestamps must not hide the sixth line that was dropped outright: they are
    // different facts, and the second is the one that lost a record.
    const timestamps = '{"runId":"r1","kind":"turn","at":"nope"}\n'.repeat(EVENT_NOTE_CAP);
    const { notes } = parseEvents(`${timestamps}garbage\n`, NOW);
    assert.equal(notes.filter((n) => n.includes('"at" is not a time')).length, EVENT_NOTE_CAP);
    assert.ok(notes.some((n) => n.includes("dropped: not JSON")));
  });

  it("reads nothing out of nothing, quietly", () => {
    assert.deepEqual(parseEvents("", NOW), { events: [], notes: [] });
  });
});

describe("openObservabilitySink", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dsh-observability-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes to the path it resolved, and rotates into the cold tier it resolved", async () => {
    // The whole point of the module: the location in the return value is the location on disk.
    const line = byteLength(`${JSON.stringify({ at: NOW, runId: "r1", kind: "turn" })}\n`);
    const target = resolveObservability(root, {
      [ENV.directory]: join(root, "observability"),
      [ENV.archive]: join(root, "archives"),
      [ENV.maxBytes]: String(line * 2),
      [ENV.generations]: "1",
    });
    const sink = openObservabilitySink(target);
    for (let i = 0; i < 6; i += 1) await sink.write({ at: NOW, runId: `r${i}`, kind: "turn" });

    assert.deepEqual(sink.notes, []);
    const live = await readFile(livePath(target), "utf8");
    assert.ok(live.length <= line * 2, "the live file stays under the bound");
    // Nothing was destroyed to enforce it: the generations that rolled off are in the cold tier.
    const cold = await readdir(join(root, "archives"));
    assert.ok(cold.length > 0, "an evicted generation reaches ~/archives");
  });

  it("deletes an evicted generation when there is no cold tier", async () => {
    const line = byteLength(`${JSON.stringify({ at: NOW, runId: "r1", kind: "turn" })}\n`);
    const target = resolveObservability(root, {
      [ENV.directory]: root,
      [ENV.archive]: "none",
      [ENV.maxBytes]: String(line),
      [ENV.generations]: "0",
    });
    const sink = openObservabilitySink(target);
    for (let i = 0; i < 4; i += 1) await sink.write({ at: NOW, runId: `r${i}`, kind: "turn" });

    assert.deepEqual(sink.notes, []);
    assert.deepEqual(await readdir(root), ["dsh-telemetry.jsonl"]);
  });

  it("does not create anything just because it was asked where it would write", async () => {
    // `where` must be safe to run on a box you are only inspecting — resolving a location is a
    // question, and a question that makes a directory is not one.
    const target = resolveObservability(join(root, "untouched"));
    assert.equal(logPaths(target).length, DEFAULT_POLICY.maxGenerations + 1);
    assert.deepEqual(await readdir(root), []);
  });
});
