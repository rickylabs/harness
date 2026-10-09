/** Pure validation at the live-source boundary: an operator descriptor becomes a `GovernanceSource` or is refused. */
import { isAbsolute } from "node:path";
import { object, positive, safeLabel, SourceError, USAGE_WINDOWS, SPEND_WINDOWS, type CapacitySource, type GovernanceSource,
  type SpendSource, type UsageSource, type UsageWindow } from "../domain/source.js";

function path(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) throw new SourceError("shape-mismatch");
  return value;
}
function credential(value: unknown): string {
  // Deny runtime-control environment names (PATH, NODE_OPTIONS, etc.) structurally.
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || /^(?:DENO_|NODE_|LD_|DYLD_)/.test(value) || ["HOME", "PATH", "USERPROFILE", "TMPDIR", "XDG_CACHE_HOME"].includes(value)) throw new SourceError("shape-mismatch");
  return value;
}
/** A bare hostname: labels only, so no scheme, port, path, userinfo or wildcard can widen the permission. */
function host(value: unknown): string {
  if (typeof value !== "string" || value.length > 253 ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(value)) throw new SourceError("shape-mismatch");
  return value;
}
/** An exact https endpoint: no userinfo, query or fragment, and already in canonical form, so the URL fetched is the URL configured. */
function endpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[?#\s]/.test(value)) throw new SourceError("shape-mismatch");
  let url: URL;
  try { url = new URL(value); } catch { throw new SourceError("shape-mismatch"); }
  if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "" || url.href !== value) throw new SourceError("shape-mismatch");
  return value;
}
function fields(value: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(value).length !== names.length || names.some(name => !(name in value))) throw new SourceError("shape-mismatch");
}
/** Validate an operator descriptor. Every refusal is the fixed `invalid-descriptor`, never the input. */
export function parseSource(value: unknown): GovernanceSource {
  try {
    const input = object(value);
    fields(input, ["usage", "spend", "capacity", "admissions", "accountLabel",
      ...(Object.hasOwn(input, "transportAvailability") ? ["transportAvailability"] : [])]);
    let usage: UsageSource | null = null;
    if (input.usage !== null) {
      const u = object(input.usage);
      fields(u, ["denoBin", "probe", "checkout", "model", "credentialEnv", "allowNet", "timeoutMs", "maxBytes", "windows"]);
      if (typeof u.model !== "string" || u.model.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)+$/.test(u.model)) throw new SourceError("shape-mismatch");
      const w = object(u.windows);
      fields(w, USAGE_WINDOWS);
      const windows = {} as Record<UsageWindow, { label: string; windowMinutes: number }>;
      for (const id of USAGE_WINDOWS) {
        const row = object(w[id]);
        fields(row, ["label", "windowMinutes"]);
        windows[id] = { label: safeLabel(row.label), windowMinutes: positive(row.windowMinutes) };
      }
      if (new Set(Object.values(windows).map(w => w.label)).size !== USAGE_WINDOWS.length) throw new SourceError("shape-mismatch");
      usage = { denoBin: path(u.denoBin), probe: path(u.probe), checkout: path(u.checkout), model: u.model,
        credentialEnv: credential(u.credentialEnv), allowNet: host(u.allowNet), timeoutMs: positive(u.timeoutMs, 60_000), maxBytes: positive(u.maxBytes, 4_194_304), windows };
    }
    let spend: SpendSource | null = null;
    if (input.spend !== null) {
      const s = object(input.spend);
      fields(s, ["url", "credentialEnv", "window", "validForMs", "timeoutMs", "maxBytes"]);
      if (typeof s.window !== "string" || !Object.hasOwn(SPEND_WINDOWS, s.window)) throw new SourceError("shape-mismatch");
      spend = { url: endpoint(s.url), credentialEnv: credential(s.credentialEnv), window: s.window as SpendSource["window"],
        validForMs: positive(s.validForMs), timeoutMs: positive(s.timeoutMs, 60_000), maxBytes: positive(s.maxBytes, 4_194_304) };
    }
    let capacity: CapacitySource | null = null;
    if (input.capacity !== null) {
      const c = object(input.capacity);
      fields(c, ["cgroupRoot", "scopeLabel", "validForMs"]);
      capacity = { cgroupRoot: path(c.cgroupRoot), scopeLabel: safeLabel(c.scopeLabel), validForMs: positive(c.validForMs) };
    }
    if (input.admissions !== null) {
      const a = object(input.admissions);
      fields(a, ["fromObservabilityLog"]);
      if (a.fromObservabilityLog !== true) throw new SourceError("shape-mismatch");
    }
    let transportAvailability: GovernanceSource["transportAvailability"] = null;
    if (input.transportAvailability !== undefined && input.transportAvailability !== null) {
      const t = object(input.transportAvailability);
      fields(t, ["path"]);
      transportAvailability = { path: path(t.path) };
    }
    return { usage, spend, capacity, admissions: input.admissions === null ? null : { fromObservabilityLog: true },
      transportAvailability, accountLabel: safeLabel(input.accountLabel) };
  } catch { throw new SourceError("invalid-descriptor"); }
}
