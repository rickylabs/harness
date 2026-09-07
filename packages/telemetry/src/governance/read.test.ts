import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { readGovernanceSnapshot, SOURCE_FAILURE_REASONS } from "@rickylabs/harness-contracts";
import { composeGovernance, type CollectedSources } from "./compose.js";
import { governanceRead } from "./read.js";
import { mapUsage } from "./usage.js";
import { mapSpend } from "./spend.js";
import { mapCapacity } from "./capacity.js";
import { SPEND_URL, type GovernanceSource } from "../source.js";

const now = "2026-09-07T12:00:00.000Z";
const later = "2026-09-07T12:10:00.000Z";
const source: GovernanceSource = {
  accountLabel: "synthetic", usage: { denoBin: "/synthetic/private-deno", probe: "/synthetic/probe", checkout: "/synthetic/checkout",
    model: "synthetic/private-model", credentialEnv: "SYNTHETIC_PRIVATE_KEY", timeoutMs: 100, maxBytes: 4096,
    windows: { rolling_five_hours: { label: "short", windowMinutes: 300 }, weekly: { label: "week", windowMinutes: 10080 }, monthly: { label: "month", windowMinutes: 43200 } } },
  spend: { url: SPEND_URL, credentialEnv: "SYNTHETIC_PRIVATE_KEY", window: "total", validForMs: 60000, timeoutMs: 100, maxBytes: 4096 },
  capacity: { cgroupRoot: "/synthetic/private-cgroup", scopeLabel: "synthetic-cgroup", validForMs: 60000 },
  admissions: { fromObservabilityLog: true },
};
const event = (item = 7) => ({ runId: "synthetic-private-run", kind: "governance.admission", at: now, detail: {
  item: { number: item }, regime: "subscription", state: "throttle", observedAt: now, validUntil: "2026-09-07T12:05:00.000Z",
  provenance: "synthetic-private-provenance", outcome: { accepted: false, reason: "quota-paced", detail: "synthetic-private-detail" },
} });
const all = (): CollectedSources => ({
  usage: mapUsage({ provider: "opencode_go", capturedAt: now, validForMs: 60000,
    percentageWindows: Object.fromEntries(["rolling_five_hours", "weekly", "monthly"].map(id => [id, { percent: 42, status: "allowed" }])) }, source.usage!, source.accountLabel),
  spend: mapSpend({ data: { usage: 2 } }, source.spend!, now),
  capacity: mapCapacity("1024", "4096", source.capacity!, now), events: [event()], logDegraded: false,
});
const none: GovernanceSource = { ...source, usage: null, spend: null, capacity: null, admissions: null };
const conflict = event(); conflict.detail.outcome.detail = "different-private-detail";
const cases = [
  ["mixed-timeout", { ...source, spend: null }, { ...all(), usage: { ok: false, code: "timeout" } }, now],
  ["unavailable-not-configured", none, all(), now],
  ["stale", source, all(), later],
  ["admissions-only", { ...none, admissions: source.admissions }, all(), now],
  ["degraded-log", source, { ...all(), logDegraded: true }, now],
  ["conflicting-admissions", source, { ...all(), events: [event(), conflict] }, now],
  ["complete-without-admissions", { ...source, admissions: null }, all(), now],
] satisfies readonly (readonly [string, GovernanceSource, CollectedSources, string])[];

for (const [name, configured, collected, evaluated] of cases) {
  it(`round-trips and byte-locks synthetic ${name}`, () => {
    const composed = composeGovernance(configured, collected, now, evaluated);
    const document = governanceRead(composed, evaluated);
    assert.equal(document.complete, composed.ok);
    assert.equal(readGovernanceSnapshot(document).ok, true);
    const fixture = readFileSync(new URL(`../../../contracts/test-fixtures/governance-read/${name}.json`, import.meta.url), "utf8");
    assert.equal(`${JSON.stringify(document, null, 2)}\n`, fixture);
    assert.doesNotMatch(JSON.stringify(document), /synthetic-private|private-model|private-cgroup|SYNTHETIC_PRIVATE_KEY/);
  });
}
it("preserves each source's original observation and independent provenance", () => {
  const document = governanceRead(composeGovernance(source, all(), "2026-09-07T12:00:01.000Z"), "2026-09-07T12:00:01.000Z");
  for (const name of ["usage", "spend", "capacity"] as const) {
    const c = document.sources[name]; assert.equal(c.status, "read");
    if (c.status === "read") { assert.equal(c.observedAt, now); assert.notEqual(c.observedAt, document.observedAt); }
  }
  assert.equal(new Set([document.sources.usage, document.sources.spend, document.sources.capacity].map(c => c.status === "read" ? c.provenance : "")).size, 3);
  assert.equal(document.admissions[0]?.observedAt, now);
  const ac = document.sources.admissions;
  assert.equal(ac.status === "read" && ac.collectedAt, document.observedAt);
});
it("keeps empty, malformed, stale and conflicting admissions distinct", () => {
  for (const [events, expected] of [
    [[], []], [[{}], []], [[{ kind: "governance.admission" }], ["shape-mismatch"]],
    [[{ ...event(), detail: { ...event().detail, validUntil: now } }], ["stale-source"]],
    [[event(), conflict], ["admission-conflict"]],
  ] as const) {
    const at = "2026-09-07T12:00:01.000Z";
    const result = governanceRead(composeGovernance(source, { ...all(), events }, at), at);
    assert.equal(result.complete, false);
    assert.equal(result.sources.admissions.status, "read");
    if (result.sources.admissions.status === "read") {
      assert.deepEqual(result.sources.admissions.dropped, expected);
      assert.equal(result.sources.admissions.empty, true);
      assert.equal(result.sources.admissions.records, 0);
    }
  }
});
it("structured meter refusal codes agree with fixed display notes", () => {
  for (const reason of SOURCE_FAILURE_REASONS) {
    const result = composeGovernance(source, { ...all(), usage: { ok: false, code: reason } }, now);
    assert.deepEqual(result.coverage.usage, { status: "failed", reason });
    assert.ok(result.notes.includes(`usage: ${reason}`));
    assert.equal(governanceRead(result, now).complete, false);
  }
  const original = all().usage;
  assert.equal(original.ok, true);
  if (!original.ok) return;
  for (const [observedAt, validUntil, reason] of [
    [now, "2026-09-07T11:00:00Z", "shape-mismatch"],
    ["2026-09-07T11:00:00Z", "2026-09-07T11:01:00Z", "stale-source"],
    ["2026-09-07T12:00:01Z", "2026-09-07T12:01:00Z", "future-source"],
  ] as const) {
    const result = composeGovernance(source, { ...all(), usage: { ...original, observedAt, validUntil } }, now);
    assert.deepEqual(result.coverage.usage, { status: "discarded", reason });
    assert.ok(result.notes.includes(`usage: ${reason}`));
  }
});
it("fails closed on over-cap composed admission evidence, without truncation", () => {
  const composed = composeGovernance(source, { ...all(), events: Array.from({ length: 1001 }, (_, i) => event(i + 1)) }, now);
  assert.equal(composed.governance.admissions.length, 1001);
  assert.throws(() => governanceRead(composed, now), /^Error: governance document unavailable$/);
});
it("represents future-invalid envelope without fabricating retained data", () => {
  const evaluated = "2026-09-07T11:00:00.000Z";
  const result = governanceRead(composeGovernance(source, all(), now, evaluated), evaluated);
  assert.equal(result.availability, "unavailable"); assert.equal(result.unavailableReason, "envelope-invalid");
  assert.equal(result.state, null); assert.equal(result.sources.capacity.status, "read");
});
