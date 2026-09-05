import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { foldLiveEvents, mergeLiveRuns, readLiveLog, type LiveFile, type LiveRun } from "./live.js";
import type { RunRecord } from "./model.js";
import type { TelemetryEvent } from "./sink.js";

const NOW = "2026-09-05T12:00:00.000Z";

const event = (
  runId: string,
  kind: string,
  at: string,
  detail?: Readonly<Record<string, unknown>>,
): TelemetryEvent => (detail === undefined ? { at, runId, kind } : { at, runId, kind, detail });

const file = (path: string, events: readonly TelemetryEvent[]): LiveFile => ({ path, events });

const jsonl = (events: readonly TelemetryEvent[]): string =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r1",
    source: "claude",
    parentId: null,
    startedAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:30:00.000Z",
    branch: null,
    identity: { model: null, effort: null, provider: null, profile: null },
    usage: {},
    outcome: "unknown",
    linkedIssues: [],
    origin: "/store/r1.jsonl",
    quota: [],
    ...over,
  };
}

function live(over: Partial<LiveRun> = {}): LiveRun {
  return {
    id: "r1",
    source: null,
    parentId: null,
    startedAt: "2026-09-05T10:05:00.000Z",
    updatedAt: "2026-09-05T10:40:00.000Z",
    branch: null,
    identity: { model: null, effort: null, provider: null, profile: null },
    outcome: null,
    linkedIssues: [],
    origin: "/observability/dsh-telemetry.jsonl",
    events: 1,
    ...over,
  };
}

describe("readLiveLog", () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "dsh-live-"));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("says nothing about a generation that does not exist yet", async () => {
    // `logPaths` names every generation the policy allows. A box that has not filled one is the
    // ordinary case, and reporting it as a gap would make `degraded` true on every healthy run.
    const log = await readLiveLog([join(root, "nope.jsonl"), join(root, "nope.1.jsonl")], NOW);
    assert.deepEqual(log.files, []);
    assert.deepEqual(log.notes, []);
    assert.equal(log.degraded, false);
  });

  it("reads the files it can, in the order it was given them", async () => {
    const a = join(root, "live.jsonl");
    const b = join(root, "live.1.jsonl");
    await writeFile(a, jsonl([event("r1", "start", NOW)]), "utf8");
    await writeFile(b, jsonl([event("r0", "start", "2026-09-04T12:00:00.000Z")]), "utf8");

    const log = await readLiveLog([a, b, join(root, "absent.jsonl")], NOW);
    assert.deepEqual(
      log.files.map((f) => f.path),
      [a, b],
    );
    assert.equal(log.files[0]?.events[0]?.runId, "r1");
    assert.equal(log.degraded, false);
  });

  it("degrades on a file that exists and will not open, without naming it", async () => {
    // A directory where a file is expected is the readable stand-in for a permissions failure. The
    // note carries no path: it names a home directory, and notes are printed and published.
    const blocked = join(root, "blocked.jsonl");
    await mkdir(blocked, { recursive: true });

    const log = await readLiveLog([blocked], NOW);
    assert.equal(log.degraded, true);
    assert.equal(log.notes.length, 1);
    assert.match(log.notes[0] ?? "", /1 file\(s\) exist but could not be read/);
    assert.ok(!(log.notes[0] ?? "").includes(root));
  });

  it("keeps the good lines of a batch whose last write was truncated", async () => {
    const path = join(root, "torn.jsonl");
    await writeFile(path, `${jsonl([event("r1", "start", NOW)])}{"runId":"r2","ki`, "utf8");

    const log = await readLiveLog([path], NOW);
    assert.equal(log.files[0]?.events.length, 1);
    assert.equal(log.degraded, true);
    assert.match(log.notes[0] ?? "", /^live log: line 2 dropped: not JSON$/);
  });
});

describe("foldLiveEvents", () => {
  it("groups by run id and counts what it saw", () => {
    const runs = foldLiveEvents([
      file("/log/live.jsonl", [
        event("a", "start", "2026-09-05T10:00:00.000Z"),
        event("b", "start", "2026-09-05T10:01:00.000Z"),
        event("a", "tick", "2026-09-05T10:02:00.000Z"),
      ]),
    ]);
    assert.deepEqual(
      runs.map((r) => [r.id, r.events]),
      [
        ["a", 2],
        ["b", 1],
      ],
    );
  });

  it("takes the last statement, because a run's model legitimately changes mid-run", () => {
    // Fallback is the case: a run that started on the native seam and finished on the relay ran
    // under two models, and the one that finished it is the one an audit is about.
    const runs = foldLiveEvents([
      file("/log/live.jsonl", [
        event("a", "start", "2026-09-05T10:00:00.000Z", { model: "fable-5", provider: "anthropic" }),
        event("a", "fallback", "2026-09-05T10:05:00.000Z", { model: "z-ai/glm-5.3-flash" }),
      ]),
    ]);
    assert.equal(runs[0]?.identity.model, "z-ai/glm-5.3-flash");
    // Untouched by the second event, and not reset to null by it either.
    assert.equal(runs[0]?.identity.provider, "anthropic");
  });

  it("orders across generations by time, not by the file it found a line in", () => {
    // The live file holds the newest lines and the generations behind it hold older ones, so
    // folding in file order would let a rotated line be the last word about a run.
    const runs = foldLiveEvents([
      file("/log/live.jsonl", [event("a", "done", "2026-09-05T11:00:00.000Z", { outcome: "complete" })]),
      file("/log/live.1.jsonl", [
        event("a", "start", "2026-09-05T09:00:00.000Z", { outcome: "running" }),
      ]),
    ]);
    assert.equal(runs[0]?.outcome, "complete");
    assert.equal(runs[0]?.startedAt, "2026-09-05T09:00:00.000Z");
    assert.equal(runs[0]?.updatedAt, "2026-09-05T11:00:00.000Z");
    // The newest file that mentioned it, which is the one to open.
    assert.equal(runs[0]?.origin, "/log/live.jsonl");
  });

  it("breaks a same-millisecond tie by position, so the fold is not a coin flip", () => {
    const events = [
      event("a", "one", "2026-09-05T10:00:00.000Z", { outcome: "running" }),
      event("a", "two", "2026-09-05T10:00:00.000Z", { outcome: "failed" }),
    ];
    const runs = foldLiveEvents([file("/log/live.jsonl", events)]);
    assert.equal(runs[0]?.outcome, "failed");
  });

  it("refuses a source or an outcome it does not recognise", () => {
    // `RunSource` and `RunOutcome` are closed sets that the renderers and the quota report branch
    // on. A pass-through here puts a value into a snapshot that nothing downstream can read.
    const runs = foldLiveEvents([
      file("/log/live.jsonl", [
        event("a", "start", "2026-09-05T10:00:00.000Z", { source: "gemini", outcome: "finished" }),
      ]),
    ]);
    assert.equal(runs[0]?.source, null);
    assert.equal(runs[0]?.outcome, null);
  });

  it("folds a run that stated nothing but its own id", () => {
    const runs = foldLiveEvents([file("/log/live.jsonl", [event("a", "ping", NOW)])]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.source, null);
    assert.equal(runs[0]?.outcome, null);
    assert.equal(runs[0]?.events, 1);
  });

  it("reads issue numbers out of a branch, with path evidence", () => {
    const runs = foldLiveEvents([
      file("/log/live.jsonl", [event("a", "start", NOW, { branch: "orch/divybot-86" })]),
    ]);
    assert.deepEqual(runs[0]?.linkedIssues, [{ number: 86, from: "path" }]);
  });

  it("ignores a detail that is not a string, rather than stringifying it", () => {
    const runs = foldLiveEvents([
      file("/log/live.jsonl", [event("a", "start", NOW, { model: 5, branch: "" })]),
    ]);
    assert.equal(runs[0]?.identity.model, null);
    assert.equal(runs[0]?.branch, null);
  });
});

describe("mergeLiveRuns", () => {
  it("fills an outcome the transcript could not say", () => {
    // The Claude and opencode stores write no completion marker, so every run they recover reads
    // `unknown`. This is the whole point of reading the log back.
    const merged = mergeLiveRuns([run({ outcome: "unknown" })], [live({ outcome: "complete" })]);
    assert.equal(merged.runs[0]?.outcome, "complete");
    assert.match(merged.notes[0] ?? "", /outcome supplied for 1 run\(s\)/);
    assert.equal(merged.degraded, false);
  });

  it("does not overrule an outcome the transcript asserted", () => {
    // `complete` and `failed` on disk are the vendor's own statement about a file it wrote. A
    // hook's opinion fills a gap; it does not win an argument.
    for (const outcome of ["complete", "failed"] as const) {
      const merged = mergeLiveRuns([run({ outcome })], [live({ outcome: "running" })]);
      assert.equal(merged.runs[0]?.outcome, outcome);
    }
    // `running` is not an assertion that the run ended, so the log still gets to close it.
    const closed = mergeLiveRuns([run({ outcome: "running" })], [live({ outcome: "failed" })]);
    assert.equal(closed.runs[0]?.outcome, "failed");
  });

  it("is idempotent: replaying the whole log over a merged view changes nothing", () => {
    // The criterion #86 states, asserted directly. It is also why recovery after a crash needs no
    // ingestion cursor — there is nothing to be lost by losing one.
    const disk = [run({ id: "r1", outcome: "unknown" }), run({ id: "r2", source: "codex" })];
    const log = [
      live({
        id: "r1",
        outcome: "complete",
        identity: { model: "gpt-5.6-sol", effort: "xhigh", provider: "openai", profile: null },
      }),
      live({ id: "r3", source: "opencode", outcome: "failed" }),
      live({ id: "r4" }),
    ];

    const once = mergeLiveRuns(disk, log);
    const twice = mergeLiveRuns(once.runs, log);
    assert.deepEqual(twice.runs, once.runs);

    // The runs are the idempotent thing. The notes are a report of what *this* call did, and the
    // second call had less to do because the first one already did it — the resolved outcome and
    // the synthesised run are on the disk side now. What survives is the run the log still cannot
    // place, which is a standing condition rather than work, and it is reported both times.
    assert.equal(once.notes.length, 3);
    assert.equal(twice.notes.length, 1);
    assert.match(twice.notes[0] ?? "", /named no seam/);
    assert.equal(twice.degraded, once.degraded);
  });

  it("adds a run the log knows about and no transcript does", () => {
    const merged = mergeLiveRuns(
      [],
      [live({ id: "r9", source: "codex", outcome: "failed", origin: "/observability/live.jsonl" })],
    );
    assert.equal(merged.runs.length, 1);
    assert.equal(merged.runs[0]?.source, "codex");
    assert.equal(merged.runs[0]?.outcome, "failed");
    // `why` hands an operator a file to open, and for a run with no transcript this is that file.
    assert.equal(merged.runs[0]?.origin, "/observability/live.jsonl");
    assert.deepEqual(merged.runs[0]?.usage, {});
    assert.match(merged.notes[0] ?? "", /1 run\(s\) known only to the log/);
  });

  it("counts a live-only run that named no seam instead of inventing one", () => {
    // `RunSource` says which subscription window a run drew from, and two of its three values are
    // windows that can be exhausted. A guess here becomes a wrong answer to "why is nothing
    // running", which is the question the quota reading exists to answer.
    const merged = mergeLiveRuns([], [live({ id: "r9", source: null })]);
    assert.deepEqual(merged.runs, []);
    assert.equal(merged.degraded, true);
    assert.match(merged.notes[0] ?? "", /1 run\(s\) named no seam/);
  });

  it("fills only the identity slots the transcript left empty", () => {
    const merged = mergeLiveRuns(
      [run({ identity: { model: "opus-5", effort: null, provider: null, profile: null } })],
      [
        live({
          identity: { model: "fable-5", effort: "medium", provider: "anthropic", profile: "review" },
        }),
      ],
    );
    // A transcript beats a hook wherever both speak: the transcript is what the run actually did.
    assert.deepEqual(merged.runs[0]?.identity, {
      model: "opus-5",
      effort: "medium",
      provider: "anthropic",
      profile: "review",
    });
  });

  it("widens the window at both ends", () => {
    const merged = mergeLiveRuns(
      [run({ startedAt: "2026-09-05T10:00:00.000Z", updatedAt: "2026-09-05T10:30:00.000Z" })],
      [live({ startedAt: "2026-09-05T09:00:00.000Z", updatedAt: "2026-09-05T11:00:00.000Z" })],
    );
    assert.equal(merged.runs[0]?.startedAt, "2026-09-05T09:00:00.000Z");
    assert.equal(merged.runs[0]?.updatedAt, "2026-09-05T11:00:00.000Z");
  });

  it("keeps path evidence when the same issue arrived both ways", () => {
    const merged = mergeLiveRuns(
      [run({ linkedIssues: [{ number: 86, from: "prose" }] })],
      [live({ linkedIssues: [{ number: 86, from: "path" }] })],
    );
    assert.deepEqual(merged.runs[0]?.linkedIssues, [{ number: 86, from: "path" }]);
  });

  it("merges into every transcript sharing a run id, not just the first", () => {
    // A run id is a vendor session id, and two transcript files can carry the same one. Taking the
    // first would leave a second record on the board still claiming the run never finished.
    const merged = mergeLiveRuns(
      [run({ id: "r1", origin: "/a.jsonl" }), run({ id: "r1", origin: "/b.jsonl" })],
      [live({ id: "r1", outcome: "complete" })],
    );
    assert.equal(merged.runs.length, 2);
    for (const record of merged.runs) assert.equal(record.outcome, "complete");
  });

  it("leaves the disk record's transcript as the file to open", () => {
    const merged = mergeLiveRuns([run({ origin: "/store/r1.jsonl" })], [live({ outcome: "failed" })]);
    assert.equal(merged.runs[0]?.origin, "/store/r1.jsonl");
  });

  it("returns the order the scan promises: newest first, ties broken by id", () => {
    const merged = mergeLiveRuns(
      [run({ id: "b", updatedAt: "2026-09-05T10:00:00.000Z" })],
      [
        live({ id: "a", source: "claude", updatedAt: "2026-09-05T10:00:00.000Z" }),
        live({ id: "z", source: "claude", updatedAt: "2026-09-05T12:00:00.000Z" }),
      ],
    );
    assert.deepEqual(
      merged.runs.map((r) => r.id),
      ["z", "a", "b"],
    );
  });

  it("says nothing at all when the log is empty", () => {
    const disk = [run()];
    const merged = mergeLiveRuns(disk, []);
    assert.deepEqual(merged.runs, disk);
    assert.deepEqual(merged.notes, []);
    assert.equal(merged.degraded, false);
  });
});
