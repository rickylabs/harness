/**
 * The dispatcher's per-transport availability (Orchid divybot, transport_availability.go): which
 * matrix transports its admission would offer now, and why each other one is out. The snapshot is
 * private: an owner-only regular file, never a link, read whole under a small bound.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { MATRIX_TRANSPORTS, SUBSCRIPTION_MATRIX_TRANSPORTS, TRANSPORT_UNAVAILABLE_REASONS, readOpenCodeProviderPools, readProviderBudgetDecisions, type TransportAvailability,
  type TransportAvailabilityRow, type TransportUnavailableReason } from "@rickylabs/harness-contracts";
import { instant, object, SourceError, type Leg } from "../source.js";

const MAX_BYTES = 512 * 1024;

export async function readTransportAvailabilityFile(path: string): Promise<string> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { throw new SourceError("file-unreadable"); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== process.getuid?.()) throw new SourceError("file-unreadable");
    if (stat.size > MAX_BYTES) throw new SourceError("oversize");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size) throw new SourceError("file-unreadable");
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally { await handle.close(); }
}

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
    exactly(input, ["schemaVersion", "observedAt", "validUntil", "transports", ...(hasPools ? ["openCodeProviderPools"] : []), ...(hasBudgets ? ["providerBudgets"] : [])]);
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
    return { ok: true, value: { observedAt, validUntil, transports, ...(pools === undefined ? {} : { openCodeProviderPools: pools }),
      ...(budgets === undefined ? {} : { providerBudgets: budgets }) }, observedAt, validUntil };
  } catch { return { ok: false, code: "shape-mismatch" }; }
}
