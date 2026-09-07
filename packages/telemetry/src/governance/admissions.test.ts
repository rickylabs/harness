import assert from "node:assert/strict";
import { it } from "node:test";
import { mapAdmissions } from "./admissions.js";
const now = "2026-09-07T12:00:00Z";
const event = (at = "2026-09-07T11:59:00Z", detail: Record<string, unknown> = {}) => ({ at: now, runId: "private-session-canary", kind: "governance.admission", detail: {
  item: { number: 205 }, regime: "subscription", state: "throttle", observedAt: at, validUntil: "2026-09-07T12:05:00Z",
  outcome: { accepted: false, reason: "quota-paced", detail: "private-project/path canary" }, provenance: "private-host-canary", ...detail,
} });
it("admissions use explicit detail time, latest per item/regime, collapse replay and keep log identity private", () => {
  const first = event("2026-09-07T11:58:00Z");
  const latest = event();
  const duplicate = { ...event("2026-09-07T13:59:00+02:00"), runId: "another-private-canary" };
  const result = mapAdmissions([latest, first, duplicate], now);
  assert.equal(result.ok, true);
  assert.equal(result.admissions.length, 1);
  assert.equal(Date.parse(result.admissions[0]!.observedAt), Date.parse(latest.detail.observedAt));
  assert.deepEqual(mapAdmissions([latest, duplicate], now), mapAdmissions([duplicate, latest], now));
  assert.equal(result.admissions[0]?.provenance, "reader:recorded-admission");
  assert.equal(result.admissions[0]?.outcome.reason, "quota-paced");
  assert.doesNotMatch(JSON.stringify(result), /private-|canary/);
  assert.deepEqual(mapAdmissions([first, latest], now), mapAdmissions([latest, first], now));
});
it("same-time conflicts block only their key and newer malformed records never revive old decisions", () => {
  const other = event(undefined, { item: { number: 206 } });
  for (const bad of [
    event(undefined, { state: "pause" }),
    event(undefined, { state: "allow" }),
    event("2026-09-07T11:59:30Z", { outcome: { accepted: true } }),
    event("2026-09-07T12:01:00Z"),
    event("not-a-time"),
    event("2026-02-30T12:00:00Z"),
    event(undefined, { validUntil: "2026-09-31T12:00:00Z" }),
    { ...event(), runId: "" },
  ]) {
    const result = mapAdmissions([event("2026-09-07T11:58:00Z"), event(), bad, other], now);
    assert.equal(result.ok, false);
    assert.deepEqual(result.admissions.map(a => a.item.number), [206]);
  }
});
it("private operator-detail differences still conflict before redaction", () => {
  const result = mapAdmissions([event(), event(undefined, { outcome: { accepted: false, reason: "quota-paced", detail: "different-private-canary" } })], now);
  assert.equal(result.ok, false);
  assert.deepEqual(result.admissions, []);
  assert.match(result.notes.join(" "), /admission-conflict/);
  assert.doesNotMatch(JSON.stringify(result), /canary/);
});
it("malformed identity/order, unsafe reasons, and unread logs fail safely; no routing or prose inference", () => {
  for (const detail of [{ item: null }, { regime: "other" }, { observedAt: undefined }, { outcome: { accepted: false, reason: "private/path or prose", detail: "x" } }]) {
    const result = mapAdmissions([event(), event(undefined, detail)], now);
    assert.equal(result.ok, false);
    assert.equal(result.admissions.length, 0);
  }
  assert.equal(mapAdmissions([event()], now, true).admissions.length, 0);
  for (const values of [[], [{ kind: "routing-state", affectedSession: "issue-205", phase: "paused" }], [{ kind: "turn", detail: { text: "pause item 205" } }]]) {
    assert.equal(mapAdmissions(values, now).ok, false);
    assert.equal(mapAdmissions(values, now).admissions.length, 0);
  }
});
it("expired newest admissions cannot expose an older still-valid refusal", () => {
  const result = mapAdmissions([event("2026-09-07T11:58:00Z"), event(undefined, { validUntil: "2026-09-07T11:59:59Z" })], now);
  assert.equal(result.ok, false);
  assert.equal(result.admissions.length, 0);
  assert.match(result.notes.join(" "), /stale-source/);
});

it("preserves published contract examples and producer-defined reason codes without a new taxonomy", () => {
  for (const reason of ["quota-paused", "lane-unknown", "needs-approval", "provider_rate_limited", "future-gate-code"]) {
    const result = mapAdmissions([event(undefined, { outcome: { accepted: false, reason, detail: "private/path withheld" } })], now);
    assert.equal(result.ok, true);
    assert.equal(result.admissions[0]?.outcome.reason, reason);
    assert.doesNotMatch(JSON.stringify(result), /private\/path/);
  }
  for (const reason of ["", "private/path", "private prose", "private\nvalue", "x".repeat(129)]) {
    const result = mapAdmissions([event(undefined, { outcome: { accepted: false, reason, detail: "withheld" } })], now);
    assert.equal(result.ok, false);
    assert.equal(result.admissions.length, 0);
  }
});
