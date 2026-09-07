import assert from "node:assert/strict";
import { it } from "node:test";
import { composeGovernance, type CollectedSources } from "./compose.js";
import { mapSpend } from "./spend.js";
import { mapCapacity } from "./capacity.js";
import { SPEND_URL, type GovernanceSource } from "../source.js";
const now = "2026-09-07T12:00:00Z";
const source: GovernanceSource = { accountLabel: "synthetic", usage: null, admissions: null,
  spend: { url: SPEND_URL, credentialEnv: "FIXTURE_API_KEY", window: "total", validForMs: 60000, timeoutMs: 100, maxBytes: 4096 },
  capacity: { cgroupRoot: "/fixture/cgroup", scopeLabel: "configured-cgroup", validForMs: 120000 } };
const collected = (): CollectedSources => ({ usage: { ok: false, code: "not-configured" },
  spend: mapSpend({ data: { usage: 2 } }, source.spend!, now), capacity: mapCapacity("1", "max", source.capacity!, now), events: [], logDegraded: false });
it("composition uses completion, retains leaves and earliest successful expiry; independent failures remain incomplete", () => {
  const result = composeGovernance(source, collected(), "2026-09-07T12:00:01Z");
  assert.equal(result.ok, true);
  assert.equal(result.governance.observedAt, "2026-09-07T12:00:01Z");
  assert.equal(result.governance.validUntil, "2026-09-07T12:01:00.000Z");
  assert.match(JSON.stringify(result.governance.state), /2026-09-07T12:00:00Z/);
  for (const leg of ["spend", "capacity"] as const) {
    const partial = composeGovernance(source, { ...collected(), [leg]: { ok: false, code: "timeout" } }, now);
    assert.equal(partial.ok, false);
    assert.equal(partial.governance.availability, "fresh");
    assert.match(partial.notes.join(" "), new RegExp(`${leg}: timeout`));
  }
});
it("expired and future sources are removed without restamping; no retained leg is unavailable", () => {
  const input = collected();
  const expired = composeGovernance(source, input, "2026-09-07T12:01:01Z");
  assert.equal(expired.ok, false);
  assert.equal(expired.governance.availability, "fresh");
  assert.match(expired.notes.join(" "), /spend: stale-source/);
  assert.equal(expired.governance.state?.regimes[1]?.regime, "metered");
  assert.doesNotMatch(JSON.stringify(expired.governance), /"spentUsd"/);
  assert.equal(composeGovernance(source, input, "2026-09-07T12:02:01Z").governance.availability, "unavailable");
  const future = composeGovernance(source, input, "2026-09-07T11:59:59Z");
  assert.equal(future.governance.availability, "unavailable");
  assert.match(future.notes.join(" "), /future-source/);
});
it("explicit evaluation clock can make retained evidence stale or future-invalid, while equal-offset times agree", () => {
  const input = collected();
  assert.equal(composeGovernance(source, input, now, "2026-09-07T12:10:00Z").governance.availability, "stale");
  assert.equal(composeGovernance(source, input, now, "2026-09-07T11:00:00Z").ok, false);
  assert.deepEqual(composeGovernance(source, input, now, "2026-09-07T14:00:00+02:00"), composeGovernance(source, input, now, now));
});
it("all-unconfigured is unavailable, configured missing admissions incomplete, and pending never inferred", () => {
  const absent = composeGovernance({ ...source, spend: null, capacity: null }, collected(), now);
  assert.equal(absent.ok, false);
  assert.equal(absent.governance.availability, "unavailable");
  for (const leg of ["usage", "spend", "capacity", "admissions"]) assert.ok(absent.notes.includes(`${leg}: not-configured`));
  const noAdmissions = composeGovernance({ ...source, admissions: { fromObservabilityLog: true } }, collected(), now);
  assert.equal(noAdmissions.ok, false);
  assert.equal(noAdmissions.governance.availability, "fresh");
  assert.deepEqual(noAdmissions.governance.state?.pending, []);
  assert.ok(noAdmissions.notes.includes("pending approvals unobserved"));
});
