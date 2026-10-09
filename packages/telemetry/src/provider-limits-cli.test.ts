import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerLimitsCommand } from "./provider-limits-cli.js";

test("provider-limits CLI emits the whole snapshot; unsafe files get a fixed diagnostic and no partial JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provider-limits-"));
  try {
    const path = join(dir, "source.json");
    const doc = { schemaVersion: 1, generatedAt: "2026-01-01T00:00:00.000Z", meters: [], outcomes: [{ provider: "opencode-go", keyName: null, accountRef: null, model: null, outcome: "refused", reason: "quota_exhausted", source: "provider-run", observedAt: "2025-12-31T00:00:00.000Z", resetsAt: null }] };
    await writeFile(path, JSON.stringify(doc), { mode: 0o600 });
    let out = "", err = ""; const io = { out: (s: string) => { out += s; }, err: (s: string) => { err += s; } };
    assert.equal(await providerLimitsCommand(["--source", path], io), 0); assert.deepEqual(JSON.parse(out), doc);
    await chmod(path, 0o644); out = "";
    assert.equal(await providerLimitsCommand(["--source", path], io), 3); assert.equal(out, ""); assert.equal(err, "provider limits unavailable\n");
    await chmod(path, 0o600);
    assert.equal(await providerLimitsCommand(["--source", path, "--watch"], io), 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
