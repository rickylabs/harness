import assert from "node:assert/strict";
import { it } from "node:test";
import { mapSpend } from "./spend.js";
import { SPEND_URL, type SpendSource } from "../source.js";
const config: SpendSource = { url: SPEND_URL, credentialEnv: "FIXTURE_API_KEY", window: "total", validForMs: 1000, timeoutMs: 100, maxBytes: 4096 };
const now = "2026-09-07T12:00:00Z";
it("spend maps only the selected field, with fixed provider/label, null ceiling, no BYOK sums or metadata", () => {
  for (const [window, expected] of [["total", 1], ["daily", 2], ["weekly", 3], ["monthly", 4]] as const) {
    const result = mapSpend({ data: { usage: 1, usage_daily: 2, usage_weekly: 3, usage_monthly: 4, byok_usage: 700, limit: 900, label: "privacy-canary" } }, { ...config, window }, now);
    assert.ok(result.ok);
    assert.equal(result.value.regime, "metered");
    if (result.value.regime !== "metered") continue;
    assert.deepEqual(result.value.providers[0], { provider: "openrouter", spentUsd: expected, ceilingUsd: null, windowLabel: window, observedAt: now });
    assert.doesNotMatch(JSON.stringify(result), /privacy-canary|700|900/);
  }
});
it("absent daily/weekly and malformed spend fail unread, never zero", () => {
  for (const usage of [undefined, -1, NaN, Infinity, "1", null]) assert.equal(mapSpend({ data: { usage } }, config, now).ok, false);
  for (const window of ["daily", "weekly"] as const) assert.equal(mapSpend({ data: { usage: 1, usage_monthly: 2 } }, { ...config, window }, now).ok, false);
  assert.equal(mapSpend({ data: { usage: 0 } }, config, now).ok, true);
});
