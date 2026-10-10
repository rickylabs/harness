/** Public usage projection from explicitly configured private native stores. */
import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { readAccountUsageEnvelope, sessionProcessedTokens, type AccountUsageEnvelope, type AccountQuotaSnapshot,
  type SessionUsage, type UnattributedUsage, type UsageCoverage, type UsageVendor } from "@rickylabs/harness-contracts";
import { backfillFromDisk } from "./backfill/index.js";
import { opaqueUsageRef, codexAccountQuota, pollCodexAccountQuota, unavailableQuota, type QuotaPollResult } from "./account-quota.js";
import type { RunRecord } from "./model.js";

export interface UsageStore {
  readonly vendor: UsageVendor; readonly seat: string; readonly cwdLabel: string; readonly root: string;
  /** Explicit operator binding; null keeps historical account membership unknown. */
  readonly accountIdentity: string | null;
}
export interface AccountUsageSource {
  readonly schemaVersion: 1; readonly keyFile: string; readonly stores: readonly UsageStore[];
  readonly codex: { readonly bin: string; readonly home: string | null } | null;
  /** Private restart state; never part of the public envelope. */
  readonly stateFile: string;
}
const safeLabel = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const safePath = (v: unknown): v is string => typeof v === "string" && v.length < 4096 && isAbsolute(v) && !/[\x00-\x1f\x7f]/.test(v);
const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
function fields(o: Record<string, unknown>, keys: string): boolean { return Object.keys(o).sort().join(" ") === keys.split(" ").sort().join(" "); }

/** Bound files before allocation and refuse symlinks/non-regular files. */
export async function usageFile(path: string, cap: number, secret = false): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > cap || (secret && ((before.mode & 0o7777) !== 0o600 || before.uid !== process.getuid?.()))) throw new Error("usage file unavailable");
    const bytes = Buffer.alloc(Math.min(cap + 1, before.size + 1));
    let length = 0;
    while (length < bytes.length) {
      const row = await file.read(bytes, length, bytes.length - length, null);
      if (row.bytesRead === 0) break;
      length += row.bytesRead;
    }
    const after = await file.stat();
    if (length !== before.size || length > cap || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("usage file changed");
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}
export function readAccountUsageSource(input: unknown): AccountUsageSource {
  const r = obj(input);
  if (!r || !fields(r, "schemaVersion keyFile stores codex stateFile") || r["schemaVersion"] !== 1 ||
      !safePath(r["keyFile"]) || !safePath(r["stateFile"]) || r["keyFile"] === r["stateFile"] ||
      !Array.isArray(r["stores"]) || r["stores"].length > 16) throw new Error("invalid usage descriptor");
  const stores = r["stores"].map((value: unknown): UsageStore => {
    const s = obj(value);
    if (!s || !fields(s, "vendor seat cwdLabel root accountIdentity") || (s["vendor"] !== "codex" && s["vendor"] !== "claude") ||
        !safeLabel(s["seat"]) || !safeLabel(s["cwdLabel"]) || !safePath(s["root"]) ||
        !(s["accountIdentity"] === null || (typeof s["accountIdentity"] === "string" && s["accountIdentity"].length > 0 && s["accountIdentity"].length <= 1024))) throw new Error("invalid usage descriptor");
    return { vendor: s["vendor"], seat: s["seat"], cwdLabel: s["cwdLabel"], root: s["root"], accountIdentity: s["accountIdentity"] };
  });
  if (new Set(stores.map(s => JSON.stringify([s.vendor, s.root]))).size !== stores.length ||
      new Set(stores.map(s => JSON.stringify([s.vendor, s.seat, s.cwdLabel]))).size !== stores.length) throw new Error("duplicate usage store");
  let codex: AccountUsageSource["codex"] = null;
  if (r["codex"] !== null) {
    const c = obj(r["codex"]);
    if (!c || !fields(c, "bin home") || !safePath(c["bin"]) || !(c["home"] === null || safePath(c["home"]))) throw new Error("invalid usage descriptor");
    codex = { bin: c["bin"], home: c["home"] };
  }
  return { schemaVersion: 1, keyFile: r["keyFile"], stateFile: r["stateFile"], stores, codex };
}
export function usageScopeHash(source: AccountUsageSource, key: Uint8Array): string {
  return createHash("sha256").update(JSON.stringify(source)).update(key).digest("hex");
}
const instant = (v: string): boolean => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const count = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
export function sessionUsage(run: RunRecord, store: UsageStore, key: Uint8Array): SessionUsage | null {
  if (run.source !== store.vendor || !instant(run.startedAt) || !instant(run.updatedAt) || run.startedAt > run.updatedAt) return null;
  const end = run.terminalAt ?? run.turnEndedAt ?? null;
  const tokens = { input: count(run.usage.inputTokens), cached: count(run.usage.cacheReadTokens),
    cacheWrite: count(run.usage.cacheWriteTokens), output: count(run.usage.outputTokens), reasoning: count(run.usage.reasoningTokens) };
  const result: SessionUsage = { vendor: store.vendor, sessionRef: opaqueUsageRef("sref", store.vendor, run.id, key),
    seat: store.seat, cwdLabel: store.cwdLabel, model: safeLabel(run.identity.model) ? run.identity.model : null,
    effort: safeLabel(run.identity.effort) ? run.identity.effort : null, startedAt: run.startedAt,
    endedAt: end !== null && instant(end) && end >= run.startedAt && end <= run.updatedAt ? end : null,
    observedAt: run.updatedAt, tokens, inputIncludesCached: store.vendor === "codex", availability: "partial", reason: "incomplete-tokens" };
  return sessionProcessedTokens(result) === null ? result : { ...result, availability: "available", reason: null };
}
export function storedQuota(run: RunRecord, store: UsageStore, key: Uint8Array): AccountQuotaSnapshot[] {
  return run.quota.flatMap(reading => {
    const window = reading.windowMinutes === 300 ? "5h" : reading.windowMinutes === 10080 ? "weekly" : null;
    if (window === null || !instant(reading.observedAt)) return [];
    const p = reading.usedPercent;
    const usedPercent = p !== null && Number.isFinite(p) && p >= 0 && p <= 100 ? p : null;
    const resetsAt = reading.resetsAt !== null && instant(reading.resetsAt) ? reading.resetsAt : null;
    const complete = usedPercent !== null && resetsAt !== null;
    return [{ vendor: store.vendor, window, accountRef: store.accountIdentity === null ? null : opaqueUsageRef("aref", store.vendor, store.accountIdentity, key),
      limitId: safeLabel(reading.limitId) ? reading.limitId : null, usedPercent, resetsAt, observedAt: reading.observedAt,
      observedBy: opaqueUsageRef("sref", store.vendor, run.id, key), source: "session" as const,
      availability: complete ? "available" as const : "partial" as const, reason: complete ? null : "shape-mismatch" as const }];
  });
}
const quotaKey = (q: AccountQuotaSnapshot): string => JSON.stringify([q.vendor, q.accountRef, q.limitId, q.window]);

/** Inferred percentage deltas need a proven quiet span in the same account, meter and reset epoch. */
export function inferUnattributedUsage(previous: AccountUsageEnvelope, current: AccountUsageEnvelope): UnattributedUsage[] {
  const output: UnattributedUsage[] = [];
  for (const q of current.quota) {
    if (q.availability !== "available" || q.accountRef === null || q.limitId === null || q.observedAt === null || q.usedPercent === null || q.resetsAt === null) continue;
    const matches = previous.quota.filter(p => quotaKey(p) === quotaKey(q));
    if (matches.length !== 1) continue;
    const p = matches[0]!;
    if (p.availability !== "available" || p.observedAt === null || p.usedPercent === null || p.resetsAt !== q.resetsAt ||
        p.observedAt >= q.observedAt || q.observedAt >= q.resetsAt || q.usedPercent <= p.usedPercent) continue;
    const coverage = current.coverage.find(c => c.vendor === q.vendor);
    const priorCoverage = previous.coverage.find(c => c.vendor === q.vendor);
    if (!coverage || !priorCoverage || priorCoverage.state !== "complete" || coverage.state !== "complete" ||
        coverage.from > p.observedAt || coverage.through < q.observedAt) continue;
    // A terminal record is required to prove an older session was idle. Last-seen time is not an end.
    const from = p.observedAt, to = q.observedAt;
    const active = [...previous.sessions, ...current.sessions].some(s => s.vendor === q.vendor &&
      s.startedAt <= to && (s.endedAt === null || s.endedAt > from));
    if (active) continue;
    output.push({ kind: "unattributed", vendor: q.vendor, accountRef: q.accountRef, limitId: q.limitId,
      window: q.window, from: p.observedAt, to: q.observedAt, usedPercentDelta: q.usedPercent - p.usedPercent,
      inferred: true, reason: "no_observed_session_activity" });
  }
  return output;
}

export interface UsageCollectOptions {
  readonly now?: () => string;
  readonly poll?: () => Promise<QuotaPollResult>;
  /** Only pass a prior envelope after validating the private descriptor/key scope hash. */
  readonly previous?: AccountUsageEnvelope;
}
/** This collection's own direct Codex read; a carried-over earlier reading never stands in for it. */
export interface CodexPollRead {
  readonly attemptedAt: string;
  readonly reason: "no-reading" | "request-failed" | "timeout" | "oversize" | "shape-mismatch" | null;
}
export async function collectAccountUsage(source: AccountUsageSource, key: Uint8Array, options: UsageCollectOptions = {}): Promise<AccountUsageEnvelope> {
  return (await collectAccountUsageReads(source, key, options)).envelope;
}
export async function collectAccountUsageReads(source: AccountUsageSource, key: Uint8Array, options: UsageCollectOptions = {}):
  Promise<{ readonly envelope: AccountUsageEnvelope; readonly codexPoll: CodexPollRead | null }> {
  const now = options.now ?? (() => new Date().toISOString());
  const direct = source.codex === null ? null : await (options.poll?.() ?? pollCodexAccountQuota({ bin: source.codex.bin,
    ...(source.codex.home === null ? {} : { codexHome: source.codex.home }) }));
  const capturedAt = now();
  const polled = direct === null ? null : direct.ok ? codexAccountQuota(direct.result, capturedAt, key) : unavailableQuota("codex", direct.reason);
  const quota: AccountQuotaSnapshot[] = [...(options.previous?.quota.filter(q => q.source !== "unavailable") ?? []), ...(polled ?? [])];
  const sessions: SessionUsage[] = [], coverage: UsageCoverage[] = [];
  for (const vendor of ["codex", "claude"] as const) {
    const stores = source.stores.filter(s => s.vendor === vendor);
    let complete = stores.length > 0;
    for (const store of stores) {
      try {
        if (!(await stat(store.root)).isDirectory()) { complete = false; continue; }
        const result = await backfillFromDisk(vendor === "codex" ? { codexSessions: store.root } : { claudeProjects: store.root },
          { limit: 500, maxDirectoryEntries: 10000, maxTranscriptBytes: 32 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024, notAfterMs: Date.parse(capturedAt) });
        if (result.degraded || result.notes.some(n => n.includes("carried no session identity"))) complete = false;
        for (const run of result.runs) {
          const row = sessionUsage(run, store, key);
          if (row === null || row.observedAt > capturedAt) { complete = false; continue; }
          sessions.push(row);
          quota.push(...storedQuota(run, store, key));
        }
      } catch { complete = false; }
    }
    if (sessions.filter(s => s.vendor === vendor).length > 1000) complete = false;
    const prior = options.previous?.coverage.find(c => c.vendor === vendor);
    coverage.push({ vendor, from: prior?.state === "complete" && prior.through <= capturedAt ? prior.through : capturedAt,
      through: capturedAt, state: stores.length === 0 ? "unavailable" : complete ? "complete" : "partial",
      reason: stores.length === 0 ? "not-configured" : complete ? null : "partial-scan" });
  }
  const latest = new Map<string, AccountQuotaSnapshot>();
  for (const q of quota) {
    if (q.observedAt !== null && q.observedAt > capturedAt) continue;
    const prior = latest.get(quotaKey(q));
    if (!prior || (q.observedAt ?? "") > (prior.observedAt ?? "")) latest.set(quotaKey(q), q);
  }
  for (const vendor of ["codex", "claude"] as const) {
    for (const window of ["5h", "weekly"] as const) {
      const known = [...latest.values()].some(q => q.vendor === vendor && q.window === window && q.source !== "unavailable");
      if (known) {
        for (const [id, q] of latest) if (q.vendor === vendor && q.window === window && q.source === "unavailable") latest.delete(id);
      } else if (![...latest.values()].some(q => q.vendor === vendor && q.window === window)) {
        const q = unavailableQuota(vendor, vendor === "claude" ? "direct-read-unsupported" : "no-reading").find(q => q.window === window)!;
        latest.set(quotaKey(q), q);
      }
    }
  }
  const unique = new Map<string, SessionUsage>();
  for (const s of sessions) {
    if (unique.has(s.sessionRef)) {
      const c = coverage.find(c => c.vendor === s.vendor)!;
      coverage[coverage.indexOf(c)] = { ...c, state: "partial", reason: "partial-scan" };
    }
    unique.set(s.sessionRef, s);
  }
  const counts = { codex: 0, claude: 0 };
  const envelope: AccountUsageEnvelope = { schemaVersion: 1, generatedAt: now(), quota: [...latest.values()].sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? "")).slice(0, 64),
    sessions: [...unique.values()].filter(s => ++counts[s.vendor] <= 1000),
    unattributed: [], coverage };
  const inferred = options.previous === undefined ? [] : inferUnattributedUsage(options.previous, envelope);
  const result = readAccountUsageEnvelope({ ...envelope, unattributed: [...(options.previous?.unattributed ?? []), ...inferred].slice(-1000) });
  if (!result.ok) throw new Error("usage document unavailable");
  // A poll that answered but measured no percentage is a failed read: keep the parser's reason.
  const measured = polled?.some(q => q.source === "account-poll" && q.usedPercent !== null) ?? false;
  const codexPoll = polled === null ? null : { attemptedAt: capturedAt,
    reason: measured ? null : (polled.find(q => q.reason !== null)?.reason ?? "no-reading") as CodexPollRead["reason"] };
  return { envelope: result.envelope, codexPoll };
}
