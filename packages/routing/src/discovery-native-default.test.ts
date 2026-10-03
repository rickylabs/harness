import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { discoverCliCapabilities, validateCliDiscoverySnapshot } from "./discovery.js";

/** Captured native metadata only; no provider requests, accounts or native turns. */
async function fixture(run: (cwd: string, binary: string, data: any) => Promise<void>, behavior = "normal") {
  const cwd = await mkdtemp(join(tmpdir(), "native-default-"));
  try {
    const data = JSON.parse(await readFile(new URL("../src/fixtures/opencode-native-default.json", import.meta.url), "utf8"));
    await writeFile(join(cwd, "data.json"), JSON.stringify({ ...data, behavior }), { mode: 0o600 });
    const binary = fileURLToPath(new URL("../src/fixtures/opencode-native-default-cli.mjs", import.meta.url));
    await run(cwd, binary, data);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
async function observe(cwd: string, binary: string) {
  return await discoverCliCapabilities({ cwd, only: ["opencode"], binaries: { opencode: binary }, timeoutMs: 3000 });
}

test("native default: real empty variant maps establish default only; named ROCm efforts remain exact", async () => fixture(async (cwd, binary, data) => {
  const s = await observe(cwd, binary), o = s.launchers.opencode;
  assert.equal(o.catalog, "observed");
  assert.deepEqual(o.problems, []);
  assert.ok(validateCliDiscoverySnapshot(s));
  assert.equal(o.models.length, data.models.length);
  for (let i = 0; i < 3; i++) {
    const m = o.models[i]!;
    assert.equal(m.id, data.models[i].providerID + "/" + data.models[i].id);
    assert.equal(m.provider?.id, data.models[i].providerID);
    assert.deepEqual(m.variants, []);
    assert.deepEqual(m.efforts, [], "native complete empty map must expose provider default, never unknown or invented high");
    assert.equal(m.effortSource, "opencode.models.variants");
  }
  assert.deepEqual(o.models[3]!.efforts, ["low", "medium", "high"]);
  const log = (await readFile(join(cwd, "commands.jsonl"), "utf8")).trim().split("\n").map(v => JSON.parse(v));
  assert.deepEqual(log.filter(v => v.args).map(v => v.args[0]), ["--version", "models", "serve"]);
  assert.deepEqual(log.filter(v => v.endpoint).map(v => v.endpoint), ["/provider"]);
  const server = log.find(v => v.args?.[0] === "serve");
  assert.throws(() => process.kill(server.pid, 0), { code: "ESRCH" });
}));

for (const behavior of ["unverified", "missing", "header-only", "opaque", "disabled"]) {
  test("native default: " + behavior + " does not assert default-only support", async () => fixture(async (cwd, binary) => {
    const s = await observe(cwd, binary), o = s.launchers.opencode;
    assert.equal(o.catalog, "observed");
    for (const m of o.models.slice(0, 3)) {
      assert.equal(m.efforts, null);
      assert.equal(m.effortSource, null);
    }
    assert.ok(validateCliDiscoverySnapshot(s));
  }, behavior));
}

for (const behavior of ["null", "array", "duplicate", "id-mismatch", "provider-mismatch"]) {
  test("native default: malformed " + behavior + " cannot certify a model", async () => fixture(async (cwd, binary) => {
    const s = await observe(cwd, binary);
    assert.equal(s.launchers.opencode.catalog, "unknown");
    assert.deepEqual(s.launchers.opencode.models, []);
    assert.ok(s.launchers.opencode.problems.includes("malformed"));
    assert.ok(validateCliDiscoverySnapshot(s));
  }, behavior));
}

test("native default: failed provider connection proof remains a refusal", async () => fixture(async (cwd, binary) => {
  const s = await observe(cwd, binary), o = s.launchers.opencode;
  assert.deepEqual(o.models[0]!.efforts, []);
  assert.equal(o.providerConnections, undefined);
  assert.ok(o.problems.includes("command-failed"));
  assert.equal(o.authenticated, "unknown");
  assert.ok(validateCliDiscoverySnapshot(s));
}, "auth-failed"));

test("native default: paired validator rejects default claims without the exact contract evidence", async () => fixture(async (cwd, binary, data) => {
  const s = await observe(cwd, binary);
  // Also certifies the reader independently of which producer implementation is imported.
  for (const m of s.launchers.opencode.models.slice(0, 3)) {
    Object.assign(m, { efforts: [], variants: [], effortSource: "opencode.models.variants" });
  }
  if (!s.launchers.opencode.sources.includes("opencode.models.variants")) {
    Object.assign(s.launchers.opencode, { sources: [...s.launchers.opencode.sources, "opencode.models.variants"] });
  }
  assert.ok(validateCliDiscoverySnapshot(s));
  const other = structuredClone(s);
  Object.assign(other.launchers, { claude: data.otherLauncher });
  assert.ok(validateCliDiscoverySnapshot(other), "another launcher's proven empty efforts need its own contract");
  const mutations: [string, (value: any) => void][] = [
    ["unknown serializer", v => { v.launchers.opencode.version = data.unverifiedVersion; }],
    ["missing version", v => { v.launchers.opencode.version = null; }],
    ["named variant in default claim", v => { v.launchers.opencode.models[0].variants = ["low"]; }],
    ["missing variant proof", v => { delete v.launchers.opencode.models[0].variants; }],
    ["missing source", v => { v.launchers.opencode.models[0].effortSource = null; }],
    ["absent source property", v => { delete v.launchers.opencode.models[0].effortSource; }],
    ["missing observation source", v => { v.launchers.opencode.sources = v.launchers.opencode.sources.filter((x: string) => x !== "opencode.models.variants"); }],
  ];
  for (const [name, mutate] of mutations) {
    const v = structuredClone(s); mutate(v);
    assert.equal(validateCliDiscoverySnapshot(v), false, name);
  }
}));
