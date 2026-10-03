import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverCliCapabilities, discoveredModels, validateCliDiscoverySnapshot } from "./discovery.js";

type Behavior = "normal" | "empty" | "duplicate" | "malformed" | "timeout" | "oversized" | "invalid-utf8" | "server-request" | "pipe-holder";
async function fixture(run: (directory: string, binary: (kind: string, behavior?: Behavior) => Promise<string>) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "cli-discovery-"));
  async function binary(kind: string, behavior: Behavior = "normal") {
    const file = join(directory, kind + "-" + behavior);
    const log = join(directory, "commands.jsonl");
    await writeFile(file, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const kind = ${JSON.stringify(kind)}, behavior = ${JSON.stringify(behavior)}, log = ${JSON.stringify(log)};
const args = process.argv.slice(2);
appendFileSync(log, JSON.stringify({args}) + '\\n');
if (args[0] === '--version') { console.log('fixture-cli 1.2.3'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({loggedIn: true, email: 'fixture-account@example.invalid', token: 'fixture-credential', configDirectory: '/fixture-private'})); process.exit(0); }
if (behavior === 'timeout') { setInterval(() => {}, 1000); }
else if (behavior === 'pipe-holder') { spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: ['ignore', 'inherit', 'inherit']}); process.exit(0); }
else if (behavior === 'oversized') { process.stdout.write('x'.repeat(8192)); }
else if (behavior === 'invalid-utf8') { process.stdout.write(Buffer.from([0xff])); }
else if (args[0] === 'models') {
  if (behavior === 'normal') console.log('fixture/alpha-v1\\nfixture/beta-v2@quant~latest');
  if (behavior === 'duplicate') console.log('fixture/alpha-v1\\nfixture/alpha-v1');
  if (behavior === 'malformed') console.log('invalid whitespace id');
}
else if (args[0] === 'app-server') {
  let buffered = '';
  process.stdin.on('data', chunk => {
    buffered += chunk.toString();
    while (buffered.includes('\\n')) {
      const at = buffered.indexOf('\\n'); const message = JSON.parse(buffered.slice(0, at)); buffered = buffered.slice(at + 1);
      appendFileSync(log, JSON.stringify({method: message.method, params: message.params}) + '\\n');
      if (!('id' in message)) continue;
      if (behavior === 'server-request' && message.method === 'model/list') { console.log(JSON.stringify({id: 999, method: 'turn/start', params: {}})); continue; }
      let result = {};
      if (message.method === 'account/read') result = {account: {type: 'chatgpt', email: 'fixture-account@example.invalid', accessToken: 'fixture-credential'}, requiresOpenaiAuth: true};
      if (message.method === 'model/list') {
        const model = message.params.cursor ? 'fixture-beta-v2' : 'fixture-alpha-v1';
        result = {data: behavior === 'empty' ? [] : [{id: model, model, supportedReasoningEfforts: [{reasoningEffort: 'medium'}, {reasoningEffort: 'high'}]}], nextCursor: message.params.cursor || behavior === 'empty' ? null : 'page-two'};
        if (behavior === 'duplicate') result = {data: [{model: 'same'}, {model: 'same'}], nextCursor: null};
        if (behavior === 'malformed') result = {data: [{model: 'invalid whitespace id'}], nextCursor: null};
      }
      console.log(JSON.stringify({id: message.id, result}));
    }
  });
}
`, { mode: 0o700 });
    return file;
  }
  try { await run(directory, binary); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("fresh inventories paginate, preserve exact IDs/efforts and never infer entitlement", async () => fixture(async (cwd, binary) => {
  const binaries = { claude: await binary("claude"), codex: await binary("codex"), opencode: await binary("opencode") };
  const snapshot = await discoverCliCapabilities({ cwd, binaries, only: ["claude", "codex", "opencode"], declaredAgyModels: ["declared/only-v1"] });
  assert.ok(validateCliDiscoverySnapshot(snapshot));
  assert.deepEqual(snapshot.launchers.codex.models.map(m => m.id), ["fixture-alpha-v1", "fixture-beta-v2"]);
  assert.deepEqual(snapshot.launchers.codex.models[0]!.efforts, ["medium", "high"]);
  assert.deepEqual(snapshot.launchers.opencode.models.map(m => m.id), ["fixture/alpha-v1", "fixture/beta-v2@quant~latest"]);
  assert.equal(snapshot.launchers.claude.authenticated, "yes");
  assert.equal(snapshot.launchers.claude.catalog, "unknown");
  for (const observation of Object.values(snapshot.launchers)) {
    assert.equal(observation.entitlement, "unknown"); assert.equal(observation.quota, "unknown");
  }
  assert.equal(discoveredModels(snapshot, "agy"), null);
  const json = JSON.stringify(snapshot);
  for (const unsafe of ["fixture-account", "fixture-credential", "/fixture-private", cwd]) assert.ok(!json.includes(unsafe));
  const commands = (await readFile(join(cwd, "commands.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(commands.filter(c => c.method).every(c => ["initialize", "initialized", "account/read", "config/read", "configRequirements/read", "model/list"].includes(c.method)));
  assert.equal(commands.find(c => c.method === "account/read").params.refreshToken, false);
  assert.ok(commands.filter(c => c.args).every(c => ["--version", "auth", "--print", "models", "serve", "app-server"].includes(c.args[0])));
}));

test("missing binaries stay absent without claiming authentication or availability", async () => fixture(async cwd => {
  const snapshot = await discoverCliCapabilities({ cwd, only: ["codex"], binaries: { codex: join(cwd, "missing") } });
  assert.equal(snapshot.launchers.codex.installed, "no");
  assert.equal(snapshot.launchers.codex.authenticated, "unknown");
  assert.equal(discoveredModels(snapshot, "codex"), null);
}));

for (const launcher of ["codex", "opencode"] as const) {
  for (const behavior of ["empty", "duplicate", "malformed", "timeout", "oversized", "invalid-utf8", "pipe-holder"] as const) {
    test(`${launcher}: ${behavior} cannot manufacture catalog evidence and closes boundedly`, async () => fixture(async (cwd, binary) => {
      const started = performance.now();
      const snapshot = await discoverCliCapabilities({ cwd, only: [launcher], binaries: { [launcher]: await binary(launcher, behavior) }, timeoutMs: 500, maximumBytes: 4096 });
      assert.equal(snapshot.launchers[launcher].installed, "yes");
      assert.equal(snapshot.launchers[launcher].catalog, "unknown");
      assert.equal(discoveredModels(snapshot, launcher), null);
      assert.ok(performance.now() - started < 3000);
      assert.ok(validateCliDiscoverySnapshot(snapshot));
    }));
  }
}

test("an unsolicited server request is refused without executing or answering it", async () => fixture(async (cwd, binary) => {
  const snapshot = await discoverCliCapabilities({ cwd, only: ["codex"], binaries: { codex: await binary("codex", "server-request") } });
  assert.equal(snapshot.launchers.codex.catalog, "unknown");
  assert.deepEqual(snapshot.launchers.codex.problems, ["malformed"]);
  const log = await readFile(join(cwd, "commands.jsonl"), "utf8");
  assert.ok(!log.includes('"method":"turn/start"'));
}));

test("stale, future, malformed and declared observations never become fresh catalog evidence", async () => fixture(async (cwd, binary) => {
  const now = new Date().toISOString();
  const snapshot = await discoverCliCapabilities({ cwd, only: ["opencode"], binaries: { opencode: await binary("opencode") }, now: () => now });
  assert.equal(discoveredModels(snapshot, "opencode", now)?.length, 2);
  assert.equal(discoveredModels(snapshot, "opencode", new Date(Date.parse(now) + 600001).toISOString()), null);
  assert.equal(discoveredModels(snapshot, "opencode", new Date(Date.parse(now) - 1).toISOString()), null);
  const broken = structuredClone(snapshot) as any;
  broken.launchers.opencode.models[0].token = "fixture-credential";
  assert.equal(validateCliDiscoverySnapshot(broken), false);
  assert.equal(discoveredModels(broken, "opencode", now), null);
  const declared = structuredClone(snapshot) as any;
  declared.launchers.opencode.catalog = "declared";
  assert.equal(discoveredModels(declared, "opencode", now), null);
}));
