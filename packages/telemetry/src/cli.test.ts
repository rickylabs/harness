/**
 * The CLI, driven end to end.
 *
 * A status command is only worth having if it works when everything else is down, so these tests
 * give it a home directory with real transcript files in it and read what it prints. Nothing here
 * stubs the backfill: the seam between "there are files on disk" and "the operator sees the work"
 * is the entire product.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { EXIT, main, parseFlags, collectGovernance, defaultSourceServices, usageCommand, runUsageProbe, readSourceText, type SourceServices } from "./cli.js";
import { spawn as spawnChild } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseSource, SPEND_URL, SourceError } from "./source.js";
import { livePath, resolveObservability } from "./observability.js";

let home: string;
let heldEnvironment: Record<string, string | undefined>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "dsh-cli-"));
  heldEnvironment = { HOME: process.env.HOME };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("DSH_TELEMETRY_")) { heldEnvironment[key] = process.env[key]; delete process.env[key]; }
  }
  process.env.HOME = home;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (key.startsWith("DSH_TELEMETRY_")) delete process.env[key];
  for (const [key, value] of Object.entries(heldEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

/** Run the CLI with stdout captured, so a test reads exactly what an operator would see. */
async function run(argv: readonly string[], services?: SourceServices): Promise<{ code: number; out: string }> {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await main(argv, services);
    return { code, out: written.join("") };
  } finally {
    process.stdout.write = original;
  }
}

/** Keep synthetic governance checks independent of ambient telemetry configuration. */
async function runIsolated(argv: readonly string[]): Promise<{ code: number; out: string }> {
  const held = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("DSH_TELEMETRY_") || value === undefined) continue;
    held.set(key, value);
    delete process.env[key];
  }
  try {
    return await run(argv);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("DSH_TELEMETRY_")) delete process.env[key];
    }
    for (const [key, value] of held) process.env[key] = value;
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

function governanceFixture(usedPercent = 63): unknown {
  return {
    observedAt: "2026-09-07T11:55:00.000Z",
    validUntil: "2026-09-07T12:05:00.000Z",
    provenance: "synthetic:test",
    state: {
      generatedAt: "2026-09-07T11:55:00.000Z",
      regimes: [
        {
          regime: "subscription",
          state: "throttle",
          accounts: [{
            seam: "codex",
            account: "primary",
            state: "throttle",
            windows: [{ label: "5h", windowMinutes: 300, usedPercent, resetsAt: null, binding: true }],
            observedAt: "2026-09-07T11:55:00.000Z",
          }],
          note: null,
        },
        {
          regime: "metered",
          state: "allow",
          providers: [{ provider: "openrouter", spentUsd: 12.5, ceilingUsd: 50, windowLabel: "monthly", observedAt: "2026-09-07T11:55:00.000Z" }],
          note: null,
        },
        {
          regime: "capacity",
          state: "allow",
          hosts: [{ host: "n5-fixture", vramUsedBytes: 8 * 1024 ** 3, vramTotalBytes: 24 * 1024 ** 3, ramUsedBytes: null, ramTotalBytes: null, observedAt: "2026-09-07T11:55:00.000Z" }],
          note: null,
        },
      ],
      pending: [],
      notes: [],
    },
    admissions: [{
      item: { number: 205 },
      regime: "subscription",
      state: "throttle",
      observedAt: "2026-09-07T11:54:00.000Z",
      validUntil: "2026-09-07T12:01:00.000Z",
      provenance: "synthetic:dispatcher",
      outcome: { accepted: false, reason: "quota-paced", detail: "waiting for the next subscription slot" },
    }],
  };
}

async function seedGovernance(name: string, value: unknown = governanceFixture()): Promise<string> {
  const path = join(home, name);
  await writeFile(path, `${JSON.stringify(value)}\n`);
  return path;
}

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

describe("dsh-telemetry governance observations", () => {
  it("shows account quota, spend, capacity, and the actual admission reason before progress", async () => {
    const observations = await seedGovernance("fresh-governance.json");
    const { code, out } = await runIsolated([
      "status",
      "--home",
      home,
      "--observations",
      observations,
      "--now",
      "2026-09-07T12:00:00.000Z",
    ]);
    assert.equal(code, EXIT.ok);
    assert.match(out, /governance: FRESH/);
    assert.match(out, /codex\/primary/);
    assert.match(out, /openrouter: \$12\.50 spent/);
    assert.match(out, /16\.0 GiB headroom/);
    assert.match(out, /#205 throttle \[subscription\] — quota-paced: waiting for the next subscription slot/);
    assert.ok(out.indexOf("#205 throttle") < out.indexOf("run(s) across"));
  });

  it("publishes the same governance value from status and tree", async () => {
    const observations = await seedGovernance("shared-governance.json");
    const args = [
      "--home",
      home,
      "--observations",
      observations,
      "--now",
      "2026-09-07T12:00:00.000Z",
      "--json",
    ];
    const status = await runIsolated(["status", ...args]);
    const tree = await runIsolated(["tree", ...args]);
    assert.equal(status.code, EXIT.ok);
    assert.equal(tree.code, EXIT.ok);
    const statusJson = JSON.parse(status.out) as { readonly governance: unknown };
    const treeJson = JSON.parse(tree.out) as { readonly governance: unknown };
    assert.deepEqual(treeJson.governance, statusJson.governance);
    assert.equal(JSON.stringify(statusJson.governance).includes(observations), false);
  });

  it("refreshes from a changed file on the next invocation without writing a telemetry event", async () => {
    const observations = await seedGovernance("changing-governance.json", governanceFixture(63));
    const args = ["status", "--home", home, "--observations", observations, "--now", "2026-09-07T12:00:00.000Z"];
    const first = await runIsolated(args);
    await writeFile(observations, `${JSON.stringify(governanceFixture(91))}\n`);
    const second = await runIsolated(args);
    assert.match(first.out, /63% used/);
    assert.match(second.out, /91% used/);
    assert.notEqual(second.out, first.out);
    const live = livePath(resolveObservability(home, {}));
    await assert.rejects(readFile(live, "utf8"), /ENOENT/);
  });

  it("makes requested missing or malformed observations incomplete without publishing the path", async () => {
    const missing = join(home, "private-observations-canary.json");
    const unreadable = await runIsolated([
      "status", "--home", home, "--observations", missing, "--now", "2026-09-07T12:00:00.000Z", "--json",
    ]);
    assert.equal(unreadable.code, EXIT.incomplete);
    assert.equal(unreadable.out.includes(missing), false);
    const unreadableJson = JSON.parse(unreadable.out) as { readonly complete: boolean; readonly governance: { readonly availability: string } };
    assert.equal(unreadableJson.complete, false);
    assert.equal(unreadableJson.governance.availability, "unavailable");

    const malformed = await seedGovernance("malformed-governance.json", { provenance: "/home/private/canary" });
    const invalid = await runIsolated([
      "tree", "--home", home, "--observations", malformed, "--now", "2026-09-07T12:00:00.000Z", "--json",
    ]);
    assert.equal(invalid.code, EXIT.incomplete);
    assert.equal(invalid.out.includes("/home/private/canary"), false);
  });
});

/**
 * The two commands, joined by a file.
 *
 * `dsh-board snapshot > items.json && dsh-telemetry tree --items items.json` is the whole product
 * as an operator runs it, and until #85 it did not work: the projection writes an envelope whose
 * items nest their GitHub fields under `source`, the loader cast an array to refs without checking
 * one, and every run came back unattributed. The board looked idle. That is the exact failure these
 * tests exist to keep out, so the fixture below is written in the projection's shape and not in
 * telemetry's own.
 */
describe("dsh-telemetry tree", () => {
  /** What `dsh-board snapshot` actually writes — envelope, nested source, phase as an object. */
  async function seedBoard(): Promise<string> {
    const path = join(home, "board.json");
    await writeFile(
      path,
      JSON.stringify({
        repo: "rickylabs/harness",
        generatedAt: "2026-09-04T22:00:00.000Z",
        items: [
          {
            source: {
              number: 39,
              title: "E9 — telemetry",
              state: "open",
              labels: ["epic:e9"],
              milestone: "M1",
              updatedAt: "2026-09-04T21:50:00.000Z",
              kind: "issue",
            },
            phase: { label: "status:impl", name: "impl", terminal: false, queued: false },
            epic: "e9",
            isEpic: true,
          },
          {
            source: {
              number: 85,
              title: "E9.3 — the hierarchy view",
              state: "open",
              labels: ["epic:e9"],
              milestone: "M1",
              updatedAt: "2026-09-04T21:00:00.000Z",
              kind: "issue",
            },
            phase: { label: "status:triage", name: "triage", terminal: false, queued: true },
            epic: "e9",
            isEpic: false,
          },
        ],
        anomalies: [],
      }),
    );
    return path;
  }

  it("attributes a run from a board snapshot piped straight in", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run([
      "tree",
      "--home",
      home,
      "--items",
      await seedBoard(),
      "--now",
      "2026-09-04T22:00:00.000Z",
    ]);
    assert.equal(code, EXIT.ok);
    assert.match(out, /M1/);
    assert.match(out, /epic:e9 E9 — telemetry/);
    // The proof the pipeline composes: the run reached a node instead of the unattributed pile.
    assert.equal(out.includes("joined to no board item"), false);
  });

  it("shows a task no run has touched, which the flat status view cannot", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { out } = await run([
      "tree",
      "--home",
      home,
      "--items",
      await seedBoard(),
      "--now",
      "2026-09-04T22:00:00.000Z",
    ]);
    assert.match(out, /#85/);
    assert.match(out, /triage/);
  });

  it("reads the documented flat --items array too, so nothing that worked stopped working", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const items = join(home, "items.json");
    await writeFile(
      items,
      JSON.stringify([{ number: 39, title: "telemetry sink", epic: "E9", milestone: "W2", phase: null }]),
    );
    const { code, out } = await run([
      "tree",
      "--home",
      home,
      "--items",
      items,
      "--now",
      "2026-09-04T22:00:00.000Z",
    ]);
    assert.equal(code, EXIT.ok);
    assert.match(out, /#39 telemetry sink/);
  });

  it("exits 3 and says which entries it dropped, rather than reporting a smaller board", async () => {
    // A silently shortened feed is the same lie as an empty one: the nodes that vanished look
    // exactly like tasks that do not exist.
    const items = join(home, "items.json");
    await writeFile(items, JSON.stringify([{ number: 39, epic: "E9" }, { title: "no number" }]));
    const { code, out } = await run([
      "tree",
      "--home",
      home,
      "--items",
      items,
      "--now",
      "2026-09-04T22:00:00.000Z",
    ]);
    assert.equal(code, EXIT.incomplete);
    assert.match(out, /entry 1 has no usable item number/);
  });

  it("emits a machine-readable tree that names no path out of this box", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { code, out } = await run([
      "tree",
      "--home",
      home,
      "--items",
      await seedBoard(),
      "--json",
      "--now",
      "2026-09-04T22:00:00.000Z",
    ]);
    assert.equal(code, EXIT.ok);
    const parsed = JSON.parse(out) as { complete: boolean; milestones: unknown[]; now: string };
    assert.equal(parsed.complete, true);
    assert.equal(parsed.now, "2026-09-04T22:00:00.000Z");
    assert.equal(parsed.milestones.length, 1);
    // Same allowlist rule as the other projections: `origin` is a path under someone's home.
    assert.equal(out.includes("origin"), false);
    assert.equal(out.includes(".jsonl"), false);
    assert.equal(out.includes(JSON.stringify(home).slice(1, -1)), false);
  });

  it("says it was never told where the board is, instead of drawing an empty tree", async () => {
    await seedClaude("ses-a", "orch/divybot-39");
    const { out } = await run(["tree", "--home", home, "--now", "2026-09-04T22:00:00.000Z"]);
    assert.match(out, /no --items given/);
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
describe("dsh-telemetry, with the live log", () => {
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

const LIVE_NOW = "2026-09-07T12:00:00.000Z";
const USAGE_CANARY = "synthetic-usage-secret-canary";
const SPEND_CANARY = "synthetic-spend-secret-canary";
const PRIVATE_CANARY = "synthetic-private-project-session-path-host-canary";
function liveDescriptor() {
  return {
    accountLabel: "synthetic", usage: { denoBin: "/fixture/deno", probe: "/fixture/probe.ts", checkout: join(home, "upstream"), model: "fixture/model",
      credentialEnv: "USAGE_API_KEY", timeoutMs: 100, maxBytes: 4096,
      windows: { rolling_five_hours: { label: "short", windowMinutes: 3 }, weekly: { label: "week", windowMinutes: 5 }, monthly: { label: "month", windowMinutes: 7 } } },
    spend: { url: SPEND_URL, credentialEnv: "SPEND_API_KEY", window: "monthly", validForMs: 60000, timeoutMs: 100, maxBytes: 4096 },
    capacity: { cgroupRoot: join(home, "cgroup"), scopeLabel: "configured-cgroup", validForMs: 60000 },
    admissions: { fromObservabilityLog: true },
  };
}
function usagePayload(capturedAt = LIVE_NOW) {
  return { provider: "opencode_go", capturedAt, validForMs: 900000,
    percentageWindows: Object.fromEntries(["rolling_five_hours", "weekly", "monthly"].map(id => [id, { percent: 42, status: "allowed", resetsAt: "2026-09-07T13:00:00Z" }])),
    private: PRIVATE_CANARY,
  };
}
const admissionEvent = () => ({ at: LIVE_NOW, runId: PRIVATE_CANARY, kind: "governance.admission", detail: {
  item: { number: 205 }, regime: "subscription", state: "throttle", observedAt: LIVE_NOW, validUntil: "2026-09-07T12:05:00Z",
  provenance: PRIVATE_CANARY, outcome: { accepted: false, reason: "quota-paced", detail: PRIVATE_CANARY },
} });
function fakeServices(over: Partial<SourceServices> = {}): SourceServices {
  return { ...defaultSourceServices(), env: { USAGE_API_KEY: USAGE_CANARY, SPEND_API_KEY: SPEND_CANARY }, clock: () => LIVE_NOW,
    usage: async () => usagePayload(), fetch: async () => new Response(JSON.stringify({ data: { usage_monthly: 2, label: PRIVATE_CANARY } })),
    readText: async path => path.endsWith("memory.current") ? "1024\n" : "max\n", ...over };
}
const emptyLog = { files: [], notes: [], degraded: false };
async function seedLive(descriptor: unknown = liveDescriptor()): Promise<string> {
  await mkdir(join(home, "cgroup"), { recursive: true });
  await mkdir(join(home, "upstream"), { recursive: true });
  await writeFile(join(home, "upstream", "unchanged.txt"), "synthetic source dependency\n");
  await writeFile(join(home, "cgroup", "memory.current"), "1024\n");
  await writeFile(join(home, "cgroup", "memory.max"), "max\n");
  const path = join(home, "source.json");
  await writeFile(path, JSON.stringify(descriptor));
  return path;
}
async function filesBelow(root: string): Promise<unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result[entry.name] = await filesBelow(path);
    else { const info = await stat(path); result[entry.name] = [info.mtimeMs, info.size, await readFile(path, "utf8")]; }
  }
  return result;
}
/** A real process, with no inherited credentials or ambient telemetry overrides. */
async function cliProcess(args: string[], stdin = "", program?: string): Promise<{ code: number; out: string; err: string }> {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  return await new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, program === undefined ? [cli, ...args] : ["--input-type=module", "-e", program, ...args], {
      env: { HOME: home, PATH: process.env.PATH ?? "" }, stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", chunk => { out += String(chunk); });
    child.stderr.on("data", chunk => { err += String(chunk); });
    child.on("error", reject);
    child.on("close", code => resolve({ code: code ?? 1, out, err }));
    child.stdin.end(stdin);
  });
}

describe("live governance CLI and services", () => {
  it("pins the env-only permission vector and minimizes child environment; no credential argv", async () => {
    const config = parseSource(liveDescriptor()).usage!;
    const command = usageCommand(config, USAGE_CANARY);
    assert.deepEqual(command.args.slice(0, 6), ["run", "--no-config", "--no-lock", "--no-prompt", "--no-remote", "--no-code-cache"]);
    assert.deepEqual(command.args.filter(a => a.startsWith("--allow-")), ["--allow-env=USAGE_API_KEY", "--allow-net=opencode.ai"]);
    assert.deepEqual(Object.keys(command.env).sort(), ["DENO_DIR", "DENO_NO_UPDATE_CHECK", "USAGE_API_KEY"]);
    assert.equal(command.env.DENO_DIR, "/dev/null");
    assert.equal(command.env.USAGE_API_KEY, USAGE_CANARY);
    assert.doesNotMatch(JSON.stringify(command.args), /secret-canary|--now|--allow-read|--allow-write|--allow-run/);
    const probe = await readFile(fileURLToPath(new URL("../adapters/opencode-usage-probe.ts", import.meta.url)), "utf8");
    assert.match(probe, /from "harness:usage"/);
    assert.match(probe, /from "harness:usage-validity"/);
    assert.match(probe, /readTextFile: denied/);
    assert.match(probe, /stat: denied/);
    assert.match(probe, /validForMs: EXPENSE_SNAPSHOT_MAX_AGE_MS/);
    assert.doesNotMatch(probe, /Deno\.env\.toObject|reserveCopilotCredits|--now/);
  });
  it("isolates each service failure and exposes incomplete evidence without leaking credentials or exceptions", async () => {
    const source = parseSource(liveDescriptor());
    let calls = 0;
    const services = fakeServices({ usage: async command => {
      assert.equal(command.env.USAGE_API_KEY, USAGE_CANARY);
      assert.doesNotMatch(JSON.stringify(command.args), /secret-canary/);
      throw new Error(PRIVATE_CANARY + USAGE_CANARY);
    }, fetch: async (url, init) => {
      calls++;
      assert.equal(url, SPEND_URL);
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SPEND_CANARY}`);
      return new Response(JSON.stringify({ data: { usage_monthly: 2, byok_usage_monthly: 20, label: PRIVATE_CANARY } }));
    } });
    const result = await collectGovernance(source, emptyLog, services);
    assert.equal(calls, 1);
    assert.equal(result.observed.ok, false);
    assert.equal(result.observed.governance.availability, "fresh");
    assert.match(JSON.stringify(result), /"spentUsd":2/);
    assert.match(JSON.stringify(result), /"ramUsedBytes":1024/);
    assert.doesNotMatch(JSON.stringify(result), /secret-canary|private-project/);
    const failedCapacity = await collectGovernance(source, emptyLog, fakeServices({ readText: async () => { throw new Error(PRIVATE_CANARY); } }));
    assert.equal(failedCapacity.observed.ok, false);
    assert.match(JSON.stringify(failedCapacity), /"usedPercent":42/);
    assert.match(failedCapacity.observed.notes.join(" "), /capacity: cgroup-unreadable/);
  });
  it("missing env bindings perform no service call and preserve the capacity leg", async () => {
    let called = false;
    const services = fakeServices({ env: {}, usage: async () => { called = true; throw new Error(); }, fetch: async () => { called = true; throw new Error(); } });
    const result = await collectGovernance(parseSource(liveDescriptor()), emptyLog, services);
    assert.equal(called, false);
    assert.equal(result.observed.ok, false);
    assert.match(result.observed.notes.join(" "), /usage: credential-unbound/);
    assert.match(result.observed.notes.join(" "), /spend: credential-unbound/);
    assert.match(JSON.stringify(result), /"ramUsedBytes":1024/);
  });
  it("spend refuses non-JSON, HTTP failure, oversized streaming bodies and timed-out responses", async () => {
    for (const [fetcher, reason] of [
      [async () => new Response("not-json"), "non-json"],
      [async () => new Response("private", { status: 401 }), "request-failed"],
      [async () => new Response("x".repeat(4097)), "oversize"],
      [async () => new Promise<Response>(() => {}), "timeout"],
      [async () => new Response(new ReadableStream({ start() {} })), "timeout"],
    ] as const) {
      const source = parseSource({ ...liveDescriptor(), spend: { ...liveDescriptor().spend, timeoutMs: 5 } });
      const result = await collectGovernance(source, emptyLog, fakeServices({ fetch: fetcher }));
      assert.equal(result.observed.ok, false);
      assert.match(result.observed.notes.join(" "), new RegExp(`spend: ${reason}`));
      assert.match(JSON.stringify(result), /"usedPercent":42/);
    }
  });
  it("takes completion after every successful read, rejects expired/future leaves, and never passes evaluation time to the probe", async () => {
    const stamps = ["2026-09-07T12:00:01Z", "2026-09-07T12:00:02Z", "2026-09-07T12:00:03Z"];
    const result = await collectGovernance(parseSource(liveDescriptor()), emptyLog, fakeServices({ clock: () => stamps.shift()!, usage: async command => {
      assert.doesNotMatch(JSON.stringify(command.args), /--now|13:00/);
      return usagePayload();
    } }), "2026-09-07T13:00:00Z");
    assert.equal(result.completion, "2026-09-07T12:00:03Z");
    assert.equal(result.observed.governance.availability, "stale");
    assert.match(JSON.stringify(result), /2026-09-07T12:00:00.000Z/);
    for (const capturedAt of ["2026-09-07T11:00:00Z", "2026-09-07T12:00:01Z"]) {
      const result = await collectGovernance(parseSource(liveDescriptor()), emptyLog, fakeServices({ usage: async () => usagePayload(capturedAt) }));
      assert.equal(result.observed.ok, false);
      assert.doesNotMatch(JSON.stringify(result), /"usedPercent"/);
      assert.match(JSON.stringify(result), /"spentUsd":2/);
    }
  });
  it("real CLI file: compatibility, refresh and all-unconfigured completeness are deterministic and read-only", async () => {
    const file = join(home, "observations.json");
    await writeFile(file, JSON.stringify(governanceFixture()));
    const args = ["status", "--home", home, "--now", "2026-09-07T12:00:00Z", "--json"];
    const before = await filesBelow(home);
    const old = await cliProcess([...args, "--observations", file]);
    const alias = await cliProcess([...args, "--observations-from", `file:${file}`]);
    assert.equal(alias.code, 0);
    assert.deepEqual(alias, old);
    assert.deepEqual(await filesBelow(home), before);
    await writeFile(file, JSON.stringify(governanceFixture(21)));
    const refreshed = await cliProcess([...args, "--observations-from", `file:${file}`]);
    assert.equal(refreshed.code, 0);
    assert.match(refreshed.out, /"usedPercent": 21/);
    const config = await seedLive({ accountLabel: "synthetic", usage: null, spend: null, capacity: null, admissions: null });
    const unconfigured = await cliProcess([...args, "--observations-from", config]);
    assert.equal(unconfigured.code, 3);
    assert.equal(JSON.parse(unconfigured.out).complete, false);
    assert.match(unconfigured.out, /unavailable/);
  });
  it("real writer-to-reader CLI path consumes synthetic admissions with injected services and no observation writes", async () => {
    const path = await seedLive();
    const recorded = await cliProcess(["record", "--home", home, "--json"], JSON.stringify(admissionEvent()) + "\n");
    assert.equal(recorded.code, 0);
    const before = await filesBelow(home);
    const cliUrl = new URL("./cli.js", import.meta.url).href;
    const program = `import {main, defaultSourceServices} from ${JSON.stringify(cliUrl)};
      const services = {...defaultSourceServices(), env: {USAGE_API_KEY: "${USAGE_CANARY}", SPEND_API_KEY: "${SPEND_CANARY}"},
        clock: () => "${LIVE_NOW}", usage: async () => (${JSON.stringify(usagePayload())}),
        fetch: async () => new Response(JSON.stringify({data: {usage_monthly: 2, label: "${PRIVATE_CANARY}"}}))};
      process.exitCode = await main(process.argv.slice(1), services);`;
    for (const command of ["status", "tree"]) {
      for (const json of [[], ["--json"]]) {
        const result = await cliProcess([command, "--home", home, "--observations-from", path, ...json], "", program);
        assert.equal(result.code, 0, result.err + result.out);
        assert.doesNotMatch(result.out + result.err, /secret-canary|private-project-session|fixture\/model/);
        assert.match(result.out, /quota-paced/);
        assert.match(result.out, /reader:recorded-admission/);
        if (json.length > 0) {
          assert.equal(JSON.parse(result.out).complete, true);
          assert.match(result.out, /"ramTotalBytes": null/);
          assert.match(result.out, /"ramUsedBytes": 1024/);
        } else assert.match(result.out, /total unknown · headroom unknown/);
      }
    }
    assert.deepEqual(await filesBelow(home), before);
    // The writer can supply envelope time, but it must never invent missing detail time.
    const malformedNewest = admissionEvent();
    const { observedAt: _omitted, ...invalidDetail } = malformedNewest.detail;
    const appended = await cliProcess(["record", "--home", home], JSON.stringify({ ...malformedNewest, detail: invalidDetail }) + "\n");
    assert.equal(appended.code, 0);
    const afterAppend = await filesBelow(home);
    const invalid = await cliProcess(["status", "--home", home, "--observations-from", path, "--json"], "", program);
    assert.equal(invalid.code, 3);
    assert.equal(JSON.parse(invalid.out).complete, false);
    assert.match(invalid.out, /shape-mismatch/);
    assert.doesNotMatch(invalid.out, /quota-paced|private-project-session/);
    assert.deepEqual(await filesBelow(home), afterAppend);
  });
  it("real CLI keeps successful capacity when credentials and admissions are unavailable; invalid source is usage error", async () => {
    const path = await seedLive();
    const before = await filesBelow(home);
    const result = await cliProcess(["status", "--home", home, "--observations-from", path, "--json"]);
    assert.equal(result.code, 3);
    assert.equal(JSON.parse(result.out).complete, false);
    assert.match(result.out, /"ramUsedBytes": 1024/);
    assert.match(result.out, /credential-unbound/);
    assert.deepEqual(await filesBelow(home), before);
    await writeFile(join(home, "cgroup", "memory.current"), "2048\n");
    const refreshedBefore = await filesBelow(home);
    const refreshed = await cliProcess(["status", "--home", home, "--observations-from", path, "--json"]);
    assert.equal(refreshed.code, 3);
    assert.match(refreshed.out, /"ramUsedBytes": 2048/);
    assert.ok(Date.parse(JSON.parse(refreshed.out).generatedAt) > Date.parse(JSON.parse(result.out).generatedAt));
    assert.deepEqual(await filesBelow(home), refreshedBefore);
    await writeFile(path, JSON.stringify({ ...liveDescriptor(), spend: { ...liveDescriptor().spend, url: "https://private-canary.invalid" } }));
    const invalid = await cliProcess(["status", "--home", home, "--observations-from", path]);
    assert.equal(invalid.code, 2);
    assert.equal(invalid.out, "governance source: invalid-descriptor\n");
    assert.throws(() => parseFlags(["status", "--observations", path, "--observations-from", path]), /mutually exclusive/);
    assert.throws(() => parseFlags(["runs", "--observations-from", path]), /requires tree or status/);
  });
  it("bounds regular file reads and real subprocess output, timeout, stderr and malformed output without Deno", async () => {
    const path = join(home, "bounded.json");
    await writeFile(path, "12345");
    await assert.rejects(readSourceText(path, 4), (e: unknown) => e instanceof SourceError && e.code === "oversize");
    assert.equal(await readSourceText(path, 5), "12345");
    const command = { bin: process.execPath, args: ["-e", "process.stderr.write('private-canary');process.stdout.write('{}')"], env: { HOME: home }, timeoutMs: 2000, maxBytes: 1024 };
    assert.deepEqual(await runUsageProbe(command), {});
    for (const [script, code] of [["process.stdout.write('x'.repeat(1025))", "oversize"], ["process.stdout.write('x')", "non-json"], ["process.exitCode=3", "spawn-failed"]]) {
      await assert.rejects(runUsageProbe({ ...command, args: ["-e", script!] }), (e: unknown) => e instanceof SourceError && e.code === code);
    }
    await assert.rejects(runUsageProbe({ ...command, args: ["-e", "setInterval(()=>{}, 1000)"], timeoutMs: 30 }), (e: unknown) => e instanceof SourceError && e.code === "timeout");
    await assert.rejects(runUsageProbe({ ...command, bin: join(home, "absent") }), (e: unknown) => e instanceof SourceError && e.code === "spawn-failed");
  });
});
