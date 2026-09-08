import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readRepositoryRunObservation } from "@rickylabs/harness-contracts";
import { collectRepositoryRunObservation } from "./repository-run-observation.js";
import { runObservationMatrix } from "../test-fixtures/run-observation/matrix.mjs";
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const env = { PATH: process.env.PATH, GIT_DIR: "/synthetic-unrelated-git", GIT_WORK_TREE: "/synthetic-unrelated-worktree" };
const run = (args: string[]) => {
  const r = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(r.error, undefined);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
test("selected-source CLI and strict decoder synthetic coverage/race matrix", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "run-observation-test-"));
  try {
    const fixtures = await runObservationMatrix({ scratch, collect: collectRepositoryRunObservation, decode: readRepositoryRunObservation,
      cli: async path => run([cli, "run-observation", "--source", path]),
      raceCli: async (fixture, point, action) => {
        const harness = join(scratch, "race.mjs");
        await writeFile(harness, `import { main } from ${JSON.stringify(new URL('./cli.js', import.meta.url).href)};
import { mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process'; import { join } from 'node:path';
const git = path => execFileSync('git', ['init', '--quiet', path], {env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},stdio:'pipe'});
const f = ${JSON.stringify(fixture)}; const action = ${action}; let invoked = 0;
process.exitCode = await main(['run-observation','--source',f.descriptorPath], undefined, {checkpoint:async p => {if(p === ${JSON.stringify(point)}) {invoked++; await action(f);}}});
if(invoked !== 1) throw new Error('checkpoint not reached');`);
        return run([harness]);
      },
    });
    assert.ok(fixtures.includes("race-descriptor-revision"));
    assert.ok(fixtures.includes("source-unreadable-directory"));
    assert.equal(fixtures.length, 108);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
test("unrelated flags rejected before descriptor effects with fixed diagnostics", () => {
  for (const args of [
    ["run-observation"], ["run-observation", "--source", "relative"],
    ["run-observation", "--source", "/synthetic-missing", "--home", "synthetic-private-canary"],
    ["--home", "synthetic-private-canary", "run-observation", "--source", "/synthetic-missing"],
    ...["--json", "--help", "--now", "--items", "--source", "--limit", "--observations-from", "--run", "--kind", "--since"].map(flag => ["run-observation", "--source", "/synthetic-missing", flag]),
  ]) {
    const r = run([cli, ...args]); assert.equal(r.code, 2); assert.equal(r.stdout, ""); assert.equal(r.stderr, "run-observation: invalid command line\n");
  }
});
