#!/usr/bin/env node
/**
 * The run-observation half of `scripts/check-installed-contracts.mjs`, run on its own.
 *
 * That gate cannot complete on this host: it fails at `sleeping probe startup (requires executable
 * TMPDIR)` in its *governance* half, on the unmodified `origin/main` baseline as well as on this
 * branch (`worklog.md` D1). The half this run actually changes — pack the real tarball, install it
 * offline, and drive the whole synthetic matrix through the *installed* decoder rather than the
 * tree's — is reachable without the sleeping executable, so it is run here instead of being
 * declared blocked.
 *
 * Requires `pnpm -r run build` first. Writes nothing outside its own temp directory.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { runObservationMatrix } from "../../../packages/telemetry/test-fixtures/run-observation/matrix.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const contracts = join(root, "packages/contracts");
const cli = join(root, "packages/telemetry/dist/cli.js");
assert.ok(existsSync(join(contracts, "dist/index.js")) && existsSync(cli), "run `pnpm -r run build` first");

const scratch = mkdtempSync(join(tmpdir(), "installed-decoder-"));
try {
  const consumer = join(scratch, "consumer"), packDir = join(scratch, "pack");
  for (const dir of [consumer, packDir, join(scratch, "home")]) mkdirSync(dir);
  const npmrc = join(scratch, "npmrc"); writeFileSync(npmrc, "");
  const globalNpmrc = join(scratch, "npmrc-global"); writeFileSync(globalNpmrc, "");
  const env = { PATH: process.env.PATH, HOME: join(scratch, "home"),
    npm_config_userconfig: npmrc, npm_config_globalconfig: globalNpmrc, npm_config_cache: join(scratch, "npm-cache"),
    npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_ignore_scripts: "true" };
  const npm = (args, cwd) => execFileSync("npm", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const source = JSON.parse(readFileSync(join(contracts, "package.json"), "utf8"));
  const packed = JSON.parse(npm(["pack", contracts, "--json", "--pack-destination", packDir, "--ignore-scripts"], scratch))[0];
  assert.equal(packed.version, source.version);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", join(packDir, packed.filename)], consumer);
  const installedRoot = join(consumer, "node_modules/@rickylabs/harness-contracts");
  const installed = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  assert.equal(installed.version, source.version);
  assert.equal(installed.dsh.protocol, 1);
  console.log(`installed @rickylabs/harness-contracts@${installed.version}, dsh.protocol ${installed.dsh.protocol}, ${packed.files.length} files`);

  const decoder = await import(pathToFileURL(createRequire(join(consumer, "package.json")).resolve("@rickylabs/harness-contracts")).href);
  assert.equal(decoder.REPOSITORY_RUN_OBSERVATION_SCHEMA, 2, "the installed package must write schema 2");
  assert.deepEqual([...decoder.REPOSITORY_RUN_OBSERVATION_READ_SCHEMAS], [1, 2], "the installed package must read both schemas");

  // A real consumer's declarations must compile against the installed `.d.ts`, including the new
  // exported vocabulary and an exhaustive narrowing over the widened source.
  writeFileSync(join(consumer, "consumer.ts"), `import { readRepositoryRunObservation, OBSERVED_RUN_SOURCES, RUN_VERIFICATION_BASES,
  type ObservedRunSource, type RunVerificationBasis, type RunExecutionReportedStatus,
  type RepositoryRunObservationSchema, type RepositoryRunObservation } from '@rickylabs/harness-contracts';
const badge = (source: ObservedRunSource): string => { switch (source) { case 'codex': return 'Codex'; case 'uhp': return 'UHP'; } };
const local = (basis: RunVerificationBasis): boolean => basis === 'enrollment-and-local-worktree';
const inFlight = (status: RunExecutionReportedStatus): boolean => status === 'source-reported-running';
const schemas: readonly RepositoryRunObservationSchema[] = [1, 2];
function render(o: RepositoryRunObservation): string {
  if (o.run === null || o.verification === null) return 'degraded';
  return [badge(o.run.source), String(local(o.verification.basis)), String(o.run.execution.status !== 'unknown' && inFlight(o.run.execution.status)), String(o.schema)].join(' ');
}
const reading = readRepositoryRunObservation({});
if (reading.ok) render(reading.observation);
// @ts-expect-error the billing seam is not an observed source
const wrongSource: ObservedRunSource = 'claude';
// @ts-expect-error a schema this package does not read is not a schema
const wrongSchema: RepositoryRunObservationSchema = 3;
// @ts-expect-error the rejected alternative basis name is not a basis
const wrongBasis: RunVerificationBasis = 'enrollment-and-hosted-session';
void schemas; void wrongSource; void wrongSchema; void wrongBasis; void OBSERVED_RUN_SOURCES; void RUN_VERIFICATION_BASES;
`);
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    noEmit: true, skipLibCheck: false, types: [], lib: ["ES2023"],
  }, files: ["consumer.ts"] }));
  const compiled = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", join(consumer, "tsconfig.json")],
    { cwd: consumer, env, encoding: "utf8" });
  assert.equal(compiled.status, 0, `installed declarations must compile a real consumer:\n${compiled.stdout}`);
  console.log("installed declarations compile an exhaustive consumer, and refuse three wrong literals");

  // The whole synthetic matrix, produced by the actual CLI and decoded by the *installed* package.
  const { collectRepositoryRunObservation } = await import(pathToFileURL(join(root, "packages/telemetry/dist/repository-run-observation.js")).href);
  const fixtures = await runObservationMatrix({
    scratch: join(scratch, "matrix"),
    collect: collectRepositoryRunObservation,
    decode: decoder.readRepositoryRunObservation,
    cli: async descriptorPath => {
      const r = spawnSync(process.execPath, [cli, "run-observation", "--source", descriptorPath],
        { env: { PATH: env.PATH, GIT_DIR: "/synthetic-unrelated-git", GIT_WORK_TREE: "/synthetic-unrelated-worktree" }, encoding: "utf8", timeout: 30_000 });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    },
  });
  assert.equal(fixtures.length, 108, "every declared synthetic fixture must run");
  console.log(`installed decoder accepted the actual CLI's output across ${fixtures.length} synthetic fixtures`);
  console.log("\nPASS — the packed, offline-installed 0.5.0 candidate writes schema 2, reads 1 and 2, and fences schema 3.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
