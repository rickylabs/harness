/** Synthetic native identity and private store only; no live native launch. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { readOrchidDispatches, resolveOrchidNativeRoot } from "@rickylabs/host-orchid";
import type { RunRecord } from "./model.js";

it("AGY exact native binding resolves without exposing the private store or session", async () => {
  const root = await mkdtemp(join(tmpdir(), "agy-bound-"));
  const digest = (v: string) => createHash("sha256").update(v).digest("hex");
  const binding = { IssueID: "fixture-issue", Repo: "example/target", BriefDigest: "b".repeat(64),
    Route: { transport: "agy", provider: "fixture-provider", model: "fixture-model", effort: "high" },
    NativeSessionID: "00000000-0000-4000-8000-000000000001" };
  const key = digest(binding.IssueID + "\0" + binding.Repo + "\0" + binding.BriefDigest);
  const record = join(root, key, "record");
  const privateBinding = { ...binding, NativeStore: { source: "agy", directory: join(root, "PRIVATE-STORE-CANARY", ".divybot-native", key, "agy") } };
  const at = "2026-01-01T00:00:00.000Z";
  try {
    await mkdir(record, { recursive: true, mode: 0o700 });
    await writeFile(join(record, "binding.json"), JSON.stringify(privateBinding), { mode: 0o600 });
    await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: "orchid-" + key,
      issue: { repo: "example/inbox", number: 42 }, parentRunId: null, source: "agy", provider: "fixture-provider",
      model: "fixture-model", effort: "high", state: "dispatched", observedAt: at,
      location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
    const native: RunRecord = { id: binding.NativeSessionID, source: "agy" as RunRecord["source"], parentId: null,
      startedAt: at, updatedAt: at, branch: null, identity: { provider: null, model: null, effort: null, profile: null },
      usage: {}, outcome: "unknown", origin: "PRIVATE-ORIGIN-CANARY", linkedIssues: [], quota: [] };
    const result = await readOrchidDispatches(root);
    assert.equal(result.degraded, false);
    assert.equal(result.dispatches[0]?.source, "agy");
    assert.equal(resolveOrchidNativeRoot(result.dispatches[0]!, [native]), native);
    assert.equal(resolveOrchidNativeRoot(result.dispatches[0]!, [{ ...native, source: "codex" }]), null);
    assert.equal(resolveOrchidNativeRoot(result.dispatches[0]!, [{ ...native, parentId: "foreign" }]), null);
    assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
    assert.ok(!JSON.stringify(result).includes(binding.NativeSessionID));
    for (const invalid of [
      { ...privateBinding, NativeStore: { ...privateBinding.NativeStore, source: "claude" } },
      { ...privateBinding, NativeStore: { ...privateBinding.NativeStore, directory: join(root, ".divybot-native", "a".repeat(64), "agy") } },
      { ...privateBinding, NativeStore: { ...privateBinding.NativeStore, directory: privateBinding.NativeStore.directory + "/../agy" } },
      { ...privateBinding, NativeStore: null },
      { ...privateBinding, NativeSessionID: "foreign-id" },
      { ...privateBinding, Route: { ...privateBinding.Route, model: "different-model" } },
      { ...privateBinding, BriefDigest: "c".repeat(64) },
    ]) {
      await writeFile(join(record, "binding.json"), JSON.stringify(invalid), { mode: 0o600 });
      const next = await readOrchidDispatches(root);
      assert.equal(next.degraded, false);
      assert.equal(resolveOrchidNativeRoot(next.dispatches[0]!, [native]), null);
      assert.ok(!JSON.stringify(next).includes("PRIVATE-"));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
