/** Read-only CLI observations (#274/#270). Catalog membership is never entitlement or a model turn. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { kill, platform } from "node:process";
import nativeBindings from "../config/discovery.native.v1.json" with { type: "json" };

export const DISCOVERY_LAUNCHERS = ["claude", "codex", "opencode", "agy"] as const;
export type DiscoveryLauncher = typeof DISCOVERY_LAUNCHERS[number];
export type DiscoveryFact = "yes" | "no" | "unknown";
export type DiscoveryProblem = "not-installed" | "command-failed" | "timeout" | "oversized" |
  "malformed" | "unsupported" | "empty-catalog" | "not-requested";
export const DISCOVERY_SOURCES = ["version", "auth-status", "model/list", "models", "declared",
  "claude.sdk.initialize", "claude.auth.apiProvider", "codex.config/read", "codex.builtin-provider", "codex.builtin-provider.unverified",
  "opencode.models.providerID", "opencode.models.providerPrefix", "opencode.models.variants", "opencode.provider/list.connected",
  "opencode.config/providers", "opencode.config/providers.providerID", "opencode.config/providers.variants", "agy.models", "agy.auth-gate", "agy.command.config", "agy.command.model"] as const;
export type DiscoverySource = typeof DISCOVERY_SOURCES[number];
export interface DiscoveryProvider {
  readonly id: string | null;
  readonly source: DiscoverySource | null;
  /** A CLI configuration binding is not a per-model entitlement assertion. */
  readonly scope: "cli" | "model" | "unknown";
}
export interface ProviderConnection {
  readonly id: string;
  /** Native configured/credential connection presence, never payment or live access. */
  readonly connected: DiscoveryFact;
  readonly source: "opencode.provider/list.connected";
}
export interface DiscoveredModel {
  readonly id: string;
  /** Exact CLI-declared values only; [] proves unsupported effort, null means unestablished support. */
  readonly efforts: readonly string[] | null;
  readonly provider?: DiscoveryProvider;
  readonly aliases?: readonly string[];
  readonly variants?: readonly string[];
  readonly effortSource?: DiscoverySource | null;
}
export interface CliObservation {
  readonly installed: DiscoveryFact;
  readonly version: string | null;
  /** CLI-reported login or configured credential presence; never a credential, account identifier or live access proof. */
  readonly authenticated: DiscoveryFact;
  /** Proven native metadata authentication gate; absent in legacy observations. */
  readonly authenticationSource?: DiscoverySource | null;
  readonly entitlement: "unknown";
  readonly quota: "unknown";
  readonly catalog: "observed" | "unknown" | "declared";
  readonly models: readonly DiscoveredModel[];
  readonly sources: readonly DiscoverySource[];
  readonly provider?: DiscoveryProvider;
  /** Absent means the connection read did not establish an exact native provider set. */
  readonly providerConnections?: readonly ProviderConnection[];
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
  readonly binaries?: Partial<Readonly<Record<DiscoveryLauncher, string>>>;
  readonly only?: readonly DiscoveryLauncher[];
  readonly declaredAgyModels?: readonly string[];
  readonly timeoutMs?: number;
  readonly maximumBytes?: number;
  readonly now?: () => string;
}
const ID = /^[^\s\u0000-\u001f\u007f]{1,256}$/u;
const VERSION = /\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/;
const MAX_MODELS = 4096;
const MAX_PAGES = 32;
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const EFFORT = /^[a-z][a-z0-9_-]{0,63}$/;
const UNKNOWN_PROVIDER: DiscoveryProvider = { id: null, source: null, scope: "unknown" };
const CODEX_BUILTIN_PROVIDER_VERSIONS = new Set<string>(nativeBindings.codex.verifiedVersions);
const release = (version: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number) ?? null;
const later = (a: number[], b: number[]) => a[0]! !== b[0]! ? a[0]! > b[0]! : a[1]! !== b[1]! ? a[1]! > b[1]! : a[2]! > b[2]!;
/** A plain release newer than every verified one, on the same major line (an auto-update). Older, pre-release,
 * build-tagged and new-major versions are not. */
function newerThanVerifiedCodex(version: string | null): boolean {
  const current = version === null ? null : release(version);
  if (current === null || CODEX_BUILTIN_PROVIDER_VERSIONS.has(version!)) return false;
  return [...CODEX_BUILTIN_PROVIDER_VERSIONS].every(verified => {
    const v = release(verified); return v !== null && later(current, v) && current[0] === v[0];
  });
}
const OPENCODE_NATIVE_VARIANT_VERSIONS = new Set<string>(nativeBindings.opencode.verifiedVersions);
const OPENCODE_HTTP_CATALOG_VERSIONS = new Set<string>(nativeBindings.opencode.httpCatalogVersions);
const AGY_METADATA_VERSIONS = new Set<string>(nativeBindings.agy.verifiedVersions);
const CLAUDE_EFFORT_OMISSION_VERSIONS = new Set<string>(nativeBindings.claude.effortOmissionVersions);
const MAX_PROVIDER_BYTES = 16 * 1024 * 1024;
function checkedEfforts(value: unknown): string[] {
  const values = checkedIds(value);
  if (values.length > 64 || values.some(v => !EFFORT.test(v))) throw new DiscoveryError("malformed");
  return values;
}
function checkedVariants(value: unknown): string[] {
  const values = checkedIds(value);
  if (values.length > 64) throw new DiscoveryError("malformed");
  return values;
}
function provider(id: unknown, source: DiscoverySource, scope: "cli" | "model"): DiscoveryProvider {
  if (typeof id !== "string" || !PROVIDER_ID.test(id)) throw new DiscoveryError("malformed");
  checkedIds([id]);
  return { id, source, scope };
}
class DiscoveryError extends Error {
  readonly problem: DiscoveryProblem;
  constructor(problem: DiscoveryProblem) { super(problem); this.problem = problem; }
}
function unknown(problem: DiscoveryProblem, declared: readonly string[] = []): CliObservation {
  return { installed: "unknown", version: null, authenticated: "unknown", entitlement: "unknown", quota: "unknown",
    catalog: declared.length ? "declared" : "unknown", models: declared.map(id => ({ id, efforts: null })), provider: UNKNOWN_PROVIDER,
    sources: declared.length ? ["declared"] : [], problems: [problem] };
}
function checkedIds(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > MAX_MODELS || values.some(v => typeof v !== "string" || !ID.test(v) || v.startsWith("/") || /(?:^|\/)(?:home|tmp|PRIVATE)(?:\/|$)|^(?:gh[pousr]_|sk-)[A-Za-z0-9]/.test(v))) {
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
/** Reject ambiguous duplicate keys and excessive nesting before projecting native JSON.
 * Error text is a fixed code; raw private values never become diagnostics. */
function nativeJson(text: string): unknown {
  let at = 0, nodes = 0;
  const space = () => { while (/\s/.test(text[at] ?? "") && at < text.length) at++; };
  const string = (): string => {
    const start = at++;
    for (; at < text.length; at++) {
      if (text[at] === "\\") { at++; continue; }
      if (text[at] === '"') { at++; return JSON.parse(text.slice(start, at)) as string; }
    }
    throw new DiscoveryError("malformed");
  };
  const visit = (depth: number): void => {
    if (depth > 64 || ++nodes > 1_000_000) throw new DiscoveryError("oversized");
    space(); const char = text[at];
    if (char === "{" || char === "[") {
      at++; space(); const end = char === "{" ? "}" : "]", keys = new Set<string>();
      if (text[at] === end) { at++; return; }
      for (;;) {
        if (char === "{") {
          space(); if (text[at] !== '"') throw new DiscoveryError("malformed");
          const key = string(); if (keys.has(key)) throw new DiscoveryError("malformed"); keys.add(key);
          space(); if (text[at++] !== ":") throw new DiscoveryError("malformed");
        }
        visit(depth + 1); space();
        if (text[at] === end) { at++; return; }
        if (text[at++] !== ",") throw new DiscoveryError("malformed");
      }
    }
    if (char === '"') { string(); return; }
    const start = at;
    while (at < text.length && !/[\s,}\]]/.test(text[at]!)) at++;
    if (at === start) throw new DiscoveryError("malformed");
  };
  try { visit(0); space(); if (at !== text.length) throw new DiscoveryError("malformed"); return JSON.parse(text); }
  catch (error) { if (error instanceof DiscoveryError) throw error; throw new DiscoveryError("malformed"); }
}
/** Locate one bounded JSON object in the native mixed header/JSON model listing. */
function jsonObjectEnd(text: string, start: number): number {
  let depth = 0, quoted = false;
  for (let at = start; at < text.length; at++) {
    const char = text[at];
    if (quoted) { if (char === "\\") at++; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") { if (--depth === 0) return at + 1; }
    if (depth > 64) throw new DiscoveryError("oversized");
  }
  throw new DiscoveryError("malformed");
}
/** Owns one child and all its pipes. No stderr/raw command error ever leaves this boundary. */
function child(binary: string, args: readonly string[], options: CliDiscoveryOptions, environment?: NodeJS.ProcessEnv) {
  const timeout = options.timeoutMs ?? 15_000;
  const maximum = options.maximumBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000 ||
      !Number.isSafeInteger(maximum) || maximum < 64 || maximum > 1024 * 1024) throw new DiscoveryError("malformed");
  const process = spawn(binary, [...args], { cwd: options.cwd, shell: false, detached: platform !== "win32", stdio: ["pipe", "pipe", "pipe"], ...(environment === undefined ? {} : { env: environment }) });
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
async function command(binary: string, args: readonly string[], options: CliDiscoveryOptions, environment?: NodeJS.ProcessEnv) {
  const running = child(binary, args, options, environment);
  try { return await running.output(); } finally { await running.close(); }
}
function problem(error: unknown): DiscoveryProblem {
  return error instanceof DiscoveryError ? error.problem : "command-failed";
}
interface CodexCatalog { models: DiscoveredModel[]; authenticated: DiscoveryFact; provider: DiscoveryProvider }
async function codexCatalog(binary: string, options: CliDiscoveryOptions, version: string | null): Promise<CodexCatalog> {
  const observationCwd = resolve(options.cwd);
  const running = child(binary, ["app-server", "--listen", "stdio://"], { ...options, cwd: observationCwd });
  let nextId = 0;
  function write(method: "initialize" | "initialized" | "account/read" | "model/list" | "config/read" | "configRequirements/read", params: unknown, notification = false) {
    const id = ++nextId;
    running.process.stdin.write(JSON.stringify({ method, params, ...(notification ? {} : { id }) }) + "\n");
    return id;
  }
  async function response(id: number): Promise<Record<string, unknown>> {
    for (;;) {
      const line = await running.line();
      let parsed;
      try { parsed = object(nativeJson(line)); } catch { throw new DiscoveryError("malformed"); }
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
    let binding = UNKNOWN_PROVIDER;
    let configuration: Record<string, unknown> | undefined, requirements: Record<string, unknown> | undefined;
    try {
      // Without cwd, Codex excludes in-repo .codex layers and cannot bind this observation.
      const result = await response(write("config/read", { includeLayers: false, cwd: observationCwd }));
      requirements = await response(write("configRequirements/read", {}));
      try { configuration = object(result.config); } catch { /* Unproven configuration stays unknown. */ }
    } catch (error) {
      if (problem(error) !== "unsupported") throw error;
      // Unsupported metadata methods cannot establish a provider; protocol errors still refuse the catalog.
    }
    if (configuration && requirements?.requirements === null) {
      try {
        if (typeof configuration.model_provider === "string") {
          binding = provider(configuration.model_provider, "codex.config/read", "cli");
        } else if (CODEX_BUILTIN_PROVIDER_VERSIONS.has(version ?? "") && configuration.model_provider === null && configuration.model_providers !== undefined &&
            Object.keys(object(configuration.model_providers)).length === 0) {
          // Pinned rust-v0.159.3 and rust-v0.160.0 core/config/mod.rs default; other revisions stay unknown:
          // required_model_provider.or(model_provider).or(cfg.model_provider).unwrap_or("openai").
          // Require a successful empty requirements read and no custom provider definitions.
          binding = provider(nativeBindings.codex.builtinProvider, "codex.builtin-provider", "cli");
        } else if (newerThanVerifiedCodex(version) && configuration.model_provider === null && configuration.model_providers !== undefined &&
            Object.keys(object(configuration.model_providers)).length === 0) {
          // An auto-updated release newer than every verified one: the same unconfigured state, with the last verified
          // default, under a source that says it is unverified so readers can name it. No safety property depends on
          // it: Codex resolves its own provider at launch; this only names the route. Older or pre-release versions
          // stay unknown.
          binding = provider(nativeBindings.codex.builtinProvider, "codex.builtin-provider.unverified", "cli");
        }
      } catch { /* Malformed binding metadata stays unknown, never defaulted. */ }
    }
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
          efforts = checkedEfforts(record.supportedReasoningEfforts.map(e => object(e).reasoningEffort));
        }
        models.push({ id: ids[0]!, efforts, provider: binding, effortSource: efforts === null ? null : "model/list" });
        if (models.length > MAX_MODELS) throw new DiscoveryError("oversized");
      }
      if (result.nextCursor === null) {
        checkedIds(models.map(m => m.id));
        if (!models.length) throw new DiscoveryError("empty-catalog");
        return { models, authenticated, provider: binding };
      }
      if (typeof result.nextCursor !== "string" || !result.nextCursor || result.nextCursor.length > 256 ||
          /[\s\u0000-\u001f\u007f]/.test(result.nextCursor) || cursors.has(result.nextCursor)) throw new DiscoveryError("malformed");
      cursor = result.nextCursor; cursors.add(cursor);
    }
    throw new DiscoveryError("oversized");
  } finally { await running.close(); }
}
/** SDK initialize is metadata only: no prompt, hooks, tools, persistence or MCP servers. */
async function claudeCatalog(binary: string, options: CliDiscoveryOptions, version: string | null): Promise<DiscoveredModel[]> {
  const running = child(binary, ["--print", "--bare", "--verbose", "--input-format", "stream-json",
    "--output-format", "stream-json", "--no-session-persistence", "--setting-sources=",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'], options);
  const requestID = "harness_metadata_initialize";
  try {
    running.process.stdin.write(JSON.stringify({ type: "control_request", request_id: requestID,
      request: { subtype: "initialize", hooks: {}, sdkMcpServers: [] } }) + "\n");
    let reply: Record<string, unknown>;
    for (;;) {
      const item = object(nativeJson(await running.line()));
      if (item.type === "system" && item.subtype === "ui_invalidate") continue; // Native metadata notification, discarded.
      if (item.type !== "control_response") throw new DiscoveryError("malformed");
      reply = object(item.response);
      if (reply.request_id !== requestID || reply.subtype !== "success") throw new DiscoveryError("malformed");
      break;
    }
    const entries = object(reply.response).models;
    if (!Array.isArray(entries) || entries.length > MAX_MODELS) throw new DiscoveryError("malformed");
    if (!entries.length) throw new DiscoveryError("empty-catalog");
    const aliases = new Set<string>(), models = new Map<string, DiscoveredModel>();
    for (const value of entries) {
      const entry = object(value), alias = checkedIds([entry.value])[0]!, id = checkedIds([entry.resolvedModel])[0]!;
      if (aliases.has(alias)) throw new DiscoveryError("malformed");
      aliases.add(alias);
      if (entry.supportsEffort !== undefined && typeof entry.supportsEffort !== "boolean") throw new DiscoveryError("malformed");
      let efforts: string[] | null = null;
      // Native 2.1.288 N7 spreads both effort fields only when nw(resolvedModel) is true.
      // That verified serializer proves omission is unsupported; unverified serializers stay unknown.
      if (entry.supportsEffort === false || (entry.supportsEffort === undefined && CLAUDE_EFFORT_OMISSION_VERSIONS.has(version ?? ""))) efforts = [];
      if (entry.supportedEffortLevels !== undefined) {
        efforts = checkedEfforts(entry.supportedEffortLevels);
        if (entry.supportsEffort !== true || !efforts.length) throw new DiscoveryError("malformed");
      }
      const previous = models.get(id);
      if (previous && JSON.stringify(previous.efforts) !== JSON.stringify(efforts)) throw new DiscoveryError("malformed");
      if ((previous?.aliases?.length ?? 0) >= 64) throw new DiscoveryError("oversized");
      models.set(id, { id, efforts, aliases: [...(previous?.aliases ?? []), alias],
        effortSource: efforts === null ? null : "claude.sdk.initialize" });
    }
    return [...models.values()];
  } finally { await running.close(); }
}
function nativeVariantEfforts(value: unknown, version: string | null): { variants: string[]; efforts: string[] | null } {
  if (value === undefined) return { variants: [], efforts: null };
  const variants = object(value), names = checkedVariants(Object.keys(variants)), efforts: string[] = [];
  // A verified complete native map with no choices establishes default-only support.
  // It does not mean reasoning is disabled or that a named effort was applied.
  if (names.length === 0 && OPENCODE_NATIVE_VARIANT_VERSIONS.has(version ?? "")) return { variants: [], efforts: [] };
  for (const name of names) {
    const body = object(variants[name]);
    if (body.disabled !== undefined && typeof body.disabled !== "boolean") throw new DiscoveryError("malformed");
    if (body.disabled === true) continue;
    const assertions: unknown[] = [body.effort, body.reasoningEffort, body.reasoning_effort].filter(v => v !== undefined);
    if (body.reasoning !== undefined) {
      const reasoning = object(body.reasoning);
      if (reasoning.effort !== undefined) assertions.push(reasoning.effort);
    }
    if (!assertions.length) continue;
    if (assertions.some(v => typeof v !== "string" || !EFFORT.test(v))) throw new DiscoveryError("malformed");
    if (new Set(assertions).size !== 1) throw new DiscoveryError("malformed");
    // The native option key must actually apply that effort, not merely be named after one.
    if (assertions[0] === name) efforts.push(name);
  }
  return { variants: names.filter(name => object(variants[name]).disabled !== true), efforts: efforts.length ? efforts : null };
}
function openCodeModels(stdout: string, version: string | null): DiscoveredModel[] {
  const models: DiscoveredModel[] = [];
  let at = 0;
  while (at < stdout.length) {
    while (at < stdout.length && /\s/.test(stdout[at]!)) at++;
    if (at === stdout.length) break;
    const newline = stdout.indexOf("\n", at), end = newline < 0 ? stdout.length : newline;
    const id = checkedIds([stdout.slice(at, end).trim()])[0]!, slash = id.indexOf("/");
    if (slash < 1 || slash === id.length - 1) throw new DiscoveryError("malformed");
    const prefix = id.slice(0, slash), nativeID = id.slice(slash + 1);
    at = end;
    while (at < stdout.length && /\s/.test(stdout[at]!)) at++;
    if (stdout[at] === "{") {
      const objectEnd = jsonObjectEnd(stdout, at), record = object(nativeJson(stdout.slice(at, objectEnd)));
      at = objectEnd;
      if (at < stdout.length && !/\s/.test(stdout[at]!)) throw new DiscoveryError("malformed");
      if (record.id !== nativeID || record.providerID !== prefix) throw new DiscoveryError("malformed");
      const capability = nativeVariantEfforts(record.variants, version);
      models.push({ id, ...capability, provider: provider(record.providerID, "opencode.models.providerID", "model"),
        effortSource: capability.efforts === null ? null : "opencode.models.variants" });
    } else {
      // Older native CLIs expose exact provider-prefixed IDs without verbose capability bodies.
      models.push({ id, efforts: null, provider: provider(prefix, "opencode.models.providerPrefix", "model"),
        variants: [], effortSource: null });
    }
    if (models.length > MAX_MODELS) throw new DiscoveryError("oversized");
  }
  checkedIds(models.map(model => model.id));
  if (!models.length) throw new DiscoveryError("empty-catalog");
  return models;
}
/** Private native payload may contain secrets. Only validated catalog and connection facts leave this boundary.
 * Owned authenticated loopback listener; no credential files, sessions, turns, redirects or writes.
 */
async function openCodeMetadata<T>(binary: string, options: CliDiscoveryOptions,
  project: (get: (path: "/provider" | "/config/providers") => Promise<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const secret = randomBytes(32).toString("hex"), username = "harness_discovery";
  const running = child(binary, ["serve", "--pure", "--hostname", "127.0.0.1", "--port", "0"], options,
    { ...process.env, OPENCODE_SERVER_USERNAME: username, OPENCODE_SERVER_PASSWORD: secret });
  const timeout = options.timeoutMs ?? 15_000, deadline = Date.now() + timeout, controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const line = await running.line();
    const match = /^opencode server listening on (http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4}))$/.exec(line);
    if (!match || Number(match[2]) > 65535) throw new DiscoveryError("malformed");
    return await project(async path => {
      const response = await fetch(match[1] + path, { method: "GET", redirect: "error", signal: controller.signal,
        headers: { Authorization: "Basic " + Buffer.from(username + ":" + secret).toString("base64") } });
      if (response.status !== 200 || !response.body) throw new DiscoveryError("command-failed");
      const maximum = options.maximumBytes ?? (path === "/config/providers" ? 1024 * 1024 : MAX_PROVIDER_BYTES), reader = response.body.getReader();
      const buffers: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > maximum) throw new DiscoveryError("oversized");
          buffers.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (controller.signal.aborted || Date.now() >= deadline) throw new DiscoveryError("timeout");
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(buffers)); }
      catch { throw new DiscoveryError("malformed"); }
      return object(nativeJson(text));
    });
  } catch (error) {
    if (controller.signal.aborted || Date.now() >= deadline) throw new DiscoveryError("timeout");
    throw error;
  } finally { clearTimeout(timer); controller.abort(); await running.close(); }
}
function openCodeConnectionFacts(data: Record<string, unknown>, models: readonly DiscoveredModel[]): ProviderConnection[] {
  const connected = checkedIds(data.connected);
  if (connected.length > 512 || connected.some(id => !PROVIDER_ID.test(id))) throw new DiscoveryError("malformed");
  const ids = new Set([...connected, ...models.map(m => m.provider!.id!)]);
  if (ids.size > 512) throw new DiscoveryError("oversized");
  return [...ids].map(id => ({ id, connected: connected.includes(id) ? "yes" : "no", source: "opencode.provider/list.connected" }));
}
async function openCodeConnections(binary: string, models: readonly DiscoveredModel[], options: CliDiscoveryOptions): Promise<ProviderConnection[]> {
  return await openCodeMetadata(binary, options, async get => openCodeConnectionFacts(await get("/provider"), models));
}
function openCodeHttpModels(data: Record<string, unknown>, version: string | null): DiscoveredModel[] {
  if (!Array.isArray(data.providers)) throw new DiscoveryError("malformed");
  if (data.providers.length > 512) throw new DiscoveryError("oversized");
  checkedIds(data.providers.map(value => object(value).id));
  const models: DiscoveredModel[] = [];
  for (const value of data.providers) {
    const p = object(value), binding = provider(p.id, "opencode.config/providers.providerID", "model"), nativeModels = object(p.models);
    for (const id of checkedIds(Object.keys(nativeModels))) {
      const record = object(nativeModels[id]);
      if (record.id !== id || record.providerID !== binding.id) throw new DiscoveryError("malformed");
      const capability = nativeVariantEfforts(record.variants, version);
      models.push({ id: binding.id + "/" + id, ...capability, provider: binding,
        effortSource: capability.efforts === null ? null : "opencode.config/providers.variants" });
    }
  }
  checkedIds(models.map(model => model.id));
  if (!models.length) throw new DiscoveryError("empty-catalog");
  return models;
}
async function openCodeHttpCatalog(binary: string, options: CliDiscoveryOptions, observation: CliObservation): Promise<CliObservation> {
  return await openCodeMetadata(binary, options, async get => {
    const models = openCodeHttpModels(await get("/config/providers"), observation.version);
    const catalog: CliObservation = { ...observation, catalog: "observed", models,
      sources: [...new Set<DiscoverySource>(["version", "opencode.config/providers", ...models.flatMap(m =>
        [m.provider?.source, m.effortSource].filter((source): source is DiscoverySource => source != null))])] };
    try { return { ...catalog, providerConnections: openCodeConnectionFacts(await get("/provider"), models),
      sources: [...catalog.sources, "opencode.provider/list.connected"] }; }
    catch (error) { return { ...catalog, problems: [problem(error)] }; }
  });
}
/** Native built-in reports are metadata: verified auth gate, no conversation, no turns or tokens.
 * Raw response/configuration is discarded; unknown versions never receive a print request. */
async function agyReport(binary: string, name: "config" | "model", options: CliDiscoveryOptions, id?: string) {
  const result = await command(binary, [...(id === undefined ? [] : ["--model", id]), "--print", "/" + name, "--output-format", "json"],
    options, { ...process.env, AGY_CLI_NONINTERACTIVE_HEADLESS: "1" });
  const envelope = object(nativeJson(result.stdout));
  if (result.code !== 0 || envelope.status !== "SUCCESS" || envelope.conversation_id !== "" || envelope.num_turns !== 0) throw new DiscoveryError("malformed");
  const usage = object(envelope.usage);
  const counters = ["input_tokens", "output_tokens", "thinking_tokens", "cache_read_tokens", "total_tokens"];
  if (counters.some(key => usage[key] !== 0) || Object.keys(usage).some(key => !counters.includes(key))) throw new DiscoveryError("malformed");
  const report = object(envelope.command);
  if (report.name !== name) throw new DiscoveryError("malformed");
  return object(report.data);
}
async function agyFacts(binary: string, ids: string[], options: CliDiscoveryOptions, observation: CliObservation): Promise<CliObservation> {
  const models: DiscoveredModel[] = ids.map(id => ({ id, efforts: null, provider: UNKNOWN_PROVIDER, effortSource: null }));
  const base: CliObservation = { ...observation, catalog: "observed", models, sources: ["version", "agy.models"] };
  if (!AGY_METADATA_VERSIONS.has(observation.version ?? "")) return base;
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const scoped = { ...options, cwd: resolve(options.cwd) };
  const bounded = () => {
    const remaining = deadline - Date.now();
    if (remaining < 1) throw new DiscoveryError("timeout");
    return { ...scoped, timeoutMs: remaining };
  };
  const sources = new Set<DiscoverySource>(base.sources), problems = new Set<DiscoveryProblem>();
  let binding = UNKNOWN_PROVIDER;
  const authenticate = () => { sources.add("agy.auth-gate"); };
  try {
    const data = await agyReport(binary, "config", bounded());
    const config = object(data.config); sources.add("agy.command.config"); authenticate();
    if (typeof config.modelProvider === "string" && Object.hasOwn(nativeBindings.agy.providerBindings, config.modelProvider) &&
        config.customModelsConfig === null && config.gcp === null && !process.env.GOOGLE_GEMINI_BASE_URL) {
      const bindings: Readonly<Record<string, string>> = nativeBindings.agy.providerBindings;
      binding = provider(bindings[config.modelProvider], "agy.command.config", "cli");
    }
  } catch (error) { problems.add(problem(error)); }
  // A catalog cannot drive an unbounded number of subprocesses. Each batch shares one deadline.
  if (ids.length > 64) problems.add("oversized");
  for (let start = 0; start < Math.min(ids.length, 64); start += 4) {
    const batch = await Promise.allSettled(ids.slice(start, Math.min(start + 4, 64)).map(async id => {
      const data = await agyReport(binary, "model", bounded(), id);
      if (data.id !== id || typeof data.effort !== "string") throw new DiscoveryError("malformed");
      const efforts = data.effort === "" ? [] : checkedEfforts([data.effort]);
      return { id, efforts, provider: binding, effortSource: "agy.command.model" as const };
    }));
    for (const [offset, result] of batch.entries()) {
      if (result.status === "fulfilled") { models[start + offset] = result.value; authenticate(); sources.add("agy.command.model"); }
      else problems.add(problem(result.reason));
    }
    if (Date.now() >= deadline) { problems.add("timeout"); break; }
  }
  return { ...base, authenticated: sources.has("agy.auth-gate") ? "yes" : "unknown", authenticationSource: sources.has("agy.auth-gate") ? "agy.auth-gate" : null,
    provider: binding, models: models.map(model => ({ ...model, provider: binding })), sources: [...sources], problems: [...problems] };
}
async function observe(launcher: DiscoveryLauncher, options: CliDiscoveryOptions): Promise<CliObservation> {
  const binary = options.binaries?.[launcher] ?? launcher, base = unknown("not-requested");
  let version;
  try { version = await command(binary, ["--version"], options); }
  catch (error) {
    const why = problem(error);
    return { ...base, installed: why === "not-installed" ? "no" : "unknown", problems: [why] };
  }
  if (version.code !== 0) return { ...base, problems: ["command-failed"] };
  const observation: CliObservation = { ...base, installed: "yes", version: VERSION.exec(version.stdout)?.[0] ?? null,
    sources: ["version"], problems: [] };
  if (launcher === "claude") {
    let authenticated: DiscoveryFact = "unknown", binding = UNKNOWN_PROVIDER;
    const sources: DiscoverySource[] = ["version"], problems: DiscoveryProblem[] = [];
    try {
      const auth = await command(binary, ["auth", "status"], options), metadata = object(nativeJson(auth.stdout));
      if (typeof metadata.loggedIn !== "boolean" || auth.code !== (metadata.loggedIn ? 0 : 1)) throw new DiscoveryError("malformed");
      authenticated = metadata.loggedIn ? "yes" : "no"; sources.push("auth-status");
      if (metadata.apiProvider === "firstParty") {
        binding = provider(nativeBindings.claude.firstPartyProvider, "claude.auth.apiProvider", "cli"); sources.push("claude.auth.apiProvider");
      }
    } catch (error) { problems.push(problem(error)); }
    try {
      const models = (await claudeCatalog(binary, options, observation.version)).map(model => ({ ...model, provider: binding }));
      return { ...observation, authenticated, provider: binding, catalog: "observed", models,
        sources: [...sources, "claude.sdk.initialize"], problems };
    } catch (error) { return { ...observation, authenticated, provider: binding, sources, problems: [...problems, problem(error)] }; }
  }
  try {
    if (launcher === "opencode" && OPENCODE_HTTP_CATALOG_VERSIONS.has(observation.version ?? "")) {
      return await openCodeHttpCatalog(binary, options, observation);
    }
    if (launcher === "codex") {
      const catalog = await codexCatalog(binary, options, observation.version);
      return { ...observation, catalog: "observed", models: catalog.models, authenticated: catalog.authenticated,
        provider: catalog.provider, sources: ["version", "auth-status", "model/list", ...(catalog.provider.source ? [catalog.provider.source] : [])] };
    }
    const output = await command(binary, launcher === "agy" ? ["models"] : ["models", "--verbose", "--pure"], options);
    if (output.code !== 0) throw new DiscoveryError("command-failed");
    if (launcher === "agy") {
      const ids = checkedIds(output.stdout.split(/\r?\n/).filter(line => line.trim()).map(line => line.split("\t")[0]));
      if (!ids.length) throw new DiscoveryError("empty-catalog");
      return await agyFacts(binary, ids, options, observation);
    }
    const models = openCodeModels(output.stdout, observation.version);
    const catalog: CliObservation = { ...observation, catalog: "observed", models, sources: [...new Set<DiscoverySource>(["version", "models", ...models.flatMap(m =>
      [m.provider?.source, m.effortSource].filter((source): source is DiscoverySource => source != null))])] };
    try { return { ...catalog, providerConnections: await openCodeConnections(binary, models, options),
      sources: [...catalog.sources, "opencode.provider/list.connected"] }; }
    catch (error) { return { ...catalog, problems: [problem(error)] }; }
  } catch (error) { return { ...observation, problems: [problem(error)] }; }
}
/** No model/provider whitelist: IDs and effort options are discovered as data. No turns or credential reads. */
export async function discoverCliCapabilities(options: CliDiscoveryOptions): Promise<CliDiscoverySnapshot> {
  const only = options.only ?? DISCOVERY_LAUNCHERS;
  if (only.some(name => !(DISCOVERY_LAUNCHERS as readonly string[]).includes(name)) || new Set(only).size !== only.length) throw new DiscoveryError("malformed");
  const declared = checkedIds(options.declaredAgyModels ?? []);
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  if (!Number.isFinite(Date.parse(observedAt))) throw new DiscoveryError("malformed");
  const observations = await Promise.all(DISCOVERY_LAUNCHERS.map(name => only.includes(name) ? observe(name, options) :
    Promise.resolve(unknown("not-requested", name === "agy" ? declared : []))));
  return { schemaVersion: 1, observedAt, launchers: Object.fromEntries(DISCOVERY_LAUNCHERS.map((name, index) =>
    [name, observations[index]!])) as unknown as CliDiscoverySnapshot["launchers"] };
}
/** Strict, credential-free JSON shape for external observation readers. Unknown keys are refused. */
export function validateCliDiscoverySnapshot(value: unknown): value is CliDiscoverySnapshot {
  try {
    const shape = (record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
      required.every(key => Object.hasOwn(record, key)) && Object.keys(record).every(key => required.includes(key) || optional.includes(key));
    const fact = (v: unknown) => v === "yes" || v === "no" || v === "unknown";
    const root = object(value);
    if (!shape(root, ["schemaVersion", "observedAt", "launchers"]) || root.schemaVersion !== 1 ||
        typeof root.observedAt !== "string" || !Number.isFinite(Date.parse(root.observedAt))) return false;
    const launchers = object(root.launchers);
    if (!shape(launchers, DISCOVERY_LAUNCHERS)) return false;
    const nativeSources: Record<DiscoveryLauncher, readonly DiscoverySource[]> = {
      claude: ["version", "auth-status", "claude.sdk.initialize", "claude.auth.apiProvider"],
      codex: ["version", "auth-status", "model/list", "codex.config/read", "codex.builtin-provider", "codex.builtin-provider.unverified"],
      opencode: ["version", "models", "opencode.models.providerID", "opencode.models.providerPrefix", "opencode.models.variants", "opencode.provider/list.connected",
        "opencode.config/providers", "opencode.config/providers.providerID", "opencode.config/providers.variants"],
      agy: ["version", "declared", "agy.models", "agy.auth-gate", "agy.command.config", "agy.command.model"],
    };
    for (const name of DISCOVERY_LAUNCHERS) {
      const record = object(launchers[name]);
      if (!shape(record, ["installed", "version", "authenticated", "entitlement", "quota", "catalog", "models", "sources", "problems"], ["provider", "providerConnections", "authenticationSource"]) ||
          !fact(record.installed) || !fact(record.authenticated) || record.entitlement !== "unknown" || record.quota !== "unknown" ||
          (typeof record.catalog !== "string" || !["observed", "unknown", "declared"].includes(record.catalog)) ||
          (record.version !== null && (typeof record.version !== "string" || VERSION.exec(record.version)?.[0] !== record.version)) ||
          !Array.isArray(record.models) || record.models.length > MAX_MODELS ||
          !Array.isArray(record.sources) || new Set(record.sources).size !== record.sources.length ||
          record.sources.some(v => !nativeSources[name].includes(v)) ||
          !Array.isArray(record.problems) || record.problems.length > 8 || record.problems.some(v =>
            !["not-installed", "command-failed", "timeout", "oversized", "malformed", "unsupported", "empty-catalog", "not-requested"].includes(v))) return false;
      if (name === "opencode" && record.authenticated !== "unknown") return false;
      const httpCatalog = record.sources.includes("opencode.config/providers");
      if (record.sources.some(source => typeof source === "string" && source.startsWith("opencode.config/providers")) &&
          (!httpCatalog || !OPENCODE_HTTP_CATALOG_VERSIONS.has(record.version as string) || record.catalog !== "observed")) return false;
      if (Object.hasOwn(record, "authenticationSource")) {
        if (name !== "agy" || (record.authenticated === "unknown" ? record.authenticationSource !== null : record.authenticationSource !== "agy.auth-gate")) return false;
      }
      if (name === "agy" && (record.authenticated !== "unknown" || record.sources.some(source => source !== "version" && source !== "agy.models" && source !== "declared"))) {
        if (record.installed !== "yes" || record.catalog !== "observed" || !AGY_METADATA_VERSIONS.has(typeof record.version === "string" ? record.version : "") ||
            record.authenticated !== "yes" || record.authenticationSource !== "agy.auth-gate" || !record.sources.includes("agy.auth-gate") ||
            !(record.sources.includes("agy.command.config") || record.sources.includes("agy.command.model"))) return false;
      }
      const sources = record.sources;
      const binding = (value: unknown, scope: "cli" | "model", modelID?: string) => {
        const p = object(value);
        if (!shape(p, ["id", "source", "scope"])) return false;
        if (p.scope === "unknown") return p.id === null && p.source === null;
        if (p.scope !== scope || typeof p.id !== "string" || !PROVIDER_ID.test(p.id) || !sources.includes(p.source)) return false;
        checkedIds([p.id]);
        if (name === "claude") return scope === "cli" && p.source === "claude.auth.apiProvider" && p.id === nativeBindings.claude.firstPartyProvider;
        if (name === "codex") return scope === "cli" && (p.source === "codex.config/read" ||
          (p.source === "codex.builtin-provider" && p.id === nativeBindings.codex.builtinProvider && typeof record.version === "string" && CODEX_BUILTIN_PROVIDER_VERSIONS.has(record.version)) ||
          (p.source === "codex.builtin-provider.unverified" && p.id === nativeBindings.codex.builtinProvider && typeof record.version === "string" && newerThanVerifiedCodex(record.version)));
        if (name === "agy") return scope === "cli" && p.source === "agy.command.config" && record.authenticated === "yes" && Object.values(nativeBindings.agy.providerBindings).includes(p.id);
        return name === "opencode" && scope === "model" && modelID?.startsWith(p.id + "/") === true &&
          (p.source === "opencode.models.providerID" || p.source === "opencode.models.providerPrefix" ||
            (httpCatalog && p.source === "opencode.config/providers.providerID"));
      };
      if (Object.hasOwn(record, "provider") && !binding(record.provider, "cli")) return false;
      const ids: unknown[] = [], aliases = new Set<string>();
      for (const entry of record.models) {
        const model = object(entry);
        if (!shape(model, ["id", "efforts"], ["provider", "aliases", "variants", "effortSource"])) return false;
        if (httpCatalog && object(model.provider).source !== "opencode.config/providers.providerID") return false;
        ids.push(model.id);
        if (model.efforts !== null) checkedEfforts(model.efforts);
        if (name === "agy" && model.efforts !== null && (record.authenticated !== "yes" || model.effortSource !== "agy.command.model" || !record.sources.includes("agy.command.model") || (model.efforts as unknown[]).length > 1)) return false;
        if (Object.hasOwn(model, "provider")) {
          const scope = name === "opencode" ? "model" : "cli";
          if (!binding(model.provider, scope, typeof model.id === "string" ? model.id : undefined)) return false;
          const p = object(model.provider);
          if (p.scope === "cli") {
            const cli = object(record.provider);
            if (p.id !== cli.id || p.source !== cli.source || p.scope !== cli.scope) return false;
          }
        }
        if (Object.hasOwn(model, "aliases")) {
          const values = checkedIds(model.aliases);
          if (name !== "claude" || !values.length || values.length > 64 || values.some(id => aliases.has(id))) return false;
          values.forEach(id => aliases.add(id));
        }
        if (Object.hasOwn(model, "variants")) { if (name !== "opencode") return false; checkedVariants(model.variants); }
        if (name === "opencode" && model.efforts !== null && (model.efforts as unknown[]).length === 0 &&
            (!OPENCODE_NATIVE_VARIANT_VERSIONS.has(record.version as string) || checkedVariants(model.variants).length !== 0 ||
             model.effortSource !== (httpCatalog ? "opencode.config/providers.variants" : "opencode.models.variants"))) return false;
        if (Object.hasOwn(model, "effortSource")) {
          const expected = name === "claude" ? "claude.sdk.initialize" : name === "codex" ? "model/list" : name === "agy" ? "agy.command.model" : httpCatalog ? "opencode.config/providers.variants" : "opencode.models.variants";
          if (model.efforts === null) { if (model.effortSource !== null) return false; }
          else if (model.effortSource !== expected || !record.sources.includes(expected)) return false;
          if (name === "opencode" && model.efforts !== null && (!Array.isArray(model.variants) || (model.efforts as unknown[]).some((e: unknown) => !(model.variants as unknown[]).includes(e)))) return false;
        }
      }
      checkedIds(ids);
      if ((record.catalog === "observed" && (record.installed !== "yes" || !ids.length)) ||
          (record.catalog === "unknown" && ids.length > 0) || (record.catalog === "declared" && name !== "agy")) return false;
      if (Object.hasOwn(record, "providerConnections")) {
        if (name !== "opencode" || record.catalog !== "observed" || !record.sources.includes("opencode.provider/list.connected") ||
            !Array.isArray(record.providerConnections) || record.providerConnections.length > 512) return false;
        const connections: unknown[] = [];
        for (const value of record.providerConnections) {
          const p = object(value);
          if (!shape(p, ["id", "connected", "source"]) || typeof p.id !== "string" || !PROVIDER_ID.test(p.id) ||
              !fact(p.connected) || p.source !== "opencode.provider/list.connected") return false;
          connections.push(p.id);
        }
        checkedIds(connections);
      } else if (record.sources.includes("opencode.provider/list.connected")) return false;
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
