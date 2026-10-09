/** OpenCode native token readings on the issue tree. Synthetic stores only. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { epoch, fixture, model, provider, rootID } from "../fixtures/opencode-issue-store.js";
import { scanOpenCodeIssue } from "./opencode-issue.js";

const nativeTokens = { total: 555, input: 100, output: 20, reasoning: 30, cache: { read: 400, write: 5 } };
it("OpenCode issue tree reads native assistant tokens as opencode-usage, summed across assistant headers", async () => {
  const f = await fixture({ tokens: nativeTokens });
  try {
    const scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
    assert.equal(scan.reason, null);
    assert.deepEqual(scan.runs[0]?.usage, { inputTokens: 100, outputTokens: 20, reasoningTokens: 30, cacheReadTokens: 400, cacheWriteTokens: 5 });
    let snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    let a = snapshot.issues[0]?.dispatches[0]?.agents[0]!;
    assert.deepEqual(a.tokenUsage, { usedTokens: 555, budgetTokens: null, observedAt: a.tokenUsage?.observedAt, source: "opencode-usage", reason: null });
    assert.ok(a.tokenUsage?.observedAt);
    assert.equal(a.resourceHistory?.tokens.source, "unavailable");
    assert.deepEqual(a.observation.cost.runTokens.measurement, scan.runs[0]?.usage);
    // A later turn's header adds its own reading; the total is the sum, not the last header.
    f.message("msg_fixture_later_user", { role: "user", time: { created: epoch + 4000 } }, rootID, epoch + 4000);
    f.message("msg_fixture_later_assistant", { role: "assistant", parentID: "msg_fixture_later_user", providerID: provider,
      modelID: model, finish: "stop", time: { created: epoch + 5000, completed: epoch + 7000 },
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 3, write: 0 } } }, rootID, epoch + 5000);
    f.part("prt_fixture_later_text", "msg_fixture_later_assistant", { type: "text", text: "The later work is complete.",
      time: { start: epoch + 5000, end: epoch + 6000 } });
    snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    a = snapshot.issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(a.tokenUsage?.usedTokens, 561); assert.equal(a.tokenUsage?.source, "opencode-usage");
  } finally { await f.close(); }
});
it("OpenCode without a whole native token reading is unavailable, never labelled claude-usage", async () => {
  const { cache: _cache, ...noCache } = nativeTokens;
  for (const tokens of [undefined, null, "555", [], {}, noCache, { ...nativeTokens, input: -1 }, { ...nativeTokens, output: 1.5 },
    { ...nativeTokens, reasoning: "30" }, { ...nativeTokens, cache: { read: 400 } }, { ...nativeTokens, cache: { ...nativeTokens.cache, extra: 1 } },
    { ...nativeTokens, extra: 1 }, { ...nativeTokens, total: -1 }, { ...nativeTokens, input: Number.MAX_SAFE_INTEGER + 1 }]) {
    const f = await fixture(tokens === undefined ? {} : { tokens });
    try {
      // A missing or malformed token reading never costs the run its timeline.
      const scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
      assert.equal(scan.reason, null, JSON.stringify(tokens)); assert.deepEqual(scan.runs[0]?.usage, {}, JSON.stringify(tokens));
      const snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
      const a = snapshot.issues[0]?.dispatches[0]?.agents[0]!;
      assert.equal(a.terminalOutcome.value, "succeeded");
      assert.deepEqual(a.tokenUsage, { usedTokens: null, budgetTokens: null, observedAt: null, source: "unavailable",
        reason: "measurement_missing" }, JSON.stringify(tokens));
      assert.ok(!JSON.stringify(snapshot).includes("claude-usage"));
    } finally { await f.close(); }
  }
  // One header with a reading and a later one without is not a total.
  const f = await fixture({ tokens: nativeTokens });
  try {
    f.message("msg_fixture_later_user", { role: "user", time: { created: epoch + 4000 } }, rootID, epoch + 4000);
    f.message("msg_fixture_later_assistant", { role: "assistant", parentID: "msg_fixture_later_user", providerID: provider,
      modelID: model, time: { created: epoch + 5000 } }, rootID, epoch + 5000);
    const a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(a.tokenUsage?.source, "unavailable"); assert.equal(a.tokenUsage?.usedTokens, null);
  } finally { await f.close(); }
});
