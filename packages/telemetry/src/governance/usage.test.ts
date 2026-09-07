import assert from "node:assert/strict";
import { it } from "node:test";
import { mapUsage } from "./usage.js";
import type { UsageSource } from "../source.js";
const config: UsageSource = { denoBin: "/fixture/deno", probe: "/fixture/probe", checkout: "/fixture/checkout", model: "fixture/model", credentialEnv: "FIXTURE_API_KEY", timeoutMs: 100, maxBytes: 4096,
  windows: { rolling_five_hours: { label: "short", windowMinutes: 1 }, weekly: { label: "week", windowMinutes: 2 }, monthly: { label: "month", windowMinutes: 3 } } };
const window = { percent: 73, status: "allowed", resetsAt: "2026-09-07T12:30:00Z" };
const payload = () => ({ provider: "opencode_go", capturedAt: "2026-09-07T12:00:00Z", validForMs: 900_000,
  percentageWindows: { rolling_five_hours: { ...window, percent: 5 }, weekly: window, monthly: window }, private: "privacy-canary" });
it("usage retains source timestamp and bound, configured durations, and never infers binding or state", () => {
  const result = mapUsage(payload(), config, "synthetic");
  assert.ok(result.ok);
  assert.equal(result.observedAt, payload().capturedAt);
  assert.equal(result.validUntil, "2026-09-07T12:15:00.000Z");
  assert.equal(result.value.regime, "subscription");
  if (result.value.regime !== "subscription") return;
  assert.equal(result.value.state, "allow");
  assert.deepEqual(result.value.accounts[0]?.windows.map(w => w.binding), [false, false, false]);
  assert.deepEqual(result.value.accounts[0]?.windows.map(w => w.windowMinutes), [1, 2, 3]);
  assert.match(result.value.note!, /binding unobserved/);
  assert.doesNotMatch(JSON.stringify(result), /privacy-canary/);
  const changed = mapUsage({ ...payload(), validForMs: 60_000 }, config, "synthetic");
  assert.ok(changed.ok);
  assert.equal(changed.validUntil, "2026-09-07T12:01:00.000Z");
});
it("usage rejects missing windows, invalid statuses, percentages, bounds and dates", () => {
  const values: unknown[] = [{ ...payload(), percentageWindows: {} }, { ...payload(), capturedAt: "bad" }, { ...payload(), validForMs: Number.MAX_VALUE }, { ...payload(), provider: "other" }];
  for (const bad of [NaN, Infinity, -1, 101, "10"]) values.push({ ...payload(), percentageWindows: { ...payload().percentageWindows, weekly: { ...window, percent: bad } } });
  for (const status of [null, "", 1, "\n"]) values.push({ ...payload(), percentageWindows: { ...payload().percentageWindows, weekly: { ...window, status } } });
  for (const value of values) assert.deepEqual(mapUsage(value, config, "synthetic"), { ok: false, code: "shape-mismatch" });
});
