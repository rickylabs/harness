/** The CLI with a governance file and with board items: what `status` and `tree` show from files. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXIT } from "./cli.js";
import { livePath, resolveObservability } from "./observability.js";
import { governanceFixture, home, run, runIsolated, seedClaude, seedFlatItems, seedGovernance, useTemporaryHome } from "./cli-test-support.js";

useTemporaryHome();

describe("harness-telemetry governance observations", () => {
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
    assert.match(out, /#205 throttle \[subscription\] — quota-paced · synthetic:dispatcher/);
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

    const malformed = await seedGovernance("malformed-governance.json", { ...(governanceFixture() as object), provenance: "/private/canary" });
    const invalid = await runIsolated([
      "tree", "--home", home, "--observations", malformed, "--now", "2026-09-07T12:00:00.000Z", "--json",
    ]);
    assert.equal(invalid.code, EXIT.incomplete);
    assert.equal(invalid.out.includes("/private/canary"), false);
  });

  it("reports a non-JSON file without retaining its bytes", async () => {
    const path = join(home, "not-json.json");
    await writeFile(path, "{private canary");
    const result = await runIsolated(["status", "--home", home, "--observations", path, "--now", "2026-09-07T12:00:00.000Z", "--json"]);
    assert.equal(result.code, EXIT.incomplete);
    assert.equal(JSON.parse(result.out).complete, false);
    assert.equal(result.out.includes("private canary"), false);
    assert.equal(result.out.includes(path), false);
  });

  it("evaluates a stored document at --now: expired stays visible as STALE, a future one is unavailable", async () => {
    const path = await seedGovernance("evaluated-governance.json");
    const later = await runIsolated(["status", "--home", home, "--observations", path, "--now", "2026-09-07T12:10:00.000Z"]);
    assert.equal(later.code, EXIT.ok);
    assert.match(later.out, /governance: STALE/);
    assert.match(later.out, /#205 STALE throttle/);
    const earlier = await runIsolated(["status", "--home", home, "--observations", path, "--now", "2026-09-07T11:50:00.000Z", "--json"]);
    assert.equal(earlier.code, EXIT.incomplete);
    assert.equal(JSON.parse(earlier.out).governance.availability, "unavailable");
  });
});

/**
 * The two commands, joined by a file.
 *
 * `harness-board snapshot > items.json && harness-telemetry tree --items items.json` is the whole product
 * as an operator runs it, and until #85 it did not work: the projection writes an envelope whose
 * items nest their GitHub fields under `source`, the loader cast an array to refs without checking
 * one, and every run came back unattributed. The board looked idle. That is the exact failure these
 * tests exist to keep out, so the fixture below is written in the projection's shape and not in
 * telemetry's own.
 */
describe("harness-telemetry tree", () => {
  /** What `harness-board snapshot` actually writes — envelope, nested source, phase as an object. */
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
    const items = await seedFlatItems();
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
