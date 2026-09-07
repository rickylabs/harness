import assert from "node:assert/strict";
import { it } from "node:test";
import { mapCapacity } from "./capacity.js";
const config = { cgroupRoot: "/fixture/cgroup", scopeLabel: "configured-cgroup", validForMs: 1000 };
const now = "2026-09-07T12:00:00Z";
it("configured cgroup v2 retains used when unlimited; never substitutes host/GPU memory", () => {
  for (const max of ["8192\n", "max\n"]) {
    const result = mapCapacity("4096\n", max, config, now);
    assert.ok(result.ok);
    assert.equal(result.value.regime, "capacity");
    if (result.value.regime !== "capacity") continue;
    assert.deepEqual(result.value.hosts[0], { host: "configured-cgroup", ramUsedBytes: 4096, ramTotalBytes: max.startsWith("max") ? null : 8192, vramUsedBytes: null, vramTotalBytes: null, observedAt: now });
    assert.match(result.value.note!, /configured cgroup v2, not a verified dispatch host; GPU unknown/);
  }
});
it("invalid cgroup bytes and contradictory finite pairs fail unread", () => {
  for (const value of ["-1", "1.5", "", "9223372036854775807", "Infinity", "1e3", undefined]) assert.equal(mapCapacity(value, "max", config, now).ok, false);
  assert.equal(mapCapacity("9", "8", config, now).ok, false);
  assert.equal(mapCapacity("1", "unlimited", config, now).ok, false);
});
