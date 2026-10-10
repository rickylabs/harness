/**
 * What a decoded provider-limit snapshot means for a launch: meters warn, only refusals block.
 *
 * A fresh, complete reading at or above `PROVIDER_LIMIT_WARNING_PERCENT` is a warning, 100% included,
 * and never refuses a route. Unknown, partial and stale readings neither warn nor refuse. The only
 * blocking evidence is an actual inference refused with `quota_exhausted` or `payment_required`, until
 * a strictly later success in the same provider, key and account scope clears it (any model for a
 * provider-wide refusal, the same model otherwise). A `rate_limited` refusal is advisory.
 *
 * A refusal reaches a route only through its scope: a refusal with no key and no account is
 * provider-wide; a key or account refusal blocks only routes a meter of that key or account binds in
 * `launchModels`. Pure and synchronous; it reads nothing and never invents a reading.
 */
import { PROVIDER_LIMIT_WARNING_PERCENT, type ProviderLimitMeterV1, type ProviderLimitSnapshotV1, type ProviderOutcomeV1 } from "./provider-limits.js";

/** A reading stays fresh for two 180-second collector polls, as in Cockpit's version-one schema. */
export const PROVIDER_LIMIT_VALIDITY_MS = 2 * 180_000;

export interface ProviderLimitAdvisoryV1 {
  readonly meter: ProviderLimitMeterV1;
  /** The source's percentage; for a key, its use of its own cap. Null when no reading establishes it. */
  readonly usedPercent: number | null;
  /** Null without a reading or for a reading observed after the evaluation clock. */
  readonly stale: boolean | null;
  /** Fresh, known and at or above the warning threshold. Advisory only. */
  readonly warning: boolean;
}
export interface ProviderLimitAssessmentV1 {
  readonly generatedAt: string;
  readonly meters: readonly ProviderLimitAdvisoryV1[];
  /** Active quota or payment refusals: the only evidence that blocks a route. */
  readonly refusals: readonly ProviderOutcomeV1[];
  /** Active rate-limit refusals: advisory, never blocking. */
  readonly rateLimits: readonly ProviderOutcomeV1[];
}
export type ProviderRouteAdmissionV1 = {
  readonly route: string;
  /** Warnings from meters that bind this route. */
  readonly warnings: readonly ProviderLimitAdvisoryV1[];
  readonly rateLimits: readonly ProviderOutcomeV1[];
} & ({ readonly admitted: true; readonly refusal: null } | { readonly admitted: false; readonly refusal: ProviderOutcomeV1 });

function advise(meter: ProviderLimitMeterV1, now: number): ProviderLimitAdvisoryV1 {
  const age = meter.observedAt === null ? NaN : now - Date.parse(meter.observedAt);
  const stale = !Number.isFinite(age) || age < 0 ? null : age >= PROVIDER_LIMIT_VALIDITY_MS || (meter.resetsAt !== null && Date.parse(meter.resetsAt) <= now);
  // A key is measured against its own cap, never an account balance; a zero cap is fully used.
  const usedPercent = meter.scope !== "key" ? meter.usedPercent
    : meter.state === "unknown" || meter.limit === null || meter.remaining === null ? null
    : meter.limit === 0 ? 100 : Math.min(100, (meter.limit - meter.remaining) / meter.limit * 100);
  return { meter, usedPercent, stale, warning: meter.state === "known" && stale === false && usedPercent !== null && usedPercent >= PROVIDER_LIMIT_WARNING_PERCENT };
}

/** Assess every meter and outcome at `now` (epoch milliseconds). */
export function assessProviderLimits(snapshot: ProviderLimitSnapshotV1, now: number): ProviderLimitAssessmentV1 {
  // Latest success per scope, for any model and per model, so clearance is one lookup per refusal.
  const anyModel = new Map<string, number>(), perModel = new Map<string, number>();
  const scope = (o: ProviderOutcomeV1) => JSON.stringify([o.provider, o.keyName, o.accountRef]);
  const latest = (map: Map<string, number>, key: string, at: number) => map.set(key, Math.max(at, map.get(key) ?? -Infinity));
  for (const o of snapshot.outcomes) {
    if (o.outcome !== "succeeded") continue;
    const at = Date.parse(o.observedAt);
    latest(anyModel, scope(o), at);
    latest(perModel, JSON.stringify([scope(o), o.model]), at);
  }
  const active = snapshot.outcomes.filter(o => o.outcome === "refused" &&
    !(Date.parse(o.observedAt) < ((o.model === null ? anyModel.get(scope(o)) : perModel.get(JSON.stringify([scope(o), o.model]))) ?? -Infinity)));
  return { generatedAt: snapshot.generatedAt, meters: snapshot.meters.map(meter => advise(meter, now)),
    refusals: active.filter(o => o.reason !== "rate_limited"), rateLimits: active.filter(o => o.reason === "rate_limited") };
}

/** Whether a provider-qualified launch route (`opencode-go/fixture`, `openrouter/vendor/model`) is admitted. */
export function admitProviderRoute(assessment: ProviderLimitAssessmentV1, route: string): ProviderRouteAdmissionV1 {
  const bound = assessment.meters.filter(a => a.meter.launchModels.includes(route));
  const covers = (o: ProviderOutcomeV1) => route.startsWith(`${o.provider}/`) && (o.model === null || route === `${o.provider}/${o.model}`) &&
    ((o.keyName === null && o.accountRef === null) || bound.some(({ meter: m }) => m.provider === o.provider && m.keyName === o.keyName &&
      (m.accountRef === o.accountRef || (o.accountRef === null && o.keyName !== null))));
  const refusal = assessment.refusals.filter(covers).reduce<ProviderOutcomeV1 | null>((last, o) =>
    last === null || Date.parse(o.observedAt) > Date.parse(last.observedAt) ? o : last, null);
  const advice = { route, warnings: bound.filter(a => a.warning), rateLimits: assessment.rateLimits.filter(covers) };
  return refusal === null ? { ...advice, admitted: true, refusal: null } : { ...advice, admitted: false, refusal };
}
