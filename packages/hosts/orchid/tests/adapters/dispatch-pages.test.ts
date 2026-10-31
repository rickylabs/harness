/** Paging is additive: the default pinned reader still refuses incomplete receipt coverage. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { readOrchidDispatches } from "../../mod.js";

it("pages beyond the legacy lexical receipt cap without losing the oldest receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "orchid-pages-"));
  try {
    for (let n = 1; n <= 1_001; n++) {
      const key = n.toString(16).padStart(64, "0"), record = join(root, key, "record");
      await mkdir(record, { recursive: true, mode: 0o700 });
      await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: "orchid-" + key,
        issue: { repo: "example/project", number: n }, parentRunId: null, source: "codex",
        provider: "fixture", model: "fixture-model", effort: "high", state: "dispatched",
        observedAt: n === 1_001 ? "2026-10-01T12:00:00.000Z" : "2026-10-05T12:00:00.000Z",
        location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
    }
    const legacy = await readOrchidDispatches(root);
    assert.equal(legacy.dispatches.length, 1_000);
    assert.equal(legacy.degraded, true);
    assert.equal(legacy.nextCursor, undefined);
    const first = await readOrchidDispatches(root, {});
    assert.equal(first.degraded, false);
    assert.ok(first.nextCursor);
    const second = await readOrchidDispatches(root, { after: first.nextCursor });
    assert.equal(second.degraded, false);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(second.dispatches.map(row => row.issue?.number), [1_001]);
    assert.equal(new Set([...first.dispatches, ...second.dispatches].map(row => row.runId)).size, 1_001);
  } finally { await rm(root, { recursive: true, force: true }); }
});
