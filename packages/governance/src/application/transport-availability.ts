/** The dispatcher's per-transport availability snapshot text, mapped through the published contract decoders. */
import { MATRIX_TRANSPORTS, SUBSCRIPTION_MATRIX_TRANSPORTS, TRANSPORT_UNAVAILABLE_REASONS, readOpenCodeProviderPools, readProviderBudgetDecisions, readTransportCapacity, type TransportAvailability,
  type TransportAvailabilityRow, type TransportUnavailableReason } from "@rickylabs/harness-contracts";
import { instant, object, SourceError, type Leg } from "../domain/source.js";

const exactly = (value: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new SourceError("shape-mismatch");
};
const iso = (value: unknown): string => new Date(Date.parse(instant(value))).toISOString();

/** Strict legacy subscription prefix or all transports, a reason exactly when unavailable. */
export function mapTransportAvailability(text: string): Leg<TransportAvailability> {
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return { ok: false, code: "non-json" }; }
  try {
    const input = object(payload);
    const hasPools = Object.hasOwn(input, "openCodeProviderPools");
    const hasBudgets = Object.hasOwn(input, "providerBudgets");
    const hasCapacity = Object.hasOwn(input, "transportCapacity");
    exactly(input, ["schemaVersion", "observedAt", "validUntil", "transports", ...(hasPools ? ["openCodeProviderPools"] : []), ...(hasBudgets ? ["providerBudgets"] : []), ...(hasCapacity ? ["transportCapacity"] : [])]);
    if (input.schemaVersion !== 1 || !Array.isArray(input.transports) || (input.transports.length !== SUBSCRIPTION_MATRIX_TRANSPORTS.length && input.transports.length !== MATRIX_TRANSPORTS.length))
      throw new SourceError("shape-mismatch");
    const observedAt = iso(input.observedAt), validUntil = iso(input.validUntil);
    const transports = input.transports.map((value, i): TransportAvailabilityRow => {
      const row = object(value);
      exactly(row, ["transport", "available", "reason"]);
      const transport = MATRIX_TRANSPORTS[i]!;
      if (row.transport !== transport || typeof row.available !== "boolean") throw new SourceError("shape-mismatch");
      if (row.available) {
        if (row.reason !== null) throw new SourceError("shape-mismatch");
        return { transport, available: true, reason: null };
      }
      if (transport === "opencode") {
        if (row.reason !== "no-capacity") throw new SourceError("shape-mismatch");
        return { transport, available: false, reason: "no-capacity" };
      }
      if (!TRANSPORT_UNAVAILABLE_REASONS.includes(row.reason as TransportUnavailableReason)) throw new SourceError("shape-mismatch");
      return { transport, available: false, reason: row.reason as TransportUnavailableReason };
    });
    const pools = hasPools ? readOpenCodeProviderPools(input.openCodeProviderPools) : undefined;
    if (pools === null || (pools !== undefined && (transports.length !== MATRIX_TRANSPORTS.length ||
        transports.at(-1)!.available !== pools.some(pool => pool.maxActive > pool.active)))) throw new SourceError("shape-mismatch");
    const budgets = hasBudgets ? readProviderBudgetDecisions(input.providerBudgets) : undefined;
    if (budgets === null || budgets?.some(r => r.observedAt !== observedAt || r.validUntil !== validUntil)) throw new SourceError("shape-mismatch");
    const capacity = hasCapacity ? readTransportCapacity(input.transportCapacity, transports) : undefined;
    if (capacity === null) throw new SourceError("shape-mismatch");
    return { ok: true, value: { observedAt, validUntil, transports, ...(pools === undefined ? {} : { openCodeProviderPools: pools }),
      ...(budgets === undefined ? {} : { providerBudgets: budgets }), ...(capacity === undefined ? {} : { transportCapacity: capacity }) }, observedAt, validUntil };
  } catch { return { ok: false, code: "shape-mismatch" }; }
}
