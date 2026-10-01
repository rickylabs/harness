import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectProviderUsage, githubBilling, openRouterPrices, providerDecimal, providerJson, readProviderUsageSource, PLAN_READ_CREDENTIAL_KEY } from "./provider-usage.js";
import { readProviderUsageSnapshot } from "@rickylabs/harness-contracts";
const at = "2026-01-02T12:00:00.000Z", key = Buffer.alloc(32, 7);
const source = () => ({ githubCopilot: { username: "fixture-owner", credentialFile: null as string | null, models: [{ model: "fixture-model", billingModel: "Fixture Model" }] }, openRouter: null, openCode: null });
const credential = ["github", "pat", ""].join("_") + "x".repeat(20);
const item = (unitType: string, model = "Fixture Model") => ({ product: "Copilot", sku: "fixture-sku", unitType, model,
  grossQuantity: 12, discountQuantity: 10, netQuantity: 2, grossAmount: 6, discountAmount: 5, netAmount: 1, pricePerUnit: 0.5 });
const reply = (url: string) => {
  const u = new URL(url), timePeriod = { year: Number(u.searchParams.get("year")), month: Number(u.searchParams.get("month")),
    ...(u.searchParams.has("day") ? { day: Number(u.searchParams.get("day")) } : {}) };
  return { user: "fixture-owner", timePeriod, usageItems: [{ ...item(u.pathname.includes("premium_request") ? "requests" : "ai-credits"), product: u.pathname.includes("premium_request") ? "Copilot" : "Copilot AI Credits" }] };
};
const billing = async (file: string, change?: (value: ReturnType<typeof reply>) => unknown) => githubBilling({ ...source().githubCopilot, credentialFile: file }, key, at,
  async url => new Response(JSON.stringify(change ? change(reply(url)) : reply(url))));
test("missing Plan credential is unknown, uses neither GH/OAuth fallback nor a network call", async () => {
  let calls = 0;
  const output = await collectProviderUsage(source(), key, at, { fetcher: async () => { calls++; throw new Error("PRIVATE_CANARY"); } });
  assert.equal(calls, 0); assert.equal(output.meters.length, 8); assert.equal(output.coverage.githubBilling, "unknown");
  assert.ok(output.meters.every(r => r.state === "unknown" && r.reason === "no-plan-read-credential" && r.grossQuantity === null && r.netUsd === null));
  assert.ok(!JSON.stringify(output).includes("fixture-owner") && !JSON.stringify(output).includes("PRIVATE_CANARY"));
});
test("billing GET binds owner/date/unit, preserves monthly/daily splits and exact model aliases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "billing-fixture-"));
  try {
    const file = join(dir, "credential.json"); await writeFile(file, JSON.stringify({ [PLAN_READ_CREDENTIAL_KEY]: credential }), { mode: 0o600 });
    const seen: string[] = [];
    const rows = await githubBilling({ ...source().githubCopilot, credentialFile: file }, key, at, async (url, init) => {
      seen.push(url); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
      assert.equal((init.headers as Record<string, string>)["X-GitHub-Api-Version"], "2026-03-10");
      assert.equal((init.headers as Record<string, string>)["Authorization"], `Bearer ${credential}`);
      return new Response(JSON.stringify(reply(url)));
    });
    assert.equal(seen.length, 4); assert.equal(rows.length, 8); assert.ok(rows.every(r => r.state === "known" && r.reportedThrough === null));
    assert.deepEqual(rows.map(r => [r.unit, r.period, r.model, r.grossQuantity, r.includedQuantity, r.netQuantity]),
      ["premium_requests", "ai_credits"].flatMap(unit => ["month", "day"].flatMap(period => [null, "fixture-model"].map(model => [unit, period, model, "12", "10", "2"]))));
    assert.ok(rows.filter(r => r.model === null).every(r => r.pricePerUnitUsd === null));
    assert.ok(rows.filter(r => r.model !== null).every(r => r.pricePerUnitUsd === "0.5"));
    assert.ok(!JSON.stringify(rows).includes(credential) && !JSON.stringify(rows).includes(dir));
    const empty = await billing(file, v => ({ ...v, usageItems: [] }));
    assert.ok(empty.every(r => r.grossQuantity === "0" && r.pricePerUnitUsd === null));
    const mixed = await billing(file, v => ({ ...v, usageItems: [...v.usageItems, item(v.usageItems[0]!.unitType, "Other Fixture Model")] }));
    assert.ok(mixed.filter(r => r.model === null).every(r => r.grossQuantity === "24"));
    assert.ok(mixed.filter(r => r.model !== null).every(r => r.grossQuantity === "12"));
    for (const change of [
      (v: ReturnType<typeof reply>) => ({ ...v, user: "other-fixture-owner" }),
      (v: ReturnType<typeof reply>) => ({ ...v, timePeriod: { ...v.timePeriod, month: 2 } }),
      (v: ReturnType<typeof reply>) => ({ ...v, usageItems: [{ ...v.usageItems[0], unitType: "tokens" }] }),
      (v: ReturnType<typeof reply>) => ({ ...v, usageItems: [{ ...v.usageItems[0], grossQuantity: 11 }] }),
      (v: ReturnType<typeof reply>) => ({ ...v, usageItems: [{ ...v.usageItems[0], grossAmount: 7 }] }),
      (v: ReturnType<typeof reply>) => ({ ...v, usageItems: [{ ...v.usageItems[0], netAmount: -1 }] }),
      (v: ReturnType<typeof reply>) => ({ ...v, usageItems: [{ ...v.usageItems[0], pricePerUnit: null }] }),
      (v: ReturnType<typeof reply>) => ({ ...v, usageItems: Array.from({ length: 1025 }, () => v.usageItems[0]) }),
    ]) assert.ok((await billing(file, change)).every(r => r.state === "unknown" && r.reason === "shape-mismatch" && r.grossQuantity === null));
    for (const status of [401, 403, 404, 429, 500]) {
      const rows = await githubBilling({ ...source().githubCopilot, credentialFile: file }, key, at,
        async () => new Response("PRIVATE_CANARY", { status }));
      assert.ok(rows.every(r => r.state === "unknown" && r.reason === (status < 405 ? "no-plan-read-credential" : "request-failed")));
      assert.ok(!JSON.stringify(rows).includes("PRIVATE_CANARY"));
    }
    await chmod(file, 0o644);
    assert.ok((await billing(file)).every(r => r.reason === "no-plan-read-credential"));
    await chmod(file, 0o600); const link = join(dir, "link"); await symlink(file, link);
    assert.ok((await billing(link)).every(r => r.reason === "no-plan-read-credential"));
    for (const value of [{ wrongKey: credential }, { [PLAN_READ_CREDENTIAL_KEY]: "classic-fixture" }, { [PLAN_READ_CREDENTIAL_KEY]: credential, extra: true }]) {
      await writeFile(file, JSON.stringify(value)); assert.ok((await billing(file)).every(r => r.reason === "no-plan-read-credential"));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("bounded provider GET covers body size, invalid encoding/JSON, thrown diagnostics and body timeout", async t => {
  const url = "https://openrouter.ai/api/v1/models";
  assert.deepEqual(await providerJson(url, {}, async () => new Response("PRIVATE_CANARY")), { ok: false, reason: "request-failed" });
  assert.deepEqual(await providerJson(url, {}, async () => new Response("{}", { headers: { "content-length": "99999999" } })), { ok: false, reason: "oversize" });
  assert.deepEqual(await providerJson(url, {}, async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1))), { ok: false, reason: "oversize" });
  assert.deepEqual(await providerJson(url, {}, async () => new Response(new Uint8Array([255]))), { ok: false, reason: "request-failed" });
  assert.deepEqual(await providerJson(url, {}, async () => { throw new Error("PRIVATE_CANARY"); }), { ok: false, reason: "request-failed" });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false, cancelled = false;
  const pending = providerJson(url, {}, async () => new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } }))).then(v => { settled = true; return v; });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  t.mock.timers.tick(10_000);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(settled, true, "whole body read must be bounded by the deadline");
  assert.deepEqual(await pending, { ok: false, reason: "timeout" });
  assert.equal(cancelled, true);
});
const prices = () => ({ data: [{ id: "fixture/model", pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0.0000001", input_cache_write: "0" } }], total_count: 1, links: { next: null } });
test("catalog aliases preserve selected ordinary prices, enrolled aliases and the full catalog", async () => {
  const catalog = prices();
  catalog.data.push({ ...catalog.data[0]!, id: "~fixture/alias" });
  catalog.total_count = catalog.data.length;
  const load = (models: readonly string[], value: unknown = catalog) => openRouterPrices({ models }, at,
    async () => new Response(JSON.stringify(value)));
  const selected = await load(["fixture/model"]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.state, "known");
  assert.equal(selected[0]?.model, "fixture/model");
  assert.deepEqual(selected[0]?.rates, { input: "1", output: "2", cacheRead: "0.1", cacheWrite: "0" });
  const enrolled = readProviderUsageSource({ githubCopilot: null, openRouter: { models: ["~fixture/alias"] }, openCode: null });
  assert.deepEqual(enrolled.openRouter?.models, ["~fixture/alias"]);
  const alias = await load(enrolled.openRouter!.models);
  assert.equal(alias[0]?.state, "known");
  assert.equal(alias[0]?.model, "~fixture/alias");
  const full = await collectProviderUsage({ githubCopilot: null, openRouter: { models: [] }, openCode: null }, key, at,
    { fetcher: async () => new Response(JSON.stringify(catalog)) });
  assert.equal(full.coverage.openRouter, "known");
  assert.deepEqual(full.prices.map(p => p.model), ["fixture/model", "~fixture/alias"]);
  assert.equal(readProviderUsageSnapshot(full).ok, true);
  for (const id of ["~", "~~fixture/alias", "fixture/~alias", "~fixture/alias\n", "~fixture/" + "x".repeat(248)]) {
    assert.throws(() => readProviderUsageSource({ githubCopilot: null, openRouter: { models: [id] }, openCode: null }));
    const bad = { ...catalog, data: [catalog.data[0], { ...catalog.data[1], id }] };
    assert.equal((await load(["fixture/model"], bad))[0]?.reason, "shape-mismatch");
  }
});
test("numeric HHMM overrides preserve midnight, wrap order, weekdays and inherited prices", async () => {
  const load = (override: Record<string, unknown>) => {
    const catalog = prices();
    Object.assign(catalog.data[0]!.pricing, { overrides: [override] });
    return openRouterPrices({ models: ["fixture/model"] }, at, async () => new Response(JSON.stringify(catalog)));
  };
  for (const [start, end, expectedStart, expectedEnd] of [
    [1630, 30, "16:30", "00:30"], [0, 2359, "00:00", "23:59"],
    [1630, 0, "16:30", "00:00"], [0, 0, "00:00", "00:00"],
  ] as const) {
    const rows = await load({ utc_start: start, utc_end: end, utc_days: ["saturday", "sunday"], completion: "0.000004" });
    assert.equal(rows[0]?.state, "known");
    assert.deepEqual(rows[0]?.overrides[0], { minPromptTokens: null, utcStart: expectedStart, utcEnd: expectedEnd,
      utcDays: [6, 0], rates: { input: "1", output: "4", cacheRead: "0.1", cacheWrite: "0" } });
    const historical = await load({ utc_start: expectedStart, utc_end: expectedEnd, utc_days: ["saturday", "sunday"], completion: "0.000004" });
    assert.deepEqual(rows, historical);
  }
  for (const bad of [-1, 2400, 1260, 1630.5, true, "30", "24:00"]) {
    const rows = await load({ utc_start: bad, utc_end: 30, completion: "0.000004" });
    assert.equal(rows[0]?.state, "unknown");
    assert.equal(rows[0]?.reason, "shape-mismatch");
    assert.equal(rows[0]?.rates.input, null);
  }
  for (const override of [{ utc_start: 1630 }, { utc_end: 30 }]) {
    assert.equal((await load(override))[0]?.reason, "shape-mismatch");
  }
});
test("price rows use catalog rates, retain context/time overrides and never invent absent cache prices", async () => {
  const load = async (value: unknown) => openRouterPrices({ models: ["fixture/model"] }, at, async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/models"); assert.deepEqual(init.headers, {}); return new Response(JSON.stringify(value));
  });
  const rows = await load(prices()); assert.equal(rows[0]?.state, "known");
  assert.deepEqual(rows[0]?.rates, { input: "1", output: "2", cacheRead: "0.1", cacheWrite: "0" });
  const withOverrides = prices() as { data: { id: string; pricing: Record<string, unknown> }[]; total_count: number; links: { next: null } };
  withOverrides.data[0]!.pricing["overrides"] = [{ min_prompt_tokens: 100, prompt: "0.000003" }, { utc_days: ["saturday", "sunday"], utc_start: "22:00", utc_end: "06:00", completion: "0.000004" }];
  const overridden = await load(withOverrides); assert.equal(overridden[0]?.state, "known");
  assert.equal(overridden[0]?.overrides[0]?.rates.input, "3"); assert.equal(overridden[0]?.overrides[0]?.rates.output, "2");
  assert.deepEqual(overridden[0]?.overrides[1]?.utcDays, [6, 0]);
  withOverrides.data[0]!.pricing["overrides"] = [{ min_prompt_tokens: 100, prompt: "0.0000000000000001" }];
  const partialOverride = await load(withOverrides);
  assert.equal(partialOverride[0]?.state, "partial"); assert.equal(partialOverride[0]?.overrides[0]?.rates.input, null);
  const absent = prices(); delete (absent.data[0]!.pricing as Partial<typeof absent.data[0]["pricing"]>).input_cache_read;
  const partial = await load(absent); assert.equal(partial[0]?.state, "partial"); assert.equal(partial[0]?.rates.cacheRead, null);
  const fee = prices() as typeof withOverrides; fee.data[0]!.pricing["request"] = "0.1";
  assert.deepEqual((await load(fee))[0]?.additionalCharges, ["request"]);
  for (const bad of [{ ...prices(), data: [...prices().data, { id: "other/fixture", pricing: {} }, { id: "other/fixture", pricing: {} }], total_count: 3 },
    { ...prices(), total_count: 2 }, { ...prices(), links: { next: "https://private.example" } },
    { ...prices(), data: [...prices().data, ...prices().data], total_count: 2 },
    { ...prices(), data: [{ id: " private-model", pricing: {} }] },
    { ...prices(), data: [{ id: "fixture/model", pricing: { overrides: [{ utc_days: ["unknown"] }] } }] }]) {
    const rows = await load(bad); assert.equal(rows[0]?.state, "unknown"); assert.equal(rows[0]?.reason, "shape-mismatch");
  }
  const missing = await openRouterPrices({ models: ["fixture/absent"] }, at, async () => new Response(JSON.stringify(prices())));
  assert.equal(missing[0]?.reason, "model-unpriced");
  assert.deepEqual(await openRouterPrices({ models: [] }, at, async () => new Response("PRIVATE_CANARY", { status: 503 })), []);
  const projection = await collectProviderUsage({ githubCopilot: null, openRouter: { models: [] }, openCode: null }, key, at,
    { fetcher: async () => new Response("PRIVATE_CANARY", { status: 503 }) });
  assert.equal(projection.coverage.openRouter, "unknown");
});
test("decimal conversion is exact for provider numbers and per-token catalog strings", () => {
  assert.equal(providerDecimal(1e-8), "0.00000001"); assert.equal(providerDecimal("0.000001", true), "1");
  assert.equal(providerDecimal("0.000000000000001", true), "0.000000001");
  for (const value of [undefined, null, NaN, Infinity, -1, "0.0000000001", "1000000000", "PRIVATE_CANARY"]) assert.equal(providerDecimal(value), null);
});
test("private source enrollment rejects unbounded identities, duplicate aliases and unsupported version scopes", () => {
  assert.deepEqual(readProviderUsageSource(source()), source());
  for (const githubCopilot of [{ ...source().githubCopilot, username: "private/path" }, { ...source().githubCopilot, credentialFile: "relative" },
    { ...source().githubCopilot, models: [source().githubCopilot.models[0], source().githubCopilot.models[0]] },
    { ...source().githubCopilot, models: [{ model: "fixture-model", billingModel: "PRIVATE\nCANARY" }] }]) assert.throws(() => readProviderUsageSource({ ...source(), githubCopilot }));
  for (const change of [{ openRouter: { models: ["fixture/model", "fixture/model"] } }, { openRouter: { models: ["bare"] } },
    { openCode: { databaseFile: "relative", from: at, versions: [], providers: [] } }, { extra: true }]) assert.throws(() => readProviderUsageSource({ ...source(), ...change }));
});
