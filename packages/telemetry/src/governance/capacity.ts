import type { RegimeStatus } from "@rickylabs/harness-contracts";
import { expiry, instant, mapped, type CapacitySource, type Leg } from "../source.js";

function bytes(value: unknown): number {
  if (typeof value !== "string" || !/^\d+\s*$/.test(value)) throw new Error();
  const result = Number(value.trim());
  if (!Number.isSafeInteger(result) || result < 0) throw new Error();
  return result;
}
export function mapCapacity(current: unknown, max: unknown, config: CapacitySource, capturedAt: string): Leg<RegimeStatus> {
  return mapped(() => {
    const ramUsedBytes = bytes(current);
    const ramTotalBytes = typeof max === "string" && max.trim() === "max" ? null : bytes(max);
    if (ramTotalBytes !== null && ramUsedBytes > ramTotalBytes) throw new Error();
    const observedAt = instant(capturedAt);
    return { ok: true, observedAt, validUntil: expiry(observedAt, config.validForMs), value: {
      regime: "capacity", state: "allow",
      note: "reader:cgroup-memory; scope is configured cgroup v2, not a verified dispatch host; GPU unknown" +
        (ramTotalBytes === null ? "; unlimited limit, total and headroom unknown" : ""),
      hosts: [{ host: config.scopeLabel, ramUsedBytes, ramTotalBytes, vramUsedBytes: null, vramTotalBytes: null, observedAt }],
    } };
  });
}
