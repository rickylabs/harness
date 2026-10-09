/**
 * The CLI, driven end to end.
 *
 * A status command is only worth having if it works when everything else is down, so these tests
 * give it a home directory with real transcript files in it and read what it prints. Nothing here
 * stubs the backfill: the seam between "there are files on disk" and "the operator sees the work"
 * is the entire product.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EXIT } from "./cli.js";
import { parseFlags } from "./cli-flags.js";
import { livePath, resolveObservability } from "./observability.js";
import { home, run, seedClaude, seedFlatItems, useTemporaryHome } from "./cli-test-support.js";

useTemporaryHome();

describe("parseFlags", () => {
  it("defaults to this user's home and a bounded scan", () => {
    const flags = parseFlags(["status"]);
    assert.equal(flags.rest[0], "status");
    assert.equal(flags.limit, 500);
    assert.equal(flags.items, null);
    assert.equal(flags.observations, null);
    assert.equal(flags.json, false);
  });

  it("takes an explicit governance observation file", () => {
    assert.equal(parseFlags(["status", "--observations", "fixture.json"]).observations, "fixture.json");
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

describe("harness-telemetry", () => {
  it("prints usage and fails when given no command", async () => {
    const { code, out } = await run([]);
    assert.equal(code, 2);
    assert.match(out, /harness-telemetry status/);
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
    const items = await seedFlatItems();
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

describe("harness-telemetry, on evidence it could not fully read", () => {
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

describe("harness-telemetry --json", () => {
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
    assert.deepEqual(Object.keys(parsed).sort(), ["agentObservations", "complete", "dispatches", "generatedAt", "notes", "runs"]);
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

/**
 * The live log, read back into the same answer.
 *
 * These go through `main` rather than `mergeLiveRuns` because the wiring is the point: the merge had
 * unit tests before it had a caller, and `record` had a writer for two milestones before anything
 * read what it wrote. Seeding through `resolveObservability` rather than a hardcoded path keeps the
 * test honest on a box where `DSH_TELEMETRY_DIR` is set.
 */
describe("harness-telemetry, with the live log", () => {
  async function seedLog(events: readonly Record<string, unknown>[]): Promise<void> {
    const path = livePath(resolveObservability(home, process.env));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
  }

  it("closes out a Claude run, which the transcript alone can never do", async () => {
    // The store writes no completion marker, so this run reads `unknown` forever on the strength of
    // its transcript. Whatever launched it watched it stop, and that is what the log carries.
    await seedClaude("ses-a", "orch/divybot-39");
    await seedLog([
      { runId: "ses-a", kind: "exit", at: "2026-09-04T21:05:00.000Z", detail: { outcome: "complete" } },
    ]);

    const { code, out } = await run(["runs", "--home", home, "--now", "2026-09-04T22:00:00.000Z"]);
    assert.equal(code, EXIT.ok);
    assert.match(out, /ses-a|claude/);
    assert.match(out, /complete/);
    assert.ok(!out.includes("unknown"));
  });

  it("does not let the log overrule an outcome the transcript asserted", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    await seedLog([
      { runId: "ses-a", kind: "guess", at: "2026-09-04T21:05:00.000Z", detail: { outcome: "failed" } },
      { runId: "ses-a", kind: "exit", at: "2026-09-04T21:06:00.000Z", detail: { outcome: "complete" } },
    ]);
    const { out } = await run(["runs", "--home", home, "--now", "2026-09-04T22:00:00.000Z"]);
    // The later statement wins between two live events; neither would have beaten a transcript that
    // said something, and the Claude store never does.
    assert.match(out, /complete/);
    assert.ok(!out.includes("failed"));
  });

  it("hands back the log itself for a run with no transcript on this box", async () => {
    // The dispatcher timed a run out before the vendor wrote anything. There is no file to open
    // except the one that recorded it, and `why` exists to name the file to open.
    await seedLog([
      {
        runId: "ses-gone",
        kind: "timeout",
        at: "2026-09-04T21:00:00.000Z",
        detail: { source: "codex", outcome: "failed", branch: "orch/divybot-39" },
      },
    ]);
    const { code, out } = await run(["why", "ses-gone", "--home", home]);
    assert.equal(code, EXIT.ok);
    assert.match(out, /ses-gone \(codex, failed\)/);
    assert.ok(out.includes(livePath(resolveObservability(home, process.env))));
  });

  it("counts a run that named no seam, and says so rather than guessing", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    await seedLog([{ runId: "ses-nameless", kind: "tick", at: "2026-09-04T21:00:00.000Z" }]);

    const { code, out } = await run(["runs", "--home", home, "--now", "2026-09-04T22:00:00.000Z"]);
    // Exit 3, not 0: the picture the operator is reading has a run in it that this command could
    // see and could not place, and treating that as a complete answer is the failure exit 3 exists
    // to prevent.
    assert.equal(code, EXIT.incomplete);
    assert.match(out, /1 run\(s\) named no seam/);
    assert.ok(!out.includes("ses-nameless"));
  });

  it("is unbothered by a home with no log in it at all", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run(["runs", "--home", home, "--now", "2026-09-04T22:00:00.000Z"]);
    assert.equal(code, EXIT.ok);
    assert.ok(!out.includes("live log:"));
  });
});
