/** Explicitly enrolled OpenCode database, never a home scan or provider request. */
import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import type { DatabaseSync as SQLiteDatabase } from "node:sqlite";
import { paidQuantityFromNano, paidQuantityNano, type ProviderHistoryRow } from "@rickylabs/harness-contracts";
import { providerAccountRef, providerDecimal, type ProviderUsageSource } from "./provider-usage.js";

const MAX_ROWS = 50_000, MAX_ROW_BYTES = 1024 * 1024, MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
type HistorySource = NonNullable<ProviderUsageSource["openCode"]>;
export async function readOpenCodeHistory(source: HistorySource, key: Uint8Array, now: string):
  Promise<{ readonly rows: readonly ProviderHistoryRow[]; readonly complete: boolean }> {
  let handle; let database: SQLiteDatabase | undefined;
  try {
    if (source.from >= now || !source.versions.length) throw new Error("unreadable history");
    handle = await open(source.databaseFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== process.getuid?.() || before.size > 256 * 1024 * 1024) throw new Error("unreadable history");
    // Pin the already-open inode. Node's read-only SQLite connection may not create a journal.
    const { DatabaseSync } = await import("node:sqlite");
    database = new DatabaseSync(`/proc/self/fd/${handle.fd}`, { readOnly: true, timeout: 1000 });
    database.exec("PRAGMA query_only=ON");
    database.exec("BEGIN");
    const query = database.prepare("SELECT m.id, m.data, s.version FROM message m LEFT JOIN session s ON s.id=m.session_id WHERE m.time_created>=? AND m.time_created<? ORDER BY m.id LIMIT ?");
    const groups = new Map<string, { provider: string; model: string; identity: string; messages: number; cost: bigint; tokens: number[]; tokensPartial: boolean; costPartial: boolean }>();
    const seen = new Set<string>(); let bytes = 0, scanned = 0, complete = true;
    for (const row of query.iterate(Date.parse(source.from), Date.parse(now), MAX_ROWS + 1)) {
      if (++scanned > MAX_ROWS || typeof row["id"] !== "string" || typeof row["data"] !== "string" || seen.has(row["id"])) throw new Error("bounded history");
      seen.add(row["id"]);
      bytes += Buffer.byteLength(row["data"]);
      if (Buffer.byteLength(row["data"]) > MAX_ROW_BYTES || bytes > MAX_TOTAL_BYTES) throw new Error("bounded history");
      const d = JSON.parse(row["data"]) as Record<string, unknown>;
      if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("invalid history");
      if (d["role"] !== "assistant") continue;
      const binding = source.providers.find(p => p.provider === d["providerID"]);
      if (!binding) continue;
      if (typeof d["modelID"] !== "string" || d["modelID"].length > 256 || !/^~?[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(d["modelID"])) throw new Error("invalid history identity");
      const id = JSON.stringify([binding.provider, d["modelID"]]);
      const group = groups.get(id) ?? { provider: binding.provider, model: d["modelID"], identity: binding.accountIdentity, messages: 0, cost: 0n, tokens: [0, 0, 0, 0, 0], tokensPartial: false, costPartial: false };
      group.messages++;
      const t = d["tokens"] as Record<string, unknown> | undefined, cache = t?.["cache"] as Record<string, unknown> | undefined;
      const tokens = [t?.["input"], t?.["output"], t?.["reasoning"], cache?.["read"], cache?.["write"]];
      const cost = providerDecimal(d["cost"]);
      if (typeof row["version"] !== "string" || !source.versions.includes(row["version"]) || tokens.some(t => !count(t))) {
        group.tokensPartial = true; complete = false;
      } else {
        for (let i = 0; i < tokens.length; i++) group.tokens[i] = group.tokens[i]! + (tokens[i] as number);
        if (group.tokens.some(t => !count(t))) throw new Error("history sum bound");
      }
      if (cost === null) { group.costPartial = true; complete = false; }
      else { group.cost += paidQuantityNano(cost)!; if (paidQuantityFromNano(group.cost) === null) throw new Error("history cost bound"); }
      groups.set(id, group);
      if (groups.size > 1024) throw new Error("history group bound");
    }
    const after = await handle.stat(), named = await lstat(source.databaseFile);
    if (!named.isFile() || named.dev !== before.dev || named.ino !== before.ino || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("changed history");
    const rows = [...groups.values()].map((g): ProviderHistoryRow => {
      const [input, output, reasoning, cacheRead, cacheWrite] = g.tokens as [number, number, number, number, number];
      const prompt = input + cacheRead + cacheWrite;
      if (!count(prompt)) throw new Error("history prompt bound");
      return { provider: g.provider, model: g.model, accountRef: providerAccountRef(g.provider, g.identity, key),
        from: source.from, through: now, observedAt: now, messages: g.messages, costSource: "local-reported",
        costUsd: g.costPartial ? null : paidQuantityFromNano(g.cost),
        tokens: g.tokensPartial ? { input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null } : { input, output, reasoning, cacheRead, cacheWrite },
        cacheHitRate: g.tokensPartial || prompt === 0 ? null : cacheRead / prompt,
        coverage: g.tokensPartial || g.costPartial ? "partial" : "complete",
        reason: g.tokensPartial ? "unsupported-token-schema" : g.costPartial ? "partial-history" : null };
    });
    return { rows, complete };
  } catch { return { rows: [], complete: false }; }
  finally { try { database?.close(); } catch { /* The read-only connection holds no write or billing authority. */ } await handle?.close().catch(() => {}); }
}
