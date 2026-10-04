/** Operator migration controls run against the compiled CLI and real isolated sources. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { openObservabilitySink, resolveObservability } from "./observability.js";
import { collectIssueAgentTree, issueAgentFeedCommand } from "./issue-agent-feed-cli.js";
import { readObservabilityLog } from "./log-source.js";
import { readLiveLog } from "./live.js";
import { LEGACY_OPERATOR_ENV, OPERATOR_ENV, resolveOperatorSetting } from "./operator-environment.js";
import { Writable } from "node:stream";
import { readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";

const execute = promisify(execFile);
const at = "2026-10-04T08:30:00.000Z";
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const canonical = "harness-telemetry.jsonl", legacy = "dsh-telemetry.jsonl";
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(?:HARNESS|DSH)_TELEMETRY_/.test(key)));
async function run(home: string, args: readonly string[], env: Record<string, string> = {}, includeHome = true) {
  try {
    const result = await execute(process.execPath, [cli, ...args, ...(includeHome ? ["--home", home] : [])], {
      env: { ...cleanEnv, ...env }, cwd: home, timeout: 15_000,
    });
    return { code: 0, out: result.stdout, err: result.stderr };
  } catch (error) {
    const result = error as Error & { code: number; stdout: string; stderr: string };
    assert.equal(typeof result.code, "number", "the compiled CLI must run, not time out");
    return { code: result.code, out: result.stdout, err: result.stderr };
  }
}
async function fixture(test: (home: string, directory: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "operator-naming-"));
  const directory = join(home, "logs");
  await mkdir(directory);
  try { await test(home, directory); }
  finally { await rm(home, { recursive: true, force: true }); }
}
const event = JSON.stringify({ at, runId: "migration-fixture-run", kind: "turn" }) + "\n";

it("canonical operator settings and legacy aliases resolve identically", () => {
  const values = { DIR: "/fixture/logs", ARCHIVE: "none", MAX_BYTES: "4k", GENERATIONS: "2" };
  const env = (prefix: string) => Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}${key}`, value]));
  const old = resolveObservability("/fixture/home", env("DSH_TELEMETRY_"));
  const current = resolveObservability("/fixture/home", env("HARNESS_TELEMETRY_"));
  assert.equal(current.directory, values.DIR);
  assert.deepEqual(current, old);
  assert.deepEqual(resolveObservability("/fixture/home", { ...env("DSH_TELEMETRY_"), ...env("HARNESS_TELEMETRY_") }), old);
});
it("contradictory dual settings refuse every operator setting without disclosing values", () => {
  for (const key of ["DIR", "ARCHIVE", "MAX_BYTES", "GENERATIONS"]) {
    assert.throws(() => resolveObservability("/fixture/home", {
      [`HARNESS_TELEMETRY_${key}`]: "CANONICAL-PRIVATE-CANARY",
      [`DSH_TELEMETRY_${key}`]: "LEGACY-PRIVATE-CANARY",
    }), error => error instanceof Error && !error.message.includes("PRIVATE-CANARY"));
  }
});
it("canonical filename selection is explicit and rejects arbitrary paths", () => {
  assert.equal(resolveObservability("/fixture/home").policy.name, legacy);
  for (const name of [canonical, legacy]) {
    assert.equal(resolveObservability("/fixture/home", { HARNESS_TELEMETRY_LOG_NAME: name }).policy.name, name);
  }
  for (const name of ["../other.jsonl", "/fixture/other.jsonl", "other.jsonl", "", " "]) {
    assert.throws(() => resolveObservability("/fixture/home", { HARNESS_TELEMETRY_LOG_NAME: name }));
  }
});
it("canonical private binding works and contradictory/blank bindings remain unavailable", async () => {
  await fixture(async (home, directory) => {
    await chmod(directory, 0o700);
    const collect = (env: Record<string, string>) => collectIssueAgentTree({ home, limit: 50, now: at, env });
    assert.equal((await collect({ HARNESS_TELEMETRY_DISPATCH_ROOT: directory })).complete, true);
    assert.equal((await collect({ DSH_TELEMETRY_DISPATCH_ROOT: directory })).complete, true);
    for (const key of ["DISPATCH_ROOT", "CLAUDE_CHILD_EVENT_ROOT", "PLACEMENT_HOST"]) {
      const result = await collect({ HARNESS_TELEMETRY_DISPATCH_ROOT: directory,
        [`HARNESS_TELEMETRY_${key}`]: "CANONICAL-PRIVATE-CANARY",
        [`DSH_TELEMETRY_${key}`]: "LEGACY-PRIVATE-CANARY" });
      assert.equal(result.complete, false);
      assert.equal(result.reason, "source_unavailable");
      assert.ok(!JSON.stringify(result).includes("PRIVATE-CANARY"));
    }
    for (const root of ["", " ", ` ${directory}`]) {
      const result = await collect({ HARNESS_TELEMETRY_DISPATCH_ROOT: root });
      assert.equal(result.reason, "source_unavailable");
    }
    assert.equal((await collect({})).reason, "source_not_bound");
  });
});
it("compiled record honors canonical directory, bound and basename", async () => {
  await fixture(async (home, directory) => {
    const env = { HARNESS_TELEMETRY_DIR: directory, HARNESS_TELEMETRY_ARCHIVE: "none",
      HARNESS_TELEMETRY_MAX_BYTES: "100", HARNESS_TELEMETRY_GENERATIONS: "2", HARNESS_TELEMETRY_LOG_NAME: canonical };
    for (let i = 0; i < 2; i++) {
      assert.equal((await run(home, ["record", "--run", "migration-fixture-run", "--kind", "turn", "--json", "--now", at], env)).code, 0);
    }
    assert.ok((await readdir(directory)).includes("harness-telemetry.1.jsonl"));
    assert.equal(await readFile(join(directory, "harness-telemetry.1.jsonl"), "utf8"), event);
    assert.equal(await readFile(join(directory, canonical), "utf8"), event);
    assert.ok(!(await readdir(directory)).includes(legacy));
  });
});
it("all operator aliases keep equal values, legacy fallback and private raw values", () => {
  for (const key of Object.keys(OPERATOR_ENV) as (keyof typeof OPERATOR_ENV)[]) {
    assert.equal(resolveOperatorSetting({ [OPERATOR_ENV[key]]: "fixture", [LEGACY_OPERATOR_ENV[key]]: "fixture" }, key), "fixture");
    assert.equal(resolveOperatorSetting({ [LEGACY_OPERATOR_ENV[key]]: "fixture" }, key), "fixture");
    assert.throws(() => resolveOperatorSetting({ [OPERATOR_ENV[key]]: "a", [LEGACY_OPERATOR_ENV[key]]: "b" }, key));
  }
  for (const key of ["directory", "archive", "maxBytes", "generations"] as const) {
    assert.equal(resolveOperatorSetting({ [OPERATOR_ENV[key]]: "   " }, key), undefined);
    assert.equal(resolveOperatorSetting({ [OPERATOR_ENV[key]]: "  a  ", [LEGACY_OPERATOR_ENV[key]]: "a" }, key), "a");
  }
  for (const key of ["dispatchRoot", "claudeChildEventRoot", "placementHost", "nativeHome"] as const) {
    assert.equal(resolveOperatorSetting({ [OPERATOR_ENV[key]]: " " }, key), " ");
    assert.throws(() => resolveOperatorSetting({ [OPERATOR_ENV[key]]: "", [LEGACY_OPERATOR_ENV[key]]: "a" }, key));
  }
});
it("a source conflict emits a valid watch frame without collecting or extending evidence", async () => {
  const lines: string[] = [];
  const output = new Writable({ write(chunk, _encoding, done) { lines.push(String(chunk)); done(); } });
  let collects = 0;
  const code = await issueAgentFeedCommand(["--watch"], { output, now: () => at, generation: () => "migration-fixture-generation",
    env: { HARNESS_TELEMETRY_DISPATCH_ROOT: "a", DSH_TELEMETRY_DISPATCH_ROOT: "b" },
    collect: async () => { collects++; throw Error(); }, wait: async () => { output.emit("close"); } });
  assert.equal(code, 0, "watch exits cleanly on output close; availability lives in each frame");
  assert.equal(collects, 0);
  assert.equal(lines.length, 1);
  const frame = JSON.parse(lines[0]!);
  assert.deepEqual(Object.keys(frame).sort(), ["generation", "sequence", "snapshot", "type"]);
  assert.equal(frame.type, "snapshot");
  assert.equal(readIssueAgentTreeSnapshot(frame.snapshot).ok, true);
  assert.equal(frame.snapshot.complete, false);
  assert.equal(frame.snapshot.reason, "source_unavailable");
  assert.equal(frame.sequence, 0);
});
it("action receipts use canonical or legacy roots and keep conflicts/permissions unavailable", async () => {
  await fixture(async (home, directory) => {
    await chmod(directory, 0o700);
    const args = ["action-receipt", "--operation", "11111111-1111-4111-8111-111111111111", "--json"];
    for (const key of ["HARNESS_TELEMETRY_DISPATCH_ROOT", "DSH_TELEMETRY_DISPATCH_ROOT"]) {
      const result = await run(home, args, { [key]: directory }, false);
      assert.equal(result.code, 3);
      assert.equal(JSON.parse(result.out).reason, "receipt_missing");
    }
    const conflict = await run(home, args, { HARNESS_TELEMETRY_DISPATCH_ROOT: directory, DSH_TELEMETRY_DISPATCH_ROOT: "PRIVATE-PATH-CANARY" }, false);
    assert.equal(JSON.parse(conflict.out).reason, "source_unavailable");
    assert.ok(!(conflict.out + conflict.err).includes("PRIVATE-PATH-CANARY"));
    await chmod(directory, 0o755);
    assert.equal(JSON.parse((await run(home, args, { HARNESS_TELEMETRY_DISPATCH_ROOT: directory }, false)).out).reason, "source_unavailable");
    const feed = await collectIssueAgentTree({ home, limit: 50, now: at, env: { HARNESS_TELEMETRY_DISPATCH_ROOT: directory } });
    assert.equal(feed.reason, "source_unavailable");
  });
});
it("observability sinks fence a family that appears after opening without losing old bytes", async () => {
  await fixture(async (_home, directory) => {
    const target = resolveObservability("/fixture/home", { HARNESS_TELEMETRY_DIR: directory, HARNESS_TELEMETRY_ARCHIVE: "none" });
    const sink = openObservabilitySink(target);
    const item = { at, runId: "migration-fixture-run", kind: "turn" };
    await sink.write(item);
    await writeFile(join(directory, canonical), event);
    await sink.write(item);
    assert.deepEqual(sink.notes, ["live log: log-family-conflict"]);
    assert.equal(await readFile(join(directory, legacy), "utf8"), event);
  });
});
it("managed readers discard the read when a second family appears during collection", async () => {
  await fixture(async (_home, directory) => {
    await writeFile(join(directory, canonical), event);
    const target = resolveObservability("/fixture/home", { HARNESS_TELEMETRY_DIR: directory, HARNESS_TELEMETRY_LOG_NAME: canonical });
    const log = await readObservabilityLog(target, at, async (paths, now) => {
      const result = await readLiveLog(paths, now);
      await writeFile(join(directory, legacy), event);
      return result;
    });
    assert.deepEqual(log, { files: [], notes: ["live log: log-family-conflict"], degraded: true });
  });
});
it("family conflicts are refused before collection and missing selection stays explicit", async () => {
  await fixture(async (home, directory) => {
    const target = resolveObservability(home, { HARNESS_TELEMETRY_DIR: directory, HARNESS_TELEMETRY_LOG_NAME: canonical });
    assert.deepEqual((await readObservabilityLog(target, at)).notes, ["live log: selected-log-missing"]);
    const optional = resolveObservability(home, { HARNESS_TELEMETRY_DIR: join(home, "absent") });
    assert.deepEqual(await readObservabilityLog(optional, at), { files: [], notes: [], degraded: false });
    await writeFile(join(directory, canonical), event);
    await writeFile(join(directory, legacy), event);
    let collects = 0;
    const conflict = await readObservabilityLog(target, at, async () => { collects++; return { files: [], notes: [], degraded: false }; });
    assert.equal(collects, 0);
    assert.deepEqual(conflict, { files: [], notes: ["live log: log-family-conflict"], degraded: true });
  });
});
it("log inventory refuses unavailable and oversized directories", async () => {
  await fixture(async (_home, directory) => {
    const path = join(directory, "not-a-directory"); await writeFile(path, "fixture");
    const unavailable = await readObservabilityLog(resolveObservability("/fixture/home", { HARNESS_TELEMETRY_DIR: path }), at);
    assert.deepEqual(unavailable.notes, ["live log: inventory-unavailable"]);
    await writeFile(join(directory, canonical), event);
    // Keep creation sequential and bounded: these are unrelated synthetic daemon files.
    for (let i = 0; i < 4096; i++) await writeFile(join(directory, `unrelated-${i}`), "");
    const oversized = await readObservabilityLog(resolveObservability("/fixture/home", {
      HARNESS_TELEMETRY_DIR: directory, HARNESS_TELEMETRY_LOG_NAME: canonical }), at);
    assert.deepEqual(oversized, { files: [], notes: ["live log: inventory-limit"], degraded: true });
  });
});
it("compiled writer refuses conflicts and an existing opposite family before creating a log", async () => {
  await fixture(async (home, directory) => {
    const args = ["record", "--run", "migration-fixture-run", "--kind", "turn", "--json", "--now", at];
    const conflict = await run(home, args, { HARNESS_TELEMETRY_DIR: directory, DSH_TELEMETRY_DIR: "PRIVATE-PATH-CANARY" });
    assert.equal(conflict.code, 3);
    assert.ok(!(conflict.out + conflict.err).includes("PRIVATE-PATH-CANARY"));
    assert.deepEqual(await readdir(directory), []);
    await writeFile(join(directory, "dsh-telemetry.99.jsonl"), event);
    const refused = await run(home, args, { HARNESS_TELEMETRY_DIR: directory, HARNESS_TELEMETRY_LOG_NAME: canonical });
    assert.equal(refused.code, 3);
    assert.deepEqual(await readdir(directory), ["dsh-telemetry.99.jsonl"]);
  });
});
it("compiled reader refuses mixed, wrong-family, missing and empty canonical sources", async () => {
  await fixture(async (home, directory) => {
    const env = { HARNESS_TELEMETRY_DIR: directory, HARNESS_TELEMETRY_LOG_NAME: canonical };
    const check = async () => {
      const result = await run(home, ["runs", "--json", "--now", at], env);
      assert.equal(result.code, 3);
      assert.equal(JSON.parse(result.out).complete, false);
      assert.deepEqual(JSON.parse(result.out).runs, []);
    };
    await check();
    await writeFile(join(directory, canonical), "\n"); await check();
    await writeFile(join(directory, canonical), event);
    await writeFile(join(directory, "dsh-telemetry.99.jsonl"), event); await check();
    await rm(join(directory, canonical)); await check();
    await rm(join(directory, "dsh-telemetry.99.jsonl"));
    const legacyDefault = await run(home, ["runs", "--json", "--now", at], { DSH_TELEMETRY_DIR: directory });
    assert.equal(legacyDefault.code, 0, "an absent optional legacy log retains its existing semantics");
  });
});
it("compiled reader accepts one selected family and keeps event time unchanged", async () => {
  await fixture(async (home, directory) => {
    const originalAt = "2026-01-01T00:00:00.000Z";
    await writeFile(join(directory, canonical), JSON.stringify({ at: originalAt, runId: "migration-fixture-run", kind: "turn", detail: { source: "codex" } }) + "\n");
    const result = await run(home, ["runs", "--json", "--now", at], {
      HARNESS_TELEMETRY_DIR: directory, HARNESS_TELEMETRY_LOG_NAME: canonical });
    assert.equal(result.code, 0);
    const document = JSON.parse(result.out);
    assert.equal(document.runs.length, 1);
    assert.equal(document.runs[0].updatedAt, originalAt);
  });
});
