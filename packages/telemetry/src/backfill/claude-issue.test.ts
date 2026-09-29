import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanClaudeIssue } from "./claude-issue.js";

const rootId = "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d";
const otherId = "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4e";
const at = "2026-01-01T00:00:00.000Z", later = "2026-01-01T00:00:01.000Z";
function transcript(sessionId: string, sidechain = false): string {
  const row = (value: unknown) => JSON.stringify(value) + "\n";
  return row({ type: "user", timestamp: at, sessionId, isSidechain: sidechain, uuid: "u1",
    message: { role: "user", content: "PRIVATE-PROMPT-CANARY" } }) +
    row({ type: "assistant", timestamp: later, sessionId, isSidechain: sidechain, uuid: "a1",
      message: { role: "assistant", model: "fixture-model", usage: { input_tokens: 5, output_tokens: 2 },
        content: [{ type: "text", text: "Review fixtures." }] } });
}

it("reads only the private-ID-selected Claude root and its child tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-issue-"));
  const project = join(root, "fixture-project"), other = join(root, "other-project");
  const child = join(project, rootId, "subagents", "agent-child.jsonl");
  try {
    await mkdir(join(project, rootId, "subagents"), { recursive: true });
    await mkdir(other);
    await writeFile(join(project, rootId + ".jsonl"), transcript(rootId));
    await writeFile(child, transcript(rootId, true));
    const unrelated = await open(join(other, otherId + ".jsonl"), "w");
    try { await unrelated.writeFile("PRIVATE-UNRELATED"); await unrelated.truncate(20 * 1_048_576); }
    finally { await unrelated.close(); }
    const scan = await scanClaudeIssue(root, id => id === rootId, 20, 8 * 1_048_576, 32 * 1_048_576);
    assert.equal(scan.reason, null);
    assert.deepEqual(scan.runs.map(run => [run.id, run.parentId]), [[rootId, null], ["agent-child", rootId]]);
    assert.equal(scan.runs[0]?.usage.inputTokens, 5);
    assert.equal(scan.runs[0]?.tokenSamples?.points.at(-1)?.usedTokens, 7);
    assert.ok((scan.runs[0]?.activitySteps?.length ?? 0) > 0);
    assert.ok(!JSON.stringify(scan.runs.map(run => ({ id: run.id, usage: run.usage, tokenSamples: run.tokenSamples })))
      .includes("PRIVATE-"));
    assert.deepEqual((await scanClaudeIssue(root, id => id === otherId, 20, 8 * 1_048_576,
      32 * 1_048_576)).reason, "scan_limit"); // The selected unrelated file is oversized.
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("keeps duplicate roots, forged child parents, symlinks and partial transcripts unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-issue-negative-"));
  const project = join(root, "fixture-project"), other = join(root, "other-project");
  const rootFile = join(project, rootId + ".jsonl");
  const child = join(project, rootId, "subagents", "agent-child.jsonl");
  const scan = () => scanClaudeIssue(root, id => id === rootId, 20, 8 * 1_048_576, 32 * 1_048_576);
  try {
    await mkdir(join(project, rootId, "subagents"), { recursive: true });
    await mkdir(other);
    await writeFile(rootFile, transcript(rootId));
    await writeFile(child, transcript(otherId, true));
    assert.equal((await scan()).reason, "source_unavailable");
    await writeFile(child, transcript(rootId, true));
    await writeFile(join(other, rootId + ".jsonl"), transcript(rootId));
    assert.equal((await scan()).reason, "source_unavailable");
    await rm(join(other, rootId + ".jsonl"));
    await writeFile(rootFile, transcript(rootId) + "{partial");
    assert.equal((await scan()).reason, "source_unavailable");
    await rm(rootFile);
    await symlink(join(other, otherId + ".jsonl"), rootFile);
    assert.equal((await scan()).reason, "source_unavailable");
  } finally { await rm(root, { recursive: true, force: true }); }
});
