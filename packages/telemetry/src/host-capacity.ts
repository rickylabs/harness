/** A bounded, local-only RAM and AMD VRAM reading. No remote host is queried. */
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { ISSUE_AGENT_TREE_FRESH_MS, unavailableAgentCost,
  type AgentCost, type AgentUnavailableReason } from "@rickylabs/harness-contracts";

export interface HostCapacityReading {
  readonly host: string | null;
  readonly cost: AgentCost["localCapacity"];
}

/** Filesystem overrides exist only for synthetic tests; production uses fixed kernel paths. */
export interface HostCapacitySource {
  readonly meminfoPath?: string;
  readonly drmRoot?: string;
}

export const HOST_CAPACITY_PLACEMENT_HOST = "DSH_TELEMETRY_PLACEMENT_HOST";
const shortName = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
const unavailable = (host: string | null, reason: AgentUnavailableReason): HostCapacityReading =>
  ({ host, cost: unavailableAgentCost(reason).localCapacity });
const integer = (raw: string): number | null => {
  if (!/^\d+\s*$/.test(raw)) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : null;
};
function meminfoBytes(raw: string, key: "MemTotal" | "MemAvailable"): number | null {
  const lines = raw.split("\n").filter(line => line.startsWith(key + ":"));
  if (lines.length !== 1) return null;
  const match = new RegExp(`^${key}:\\s*(\\d+)\\s+kB\\s*$`).exec(lines[0]!);
  const kib = match ? integer(match[1]!) : null;
  if (kib === null || kib > Math.floor(Number.MAX_SAFE_INTEGER / 1024)) return null;
  return kib * 1024;
}

/** All cardN pairs must be present and sane; a missing GPU is never a measured zero. */
export async function readLocalHostCapacity(capturedAt: string, configuredHost: string | undefined,
  source: HostCapacitySource = {}): Promise<HostCapacityReading> {
  if (configuredHost === undefined || configuredHost === "") return unavailable(null, "host_identity_unset");
  const host = configuredHost;
  if (!shortName.test(host) || !Number.isFinite(Date.parse(capturedAt)) ||
      new Date(capturedAt).toISOString() !== capturedAt) return unavailable(null, "binding_invalid");
  const meminfoPath = source.meminfoPath ?? "/proc/meminfo";
  const drmRoot = source.drmRoot ?? "/sys/class/drm";
  let memory: string;
  try { memory = await readFile(meminfoPath, "utf8"); }
  catch { return unavailable(host, "source_unavailable"); }
  if (memory.length > 65_536) return unavailable(host, "source_incomplete");
  const ramTotalBytes = meminfoBytes(memory, "MemTotal");
  const ramAvailableBytes = meminfoBytes(memory, "MemAvailable");
  if (ramTotalBytes === null || ramAvailableBytes === null || ramTotalBytes === 0 || ramAvailableBytes > ramTotalBytes) {
    return unavailable(host, "source_incomplete");
  }
  let cards: string[];
  try { cards = (await readdir(drmRoot)).filter(name => /^card\d+$/.test(name)).sort(); }
  catch { return unavailable(host, "source_unavailable"); }
  if (cards.length === 0) return unavailable(host, "measurement_missing");
  if (cards.length > 16) return unavailable(host, "source_incomplete");
  let vramUsedBytes = 0, vramTotalBytes = 0;
  const cardMeasurements: { card: string; vramUsedBytes: number; vramTotalBytes: number }[] = [];
  for (const card of cards) {
    let usedRaw: string, totalRaw: string;
    try {
      if (basename(await realpath(join(drmRoot, card, "device", "driver"))) !== "amdgpu") {
        return unavailable(host, "source_incomplete");
      }
      [usedRaw, totalRaw] = await Promise.all([
        readFile(join(drmRoot, card, "device", "mem_info_vram_used"), "utf8"),
        readFile(join(drmRoot, card, "device", "mem_info_vram_total"), "utf8"),
      ]);
    } catch { return unavailable(host, "source_unavailable"); }
    if (usedRaw.length > 128 || totalRaw.length > 128) return unavailable(host, "source_incomplete");
    const used = integer(usedRaw), total = integer(totalRaw);
    if (used === null || total === null || total === 0 || used > total ||
        !Number.isSafeInteger(vramUsedBytes + used) || !Number.isSafeInteger(vramTotalBytes + total)) {
      return unavailable(host, "source_incomplete");
    }
    vramUsedBytes += used;
    vramTotalBytes += total;
    cardMeasurements.push({ card, vramUsedBytes: used, vramTotalBytes: total });
  }
  const measurement = { host, ramUsedBytes: ramTotalBytes - ramAvailableBytes, ramTotalBytes,
    vramUsedBytes, vramTotalBytes, cards: cardMeasurements };
  const validUntil = new Date(Date.parse(capturedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString();
  const revision = createHash("sha256").update(JSON.stringify({ capturedAt, measurement })).digest("hex");
  return { host, cost: { ...unavailableAgentCost().localCapacity, availability: "available", measurement,
    reason: null, observedAt: capturedAt, validUntil, revision } };
}
