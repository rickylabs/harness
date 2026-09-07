import type { RegimeStatus } from "@rickylabs/harness-contracts";
import { expiry, instant, mapped, object, USAGE_WINDOWS, type Leg, type UsageSource } from "../source.js";

/** Source snapshot only; no expense evaluator, binding policy or inferred duration. */
export function mapUsage(value: unknown, config: UsageSource, account: string): Leg<RegimeStatus> {
  return mapped(() => {
    const input = object(value);
    if (input.provider !== "opencode_go") throw new Error();
    const observedAt = instant(input.capturedAt);
    const validUntil = expiry(observedAt, input.validForMs);
    const readings = object(input.percentageWindows);
    const windows = USAGE_WINDOWS.map(id => {
      const row = object(readings[id]);
      if (typeof row.percent !== "number" || !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100 ||
          typeof row.status !== "string" || row.status.trim().length === 0 || row.status.length > 128 || /[\x00-\x1f\x7f]/.test(row.status)) throw new Error();
      return { ...config.windows[id], usedPercent: row.percent, resetsAt: row.resetsAt === undefined ? null : instant(row.resetsAt), binding: false };
    });
    return { ok: true, observedAt, validUntil, value: { regime: "subscription", state: "allow",
      accounts: [{ seam: "opencode_go", account, state: "allow", windows, observedAt }],
      note: "reader:opencode-usage; reader-stamped after response (provider capture time unobserved); binding unobserved; one configured credential binding, fleet completeness unknown" } };
  });
}
