/** A provider-limit snapshot's text, decoded through the published contract; a snapshot generated after `now` is refused. */
import { readProviderLimitSnapshot, type ProviderLimitSnapshotV1 } from "@rickylabs/harness-contracts";

export function decodeProviderLimits(text: string, now: number): ProviderLimitSnapshotV1 | null {
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return null; }
  const decoded = readProviderLimitSnapshot(payload);
  return decoded.ok && Date.parse(decoded.snapshot.generatedAt) <= now ? decoded.snapshot : null;
}
