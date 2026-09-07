import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSource, SPEND_URL, SourceError, instant } from "./source.js";

const descriptor = () => ({
  accountLabel: "synthetic", admissions: { fromObservabilityLog: true },
  usage: { denoBin: "/fixture/deno", probe: "/fixture/probe.ts", checkout: "/fixture/upstream", model: "fixture/model",
    credentialEnv: "FIXTURE_API_KEY", timeoutMs: 100, maxBytes: 4096,
    windows: { rolling_five_hours: { label: "short", windowMinutes: 13 }, weekly: { label: "week", windowMinutes: 17 }, monthly: { label: "month", windowMinutes: 19 } } },
  spend: { url: SPEND_URL, credentialEnv: "FIXTURE_API_KEY", window: "total", validForMs: 1000, timeoutMs: 100, maxBytes: 4096 },
  capacity: { cgroupRoot: "/fixture/cgroup", scopeLabel: "configured-cgroup", validForMs: 1000 },
});
describe("live source descriptor", () => {
  it("accepts required explicit configuration and no compiled model or duration", () => {
    const parsed = parseSource(descriptor());
    assert.equal(parsed.usage?.model, "fixture/model");
    assert.equal(parsed.usage?.windows.monthly.windowMinutes, 19);
    assert.equal(parseSource({ accountLabel: "synthetic", usage: null, spend: null, capacity: null, admissions: null }).usage, null);
  });
  it("refuses missing fields, extra fields, bad paths/labels, env injection and bounds without echoes", () => {
    const cases: unknown[] = [null, {}, { ...descriptor(), secret: "privacy-canary" },
      { ...descriptor(), accountLabel: "private/path" }, { ...descriptor(), usage: undefined }];
    for (const [field, value] of [["denoBin", "deno"], ["probe", "/tmp/\ncanary"], ["model", "bad model"], ["credentialEnv", "NODE_OPTIONS"], ["credentialEnv", "KEY=secret"], ["timeoutMs", 0], ["timeoutMs", 60001], ["maxBytes", 4194305], ["maxBytes", 0], ["windows", {}]] as const) {
      cases.push({ ...descriptor(), usage: { ...descriptor().usage, [field]: value } });
    }
    for (const value of cases) assert.throws(() => parseSource(value), (e: unknown) => e instanceof SourceError && e.message === "invalid-descriptor");
  });
  it("permits only the exact current-key URL and the four fixed spend windows", () => {
    for (const url of ["http://openrouter.ai/api/v1/key", "https://evil.test/api/v1/key", SPEND_URL + "/", SPEND_URL + "?x=1", SPEND_URL + "#x", "https://user@openrouter.ai/api/v1/key"]) {
      assert.throws(() => parseSource({ ...descriptor(), spend: { ...descriptor().spend, url } }));
    }
    for (const window of ["total", "daily", "weekly", "monthly"]) assert.equal(parseSource({ ...descriptor(), spend: { ...descriptor().spend, window } }).spend?.window, window);
    for (const window of ["balance", "byok_usage", "toString"]) assert.throws(() => parseSource({ ...descriptor(), spend: { ...descriptor().spend, window } }));
  });
});

it("live timestamps reject calendar normalization, while legitimate leap days and offsets retain their instant", () => {
  for (const value of ["2026-02-30T12:00:00Z", "2026-02-29T12:00:00Z", "2026-09-07T24:00:00Z"]) assert.throws(() => instant(value));
  assert.equal(instant("2024-02-29T12:00:00Z"), "2024-02-29T12:00:00Z");
  assert.equal(Date.parse(instant("2026-09-07T14:00:00+02:00")), Date.parse("2026-09-07T12:00:00Z"));
});
