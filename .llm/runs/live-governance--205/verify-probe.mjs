/** Offline executable receipt: needs Deno, no network, real credentials or source checkout. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const temp = await mkdtemp(join(tmpdir(), "harness-probe-fixture-"));
try {
  const usage = join(temp, "usage.ts");
  const validity = join(temp, "validity.ts");
  const probe = join(root, "packages/telemetry/adapters/opencode-usage-probe.ts");
  const imports = { "harness:usage": pathToFileURL(usage).href,
    "harness:usage-validity": pathToFileURL(validity).href };
  async function check({ age = 60000, status = "ok", resetsAt = "2026-09-07T12:00:00Z",
    extra = false, accepted = true } = {}) {
    const percentageWindows = Object.fromEntries(["rolling_five_hours", "weekly", "monthly"].map(id =>
      [id, { percent: 10, status, resetsAt, ...(extra ? { private: "private-extra-canary" } : {}) }]));
    const sample = { provider: "opencode_go", capturedAt: "2026-09-07T11:00:00Z", percentageWindows };
    await writeFile(usage, `export async function fetchOpenCodeGoUsageSnapshot(_model, deps) {
      let denied = false;
      try { await deps.readTextFile("synthetic-no-read"); } catch { denied = true; }
      if (!denied) throw new Error("injected read unexpectedly permitted");
      denied = false;
      try { await Deno.readTextFile("synthetic-no-read"); } catch (e) {
        denied = e instanceof Deno.errors.NotCapable;
      }
      if (!denied) throw new Error("runtime read unexpectedly permitted");
      return ${JSON.stringify(sample)};
    }`);
    await writeFile(validity, `export const EXPENSE_SNAPSHOT_MAX_AGE_MS = ${age};`);
    const result = spawnSync("deno", ["run", "--no-config", "--no-lock", "--no-prompt",
      "--no-remote", "--no-code-cache",
      `--import-map=data:application/json,${encodeURIComponent(JSON.stringify({ imports }))}`,
      "--allow-env=HARNESS_FIXTURE_API_KEY", probe, "fixture/model", "HARNESS_FIXTURE_API_KEY",
      "65536", "1000"], { encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH ?? "", HARNESS_FIXTURE_API_KEY: "synthetic-credential-canary",
        DENO_DIR: "/dev/null", DENO_NO_UPDATE_CHECK: "1" } });
    assert.equal(result.status, accepted ? 0 : 3, "probe exit differs; raw output withheld");
    assert.doesNotMatch(result.stdout + result.stderr, /canary/);
    if (accepted) {
      const value = JSON.parse(result.stdout);
      assert.equal(value.validForMs, age);
      assert.equal(Object.keys(value.percentageWindows).length, 3);
      assert.deepEqual(Object.keys(value.percentageWindows.weekly).sort(), ["percent", "resetsAt", "status"]);
    } else assert.equal(result.stdout, "");
  }
  await check();
  await check({ age: 900000, status: "rate-limited" });
  await check({ status: "private-status-canary", accepted: false });
  await check({ resetsAt: "private-reset-canary", accepted: false });
  await check({ extra: true });
  console.log("Offline probe checks passed: dynamic validity, denied reads, supported statuses, private-field rejection and omission.");
} finally { await rm(temp, { recursive: true, force: true }); }
