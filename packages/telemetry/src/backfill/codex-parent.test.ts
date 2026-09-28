/** Synthetic thread identities; no captured sessions. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { parseCodexRollout } from "./codex.js";
const parse = (payload: Record<string, unknown>) => parseCodexRollout(JSON.stringify({
  timestamp: "2026-01-01T00:00:00.000Z", type: "session_meta", payload,
}), "synthetic");
const base = { id: "fixture-child", session_id: "fixture-root" };
it("keeps child identity distinct from the shared tree session and reads its parent", () => {
  const { run } = parse({ ...base, parent_thread_id: "fixture-parent" });
  assert.equal(run?.id, "fixture-child");
  assert.equal(run?.parentId, "fixture-parent");
});
it("reads the older thread_spawn parent and preserves legacy session-only identity", () => {
  const child = parse({ ...base, source: { subagent: { thread_spawn: {
    parent_thread_id: "fixture-parent", depth: 1,
  } } } }).run;
  assert.equal(child?.parentId, "fixture-parent");
  assert.equal(child?.nativeDepth, 1);
  assert.equal(parse({ session_id: "fixture-legacy" }).run?.id, "fixture-legacy");
});
it("keeps depth absent without a valid native spawn measurement bound to the accepted parent", () => {
  const spawn = (depth: unknown, parent_thread_id: unknown = "fixture-parent") =>
    parse({ ...base, source: { subagent: { thread_spawn: { parent_thread_id, depth } } } }).run;
  for (const depth of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.equal(spawn(depth)?.nativeDepth, undefined);
  }
  assert.equal(spawn(1, null)?.nativeDepth, undefined);
  assert.equal(parse({ ...base, parent_thread_id: "fixture-other", source: { subagent: {
    thread_spawn: { parent_thread_id: "fixture-parent", depth: 1 },
  } } }).run?.nativeDepth, undefined);
  assert.equal(parse({ ...base, parent_thread_id: "fixture-parent" }).run?.nativeDepth, undefined);
  assert.equal(parse({ ...base, source: { subagent: { thread_spawn: { depth: 1 } } } }).run?.nativeDepth, undefined);
});
it("never treats a fork as a parent or accepts malformed, conflicting or self parents", () => {
  assert.equal(parse({ ...base, forked_from_id: "fixture-fork" }).run?.parentId, null);
  for (const payload of [
    { ...base, parent_thread_id: "fixture-child" },
    { ...base, parent_thread_id: 123 },
    { ...base, parent_thread_id: "fixture-parent", source: { subagent: { thread_spawn: {
      parent_thread_id: "fixture-other", depth: 1,
    } } } },
  ]) {
    const result = parse(payload);
    assert.equal(result.run?.parentId, null);
    assert.ok(result.notes.some(note => note.reason.includes("parent identity")));
    assert.ok(!JSON.stringify(result.notes).includes("fixture-"));
  }
});
