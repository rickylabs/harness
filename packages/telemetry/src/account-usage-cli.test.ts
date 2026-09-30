import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readAccountUsageEnvelope } from "@rickylabs/harness-contracts";
import { usageFile } from "./account-usage.js";
const exec = promisify(execFile), cli = fileURLToPath(new URL("./cli.js", import.meta.url));
test("one-shot CLI emits a strict document, persists private state and resets changed source scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-cli-fixture-"));
  try {
    const store = join(root, "store"), keyFile = join(root, "fake-key"), stateFile = join(root, "state"), descriptor = join(root, "descriptor.json");
    await mkdir(store); await writeFile(keyFile, Buffer.alloc(32, 7), { mode: 0o600 });
    const source = { schemaVersion: 1, keyFile, stateFile, codex: null, stores: [
      { vendor: "codex", seat: "seat-a", cwdLabel: "project-a", root: store, accountIdentity: null },
    ] };
    await writeFile(descriptor, JSON.stringify(source));
    const invoke = async (): Promise<string> => {
      try { await exec(process.execPath, [cli, "account-usage", "--source", descriptor], { timeout: 5000 }); assert.fail("partial source must exit 3"); }
      catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        assert.equal(failure.code, 3); assert.equal(failure.stderr, ""); return failure.stdout!;
      }
    };
    const output = await invoke();
    assert.equal(readAccountUsageEnvelope(JSON.parse(output)).ok, true);
    assert.ok(!output.includes(root) && !output.includes("fake-key"));
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { sourceHash: string; snapshot: unknown };
    assert.equal(readAccountUsageEnvelope(saved.snapshot).ok, true);
    await writeFile(descriptor, JSON.stringify({ ...source, stores: [] }));
    const next = JSON.parse(await invoke());
    assert.equal(next.sessions.length, 0);
    const changed = JSON.parse(await readFile(stateFile, "utf8")) as { sourceHash: string };
    assert.notEqual(changed.sourceHash, saved.sourceHash);
    await writeFile(descriptor, '{"PRIVATE_CANARY":true}');
    await assert.rejects(exec(process.execPath, [cli, "account-usage", "--source", descriptor]), error => {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return failure.code === 1 && failure.stdout === "" && failure.stderr === "account-usage: descriptor, key, state or collection unavailable\n";
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("private file reads enforce key mode, regular files, symlink refusal and byte bounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-file-fixture-"));
  try {
    const keyFile = join(root, "fake-key"), alias = join(root, "alias");
    await writeFile(keyFile, Buffer.alloc(32, 7), { mode: 0o600 });
    assert.equal((await usageFile(keyFile, 32, true)).length, 32);
    await assert.rejects(usageFile(keyFile, 31, true));
    await assert.rejects(usageFile(root, 32));
    await symlink(keyFile, alias); await assert.rejects(usageFile(alias, 32, true));
    await chmod(keyFile, 0o644); await assert.rejects(usageFile(keyFile, 32, true));
  } finally { await rm(root, { recursive: true, force: true }); }
});
