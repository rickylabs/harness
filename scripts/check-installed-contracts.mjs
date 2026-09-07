#!/usr/bin/env node
/** Pack, install offline, compile a real consumer, and decode the actual one-shot CLI output.
 * Synthetic fixtures only. All paths, credentials, raw command output and children are temp-owned.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cli = join(root, "packages/telemetry/dist/cli.js");
const contracts = join(root, "packages/contracts");
const children = new Set();
let scratch;
let probePid;
let stage = "built prerequisites";
function terminate(child) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch { /* Already exited. */ }
}
function cleanup() {
  for (const child of children) terminate(child);
  if (probePid) { try { process.kill(probePid, "SIGKILL"); } catch { /* Reaped. */ } }
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { cleanup(); process.exit(1); });
async function run(bin, args, options = {}) {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(bin, args, { cwd: options.cwd ?? root, env: options.env ?? {},
      detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    children.add(child);
    let stdout = "", stderr = "", failure = false;
    const timer = setTimeout(() => { failure = true; terminate(child); }, 30_000);
    const append = (target, bytes) => {
      if (target.length + bytes.length > 8_388_608) { failure = true; terminate(child); return target; }
      return target + bytes.toString("utf8");
    };
    child.stdout.on("data", bytes => { stdout = append(stdout, bytes); });
    child.stderr.on("data", bytes => { stderr = append(stderr, bytes); });
    child.on("error", () => { failure = true; });
    child.on("close", code => {
      clearTimeout(timer); terminate(child); children.delete(child);
      if (failure) reject(new Error("owned command failed or exceeded bounds"));
      else resolveResult({ code, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}
try {
  for (const file of [cli, join(contracts, "dist/index.js"), join(contracts, "dist/index.d.ts"), join(contracts, "dist/server.js"), join(contracts, "dist/server.d.ts")]) {
    assert.ok(existsSync(file), "required dist output missing; run workspace build first");
  }
  scratch = mkdtempSync(join(tmpdir(), "governance-installed-"));
  const consumer = join(scratch, "consumer"), packDir = join(scratch, "pack"), cgroup = join(scratch, "cgroup");
  for (const dir of [consumer, packDir, cgroup, join(scratch, "home"), join(scratch, "checkout")]) mkdirSync(dir);
  // Explicit empty npm configuration: never consult operator auth/config files or remote metadata.
  const npmConfig = join(scratch, "empty-npmrc"); writeFileSync(npmConfig, "");
  const npmGlobal = join(scratch, "empty-global-npmrc"); writeFileSync(npmGlobal, "");
  const env = { PATH: process.env.PATH ?? dirname(process.execPath), HOME: join(scratch, "home"),
    npm_config_userconfig: npmConfig, npm_config_globalconfig: npmGlobal, npm_config_cache: join(scratch, "npm-cache"),
    npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_ignore_scripts: "true" };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  stage = "offline pack";
  const packed = await run(npm, ["pack", contracts, "--json", "--pack-destination", packDir, "--ignore-scripts"], { cwd: scratch, env });
  assert.equal(packed.code, 0);
  const metadata = JSON.parse(packed.stdout)[0];
  assert.equal(metadata.version, "0.2.0");
  const tarball = join(packDir, metadata.filename);
  const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  assert.ok(!metadata.files.some(f => /test|fixture|tsbuildinfo/.test(f.path)));
  for (const file of metadata.files.filter(f => f.path.endsWith(".js") || f.path.endsWith(".ts") || f.path.endsWith(".md") || f.path.endsWith(".json") || f.path.endsWith(".map"))) {
    const body = readFileSync(join(contracts, file.path), "utf8");
    assert.ok(!body.includes(root) && !body.includes(scratch), "public artifact contains an operational path");
  }
  stage = "offline install (no network fallback)";
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const installed = await run(npm, ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: consumer, env });
  assert.equal(installed.code, 0);
  const installedRoot = join(consumer, "node_modules/@rickylabs/harness-contracts");
  const pkg = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.2.0"); assert.equal(pkg.dsh.protocol, 1);
  assert.ok(existsSync(join(installedRoot, "dist/index.d.ts")) && existsSync(join(installedRoot, "dist/server.d.ts")));
  stage = "installed root/server runtime exports";
  writeFileSync(join(consumer, "runtime.mjs"), `import assert from 'node:assert/strict';
import { readGovernanceSnapshot, PROTOCOL_VERSION } from '@rickylabs/harness-contracts';
import { openHub } from '@rickylabs/harness-contracts/server';
assert.equal(typeof readGovernanceSnapshot, 'function'); assert.equal(PROTOCOL_VERSION, 1);
assert.equal(typeof openHub, 'function');
console.log(JSON.stringify({ root: true, server: true, protocol: PROTOCOL_VERSION }));\n`);
  const runtime = await run(process.execPath, [join(consumer, "runtime.mjs")], { cwd: consumer, env });
  assert.equal(runtime.code, 0); assert.deepEqual(JSON.parse(runtime.stdout), { root: true, server: true, protocol: 1 });
  stage = "installed root/server declaration compilation";
  writeFileSync(join(consumer, "consumer.ts"), `import { readGovernanceSnapshot, PROTOCOL_VERSION, type GovernanceReadSnapshot, type GovernanceReading } from '@rickylabs/harness-contracts';
import { openHub, type Hub, type Delivery } from '@rickylabs/harness-contracts/server';
const protocol: 1 = PROTOCOL_VERSION;
const read: GovernanceReading = readGovernanceSnapshot({});
function consume(snapshot: GovernanceReadSnapshot): boolean { return snapshot.complete; }
const server: typeof openHub = openHub;
function acceptHub(hub: Hub): readonly Delivery[] { void hub; return []; }
if (read.ok) consume(read.snapshot);
// @ts-expect-error installed root declaration must reject a non-snapshot
consume(42);
// @ts-expect-error installed server declaration must reject a non-Hub
acceptHub(42);
void protocol; void server; void acceptHub;\n`);
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    noEmit: true, skipLibCheck: false, types: [], lib: ["ES2023", "DOM"],
  }, files: ["consumer.ts"] }));
  const compiled = await run(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", join(consumer, "tsconfig.json")], { cwd: consumer, env });
  assert.equal(compiled.code, 0);
  stage = "synthetic fixture setup";
  assert.notEqual(process.platform, "win32", "sleeping executable fixture currently requires a POSIX shebang host");
  const pidFile = join(scratch, "probe.pid"), probe = join(scratch, "sleeping-probe");
  // One Node child, no shell, subprocess or grandchild. The CLI must kill and reap this process.
  writeFileSync(probe, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetTimeout(() => {}, 60_000);\n`);
  // A package boundary makes the extensionless executable ESM on supported Node versions.
  writeFileSync(join(scratch, "package.json"), '{"type":"module"}\n'); chmodSync(probe, 0o700);
  writeFileSync(join(scratch, "probe.ts"), "// synthetic unused probe argument\n");
  writeFileSync(join(cgroup, "memory.current"), "1024\n"); writeFileSync(join(cgroup, "memory.max"), "4096\n");
  const secret = `synthetic-${randomUUID()}`, privateDetail = `synthetic-private-${randomUUID()}`;
  const cliEnv = { HOME: env.HOME, PATH: env.PATH, SYNTHETIC_USAGE_KEY: secret,
    DSH_TELEMETRY_DIR: join(scratch, "log"), DSH_TELEMETRY_ARCHIVE: "none" };
  const descriptor = { accountLabel: "synthetic", usage: { denoBin: probe, probe: join(scratch, "probe.ts"), checkout: join(scratch, "checkout"),
    model: "synthetic/sleeping-model", credentialEnv: "SYNTHETIC_USAGE_KEY", timeoutMs: 500, maxBytes: 4096,
    windows: { rolling_five_hours: { label: "short", windowMinutes: 300 }, weekly: { label: "week", windowMinutes: 10080 }, monthly: { label: "month", windowMinutes: 43200 } } },
    spend: null, capacity: { cgroupRoot: cgroup, scopeLabel: "synthetic-cgroup", validForMs: 60_000 }, admissions: { fromObservabilityLog: true } };
  const sourceFile = join(scratch, "descriptor.json"); writeFileSync(sourceFile, JSON.stringify(descriptor));
  const observedAt = new Date().toISOString(), validUntil = new Date(Date.now() + 60_000).toISOString();
  const event = { runId: "synthetic-admission", kind: "governance.admission", at: observedAt, detail: {
    item: { number: 7 }, regime: "subscription", state: "throttle", observedAt, validUntil, provenance: "synthetic-input",
    outcome: { accepted: false, reason: "quota-paced", detail: privateDetail } } };
  stage = "recorded admission via actual CLI";
  const record = await run(process.execPath, [cli, "record", "--home", env.HOME], { env: cliEnv, input: JSON.stringify(event) + "\n" });
  assert.equal(record.code, 0); assert.ok(!record.stdout.includes(privateDetail));
  stage = "actual CLI mixed timeout";
  const produced = await run(process.execPath, [cli, "governance", "--home", env.HOME, "--observations-from", sourceFile], { env: cliEnv });
  stage = `mixed timeout exit (observed ${produced.code})`;
  assert.equal(produced.code, 3); assert.equal(produced.stderr, "");
  stage = "sleeping probe startup (requires executable TMPDIR)";
  assert.ok(existsSync(pidFile), "sleeping probe actually started");
  stage = "sleeping probe reaping";
  probePid = Number(readFileSync(pidFile, "utf8")); assert.ok(Number.isSafeInteger(probePid) && probePid > 0);
  assert.throws(() => process.kill(probePid, 0), { code: "ESRCH" }); probePid = undefined;
  const consumerRequire = createRequire(join(consumer, "runtime.mjs"));
  const decoder = await import(pathToFileURL(consumerRequire.resolve("@rickylabs/harness-contracts")).href);
  const decoded = decoder.readGovernanceSnapshot(JSON.parse(produced.stdout));
  stage = "installed decoder accepts mixed document";
  assert.equal(decoded.ok, true); const document = decoded.snapshot;
  stage = "mixed document coverage and original stamps";
  assert.equal(document.complete, false); assert.equal(document.availability, "fresh");
  assert.deepEqual(document.sources.usage, { status: "failed", reason: "timeout" });
  assert.deepEqual(document.sources.spend, { status: "not-configured" });
  assert.equal(document.sources.capacity.status, "read"); assert.equal(document.sources.capacity.provenance, "reader:cgroup-memory");
  assert.equal(document.sources.admissions.status, "read"); assert.equal(document.sources.admissions.records, 1);
  assert.equal(document.sources.admissions.empty, false); assert.deepEqual(document.sources.admissions.dropped, []);
  assert.equal(document.sources.admissions.provenance, "reader:recorded-admission");
  assert.equal(document.sources.admissions.collectedAt, document.observedAt);
  assert.deepEqual(document.sources.approvals, { status: "not-observed" });
  assert.equal(document.admissions[0].item, 7); assert.equal(document.admissions[0].accepted, false);
  assert.equal(document.admissions[0].reason, "quota-paced"); assert.equal(document.admissions[0].observedAt, observedAt);
  assert.equal(document.admissions[0].validUntil, validUntil);
  assert.equal(document.state.regimes[2].hosts[0].ramUsedBytes, 1024);
  assert.equal(document.state.regimes[2].hosts[0].ramTotalBytes, 4096);
  assert.equal(document.state.regimes[2].hosts[0].observedAt, document.sources.capacity.observedAt);
  for (const value of [secret, privateDetail, scratch, descriptor.usage.model, descriptor.usage.credentialEnv]) assert.ok(!produced.stdout.includes(value));
  stage = "actual CLI all unconfigured";
  writeFileSync(sourceFile, JSON.stringify({ ...descriptor, usage: null, capacity: null, admissions: null }));
  const absent = await run(process.execPath, [cli, "governance", "--home", env.HOME, "--observations-from", sourceFile], { env: cliEnv });
  assert.equal(absent.code, 3); assert.equal(absent.stderr, "");
  const unavailable = decoder.readGovernanceSnapshot(JSON.parse(absent.stdout));
  assert.equal(unavailable.ok, true); assert.equal(unavailable.snapshot.unavailableReason, "not-configured");
  console.log(JSON.stringify({ check: "installed-governance", status: "PASS", version: pkg.version, protocol: 1,
    tarball: metadata.filename, sha256: digest, exports: { rootRuntime: true, serverRuntime: true, rootTypesCompiled: true, serverTypesCompiled: true },
    install: "npm install --offline --ignore-scripts --no-audit --no-fund <tarball>",
    command: "node packages/telemetry/dist/cli.js governance --home <synthetic-home> --observations-from <synthetic-descriptor>",
    fixtures: ["mixed-timeout", "all-unconfigured"], timeout: { actualSleepingProbe: true, terminatedAndReaped: true, grandchildren: 0 },
    assertions: "version/protocol, root/server runtime and compiled declarations, source coverage, admission refusal and original stamps, memory readings, privacy, unavailable",
    limitations: ["synthetic only; no live acceptance or downstream compatibility claim", "sleeping executable fixture requires POSIX shebang support and executable TMPDIR", "candidate only; no publication"] }));
} catch {
  // Never reflect npm/compiler/probe output, paths, arbitrary errors or credential-bearing input.
  console.error(`check:installed failed at ${stage}`);
  process.exitCode = 1;
} finally { cleanup(); }
