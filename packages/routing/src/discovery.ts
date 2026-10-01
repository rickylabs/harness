/** Read-only CLI observations (#274/#270). Catalog membership is never entitlement or a model turn. */
import { spawn } from "node:child_process";
import { kill, platform } from "node:process";

export const DISCOVERY_LAUNCHERS = ["claude", "codex", "opencode", "agy"] as const;
export type DiscoveryLauncher = typeof DISCOVERY_LAUNCHERS[number];
export type DiscoveryFact = "yes" | "no" | "unknown";
export type DiscoveryProblem = "not-installed" | "command-failed" | "timeout" | "oversized" |
  "malformed" | "unsupported" | "empty-catalog" | "not-requested";
export interface DiscoveredModel {
  readonly id: string;
  /** Exact CLI-declared values only; null means the listing did not establish effort support. */
  readonly efforts: readonly string[] | null;
}
export interface CliObservation {
  readonly installed: DiscoveryFact;
  readonly version: string | null;
  /** CLI-reported login presence; never a credential, account identifier or live access proof. */
  readonly authenticated: DiscoveryFact;
  readonly entitlement: "unknown";
  readonly quota: "unknown";
  readonly catalog: "observed" | "unknown" | "declared";
  readonly models: readonly DiscoveredModel[];
  readonly sources: readonly ("version" | "auth-status" | "model/list" | "models" | "declared")[];
  readonly problems: readonly DiscoveryProblem[];
}
export interface CliDiscoverySnapshot {
  readonly schemaVersion: 1;
  readonly observedAt: string;
  readonly launchers: Readonly<Record<DiscoveryLauncher, CliObservation>>;
}
export interface CliDiscoveryOptions {
  /** Used by the CLI itself; never included in observations or diagnostics. */
  readonly cwd: string;
  readonly binaries?: Partial<Readonly<Record<Exclude<DiscoveryLauncher, "agy">, string>>>;
  readonly only?: readonly Exclude<DiscoveryLauncher, "agy">[];
  readonly declaredAgyModels?: readonly string[];
  readonly timeoutMs?: number;
  readonly maximumBytes?: number;
  readonly now?: () => string;
}
const ID = /^[^\s\u0000-\u001f\u007f]{1,256}$/u;
const VERSION = /\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/;
const MAX_MODELS = 4096;
const MAX_PAGES = 32;
class DiscoveryError extends Error {
  readonly problem: DiscoveryProblem;
  constructor(problem: DiscoveryProblem) { super(problem); this.problem = problem; }
}
function unknown(problem: DiscoveryProblem, declared: readonly string[] = []): CliObservation {
  return { installed: "unknown", version: null, authenticated: "unknown", entitlement: "unknown", quota: "unknown",
    catalog: declared.length ? "declared" : "unknown", models: declared.map(id => ({ id, efforts: null })),
    sources: declared.length ? ["declared"] : [], problems: [problem] };
}
function checkedIds(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > MAX_MODELS || values.some(v => typeof v !== "string" || !ID.test(v))) {
    throw new DiscoveryError("malformed");
  }
  const ids = values as string[];
  if (new Set(ids).size !== ids.length) throw new DiscoveryError("malformed");
  return ids;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DiscoveryError("malformed");
  return value as Record<string, unknown>;
}
/** Owns one child and all its pipes. No stderr/raw command error ever leaves this boundary. */
function child(binary: string, args: readonly string[], options: CliDiscoveryOptions) {
  const timeout = options.timeoutMs ?? 15_000;
  const maximum = options.maximumBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000 ||
      !Number.isSafeInteger(maximum) || maximum < 64 || maximum > 1024 * 1024) throw new DiscoveryError("malformed");
  const process = spawn(binary, [...args], { cwd: options.cwd, shell: false, detached: platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  process.stderr.resume();
  let failure: DiscoveryProblem | undefined;
  let size = 0;
  const buffers: Buffer[] = [];
  const waiters: { resolve: (value: string) => void; reject: (error: Error) => void }[] = [];
  const lines: string[] = [];
  let text = "";
  let closed = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const terminate = () => {
    if (closed) return;
    try { if (platform !== "win32" && process.pid) kill(-process.pid, "SIGKILL"); else process.kill("SIGKILL"); }
    catch { /* already exited */ }
  };
  const fail = (problem: DiscoveryProblem) => {
    failure ??= problem;
    for (const waiter of waiters.splice(0)) waiter.reject(new DiscoveryError(failure));
    terminate();
  };
  process.stdout.on("data", (chunk: Buffer) => {
    if (failure) return;
    size += chunk.length;
    if (size > maximum) { fail("oversized"); return; }
    buffers.push(chunk);
    try { text += decoder.decode(chunk, { stream: true }); } catch { fail("malformed"); return; }
    let newline;
    while ((newline = text.indexOf("\n")) >= 0) {
      const line = text.slice(0, newline); text = text.slice(newline + 1);
      const waiter = waiters.shift(); if (waiter) waiter.resolve(line); else lines.push(line);
    }
  });
  const done = new Promise<number | null>(resolve => {
    process.once("error", (error: NodeJS.ErrnoException) => {
      fail(error.code === "ENOENT" ? "not-installed" : "command-failed");
    });
    process.once("close", code => {
      closed = true;
      try { decoder.decode(); } catch { failure ??= "malformed"; }
      for (const waiter of waiters.splice(0)) waiter.reject(new DiscoveryError(failure ?? "command-failed"));
      resolve(code);
    });
  });
  const timer = setTimeout(() => fail("timeout"), timeout);
  process.stdin.on("error", () => fail("command-failed"));
  return {
    process,
    async output() {
      process.stdin.end(); const code = await done;
      if (failure) throw new DiscoveryError(failure);
      return { code, stdout: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(buffers)) };
    },
    async line() {
      if (failure) throw new DiscoveryError(failure);
      if (lines.length) return lines.shift()!;
      if (closed) throw new DiscoveryError("command-failed");
      return await new Promise<string>((resolve, reject) => waiters.push({ resolve, reject }));
    },
    async close() { clearTimeout(timer); process.stdin.destroy(); terminate(); await done; },
  };
}
async function command(binary: string, args: readonly string[], options: CliDiscoveryOptions) {
  const running = child(binary, args, options);
  try { return await running.output(); } finally { await running.close(); }
}
function problem(error: unknown): DiscoveryProblem {
  return error instanceof DiscoveryError ? error.problem : "command-failed";
}
interface CodexCatalog { models: DiscoveredModel[]; authenticated: DiscoveryFact }
async function codexCatalog(binary: string, options: CliDiscoveryOptions): Promise<CodexCatalog> {
  const running = child(binary, ["app-server", "--listen", "stdio://"], options);
  let nextId = 0;
  function write(method: "initialize" | "initialized" | "account/read" | "model/list", params: unknown, notification = false) {
    const id = ++nextId;
    running.process.stdin.write(JSON.stringify({ method, params, ...(notification ? {} : { id }) }) + "\n");
    return id;
  }
  async function response(id: number): Promise<Record<string, unknown>> {
    for (;;) {
      const line = await running.line();
      let parsed;
      try { parsed = object(JSON.parse(line)); } catch { throw new DiscoveryError("malformed"); }
      if (parsed.id === id) {
        if (parsed.error !== undefined) throw new DiscoveryError("unsupported");
        return object(parsed.result);
      }
      // Notifications are metadata; server requests are refused, never answered or executed.
      if (parsed.id !== undefined) throw new DiscoveryError("malformed");
    }
  }
  try {
    await response(write("initialize", { clientInfo: { name: "harness_discovery", version: "0.1.0" } }));
    write("initialized", {}, true);
    let authenticated: DiscoveryFact = "unknown";
    try {
      const account = await response(write("account/read", { refreshToken: false }));
      if (account.account === null) authenticated = account.requiresOpenaiAuth === true ? "no" : "unknown";
      else if (typeof account.account === "object" && account.account !== null) authenticated = "yes";
    } catch (error) { if (problem(error) !== "unsupported") throw error; }
    const models: DiscoveredModel[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await response(write("model/list", { limit: 100, includeHidden: true, ...(cursor === undefined ? {} : { cursor }) }));
      if (!Array.isArray(result.data)) throw new DiscoveryError("malformed");
      for (const entry of result.data) {
        const record = object(entry);
        const ids = checkedIds([record.model]);
        let efforts: string[] | null = null;
        if (record.supportedReasoningEfforts !== undefined) {
          if (!Array.isArray(record.supportedReasoningEfforts)) throw new DiscoveryError("malformed");
          efforts = checkedIds(record.supportedReasoningEfforts.map(e => object(e).reasoningEffort));
        }
        models.push({ id: ids[0]!, efforts });
        if (models.length > MAX_MODELS) throw new DiscoveryError("oversized");
      }
      if (result.nextCursor === null) {
        checkedIds(models.map(m => m.id));
        if (!models.length) throw new DiscoveryError("empty-catalog");
        return { models, authenticated };
      }
      if (typeof result.nextCursor !== "string" || !result.nextCursor || result.nextCursor.length > 256 ||
          /[\s\u0000-\u001f\u007f]/.test(result.nextCursor) || cursors.has(result.nextCursor)) throw new DiscoveryError("malformed");
      cursor = result.nextCursor; cursors.add(cursor);
    }
    throw new DiscoveryError("oversized");
  } finally { await running.close(); }
}
async function observe(launcher: Exclude<DiscoveryLauncher, "agy">, options: CliDiscoveryOptions): Promise<CliObservation> {
  const binary = options.binaries?.[launcher] ?? launcher;
  const base = unknown("not-requested");
  let version;
  try { version = await command(binary, ["--version"], options); }
  catch (error) {
    const why = problem(error);
    return { ...base, installed: why === "not-installed" ? "no" : "unknown", problems: [why] };
  }
  if (version.code !== 0) return { ...base, problems: ["command-failed"] };
  const observation = { ...base, installed: "yes" as const, version: VERSION.exec(version.stdout)?.[0] ?? null,
    sources: ["version"] as CliObservation["sources"], problems: [] as DiscoveryProblem[] };
  if (launcher === "claude") {
    try {
      const auth = await command(binary, ["auth", "status"], options);
      const metadata = object(JSON.parse(auth.stdout));
      const authenticated = typeof metadata.loggedIn === "boolean" && auth.code === (metadata.loggedIn ? 0 : 1)
        ? metadata.loggedIn ? "yes" : "no" : "unknown";
      return { ...observation, authenticated, sources: ["version", "auth-status"], problems: ["unsupported"] };
    } catch { return { ...observation, problems: ["unsupported"] }; }
  }
  try {
    if (launcher === "codex") {
      const catalog = await codexCatalog(binary, options);
      return { ...observation, catalog: "observed", models: catalog.models, authenticated: catalog.authenticated,
        sources: ["version", "auth-status", "model/list"] };
    }
    const output = await command(binary, ["models"], options);
    if (output.code !== 0) throw new DiscoveryError("command-failed");
    const ids = checkedIds(output.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
    if (!ids.length) throw new DiscoveryError("empty-catalog");
    if (ids.some(id => !id.includes("/") || id.startsWith("/") || id.endsWith("/"))) throw new DiscoveryError("malformed");
    return { ...observation, catalog: "observed", models: ids.map(id => ({ id, efforts: null })), sources: ["version", "models"] };
  } catch (error) { return { ...observation, problems: [problem(error)] }; }
}
/** No model/provider whitelist: IDs and effort options are discovered as data. No turns or credential reads. */
export async function discoverCliCapabilities(options: CliDiscoveryOptions): Promise<CliDiscoverySnapshot> {
  const only = options.only ?? ["claude", "codex", "opencode"];
  if (only.some(name => !["claude", "codex", "opencode"].includes(name)) || new Set(only).size !== only.length) throw new DiscoveryError("malformed");
  const declared = checkedIds(options.declaredAgyModels ?? []);
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  if (!Number.isFinite(Date.parse(observedAt))) throw new DiscoveryError("malformed");
  const [claude, codex, opencode] = await Promise.all((["claude", "codex", "opencode"] as const)
    .map(name => only.includes(name) ? observe(name, options) : Promise.resolve(unknown("not-requested"))));
  return { schemaVersion: 1, observedAt, launchers: { claude: claude!, codex: codex!, opencode: opencode!, agy: unknown("unsupported", declared) } };
}
/** Strict, credential-free JSON shape for external observation readers. Unknown keys are refused. */
export function validateCliDiscoverySnapshot(value: unknown): value is CliDiscoverySnapshot {
  try {
    const exact = (record: Record<string, unknown>, keys: readonly string[]) =>
      Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key));
    const root = object(value);
    if (!exact(root, ["schemaVersion", "observedAt", "launchers"]) || root.schemaVersion !== 1 ||
        typeof root.observedAt !== "string" || !Number.isFinite(Date.parse(root.observedAt))) return false;
    const launchers = object(root.launchers);
    if (!exact(launchers, DISCOVERY_LAUNCHERS)) return false;
    for (const name of DISCOVERY_LAUNCHERS) {
      const record = object(launchers[name]);
      if (!exact(record, ["installed", "version", "authenticated", "entitlement", "quota", "catalog", "models", "sources", "problems"]) ||
          (typeof record.installed !== "string" || !["yes", "no", "unknown"].includes(record.installed)) ||
          (typeof record.authenticated !== "string" || !["yes", "no", "unknown"].includes(record.authenticated)) || record.entitlement !== "unknown" || record.quota !== "unknown" ||
          (typeof record.catalog !== "string" || !["observed", "unknown", "declared"].includes(record.catalog)) ||
          (record.version !== null && (typeof record.version !== "string" || VERSION.exec(record.version)?.[0] !== record.version)) ||
          !Array.isArray(record.models) || record.models.length > MAX_MODELS ||
          !Array.isArray(record.sources) || record.sources.some(v => !["version", "auth-status", "model/list", "models", "declared"].includes(v)) ||
          !Array.isArray(record.problems) || record.problems.some(v => !["not-installed", "command-failed", "timeout", "oversized", "malformed", "unsupported", "empty-catalog", "not-requested"].includes(v))) return false;
      const ids: unknown[] = [];
      for (const entry of record.models) {
        const model = object(entry);
        if (!exact(model, ["id", "efforts"])) return false;
        ids.push(model.id);
        if (model.efforts !== null) { if (!Array.isArray(model.efforts) || model.efforts.length > 64) return false; checkedIds(model.efforts); }
      }
      checkedIds(ids);
      if ((record.catalog === "observed" && (record.installed !== "yes" || !ids.length)) ||
          (record.catalog === "unknown" && ids.length > 0) || (record.catalog === "declared" && name !== "agy")) return false;
    }
    return true;
  } catch { return false; }
}
/** Freshness is checked at consumption, not inferred from process installation or configured membership. */
export function discoveredModels(snapshot: CliDiscoverySnapshot, launcher: string, now = new Date().toISOString(), maximumAgeMs = 600_000): readonly DiscoveredModel[] | null {
  if (!validateCliDiscoverySnapshot(snapshot) || !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0) return null;
  const captured = Date.parse(snapshot.observedAt); const current = Date.parse(now);
  if (!Number.isFinite(captured) || !Number.isFinite(current) || captured > current || current - captured > maximumAgeMs) return null;
  const name = launcher === "antigravity" ? "agy" : launcher;
  if (!(DISCOVERY_LAUNCHERS as readonly string[]).includes(name)) return null;
  const observation = snapshot.launchers[name as DiscoveryLauncher];
  if (observation.installed !== "yes" || observation.catalog !== "observed") return null;
  return observation.models;
}
