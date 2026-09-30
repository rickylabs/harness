/** Codex app-server read-only quota transport. No thread, turn, login or prompt method exists here. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHmac } from "node:crypto";
import { homedir } from "node:os";
import type { AccountQuotaSnapshot, UsageAccountRef, UsageReason, UsageVendor } from "@rickylabs/harness-contracts";
import { isoFromUnixSeconds } from "./backfill/codex.js";

export function opaqueUsageRef(kind: "sref", vendor: UsageVendor, identity: string, key: Uint8Array): `sref:v1:${UsageVendor}:${string}`;
export function opaqueUsageRef(kind: "aref", vendor: UsageVendor, identity: string, key: Uint8Array): UsageAccountRef;
export function opaqueUsageRef(kind: "sref" | "aref", vendor: UsageVendor, identity: string, key: Uint8Array): `sref:v1:${UsageVendor}:${string}` | UsageAccountRef {
  if (key.byteLength < 32 || identity.length === 0) throw new Error("usage identity unavailable");
  const digest = createHmac("sha256", key).update(JSON.stringify(["usage-ref", 1, kind, vendor, identity])).digest("base64url");
  return `${kind}:v1:${vendor}:${digest}`;
}
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const label = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
export function unavailableQuota(vendor: UsageVendor, reason: UsageReason): AccountQuotaSnapshot[] {
  return (["5h", "weekly"] as const).map(window => ({ vendor, window, accountRef: null, limitId: null,
    usedPercent: null, resetsAt: null, observedAt: null, observedBy: null, source: "unavailable", availability: "unavailable", reason }));
}

/** Map only measured fields and exact vendor durations. No guessed window or account identity. */
export function codexAccountQuota(result: unknown, observedAt: string, key: Uint8Array): readonly AccountQuotaSnapshot[] {
  const root = object(result);
  if (root === null) return unavailableQuota("codex", "shape-mismatch");
  const accountRef = typeof root["accountId"] === "string" && root["accountId"].length > 0
    ? opaqueUsageRef("aref", "codex", root["accountId"], key) : null;
  const buckets = object(root["rateLimitsByLimitId"]);
  const candidates = buckets === null || Object.keys(buckets).length === 0 ? [root["rateLimits"]] : Object.values(buckets);
  if (candidates.length > 32) return unavailableQuota("codex", "oversize");
  const rows = new Map<string, AccountQuotaSnapshot>();
  for (const value of candidates) {
    const bucket = object(value);
    if (bucket === null) continue;
    const limitId = label(bucket["limitId"]) ? bucket["limitId"] : null;
    for (const name of ["primary", "secondary"]) {
      const reading = object(bucket[name]);
      if (reading === null) continue;
      const mins = reading["windowDurationMins"];
      const window = mins === 300 ? "5h" : mins === 10080 ? "weekly" : null;
      if (window === null) continue;
      const n = reading["usedPercent"];
      const usedPercent = typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
      const resetsAt = isoFromUnixSeconds(reading["resetsAt"]);
      const complete = usedPercent !== null && resetsAt !== null;
      const row: AccountQuotaSnapshot = { vendor: "codex", accountRef, limitId, window, usedPercent, resetsAt,
        observedAt, observedBy: null, source: "account-poll", availability: complete ? "available" : "partial", reason: complete ? null : "shape-mismatch" };
      const id = JSON.stringify([limitId, window]);
      if (rows.has(id)) return unavailableQuota("codex", "shape-mismatch");
      rows.set(id, row);
    }
  }
  return rows.size === 0 ? unavailableQuota("codex", "no-reading") : [...rows.values()];
}

export interface QuotaPollOptions {
  readonly bin: string;
  readonly codexHome?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /** Owned deterministic test seam; never exposed by a CLI flag or descriptor. */
  readonly spawn?: (bin: string, args: readonly string[], env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;
}
export type QuotaPollResult = { readonly ok: true; readonly result: unknown } |
  { readonly ok: false; readonly reason: "request-failed" | "timeout" | "oversize" | "shape-mismatch" };

export async function pollCodexAccountQuota(options: QuotaPollOptions): Promise<QuotaPollResult> {
  return await new Promise(resolve => {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: homedir(),
      ...(options.codexHome === undefined ? {} : { CODEX_HOME: options.codexHome }) };
    let child: ChildProcessWithoutNullStreams;
    try { child = options.spawn?.(options.bin, ["app-server", "--listen", "stdio://"], env) ??
      spawn(options.bin, ["app-server", "--listen", "stdio://"], { env, cwd: homedir(), stdio: "pipe" }); }
    catch { resolve({ ok: false, reason: "request-failed" }); return; }
    let settled = false, bytes = 0, pending = "", stage = 1;
    const finish = (result: QuotaPollResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill("SIGTERM");
      const kill = setTimeout(() => { child.kill("SIGKILL"); }, 1000);
      kill.unref();
      child.once("close", () => clearTimeout(kill));
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), options.timeoutMs ?? 15000);
    const send = (request: Record<string, unknown>): void => { child.stdin.write(`${JSON.stringify(request)}\n`); };
    child.on("error", () => finish({ ok: false, reason: "request-failed" }));
    child.on("close", () => finish({ ok: false, reason: "request-failed" }));
    child.stdin.on("error", () => finish({ ok: false, reason: "request-failed" }));
    // Stderr is drained and counted, never reflected into a public diagnostic.
    child.stderr.on("data", (data: Buffer) => {
      bytes += data.byteLength;
      if (bytes > (options.maxBytes ?? 1024 * 1024)) finish({ ok: false, reason: "oversize" });
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(data);
      if (bytes > (options.maxBytes ?? 1024 * 1024)) { finish({ ok: false, reason: "oversize" }); return; }
      pending += data;
      let end: number;
      while (!settled && (end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        let message: Record<string, unknown> | null;
        try { message = object(JSON.parse(line)); } catch { finish({ ok: false, reason: "shape-mismatch" }); return; }
        if (!message) { finish({ ok: false, reason: "shape-mismatch" }); return; }
        if (message["id"] === undefined) continue; // Native notifications, never requests to execute.
        if (message["id"] !== stage || message["error"] !== undefined || !Object.hasOwn(message, "result")) {
          finish({ ok: false, reason: "request-failed" }); return;
        }
        if (stage === 1) {
          stage = 2;
          send({ method: "initialized" });
          send({ id: 2, method: "account/read", params: { refreshToken: false } });
        } else if (stage === 2) {
          stage = 3;
          send({ id: 3, method: "account/rateLimits/read", params: { excludeResetCreditDetails: true } });
        } else finish({ ok: true, result: message["result"] });
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "harness_quota_reader", version: "1.0.0" } } });
  });
}
