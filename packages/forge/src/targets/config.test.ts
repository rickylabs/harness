import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkTargets } from "./model.js";
import { describeIssue, loadTargetsConfig, parseTargetsConfig } from "./config.js";

/**
 * The live example, verbatim from `cmd/divybot/divybot.example.json`.
 *
 * Kept whole rather than reduced to the fields under test, because the acceptance criterion is that
 * this parser reads the dispatcher's own file — and the way that quietly stops being true is a
 * fixture trimmed down to the keys someone remembered.
 */
const EXAMPLE = JSON.stringify({
  inbox: "denoland/divybot",
  bot_login: "divybot",
  bot_email: "divybot@users.noreply.github.com",
  poll_interval: "30s",
  branch_prefix: "orch/divybot-",
  state_file: "/root/divybot/state.json",
  ntfy_topic: "orchid-divy-7f3k9",
  hosts: [
    {
      name: "n5",
      ssh: "root@n5",
      key: "/root/.ssh/id_ed25519",
      home: "/root",
      workdir_root: "/work",
      capabilities: ["build-deno", "x86"],
      capacity: 6,
    },
  ],
  targets: [
    { label: "deno", repo: "denoland/deno", agent: "claude", need_cap: "build-deno" },
    { label: "dactyl", repo: "denoland/dactyl", agent: "claude" },
    { label: "v8x", repo: "littledivy/v8x", agents: ["claude", "codex"], automerge: true },
  ],
  governor: {
    enabled: true,
    weekly_ceiling_pct: 92,
    slack_pct: 8,
    max_active: 16,
    min_active: 1,
    rate_window: "3h",
    five_rate_window: "45m",
    sample_interval: "90s",
  },
});

describe("parseTargetsConfig", () => {
  it("reads the dispatcher's own example file without complaint", () => {
    const { table, issues } = parseTargetsConfig(EXAMPLE);
    assert.deepEqual(issues, []);
    assert.equal(table?.inbox, "denoland/divybot");
    assert.equal(table?.botLogin, "divybot");
    assert.equal(table?.branchPrefix, "orch/divybot-");
    assert.deepEqual(
      table?.targets.map((t) => t.label),
      ["deno", "dactyl", "v8x"],
    );
  });

  it("ignores the keys that decide nothing about where an issue goes", () => {
    // `hosts`, `governor`, `state_file` and `ntfy_topic` are the dispatcher's business. Reading
    // them here would be a second copy of its operational state, able to disagree with the one that
    // matters, and none of it answers "which repository does this label send work to".
    const { issues } = parseTargetsConfig(EXAMPLE);
    assert.deepEqual(issues, []);
  });

  it("carries the upstream target fields through", () => {
    const { table } = parseTargetsConfig(EXAMPLE);
    const [deno, , v8x] = table?.targets ?? [];
    assert.equal(deno?.needCap, "build-deno");
    assert.deepEqual(deno?.agents, ["claude"]);
    assert.deepEqual(v8x?.agents, ["claude", "codex"]);
    assert.equal(v8x?.automerge, true);
  });

  it("lets `agents` override `agent`, as the dispatcher does", () => {
    const { table } = parseTargetsConfig(
      JSON.stringify({ targets: [{ label: "x", repo: "o/r", agent: "claude", agents: ["codex"] }] }),
    );
    assert.deepEqual(table?.targets[0]?.agents, ["codex"]);
  });

  it("defaults a row naming no agent at all to claude", () => {
    const { table } = parseTargetsConfig(JSON.stringify({ targets: [{ label: "x", repo: "o/r" }] }));
    assert.deepEqual(table?.targets[0]?.agents, ["claude"]);
  });
});

describe("defaults are applied at the parse", () => {
  it("resolves an omitted memory repo to the inbox, exactly as loadConfig does", () => {
    const { table } = parseTargetsConfig(
      JSON.stringify({ inbox: "rickylabs/harness", memory: { enabled: true } }),
    );
    assert.equal(table?.memory.repo, "rickylabs/harness");
    assert.equal(table?.memory.branch, "main");
    assert.equal(table?.memory.dir, "memory");
    assert.equal(table?.memory.interval, "5m");
  });

  it("makes the omission refusable by the same rule as the explicit spelling", () => {
    // The point of resolving here rather than at the point of use: one rule in `checkTargets`
    // catches both, instead of one rule plus a clause about an absent field.
    const omitted = parseTargetsConfig(
      JSON.stringify({
        inbox: "o/r",
        bot_login: "b",
        branch_prefix: "p-",
        targets: [{ label: "x", repo: "o/r" }],
        memory: { enabled: true },
      }),
    );
    const spelled = parseTargetsConfig(
      JSON.stringify({
        inbox: "o/r",
        bot_login: "b",
        branch_prefix: "p-",
        targets: [{ label: "x", repo: "o/r" }],
        memory: { enabled: true, repo: "o/r" },
      }),
    );
    if (omitted.table === null || spelled.table === null) throw new Error("expected both to parse");
    assert.deepEqual(
      checkTargets(omitted.table).map((p) => p.reason),
      ["memory-on-inbox"],
    );
    assert.deepEqual(
      checkTargets(spelled.table).map((p) => p.reason),
      ["memory-on-inbox"],
    );
  });

  it("fills the memory defaults even when the section is absent, so flipping enabled says something true", () => {
    const { table } = parseTargetsConfig(JSON.stringify({ inbox: "o/r" }));
    assert.equal(table?.memory.enabled, false);
    assert.equal(table?.memory.repo, "o/r");
    assert.equal(table?.memory.interval, "5m");
  });
});

describe("nothing is coerced", () => {
  it("refuses a number that arrived as a string, because encoding/json would", () => {
    // A parser that accepted it would report a table healthy that divybot will not start on.
    const { table, issues } = parseTargetsConfig(
      JSON.stringify({ targets: [{ label: "x", repo: "o/r", priority: "3" }] }),
    );
    assert.equal(table?.targets[0]?.priority, 0);
    assert.deepEqual(issues.map((i) => i.path), ["targets[0].priority"]);
    assert.match(issues[0]?.message ?? "", /whole number/);
  });

  it("names the offending element of a list rather than discarding the list", () => {
    const { table, issues } = parseTargetsConfig(
      JSON.stringify({ targets: [{ label: "x", repo: "o/r", agents: ["claude", 7] }] }),
    );
    assert.deepEqual(table?.targets[0]?.agents, ["claude"]);
    assert.deepEqual(issues.map((i) => i.path), ["targets[0].agents[1]"]);
  });

  it("keeps parsing after a bad row, because an operator wants the whole list", () => {
    const { table, issues } = parseTargetsConfig(
      JSON.stringify({ targets: ["deno", { label: "x", repo: "o/r" }] }),
    );
    assert.deepEqual(
      table?.targets.map((t) => t.label),
      ["x"],
    );
    assert.deepEqual(issues.map((i) => i.path), ["targets[0]"]);
  });

  it("treats an absent optional key as a default and a wrong-typed one as an issue", () => {
    const absent = parseTargetsConfig(JSON.stringify({ targets: [{ label: "x", repo: "o/r" }] }));
    assert.deepEqual(absent.issues, []);
    const wrong = parseTargetsConfig(
      JSON.stringify({ targets: [{ label: "x", repo: "o/r", automerge: "yes" }] }),
    );
    assert.deepEqual(wrong.issues.map((i) => i.path), ["targets[0].automerge"]);
  });

  it("reports a document that is not an object at all and salvages nothing", () => {
    const { table, issues } = parseTargetsConfig("[]");
    assert.equal(table, null);
    assert.equal(issues.length, 1);
    assert.equal(describeIssue(issues[0] ?? { path: "", message: "" }), issues[0]?.message);
  });

  it("reports unparseable JSON without throwing", () => {
    const { table, issues } = parseTargetsConfig("{ nope");
    assert.equal(table, null);
    assert.match(issues[0]?.message ?? "", /not valid JSON/);
  });
});

describe("loadTargetsConfig", () => {
  it("treats a missing file as an answer, not a failure", () => {
    // Same convention as `loadLabelsFile`: a repository that has never had a dispatcher configured
    // is not one with a broken config, and the caller decides whether the absence matters.
    const loaded = loadTargetsConfig("/nowhere/divybot.json", () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    assert.equal(loaded.found, false);
    assert.equal(loaded.table, null);
    assert.deepEqual(loaded.issues, []);
  });

  it("rethrows a read failure that is not an absence", () => {
    assert.throws(() =>
      loadTargetsConfig("/root/divybot.json", () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }),
    );
  });

  it("reports what it read", () => {
    const loaded = loadTargetsConfig("divybot.json", () => EXAMPLE);
    assert.equal(loaded.found, true);
    assert.equal(loaded.path, "divybot.json");
    assert.equal(loaded.table?.inbox, "denoland/divybot");
  });
});
