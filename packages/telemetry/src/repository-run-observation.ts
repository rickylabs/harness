/** Selected local Codex source reader. Deliberately independent of the lossy backfill fold. */
import { constants, type Stats } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, relative, sep } from "node:path";
import { readRepositoryRunObservation, type RepositoryRunBinding, type RepositoryRunObservation,
  type RunObservationCoverage, type ObservedRepositoryRun, type RunTokenObservation } from "@rickylabs/harness-contracts";

const exec = promisify(execFile);
const DESCRIPTOR_CAP = 64 * 1024, SOURCE_CAP = 32 * 1024 * 1024, LINE_CAP = 1024 * 1024;
const EPOCH = "1970-01-01T00:00:00.000Z";
type Failure = Exclude<RunObservationCoverage, { status: "read" }>;
const unavailable = (reason: Extract<Failure, { status: "unavailable" }>["reason"]): Failure => ({ status: "unavailable", reason });
const incomplete = (reason: Extract<Failure, { status: "incomplete" }>["reason"]): Failure => ({ status: "incomplete", reason });
class ReadFailure extends Error { constructor(readonly coverage: Failure) { super("source unavailable"); } }
const fail = (coverage: Failure): never => { throw new ReadFailure(coverage); };
const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const identifier = (v: unknown): v is string => typeof v === "string" && v.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v);
const safePath = (v: unknown): v is string => typeof v === "string" && v.length <= 4096 && isAbsolute(v) && !/[\x00-\x1f\x7f]/.test(v);
const sameNode = (a: Stats, b: Stats): boolean => a.dev === b.dev && a.ino === b.ino;
const sameFile = (a: Stats, b: Stats): boolean => sameNode(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const contains = (root: string, path: string): boolean => { const r = relative(root, path); return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`)); };
interface FileSnapshot { bytes: Buffer; identity: Stats; canonical: string }
interface DirectorySnapshot { canonical: string; identity: Stats }
export interface RepositoryRunSourceDescriptor {
  readonly schema: 1;
  readonly binding: RepositoryRunBinding;
  readonly source: { readonly kind: "codex"; readonly root: string; readonly file: string; readonly nativeId: string };
  readonly worktree: string;
  readonly gitCommonDirectory: string;
}
/** Deterministic tests may pause at these points. The CLI has no flags/env access to this seam. */
export interface RepositoryRunReadOptions {
  readonly checkpoint?: (point: "descriptor-snapshotted" | "binding-snapshotted" | "source-opened" | "source-read" | "before-final-checks") => void | Promise<void>;
  readonly now?: () => string;
}
function descriptor(bytes: Buffer): RepositoryRunSourceDescriptor {
  const d = obj(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (!d || Object.keys(d).sort().join() !== "binding,gitCommonDirectory,schema,source,worktree" || d.schema !== 1) throw new Error("invalid descriptor");
  const s = obj(d.source);
  if (!s || Object.keys(s).sort().join() !== "file,kind,nativeId,root" || s.kind !== "codex" || !identifier(s.nativeId) || !safePath(s.root) || !safePath(s.file) || !safePath(d.worktree) || !safePath(d.gitCommonDirectory)) throw new Error("invalid descriptor");
  const read = readRepositoryRunObservation({ schema: 1, protocol: 1, binding: d.binding, capturedAt: EPOCH,
    coverage: unavailable("source-missing"), verification: null, run: null });
  if (!read.ok) throw new Error("invalid descriptor");
  return { schema: 1, binding: read.observation.binding, source: { kind: "codex", root: s.root, file: s.file, nativeId: s.nativeId }, worktree: d.worktree, gitCommonDirectory: d.gitCommonDirectory };
}
async function fileSnapshot(path: string, cap: number, changed: Failure, root?: string, opened?: () => Promise<void>): Promise<FileSnapshot> {
  const canonical = await realpath(path);
  if (root !== undefined && !contains(root, canonical)) return fail(unavailable("scope-mismatch"));
  const initial = await stat(path);
  if (!initial.isFile()) return fail(unavailable("source-unreadable"));
  if (initial.size > cap) return fail(unavailable("source-too-large"));
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) return fail(unavailable("source-unreadable"));
    if (before.size > cap) return fail(unavailable("source-too-large"));
    if (!sameFile(initial, before)) return fail(changed);
    await opened?.();
    const bytes = Buffer.alloc(Math.min(before.size + 1, cap + 1));
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > cap) return fail(unavailable("source-too-large"));
    try {
      const after = await handle.stat();
      const pathAfter = await stat(path);
      if (length !== before.size || !sameFile(before, after) || !sameFile(before, pathAfter) || await realpath(path) !== canonical) return fail(changed);
      return { bytes: bytes.subarray(0, length), identity: after, canonical };
    } catch { return fail(changed); }
  } finally { await handle.close(); }
}
async function directory(path: string): Promise<DirectorySnapshot> {
  const canonical = await realpath(path), identity = await stat(canonical);
  if (!identity.isDirectory()) throw new Error("invalid directory");
  return { canonical, identity };
}
async function gitIdentity(worktree: string): Promise<string> {
  // No inherited GIT_* redirection, global config, optional locks, hooks or remote operations.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" };
  const { stdout } = await exec("git", ["-C", worktree, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { env, encoding: "utf8", timeout: 5000, maxBuffer: 16384 });
  return stdout;
}
interface BindingSnapshot { root: DirectorySnapshot | null; worktree: DirectorySnapshot | null; common: DirectorySnapshot | null; git: string | null }
async function bindingSnapshot(d: RepositoryRunSourceDescriptor): Promise<BindingSnapshot> {
  const availableDirectory = async (path: string): Promise<DirectorySnapshot | null> => {
    try { return await directory(path); } catch { return null; }
  };
  const root = await availableDirectory(d.source.root), worktree = await availableDirectory(d.worktree), common = await availableDirectory(d.gitCommonDirectory);
  let git: string | null = null;
  if (worktree) { try { git = await gitIdentity(worktree.canonical); } catch { /* Unverified association, never raw Git errors. */ } }
  return { root, worktree, common, git };
}
async function corroborate(scope: BindingSnapshot): Promise<Failure | null> {
  if (!scope.root || !scope.worktree || !scope.common || scope.git === null) return unavailable("scope-unverified");
  const parts = scope.git.trimEnd().split("\n");
  if (parts.length !== 2 || !safePath(parts[0]) || !safePath(parts[1])) return unavailable("scope-unverified");
  try {
    if (await realpath(parts[0]) !== scope.worktree.canonical || await realpath(parts[1]) !== scope.common.canonical) return unavailable("scope-mismatch");
  } catch { return unavailable("scope-unverified"); }
  return null;
}
function sameBinding(a: BindingSnapshot, b: BindingSnapshot): boolean {
  return a.git === b.git && (["root", "worktree", "common"] as const).every(k => {
    const before = a[k], after = b[k];
    return before === null || after === null ? before === after : before.canonical === after.canonical && sameNode(before.identity, after.identity);
  });
}
function timestamp(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
}
async function extract(bytes: Buffer, d: RepositoryRunSourceDescriptor, scope: BindingSnapshot | null, scopeFailure: Failure | null): Promise<ObservedRepositoryRun> {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail(incomplete("malformed-record")); }
  const rows: Record<string, unknown>[] = [];
  let unknown = false;
  const lines = text.split("\n");
  if (lines.some(line => Buffer.byteLength(line) > LINE_CAP)) return fail(unavailable("source-too-large"));
  for (const line of lines) {
    if (!line.trim()) continue;
    let r: Record<string, unknown> | null;
    try { r = obj(JSON.parse(line)); } catch { return fail(incomplete("malformed-record")); }
    if (!r) return fail(incomplete("malformed-record"));
    // The two supplemental envelopes have their own reviewed identity/evidence refusal rules.
    if (!obj(r.payload) && r.type !== "world_state" && r.type !== "token_usage_record") return fail(incomplete("malformed-record"));
    if (!["session_meta", "turn_context", "event_msg", "response_item", "compacted", "world_state", "token_usage_record"].includes(String(r.type))) unknown = true;
    rows.push(r);
  }
  if (unknown) return fail(incomplete("unknown-envelope"));
  const ids = new Set<string>();
  for (const r of rows) if (r.type === "session_meta") {
    const p = obj(r.payload)!;
    for (const k of ["id", "session_id"]) if (Object.hasOwn(p, k)) {
      if (!identifier(p[k])) return fail(unavailable("identity-mismatch"));
      ids.add(p[k]);
    }
  }
  if (!ids.size) return fail(unavailable("identity-missing"));
  if (ids.size !== 1 || !ids.has(d.source.nativeId)) return fail(unavailable("identity-mismatch"));
  // Supplemental token records corroborate identity only. No other payload field is consulted.
  for (const r of rows) if (r.type === "token_usage_record") {
    const p = obj(r.payload);
    if (!p || !identifier(p.thread_id) || !identifier(p.session_id) || p.thread_id !== d.source.nativeId || p.session_id !== d.source.nativeId) return fail(unavailable("identity-mismatch"));
  }
  if (scopeFailure) return fail(scopeFailure);
  if (!scope) return fail(unavailable("scope-unverified"));
  let positive = false, unverified = false, mismatch = false;
  for (const r of rows) if (r.type === "session_meta" || r.type === "turn_context") {
    const p = obj(r.payload)!;
    if (!Object.hasOwn(p, "cwd")) continue;
    if (!safePath(p.cwd)) { unverified = true; continue; }
    try {
      const cwd = await directory(p.cwd);
      if (!contains(scope.worktree!.canonical, cwd.canonical)) mismatch = true;
      else if (r.type === "session_meta") positive = true;
    } catch { unverified = true; }
  }
  // Only the reviewed full environment map is a scope assertion. Never mine other fields.
  let invalidWorldState = false;
  for (const r of rows) if (r.type === "world_state") {
    const p = obj(r.payload), state = obj(p?.state), environments = obj(state?.environments), map = obj(environments?.environments);
    if (p?.full !== true || !state || !environments || !map || Object.keys(map).length === 0) {
      invalidWorldState = true; continue;
    }
    for (const value of Object.values(map)) {
      const environment = obj(value);
      if (!environment || !safePath(environment.cwd)) { invalidWorldState = true; continue; }
      try {
        const cwd = await directory(environment.cwd);
        if (!contains(scope.worktree!.canonical, cwd.canonical)) mismatch = true;
      } catch { unverified = true; }
    }
  }
  if (mismatch) return fail(unavailable("scope-mismatch"));
  if (!positive || unverified) return fail(unavailable("scope-unverified"));
  let previous: string | null = null;
  for (const r of rows) {
    if (!timestamp(r.timestamp) || (previous !== null && r.timestamp < previous)) return fail(incomplete("invalid-timestamp"));
    previous = r.timestamp;
  }
  if (invalidWorldState) return fail(incomplete("invalid-evidence"));
  const identity: { provider: ObservedRepositoryRun["identity"]["provider"]; model: ObservedRepositoryRun["identity"]["model"]; effort: ObservedRepositoryRun["identity"]["effort"] } = { provider: null, model: null, effort: null };
  let usage: RunTokenObservation | null = null;
  let execution: ObservedRepositoryRun["execution"] = { status: "unknown", observedAt: null };
  for (const r of rows) {
    const p = obj(r.payload)!, observedAt = r.timestamp as string;
    const leaf = (key: keyof typeof identity, v: unknown): void => {
      if (typeof v !== "string" || v.length < 1 || v.length > 200 || !/^[A-Za-z0-9_./:-]+$/.test(v)) fail(incomplete("invalid-evidence"));
      identity[key] = { value: v as string, observedAt };
    };
    if (r.type === "session_meta" && Object.hasOwn(p, "model_provider")) leaf("provider", p.model_provider);
    if (r.type === "turn_context") {
      if (Object.hasOwn(p, "model")) leaf("model", p.model);
      if (Object.hasOwn(p, "effort")) leaf("effort", p.effort);
      const mode = obj(p.collaboration_mode), settings = obj(mode?.settings);
      if (settings) {
        if (Object.hasOwn(settings, "model")) leaf("model", settings.model);
        if (Object.hasOwn(settings, "reasoning_effort")) leaf("effort", settings.reasoning_effort);
      }
    }
    if (r.type !== "event_msg") continue;
    if (p.type === "token_count") {
      const info = obj(p.info);
      if (p.info !== undefined && p.info !== null && !info) return fail(incomplete("invalid-evidence"));
      if (info && Object.hasOwn(info, "total_token_usage")) {
        const total = obj(info.total_token_usage);
        if (!total) return fail(incomplete("invalid-evidence"));
        const counts: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheReadTokens?: number } = {};
        const fields = { input_tokens: "inputTokens", output_tokens: "outputTokens", reasoning_output_tokens: "reasoningTokens", cached_input_tokens: "cacheReadTokens" } as const;
        for (const [wire, field] of Object.entries(fields)) if (Object.hasOwn(total, wire)) {
          const n = total[wire];
          if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return fail(incomplete("invalid-evidence"));
          counts[field] = n === 0 ? 0 : n;
        }
        usage = Object.keys(counts).length ? { observedAt, ...counts } : null;
      }
    }
    if (p.type === "task_started") execution = { status: "unknown", observedAt: null };
    if (p.type === "task_complete") execution = { status: "source-reported-complete", observedAt };
    if (["error", "stream_error", "turn_aborted"].includes(String(p.type))) execution = { status: "source-reported-error", observedAt };
  }
  return { source: "codex", nativeId: d.source.nativeId, firstObservedAt: rows[0]!.timestamp as string, lastObservedAt: previous!, identity, usage, execution,
    relationships: { parent: "unavailable", agent: "unavailable", task: "unavailable", messages: "unavailable", certification: "unavailable" } };
}

/** Throws only a fixed descriptor/internal error; valid enrolled bindings survive source refusal. */
export async function collectRepositoryRunObservation(path: string, options: RepositoryRunReadOptions = {}): Promise<RepositoryRunObservation> {
  let initial: FileSnapshot, d: RepositoryRunSourceDescriptor;
  try {
    if (!safePath(path)) throw new Error();
    initial = await fileSnapshot(path, DESCRIPTOR_CAP, incomplete("binding-changed"));
    d = descriptor(initial.bytes);
  } catch { throw new Error("run-observation: invalid descriptor"); }
  const checkpoint = options.checkpoint ?? (() => {}), now = options.now ?? (() => new Date().toISOString());
  await checkpoint("descriptor-snapshotted");
  const scope = await bindingSnapshot(d), scopeFailure = await corroborate(scope);
  await checkpoint("binding-snapshotted");
  let source: FileSnapshot | null = null, failure: Failure | null = null, run: ObservedRepositoryRun | null = null;
  try {
    // Canonical containment is checked before opening the selected source bytes.
    const canonical = await realpath(d.source.file);
    let root: string;
    try { root = scope.root?.canonical ?? await realpath(d.source.root); }
    catch { return fail(scopeFailure ?? unavailable("scope-unverified")); }
    if (!contains(root, canonical)) fail(unavailable("scope-mismatch"));
    source = await fileSnapshot(d.source.file, SOURCE_CAP, incomplete("source-changed"), root, async () => { await checkpoint("source-opened"); });
    if (!contains(root, source.canonical)) fail(unavailable("scope-mismatch"));
    await checkpoint("source-read");
    run = await extract(source.bytes, d, scope, scopeFailure);
  } catch (e) {
    failure = e instanceof ReadFailure ? e.coverage : unavailable(obj(e)?.code === "ENOENT" ? "source-missing" : "source-unreadable");
  }
  await checkpoint("before-final-checks");
  try {
    const final = await fileSnapshot(path, DESCRIPTOR_CAP, incomplete("binding-changed"));
    if (final.canonical !== initial.canonical || !sameFile(final.identity, initial.identity) || !final.bytes.equals(initial.bytes)) fail(incomplete("binding-changed"));
    if (!sameBinding(scope, await bindingSnapshot(d))) fail(incomplete("binding-changed"));
  } catch { failure = incomplete("binding-changed"); }
  if (source && failure?.reason !== "binding-changed") {
    try {
      if (await realpath(d.source.file) !== source.canonical || !sameFile(await stat(d.source.file), source.identity)) fail(incomplete("source-changed"));
    } catch { failure = incomplete("source-changed"); }
  }
  const verification = failure === null && run !== null ? { basis: "enrollment-and-local-worktree", verifiedAt: now() } : null;
  const result = readRepositoryRunObservation({ schema: 1, protocol: 1, binding: d.binding, capturedAt: now(), coverage: failure ?? { status: "read", reason: null }, verification, run: failure ? null : run });
  if (!result.ok) throw new Error("run-observation: collection failed");
  return result.observation;
}
