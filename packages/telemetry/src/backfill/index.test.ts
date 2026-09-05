/**
 * The scan, against a real directory tree.
 *
 * The claim under test is the one this package was built on: "nothing ran" and "I could not see
 * whether anything ran" are different answers. Every case here is about which of the two comes out.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { backfillFromDisk, defaultRoots } from "./index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-backfill-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const claudeLine = (id: string, at: string) =>
  `${JSON.stringify({
    type: "assistant",
    sessionId: id,
    timestamp: at,
    cwd: "/repo",
    gitBranch: "orch/divybot-39",
    message: { role: "assistant", model: "claude-opus-5", usage: { input_tokens: 3, output_tokens: 1 } },
  })}\n`;

async function claudeStore(files: readonly (readonly [string, string])[]): Promise<string> {
  const dir = join(root, ".claude", "projects", "slug");
  await mkdir(dir, { recursive: true });
  for (const [name, id] of files) {
    await writeFile(join(dir, name), claudeLine(id, "2026-09-04T21:00:00.000Z"));
  }
  return join(root, ".claude", "projects");
}

/**
 * Stamp a transcript's modification time.
 *
 * The scan bounds and orders by mtime, and three files written in a loop can share a millisecond,
 * so a test that wants to know which two of three were read has to say when they were written.
 */
async function writtenAt(store: string, name: string, iso: string): Promise<void> {
  const at = new Date(iso);
  await utimes(join(store, "slug", name), at, at);
}

describe("backfillFromDisk", () => {
  it("says a store was not configured, rather than reporting it as empty", () => {
    // The distinction the whole package turns on.
    return backfillFromDisk({}).then(({ runs, notes }) => {
      assert.deepEqual(runs, []);
      for (const seam of ["claude", "codex", "opencode"]) {
        assert.ok(
          notes.some((n) => n.startsWith(`${seam}: no store configured`)),
          `${seam} produced no note`,
        );
      }
    });
  });

  it("says a store is not on this box, and does not call that a gap", async () => {
    // A machine that does not run Codex has no Codex store, and saying so is a *complete* answer.
    // Reporting it the same way as a store that will not open left a caller unable to tell whether
    // its own answer could be trusted (finding F-7 on #105).
    const { runs, notes, degraded } = await backfillFromDisk({ claudeProjects: join(root, "nope") });
    assert.deepEqual(runs, []);
    assert.match(notes.join("\n"), /claude: no store on this box — nothing has run here/);
    assert.equal(degraded, false);
  });

  it("says a configured store is unreadable, and calls that a gap", async () => {
    await writeFile(join(root, "a-file"), "not a directory");
    const { runs, notes, degraded } = await backfillFromDisk({
      claudeProjects: join(root, "a-file"),
    });
    assert.deepEqual(runs, []);
    assert.match(notes.join("\n"), /claude: store could not be read \(not a directory\)/);
    assert.equal(degraded, true);
    // The note names the seam and the reason. It must not name the path: that is a home directory,
    // and a note is printed, piped and published (finding F-5 on #105).
    assert.equal(notes.join("\n").includes(root), false);
  });

  it("recovers runs from a nested transcript tree", async () => {
    const claudeProjects = await claudeStore([
      ["a.jsonl", "ses-a"],
      ["b.jsonl", "ses-b"],
    ]);
    const { runs } = await backfillFromDisk({ claudeProjects });
    assert.deepEqual(
      runs.map((r) => r.id).sort(),
      ["ses-a", "ses-b"],
    );
    assert.equal(runs[0]?.source, "claude");
  });

  it("ignores a file that is not a transcript", async () => {
    const claudeProjects = await claudeStore([["a.jsonl", "ses-a"]]);
    await writeFile(join(claudeProjects, "slug", "notes.md"), "not a transcript");
    const { runs, notes } = await backfillFromDisk({ claudeProjects });
    assert.equal(runs.length, 1);
    assert.equal(notes.some((n) => n.includes("could not be read")), false);
  });

  it("reports a transcript that carried no session identity", async () => {
    const claudeProjects = await claudeStore([["a.jsonl", "ses-a"]]);
    await writeFile(join(claudeProjects, "slug", "blank.jsonl"), '{"type":"queue-operation"}\n');
    const { runs, notes } = await backfillFromDisk({ claudeProjects });
    assert.equal(runs.length, 1);
    assert.match(notes.join("\n"), /claude: 1 transcript\(s\) carried no session identity/);
  });

  it("says the scan was truncated, so a partial answer never passes as a complete one", async () => {
    const claudeProjects = await claudeStore([
      ["a.jsonl", "ses-a"],
      ["b.jsonl", "ses-b"],
      ["c.jsonl", "ses-c"],
    ]);
    const { runs, notes, degraded } = await backfillFromDisk({ claudeProjects }, { limit: 2 });
    assert.equal(runs.length, 2);
    assert.match(notes.join("\n"), /claude: 3 transcript\(s\) match — only the 2 most recent were read/);
    assert.equal(degraded, true);
  });

  it("keeps the newest transcripts when the bound makes it choose", async () => {
    // An alphabetical truncation answers "what is running" with whichever sessions happen to sort
    // first, which for a fleet is the ones that finished weeks ago.
    const claudeProjects = await claudeStore([
      ["a.jsonl", "ses-a"],
      ["b.jsonl", "ses-b"],
      ["c.jsonl", "ses-c"],
    ]);
    await writtenAt(claudeProjects, "a.jsonl", "2026-08-01T00:00:00.000Z");
    await writtenAt(claudeProjects, "b.jsonl", "2026-09-01T00:00:00.000Z");
    await writtenAt(claudeProjects, "c.jsonl", "2026-09-04T00:00:00.000Z");
    const { runs } = await backfillFromDisk({ claudeProjects }, { limit: 2 });
    assert.deepEqual(runs.map((r) => r.id).sort(), ["ses-b", "ses-c"]);
  });

  it("truncates the same way twice, so a bounded scan is still reproducible", async () => {
    const claudeProjects = await claudeStore([
      ["c.jsonl", "ses-c"],
      ["a.jsonl", "ses-a"],
      ["b.jsonl", "ses-b"],
    ]);
    // Written in one loop, so all three may share a millisecond: the tie-break by path is what
    // makes the answer the same twice, and it is only checkable if the tie actually happens.
    for (const name of ["a.jsonl", "b.jsonl", "c.jsonl"]) {
      await writtenAt(claudeProjects, name, "2026-09-04T00:00:00.000Z");
    }
    const first = await backfillFromDisk({ claudeProjects }, { limit: 2 });
    const second = await backfillFromDisk({ claudeProjects }, { limit: 2 });
    assert.deepEqual(
      first.runs.map((r) => r.id),
      second.runs.map((r) => r.id),
    );
    assert.deepEqual(first.runs.map((r) => r.id).sort(), ["ses-a", "ses-b"]);
  });

  it("applies --since before it opens a transcript, so the bound is on the work", async () => {
    // `--since` used to filter the finished list while the scan still read every transcript on the
    // box: a bound on the output wearing the costume of a bound on the work (finding F-7 on #105).
    // The stale file's *records* are recent; only its mtime is old, so it can only be excluded by a
    // decision taken before it was read.
    const claudeProjects = await claudeStore([
      ["fresh.jsonl", "ses-fresh"],
      ["stale.jsonl", "ses-stale"],
    ]);
    await writtenAt(claudeProjects, "stale.jsonl", "2026-08-01T00:00:00.000Z");
    const { runs } = await backfillFromDisk(
      { claudeProjects },
      { sinceMs: Date.parse("2026-09-01T00:00:00.000Z") },
    );
    assert.deepEqual(
      runs.map((r) => r.id),
      ["ses-fresh"],
    );
  });

  it("orders runs newest activity first", async () => {
    const dir = join(root, ".claude", "projects", "slug");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "old.jsonl"), claudeLine("ses-old", "2026-09-01T10:00:00.000Z"));
    await writeFile(join(dir, "new.jsonl"), claudeLine("ses-new", "2026-09-04T10:00:00.000Z"));
    const { runs } = await backfillFromDisk({ claudeProjects: join(root, ".claude", "projects") });
    assert.deepEqual(
      runs.map((r) => r.id),
      ["ses-new", "ses-old"],
    );
  });

  it("keeps one bad seam from costing the others", async () => {
    const claudeProjects = await claudeStore([["a.jsonl", "ses-a"]]);
    const { runs, notes } = await backfillFromDisk({
      claudeProjects,
      codexSessions: join(root, "missing"),
      opencodeDb: join(root, "missing.db"),
    });
    assert.equal(runs.length, 1);
    assert.match(notes.join("\n"), /codex: no store on this box/);
    assert.match(notes.join("\n"), /opencode: no store on this box/);
  });

  it("bounds the opencode seam by the same --limit as the transcript seams", async () => {
    // `--limit 1` bounded the two JSONL seams and returned every opencode row, so the same flag
    // meant two different things depending on which store answered (finding F-7 on #105).
    const sqlite = (await import("node:sqlite")) as unknown as {
      DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void };
    };
    const opencodeDb = join(root, "opencode.db");
    const writer = new sqlite.DatabaseSync(opencodeDb);
    writer.exec("create table session (id text, parent_id text, title text, directory text, agent text, model text, cost real, tokens_input integer, tokens_output integer, tokens_reasoning integer, tokens_cache_read integer, tokens_cache_write integer, time_created integer, time_updated integer)");
    for (let i = 1; i <= 4; i += 1) {
      writer.exec(
        `insert into session (id, time_created, time_updated) values ('ses_${i}', ${1_772_000_000_000 + i * 1000}, ${1_772_000_000_000 + i * 1000})`,
      );
    }
    writer.close();

    const { runs, notes, degraded } = await backfillFromDisk({ opencodeDb }, { limit: 2 });
    // Newest first, so a bound of two is the two most recent sessions and not the two oldest.
    assert.deepEqual(
      runs.map((r) => r.id),
      ["ses_4", "ses_3"],
    );
    assert.match(notes.join("\n"), /opencode: more than 2 session\(s\) match — only the 2 most recent were read/);
    assert.equal(degraded, true);
  });
});

describe("defaultRoots", () => {
  it("names the three stores as they are actually laid out", () => {
    const roots = defaultRoots("/home/agent");
    assert.equal(roots.claudeProjects, join("/home/agent", ".claude", "projects"));
    assert.equal(roots.codexSessions, join("/home/agent", ".codex", "sessions"));
    assert.equal(roots.opencodeDb, join("/home/agent", ".local", "share", "opencode", "opencode.db"));
  });
});

describe("backfillFromDisk, on stores it cannot fully read", () => {
  it("keeps one malformed line from ending the whole scan", async () => {
    // Finding F-4 on #105, end to end: a single `null` line used to throw out of the parser, past
    // the seam loop, and out of `backfillFromDisk` — so one bad file in the Claude store meant no
    // Codex runs, no opencode runs, and `status` exiting 1 with nothing on screen.
    const claudeProjects = await claudeStore([["a.jsonl", "ses-a"]]);
    await writeFile(join(claudeProjects, "slug", "bad.jsonl"), `null\n${claudeLine("ses-b", "2026-09-04T21:00:00.000Z")}`);
    const { runs, notes } = await backfillFromDisk({ claudeProjects });
    assert.deepEqual(runs.map((r) => r.id).sort(), ["ses-a", "ses-b"]);
    assert.match(notes.join("\n"), /claude: not a JSON object — 1 line\(s\) across 1 transcript\(s\)/);
  });

  it("aggregates degradation per seam rather than per file", async () => {
    // Five hundred transcripts with a truncated tail each is one fact about the store, not five
    // hundred lines of output. The count is what tells an operator whether to care.
    const claudeProjects = await claudeStore([["a.jsonl", "ses-a"]]);
    for (const [name, id] of [["b.jsonl", "ses-b"], ["c.jsonl", "ses-c"]] as const) {
      await writeFile(join(claudeProjects, "slug", name), `${claudeLine(id, "2026-09-04T21:00:00.000Z")}{"half":`);
    }
    const { runs, notes } = await backfillFromDisk({ claudeProjects });
    assert.equal(runs.length, 3);
    const degraded = notes.filter((n) => n.includes("not valid JSON"));
    assert.deepEqual(degraded, ["claude: not valid JSON — 2 line(s) across 2 transcript(s)"]);
  });

  it("says nothing about degradation when there was none", async () => {
    const claudeProjects = await claudeStore([["a.jsonl", "ses-a"]]);
    const { notes, degraded } = await backfillFromDisk({ claudeProjects });
    assert.equal(
      notes.some((n) => n.includes("line(s) across")),
      false,
      notes.join("\n"),
    );
    assert.equal(degraded, false);
  });

  it("flags a truncated record as a gap, because prose is not something a caller can branch on", async () => {
    const claudeProjects = await claudeStore([["a.jsonl", "ses-a"]]);
    await writeFile(
      join(claudeProjects, "slug", "b.jsonl"),
      `${claudeLine("ses-b", "2026-09-04T21:00:00.000Z")}{"half":`,
    );
    const { degraded } = await backfillFromDisk({ claudeProjects });
    assert.equal(degraded, true);
  });

  it("does not call a transcript with no session identity a gap", async () => {
    // It was read completely and had nothing in it. That is an answer about the file, not a hole in
    // what the scan could see, and treating it as one would make `status` cry wolf on every box.
    const claudeProjects = await claudeStore([["a.jsonl", "ses-a"]]);
    await writeFile(join(claudeProjects, "slug", "blank.jsonl"), '{"type":"queue-operation"}\n');
    const { notes, degraded } = await backfillFromDisk({ claudeProjects });
    assert.match(notes.join("\n"), /carried no session identity/);
    assert.equal(degraded, false);
  });
});
