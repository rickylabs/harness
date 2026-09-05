/**
 * The scan, against a real directory tree.
 *
 * The claim under test is the one this package was built on: "nothing ran" and "I could not see
 * whether anything ran" are different answers. Every case here is about which of the two comes out.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("says a configured store is unreadable, rather than reporting it as empty", async () => {
    const { runs, notes } = await backfillFromDisk({ claudeProjects: join(root, "nope") });
    assert.deepEqual(runs, []);
    assert.match(notes.join("\n"), /claude: .*nope is not a readable directory/);
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
    const { runs, notes } = await backfillFromDisk({ claudeProjects }, 2);
    assert.equal(runs.length, 2);
    assert.match(notes.join("\n"), /claude: more than 2 transcripts under .* — scan truncated/);
  });

  it("truncates the same way twice, so a bounded scan is still reproducible", async () => {
    const claudeProjects = await claudeStore([
      ["c.jsonl", "ses-c"],
      ["a.jsonl", "ses-a"],
      ["b.jsonl", "ses-b"],
    ]);
    const first = await backfillFromDisk({ claudeProjects }, 2);
    const second = await backfillFromDisk({ claudeProjects }, 2);
    assert.deepEqual(
      first.runs.map((r) => r.id),
      second.runs.map((r) => r.id),
    );
    // Sorted walk, so it is the alphabetically first two, not whatever the directory hands back.
    assert.deepEqual(first.runs.map((r) => r.id).sort(), ["ses-a", "ses-b"]);
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
    assert.match(notes.join("\n"), /codex: .* is not a readable directory/);
    assert.match(notes.join("\n"), /opencode\.db unreadable/);
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
