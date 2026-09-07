import type { RegimeStatus } from "@rickylabs/harness-contracts";
import { expiry, instant, mapped, object, SPEND_WINDOWS, type Leg, type SpendSource } from "../source.js";

export function mapSpend(value: unknown, config: SpendSource, capturedAt: string): Leg<RegimeStatus> {
  return mapped(() => {
    const data = object(object(value).data);
    const spentUsd = data[SPEND_WINDOWS[config.window]];
    if (typeof spentUsd !== "number" || !Number.isFinite(spentUsd) || spentUsd < 0) throw new Error();
    const observedAt = instant(capturedAt);
    return { ok: true, observedAt, validUntil: expiry(observedAt, config.validForMs), value: {
      regime: "metered", state: "allow", note: "reader:openrouter-key; reader-stamped after response; ceiling unobserved",
      providers: [{ provider: "openrouter", spentUsd, ceilingUsd: null, windowLabel: config.window, observedAt }],
    } };
  });
}
