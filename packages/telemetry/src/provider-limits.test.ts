import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProviderLimitsFile } from "./provider-limits.js";
import { providerLimitsCommand } from "./provider-limits-cli.js";
test("private snapshot file and CLI preserve history; unsafe files never expose path or environment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provider-limits-"));
  try {
    const path = join(dir, "source.json"), alias = join(dir, "alias.json");
    const doc = { schemaVersion: 1, generatedAt: "2026-01-01T00:00:00.000Z", meters: [], outcomes: [{ provider: "opencode-go", keyName: null, accountRef: null, model: null, outcome: "refused", reason: "quota_exhausted", source: "provider-run", observedAt: "2025-12-31T00:00:00.000Z", resetsAt: null }] };
    await writeFile(path, JSON.stringify(doc), { mode: 0o600 });
    assert.deepEqual(await readProviderLimitsFile(path), doc);
    let out = "", err = ""; const io = { out: (s: string) => { out += s; }, err: (s: string) => { err += s; } };
    assert.equal(await providerLimitsCommand(["--source", path], io), 0); assert.deepEqual(JSON.parse(out), doc);
    await chmod(path, 0o644); out = "";
    assert.equal(await providerLimitsCommand(["--source", path], io), 3); assert.equal(out, ""); assert.equal(err, "provider limits unavailable\n");
    await chmod(path, 0o600); await symlink(path, alias);
    await assert.rejects(readProviderLimitsFile(alias), {message:"provider limits unavailable"});
    await assert.rejects(readProviderLimitsFile(join(dir, "missing-private-path.json")), {message:"provider limits unavailable"});
    assert.equal(await providerLimitsCommand(["--source", path, "--watch"], io), 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
