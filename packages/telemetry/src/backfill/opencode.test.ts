import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  openOpencodeDb,
  readSessions,
  rowToRun,
  SESSION_QUERY,
  type SessionRow,
  type SqliteReader,
} from "./opencode.js";

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: "ses_7f2",
  parent_id: null,
  title: "project the board",
  directory: "/home/agent/projects/harness/worktrees/issue-36",
  agent: "build",
  model: "z-ai/glm-5.3-flash",
  cost: 0.0412,
  tokens_input: 12_000,
  tokens_output: 900,
  tokens_reasoning: 0,
  tokens_cache_read: 40_000,
  tokens_cache_write: 300,
  time_created: 1_772_000_000_000,
  time_updated: 1_772_000_600_000,
  ...over,
});

describe("SESSION_QUERY", () => {
  it("reads the session table and nothing else", () => {
    // The containment claim in the module header, made checkable. The same database holds
    // `credential`; a future edit that widens this query has to fail a test to do it.
    const tables = [...SESSION_QUERY.matchAll(/\bfrom\s+(\w+)/gi)].map((m) => m[1]);
    assert.deepEqual(tables, ["session"]);
    assert.equal(/\bjoin\b/i.test(SESSION_QUERY), false);
    // Word-bounded on purpose: the column `time_updated` is not the statement `update`, and a naive
    // substring check that confused the two would have to be loosened to pass, defeating itself.
    for (const forbidden of ["credential", "account", "auth", "insert", "update", "delete", "attach", "pragma"]) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`, "i").test(SESSION_QUERY),
        false,
        `query mentions ${forbidden}`,
      );
    }
  });

  it("has no interpolation point a caller could widen it through", () => {
    assert.equal(SESSION_QUERY.includes("${"), false);
    assert.equal(SESSION_QUERY.includes("?"), false);
  });
});

describe("rowToRun", () => {
  it("maps a session row, milliseconds and all", () => {
    const run = rowToRun(row(), "/db/opencode.db");
    assert.ok(run);
    assert.equal(run.id, "ses_7f2");
    assert.equal(run.source, "opencode");
    assert.equal(run.startedAt, new Date(1_772_000_000_000).toISOString());
    assert.equal(run.updatedAt, new Date(1_772_000_600_000).toISOString());
    assert.deepEqual(run.usage, {
      inputTokens: 12_000,
      outputTokens: 900,
      reasoningTokens: 0,
      cacheReadTokens: 40_000,
      cacheWriteTokens: 300,
      costUsd: 0.0412,
    });
    assert.deepEqual(run.linkedIssues, [36]);
    assert.equal(run.identity.profile, "build");
  });

  it("reports the agent profile as a profile and not as an effort", () => {
    // Putting `plan` in the effort field would make a routing audit read a lane name as an effort
    // level and pass a run that never set one. It used to travel in the title instead, which was
    // worse: the title is prose and no longer exists on the record at all (finding F-5 on #105).
    const run = rowToRun(row({ agent: "plan" }), "o");
    assert.equal(run?.identity.profile, "plan");
    assert.equal(run?.identity.effort, null);
    assert.equal(run?.identity.model, "z-ai/glm-5.3-flash");
    assert.equal(run?.identity.provider, "z-ai");
  });

  it("puts none of the operator's words on the record it returns", () => {
    const run = rowToRun(
      row({ title: "the passphrase is hunter2", directory: "/home/someone/private/issue-36" }),
      "o",
    );
    assert.ok(run);
    const published = JSON.stringify(run);
    assert.equal(published.includes("hunter2"), false, "the title reached the record");
    assert.equal(published.includes("/home/someone"), false, "the directory reached the record");
    // Both are still read: the issue number in that path is the reason the column is selected.
    assert.deepEqual(run.linkedIssues, [36]);
  });

  it("carries parent_id, the only seam that records the subagent tree as data", () => {
    const run = rowToRun(row({ id: "ses_child", parent_id: "ses_7f2" }), "o");
    assert.equal(run?.parentId, "ses_7f2");
  });

  it("falls back to the start time when the row was never updated", () => {
    const run = rowToRun(row({ time_updated: null }), "o");
    assert.equal(run?.updatedAt, run?.startedAt);
  });

  it("refuses a row with no usable creation time rather than dating it to 1970", () => {
    for (const bad of [null, 0, -5]) {
      assert.equal(rowToRun(row({ time_created: bad }), "o"), null, `${String(bad)} produced a run`);
    }
  });

  it("omits a token field the row left null instead of reporting a zero", () => {
    const run = rowToRun(row({ cost: null, tokens_reasoning: null }), "o");
    assert.equal("costUsd" in (run?.usage ?? {}), false);
    assert.equal("reasoningTokens" in (run?.usage ?? {}), false);
  });

  it("reports an unknown outcome, because the store records no terminal state", () => {
    // A session that finished and a session whose host was reclaimed for capacity look identical.
    assert.equal(rowToRun(row(), "o")?.outcome, "unknown");
  });
});

describe("readSessions", () => {
  it("runs exactly the fixed query and drops rows it cannot date", () => {
    const asked: string[] = [];
    const reader: SqliteReader = {
      all: (query) => {
        asked.push(query);
        return [row(), row({ id: "ses_bad", time_created: null })] as unknown as Readonly<Record<string, unknown>>[];
      },
      close: () => {},
    };
    const runs = readSessions(reader, "/db/opencode.db");
    assert.deepEqual(asked, [SESSION_QUERY]);
    assert.deepEqual(
      runs.map((r) => r.id),
      ["ses_7f2"],
    );
  });
});

describe("openOpencodeDb", () => {
  it("reads a real database through the driver adapter", async () => {
    // The adapter between `node:sqlite`'s prepare(sql).all() and this module's all(sql) is the kind
    // of shape mismatch that type-checks and then fails on the one machine that has the store. It
    // only counts if a real database goes through it.
    const dir = await mkdtemp(join(tmpdir(), "dsh-opencode-"));
    const path = join(dir, "opencode.db");
    try {
      const sqlite = (await import("node:sqlite")) as unknown as {
        DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void };
      };
      const writer = new sqlite.DatabaseSync(path);
      writer.exec(`create table session (
        id text primary key, project_id text, parent_id text, slug text, directory text,
        title text, version text, agent text, model text, cost real,
        tokens_input integer, tokens_output integer, tokens_reasoning integer,
        tokens_cache_read integer, tokens_cache_write integer,
        time_created integer, time_updated integer
      )`);
      writer.exec(`insert into session (id, parent_id, title, directory, agent, model, cost,
        tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        time_created, time_updated)
        values ('ses_root', null, 'build the sink', '/repo/issue-39', 'build', 'z-ai/glm-5.3-flash',
                0.02, 100, 20, 0, 5, 1, 1772000000000, 1772000600000)`);
      writer.exec(`insert into session (id, parent_id, title, time_created)
        values ('ses_kid', 'ses_root', 'subagent', 1772000100000)`);
      // Also a table the module must never touch, present for the same reason it is in the real db.
      writer.exec("create table credential (id text, value text)");
      writer.exec("insert into credential values ('k', 'redacted')");
      writer.close();

      const { reader, note } = await openOpencodeDb(path);
      assert.equal(note, null);
      assert.ok(reader);
      const runs = readSessions(reader, path);
      reader.close();

      assert.deepEqual(
        runs.map((r) => r.id),
        ["ses_root", "ses_kid"],
      );
      assert.equal(runs[1]?.parentId, "ses_root");
      assert.deepEqual(runs[0]?.linkedIssues, [39]);
      assert.equal(runs[0]?.usage.costUsd, 0.02);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports an unreadable database as a note rather than throwing", async () => {
    // The rest of the backfill must still produce a snapshot. A degraded answer beats no answer.
    const path = join(tmpdir(), "definitely-not-here.db");
    const { reader, note } = await openOpencodeDb(path);
    assert.equal(reader, null);
    assert.match(note ?? "", /opencode: store unreadable \(/);
    // The note is printed and may be published, and this path names a home directory. The error
    // code is what an operator acts on; the path is not theirs to hand out (finding F-5 on #105).
    assert.equal((note ?? "").includes(path), false, "the note carries the store path");
  });
});
