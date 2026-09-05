import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  launchIdentity,
  openOpencodeDb,
  readSessions,
  rowToRun,
  SESSION_COLUMNS,
  sessionQuery,
  type SessionRow,
  type SqliteReader,
} from "./opencode.js";

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: "ses_7f2",
  parent_id: null,
  title: "project the board",
  directory: "/home/agent/projects/harness/worktrees/issue-36",
  agent: "build",
  model: '{"id":"z-ai/glm-5.3-flash","providerID":"openrouter","variant":"high"}',
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

describe("sessionQuery", () => {
  it("reads the session table and nothing else", () => {
    // The containment claim in the module header, made checkable. The same database holds
    // `credential`; a future edit that widens this query has to fail a test to do it. The built
    // statement is checked rather than the literal, so a bound cannot smuggle a table in either.
    const { text } = sessionQuery({ limit: 10, sinceMs: 1_772_000_000_000 });
    const tables = [...text.matchAll(/\bfrom\s+(\w+)/gi)].map((m) => m[1]);
    assert.deepEqual(tables, ["session"]);
    assert.equal(/\bjoin\b/i.test(text), false);
    // Word-bounded on purpose: the column `time_updated` is not the statement `update`, and a naive
    // substring check that confused the two would have to be loosened to pass, defeating itself.
    for (const forbidden of ["credential", "account", "auth", "insert", "update", "delete", "attach", "pragma"]) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`, "i").test(text),
        false,
        `query mentions ${forbidden}`,
      );
    }
  });

  it("puts every caller-supplied value in a parameter and none of it in the text", () => {
    // The statement now takes bounds, so "fixed literal" is no longer the containment argument.
    // This is: what the caller supplies reaches SQLite as data, and the text it lands in is the
    // same text for every caller.
    const bounded = sessionQuery({ limit: 7, sinceMs: 1_772_000_000_000 });
    assert.equal(bounded.text.includes("7"), false, "the limit was interpolated into the query");
    assert.equal(bounded.text.includes("1772000000000"), false, "the cutoff was interpolated");
    assert.deepEqual(bounded.params, [1_772_000_000_000, 7]);
    assert.equal(SESSION_COLUMNS.includes("?"), false);
    assert.equal(SESSION_COLUMNS.includes("${"), false);
  });

  it("bounds and orders in the database, so --limit means the newest rows", () => {
    const { text, params } = sessionQuery({ limit: 3 });
    assert.match(text, /order by coalesce\(time_updated, time_created\) desc/);
    assert.match(text, /limit \?/);
    // No cutoff given, so no `where` clause and one parameter rather than two.
    assert.equal(/\bwhere\b/i.test(text), false);
    assert.deepEqual(params, [3]);
  });
});

describe("launchIdentity", () => {
  it("reads the object the store actually writes", () => {
    assert.deepEqual(launchIdentity('{"id":"kimi-k2.6","providerID":"opencode","variant":"high"}'), {
      model: "kimi-k2.6",
      effort: "high",
      provider: "opencode",
    });
  });

  it("reports a variant of default as default, because that is what the seam recorded", () => {
    // `LaunchIdentity` forbids guessing. Folding "default" into null would be this module deciding
    // that the provider default is the same as no answer, and a routing audit reading the result
    // could no longer tell a run that pinned the default from one that never set an effort.
    assert.equal(
      launchIdentity('{"id":"qwen3.8-27b","providerID":"n5air","variant":"default"}').effort,
      "default",
    );
  });

  it("leaves effort null when the row carries no variant", () => {
    assert.deepEqual(launchIdentity('{"id":"big-pickle","providerID":"opencode"}'), {
      model: "big-pickle",
      effort: null,
      provider: "opencode",
    });
  });

  it("says nothing about a row that recorded nothing", () => {
    assert.deepEqual(launchIdentity(null), { model: null, effort: null, provider: null });
  });

  it("keeps an unparseable value as an opaque model rather than dropping it", () => {
    // A value this function cannot read is still what the seam wrote. Returning null would claim
    // the row said nothing, which is a different — and false — statement about the evidence.
    for (const raw of ["z-ai/glm-5.3-flash", "", "[1,2]", "null", '"a string"', "{oops"]) {
      assert.deepEqual(
        launchIdentity(raw),
        { model: raw, effort: null, provider: null },
        `raw: ${JSON.stringify(raw)}`,
      );
    }
  });

  it("does not put a non-string field into an identity slot", () => {
    // An id that is a number is not a model name, and reporting it would put back exactly the kind
    // of value this function exists to keep out of the slot.
    const raw = '{"id":42,"providerID":{"n":1},"variant":[]}';
    assert.deepEqual(launchIdentity(raw), { model: raw, effort: null, provider: null });
  });

  it("ignores an empty string the same way, in every slot", () => {
    assert.deepEqual(launchIdentity('{"id":"","providerID":"n5air"}'), {
      model: '{"id":"","providerID":"n5air"}',
      effort: null,
      provider: null,
    });
    assert.deepEqual(launchIdentity('{"id":"m","providerID":"","variant":""}'), {
      model: "m",
      effort: null,
      provider: null,
    });
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
    assert.deepEqual(run.linkedIssues, [{ number: 36, from: "path" }]);
    assert.equal(run.identity.profile, "build");
  });

  it("reports the agent profile as a profile and not as an effort", () => {
    // Putting `plan` in the effort field would make a routing audit read a lane name as an effort
    // level and pass a run that never set one. It used to travel in the title instead, which was
    // worse: the title is prose and no longer exists on the record at all (finding F-5 on #105).
    const noVariant = '{"id":"z-ai/glm-5.3-flash","providerID":"openrouter"}';
    const run = rowToRun(row({ agent: "plan", model: noVariant }), "o");
    assert.equal(run?.identity.profile, "plan");
    assert.equal(run?.identity.effort, null);
    assert.equal(run?.identity.model, "z-ai/glm-5.3-flash");
    assert.equal(run?.identity.provider, "openrouter");
  });

  it("reads the whole launch identity out of the column the store actually writes", () => {
    // `session.model` is a JSON object, not a `provider/model` string. The fixture asserted the
    // invented shape, so against the real database every opencode run reported its raw JSON blob as
    // its model and that same blob again as its provider.
    assert.deepEqual(rowToRun(row(), "o")?.identity, {
      model: "z-ai/glm-5.3-flash",
      effort: "high",
      provider: "openrouter",
      profile: "build",
    });
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
    assert.deepEqual(run.linkedIssues, [{ number: 36, from: "path" }]);
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
  it("runs exactly the built query and drops rows it cannot date", () => {
    const asked: [string, readonly number[]][] = [];
    const reader: SqliteReader = {
      all: (query, params) => {
        asked.push([query, params]);
        return [row(), row({ id: "ses_bad", time_created: null })] as unknown as Readonly<Record<string, unknown>>[];
      },
      close: () => {},
    };
    const runs = readSessions(reader, "/db/opencode.db", { limit: 25 });
    assert.deepEqual(asked, [[sessionQuery({ limit: 25 }).text, [25]]]);
    assert.deepEqual(
      runs.map((r) => r.id),
      ["ses_7f2"],
    );
  });

  it("hands the cutoff to the database rather than filtering what it read", () => {
    // `--limit 1` used to bound the two JSONL seams and return every opencode row, so one flag meant
    // two things depending on which store answered (finding F-7 on #105).
    let bound: readonly number[] = [];
    const reader: SqliteReader = {
      all: (_query, params) => {
        bound = params;
        return [];
      },
      close: () => {},
    };
    readSessions(reader, "o", { limit: 4, sinceMs: 1_772_000_000_000 });
    assert.deepEqual(bound, [1_772_000_000_000, 4]);
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

      const { reader, note, absent } = await openOpencodeDb(path);
      assert.equal(note, null);
      assert.equal(absent, false);
      assert.ok(reader);
      const runs = readSessions(reader, path, { limit: 100 });
      reader.close();

      assert.deepEqual(
        runs.map((r) => r.id),
        ["ses_root", "ses_kid"],
      );
      assert.equal(runs[1]?.parentId, "ses_root");
      assert.deepEqual(runs[0]?.linkedIssues, [{ number: 39, from: "path" }]);
      assert.equal(runs[0]?.usage.costUsd, 0.02);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("separates a box with no opencode from a store that will not open", async () => {
    // `node:sqlite` reports both as ERR_SQLITE_ERROR, so the code cannot tell them apart — and
    // reporting both as "unreadable" made a caller unable to say whether its answer was complete.
    const path = join(tmpdir(), "definitely-not-here.db");
    const missing = await openOpencodeDb(path);
    assert.equal(missing.reader, null);
    assert.equal(missing.absent, true);
    assert.equal(missing.note, "opencode: no store on this box");

    const dir = await mkdtemp(join(tmpdir(), "dsh-opencode-bad-"));
    try {
      // A directory where the store belongs, because it is the failure `node:sqlite` reports at open
      // time. A file of the wrong content opens fine and only fails when a statement runs, which the
      // backfill catches separately as a failed query.
      const broken = join(dir, "opencode.db");
      await mkdir(broken, { recursive: true });
      const found = await openOpencodeDb(broken);
      assert.equal(found.reader, null);
      assert.equal(found.absent, false, "a corrupt store was reported as a store that is not there");
      assert.match(found.note ?? "", /opencode: store unreadable \(/);
      // The note is printed and may be published, and this path names a home directory. The error
      // code is what an operator acts on; the path is not theirs to hand out (finding F-5 on #105).
      assert.equal((found.note ?? "").includes(broken), false, "the note carries the store path");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
