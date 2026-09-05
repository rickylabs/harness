/**
 * The CLI, driven end to end.
 *
 * A status command is only worth having if it works when everything else is down, so these tests
 * give it a home directory with real transcript files in it and read what it prints. Nothing here
 * stubs the backfill: the seam between "there are files on disk" and "the operator sees the work"
 * is the entire product.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { EXIT, main, parseFlags } from "./cli.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "dsh-cli-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** Run the CLI with stdout captured, so a test reads exactly what an operator would see. */
async function run(argv: readonly string[]): Promise<{ code: number; out: string }> {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await main(argv);
    return { code, out: written.join("") };
  } finally {
    process.stdout.write = original;
  }
}

async function seedClaude(sessionId: string, branch: string): Promise<void> {
  const dir = join(home, ".claude", "projects", "slug");
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify({
    type: "assistant",
    sessionId,
    timestamp: "2026-09-04T21:00:00.000Z",
    cwd: "/repo",
    gitBranch: branch,
    effort: "medium",
    message: { role: "assistant", model: "claude-opus-5", usage: { input_tokens: 1200, output_tokens: 40 } },
  });
  await writeFile(join(dir, `${sessionId}.jsonl`), `${line}\n`);
}

describe("parseFlags", () => {
  it("defaults to this user's home and a bounded scan", () => {
    const flags = parseFlags(["status"]);
    assert.equal(flags.rest[0], "status");
    assert.equal(flags.limit, 500);
    assert.equal(flags.items, null);
    assert.equal(flags.json, false);
  });

  it("rejects a limit that is not a positive integer, rather than scanning nothing", () => {
    for (const bad of ["0", "-3", "many", "1.5"]) {
      assert.throws(() => parseFlags(["status", "--limit", bad]), /positive integer/, `--limit ${bad}`);
    }
  });

  it("reports a flag given without a value instead of consuming the command", () => {
    assert.throws(() => parseFlags(["status", "--home"]), /--home needs a value/);
  });

  it("takes a reference time, so output can be reproduced", () => {
    assert.equal(parseFlags(["status", "--now", "2026-09-04T22:00:00.000Z"]).now, "2026-09-04T22:00:00.000Z");
  });

  it("refuses a time flag it cannot parse, rather than comparing it as a string", () => {
    // `--since not-a-date` used to be accepted and compared lexically, which returned zero runs and
    // exit 0: an operator asking a reasonable question was told nothing is happening (F-7 on #105).
    assert.throws(() => parseFlags(["runs", "--since", "not-a-date"]), /--since needs a time/);
    assert.throws(() => parseFlags(["status", "--now", "whenever"]), /--now needs a time/);
  });

  it("keeps --since as an epoch, which is what actually bounds the readers", () => {
    const flags = parseFlags(["runs", "--since", "2026-09-04T22:00:00.000Z"]);
    assert.equal(flags.sinceMs, Date.parse("2026-09-04T22:00:00.000Z"));
  });
});

describe("dsh-telemetry", () => {
  it("prints usage and fails when given no command", async () => {
    const { code, out } = await run([]);
    assert.equal(code, 2);
    assert.match(out, /dsh-telemetry status/);
  });

  it("succeeds on --help, because asking for help is not an error", async () => {
    const { code } = await run(["--help"]);
    assert.equal(code, 0);
  });

  it("renders the work it found, with governance above it", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run(["status", "--home", home, "--now", "2026-09-04T22:00:00.000Z"]);
    assert.equal(code, 0);
    assert.match(out, /board activity as of 2026-09-04T22:00:00\.000Z/);
    assert.match(out, /governance:|governance: no seam reported/);
    assert.match(out, /claude-opus-5\/medium/);
    assert.ok(out.indexOf("governance") < out.indexOf("run(s) across"));
  });

  it("says it was never told where the board is, instead of showing an empty board", async () => {
    // Without items every run is unattributed. Silence here would read as "no work is happening",
    // which is the exact wrong answer and the reason this note exists.
    await seedClaude("ses-a", "orch/divybot-39");
    const { out } = await run(["status", "--home", home, "--now", "2026-09-04T22:00:00.000Z"]);
    assert.match(out, /no --items given: runs are listed but not attributed to epics/);
  });

  it("attributes runs to epics once it is given the board", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const items = join(home, "items.json");
    await writeFile(
      items,
      JSON.stringify([{ number: 39, title: "telemetry sink", epic: "E9", milestone: "W2", phase: null }]),
    );
    const { out } = await run(["status", "--home", home, "--items", items, "--now", "2026-09-04T22:00:00.000Z"]);
    assert.match(out, /epic:E9 \(W2\)/);
    assert.match(out, /#39 telemetry sink/);
    assert.equal(out.includes("the board cannot see"), false);
  });

  it("reports an unreadable items file rather than silently dropping attribution", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run([
      "status",
      "--home",
      home,
      "--items",
      join(home, "nope.json"),
      "--now",
      "2026-09-04T22:00:00.000Z",
    ]);
    assert.match(out, /nope\.json could not be read/);
    // Attribution was asked for and could not be had, so the picture on screen is not the board.
    assert.equal(code, EXIT.incomplete);
  });

  it("emits a machine-readable snapshot under --json", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { out } = await run(["status", "--home", home, "--json", "--now", "2026-09-04T22:00:00.000Z"]);
    const parsed: unknown = JSON.parse(out);
    assert.equal((parsed as { generatedAt: string }).generatedAt, "2026-09-04T22:00:00.000Z");
    assert.ok(Array.isArray((parsed as { notes: unknown[] }).notes));
  });

  it("lists runs newest first", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run(["runs", "--home", home]);
    assert.equal(code, 0);
    assert.match(out, /ses|claude/);
    assert.match(out, /claude-opus-5/);
  });

  it("drops runs older than --since", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { out } = await run(["runs", "--home", home, "--since", "2026-09-05T00:00:00.000Z"]);
    assert.equal(out.trim(), "");
  });

  it("names the log to open first for a given run", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run(["why", "ses-a", "--home", home]);
    assert.equal(code, 0);
    assert.match(out, /ses-a \(claude, unknown\)/);
  });

  it("fails honestly when asked about a run it cannot see", async () => {
    // Exit 4, not 1: a miss on a scan that could see everything is an answer, and exit 1 is
    // reserved for this command breaking. They used to be the same status (finding F-7 on #105).
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run(["why", "ses-nope", "--home", home]);
    assert.equal(code, EXIT.notFound);
    assert.match(out, /no run matching ses-nope in this scan/);
  });

  it("says a miss might be its own blindness when the scan was incomplete", async () => {
    // "I did not find it" and "I could not see everywhere" are different answers, and when both are
    // true the second is the one to act on — so 3 outranks 4.
    await seedClaude("ses-a", "orch/divybot-39");
    await seedClaude("ses-b", "orch/divybot-40");
    const { code, out } = await run(["why", "ses-nope", "--home", home, "--limit", "1"]);
    assert.equal(code, EXIT.incomplete);
    assert.match(out, /no run matching ses-nope in this scan/);
    assert.match(out, /this scan was incomplete/);
  });

  it("rejects an unknown command with usage rather than doing something else", async () => {
    const { code, out } = await run(["staus", "--home", home]);
    assert.equal(code, EXIT.usage);
    assert.match(out, /unknown command: staus/);
  });
});

describe("dsh-telemetry, on evidence it could not fully read", () => {
  it("exits 0 on a box that simply has no stores", async () => {
    // Absent stores are a complete answer about a machine that does not run those vendors. If this
    // were exit 3, every laptop in the fleet would report a permanent fault.
    const { code, out } = await run(["status", "--home", home, "--now", "2026-09-04T22:00:00.000Z"]);
    assert.equal(code, EXIT.ok);
    assert.match(out, /no store on this box/);
  });

  it("exits 3 when a store is there and will not open", async () => {
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(join(home, ".claude", "projects"), "not a directory");
    const { code, out } = await run(["status", "--home", home, "--now", "2026-09-04T22:00:00.000Z"]);
    assert.equal(code, EXIT.incomplete);
    assert.match(out, /claude: store could not be read/);
  });

  it("exits 3 and says why when a bounded scan could not read everything", async () => {
    // The case that makes silence dangerous: an empty run list from a truncated scan is shaped
    // exactly like an empty board, and a script polling this would report the fleet as idle.
    await seedClaude("ses-a", "orch/divybot-39");
    await seedClaude("ses-b", "orch/divybot-40");
    const { code, out } = await run(["runs", "--home", home, "--limit", "1"]);
    assert.equal(code, EXIT.incomplete);
    assert.match(out, /this scan was incomplete:/);
    assert.match(out, /only the 1 most recent were read/);
  });

  it("stays quiet and exits 0 when the scan saw everything", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run(["runs", "--home", home]);
    assert.equal(code, EXIT.ok);
    assert.equal(out.includes("this scan was incomplete"), false);
  });
});

describe("dsh-telemetry --json", () => {
  it("wraps runs in an envelope that says whether the answer is complete", async () => {
    // `runs --json` used to emit a bare array and drop every note, so a machine consumer received a
    // truncated scan in the shape of complete evidence (finding F-10 on #105).
    await seedClaude("ses-a", "orch/divybot-39");
    await seedClaude("ses-b", "orch/divybot-40");
    const { code, out } = await run([
      "runs",
      "--home",
      home,
      "--limit",
      "1",
      "--json",
      "--now",
      "2026-09-04T22:00:00.000Z",
    ]);
    assert.equal(code, EXIT.incomplete);
    const parsed = JSON.parse(out) as {
      generatedAt: string;
      complete: boolean;
      runs: unknown[];
      notes: string[];
    };
    assert.deepEqual(Object.keys(parsed).sort(), ["complete", "generatedAt", "notes", "runs"]);
    assert.equal(parsed.generatedAt, "2026-09-04T22:00:00.000Z");
    assert.equal(parsed.complete, false);
    assert.equal(parsed.runs.length, 1);
    assert.ok(parsed.notes.some((n) => n.includes("most recent were read")));
  });

  it("says complete when it was", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run(["runs", "--home", home, "--json"]);
    assert.equal(code, EXIT.ok);
    assert.equal((JSON.parse(out) as { complete: boolean }).complete, true);
  });

  it("publishes no path out of either --json surface", async () => {
    // Every run carries the transcript it was read from, which is an absolute path under someone's
    // home directory. `why` hands that path to its operator on purpose; the published projections
    // must not (finding F-5 on #105, and the claim `RunRecord.origin` makes about itself).
    await seedClaude("ses-a", "orch/divybot-39");
    const status = await run(["status", "--home", home, "--json", "--now", "2026-09-04T22:00:00.000Z"]);
    const runs = await run(["runs", "--home", home, "--json", "--now", "2026-09-04T22:00:00.000Z"]);
    // `.jsonl` rather than the home path itself: JSON escapes a Windows separator, so a substring
    // search for the raw path would pass on this platform even if the path were published.
    const escaped = JSON.stringify(home).slice(1, -1);
    for (const [what, { out }] of [
      ["status", status],
      ["runs", runs],
    ] as const) {
      assert.equal(out.includes("origin"), false, `${what} --json named the origin field`);
      assert.equal(out.includes(".jsonl"), false, `${what} --json published a transcript path`);
      assert.equal(out.includes(escaped), false, `${what} --json published a home directory`);
    }
    // `why` is the local operator's command, and handing back the file to open is its entire job.
    assert.match((await run(["why", "ses-a", "--home", home])).out, /the run's own transcript/);
    assert.match((await run(["why", "ses-a", "--home", home])).out, /ses-a\.jsonl/);
    const asJson = await run(["why", "ses-a", "--home", home, "--json"]);
    assert.match((JSON.parse(asJson.out) as { transcript: string }).transcript, /ses-a\.jsonl/);
  });

  it("carries completeness on the status snapshot too", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { out } = await run(["status", "--home", home, "--json", "--now", "2026-09-04T22:00:00.000Z"]);
    const parsed = JSON.parse(out) as { complete: boolean; notes: string[]; epics: unknown[] };
    assert.equal(parsed.complete, true);
    assert.ok(Array.isArray(parsed.notes));
    assert.ok(Array.isArray(parsed.epics));
  });
});
