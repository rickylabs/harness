/** Read-only Orchid native run lookup. Private IDs stay inside the host boundary. */
import { createConnection } from "node:net";
import { isAbsolute } from "node:path";
export const NATIVE_RUN_BATCH_LIMIT = 128;
const FRAME_BYTES = 1_048_576;
/** Recorded Orchid tokens; preserve the full token and label on the native wire. */
const NATIVE_RUN_AGENTS = ["codex", "codex-run", "claude", "agy", "opencode", "opencode-run"] as const;
export interface NativeRunQuery { readonly key: string; readonly label: string }
export interface NativeRunRecord {
  readonly key: string;
  readonly issue: { readonly repo: string; readonly number: number };
  readonly dispatchKey: string;
  readonly nativeSessionId: string;
  readonly agent: string;
  readonly label: string;
  readonly phase: "active" | "completed";
  readonly observedAt: string;
}
export interface NativeRunLookup {
  readonly complete: boolean;
  readonly generation: string;
  readonly revision: number;
  readonly records: readonly NativeRunRecord[];
  readonly missing: readonly { readonly key: string; readonly reason: string }[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && Buffer.byteLength(value) <= 512 && !/[\x00-\x20\x7f]/.test(value);
const reasons = new Set(["run_not_found", "binding_unavailable", "identity_mismatch", "native_identity_unavailable", "source_unavailable"]);
/** Validate that every queried coordinate has exactly one native result, never a partial success. */
export function decodeNativeRunLookup(value: unknown, queries: readonly NativeRunQuery[]): NativeRunLookup {
  if (!object(value) || value.type !== "run_lookup" || value.schemaVersion !== 1 ||
      typeof value.complete !== "boolean" || !identity(value.generation) ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
      !Array.isArray(value.records) || !Array.isArray(value.missing) ||
      value.records.length + value.missing.length !== queries.length) throw Error("native run source unavailable");
  const expected = new Map(queries.map(q => [q.key, q.label]));
  for (const row of value.records) {
    if (!object(row) || typeof row.key !== "string" || !expected.has(row.key) ||
        !object(row.issue) || typeof row.issue.repo !== "string" || row.issue.repo.length > 256 ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(row.issue.repo) ||
        !Number.isSafeInteger(row.issue.number) || (row.issue.number as number) < 1 ||
        typeof row.dispatchKey !== "string" || !/^[a-f0-9]{64}$/.test(row.dispatchKey) ||
        !identity(row.nativeSessionId) || (row.phase !== "active" && row.phase !== "completed") ||
        typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt)) ||
        !(row.phase === "completed" && row.agent === "" && row.label === "" ||
          typeof row.agent === "string" && row.label === expected.get(row.key) && row.label === row.agent + "-" + row.key)) {
      throw Error("native run source unavailable");
    }
    expected.delete(row.key);
  }
  for (const row of value.missing) {
    if (!object(row) || typeof row.key !== "string" || !expected.has(row.key) ||
        typeof row.reason !== "string" || !reasons.has(row.reason)) throw Error("native run source unavailable");
    expected.delete(row.key);
  }
  if (expected.size || value.complete === false && value.records.length) throw Error("native run source unavailable");
  return value as unknown as NativeRunLookup;
}
/** Fixed method and bounded packet; this client cannot send any coordinator action. */
export async function lookupOrchidNativeRuns(socket: string | undefined, queries: readonly NativeRunQuery[]): Promise<NativeRunLookup> {
  if (!socket || !isAbsolute(socket) || queries.length > NATIVE_RUN_BATCH_LIMIT ||
      new Set(queries.map(q => q.key)).size !== queries.length || queries.some(q =>
        !/^[1-9][0-9]{0,15}$/.test(q.key) || !Number.isSafeInteger(Number(q.key)) ||
        !NATIVE_RUN_AGENTS.some(agent => q.label === agent + "-" + q.key))) {
    throw Error("native run source unavailable");
  }
  return await new Promise((resolve, reject) => {
    const conn = createConnection(socket);
    let bytes = Buffer.alloc(0), settled = false;
    const finish = (value?: NativeRunLookup) => {
      if (settled) return; settled = true; conn.destroy();
      value ? resolve(value) : reject(Error("native run source unavailable"));
    };
    conn.setTimeout(5000, () => finish());
    conn.once("error", () => finish()); conn.once("end", () => finish());
    conn.once("connect", () => conn.write(JSON.stringify({ id: "native-runs", method: "run.lookup", params: { keys: queries } }) + "\n"));
    conn.on("data", (chunk: Buffer) => {
      if (bytes.length + chunk.length > FRAME_BYTES) { finish(); return; }
      bytes = Buffer.concat([bytes, chunk]);
      const newline = bytes.indexOf(10);
      if (newline < 0) return;
      try {
        const rpc: unknown = JSON.parse(bytes.subarray(0, newline).toString("utf8"));
        if (!object(rpc) || rpc.id !== "native-runs" || rpc.error !== undefined) throw Error();
        finish(decodeNativeRunLookup(rpc.result, queries));
      } catch { finish(); }
    });
  });
}
