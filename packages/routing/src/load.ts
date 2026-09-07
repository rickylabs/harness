/** Bounded UTF-8 document loading. Diagnostics contain codes and structural paths only. */
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { deepFreeze, fieldPath, MAX_DEPTH, MAX_DOCUMENT_BYTES, validateRoutingConfiguration } from "./schema.js";
import type { InvalidProblem, RoutingConfiguration } from "./schema.js";
import type { PolicyProblem } from "./resolve.js";

export type LoadRefusal =
  | { readonly kind: "unreadable"; readonly code: "absent" | "not-a-file" | "permission" | "too-large" }
  | { readonly kind: "malformed"; readonly code: "not-json" | "not-utf8" | "root-not-object" }
  | { readonly kind: "unsupported-schema-version"; readonly seen: number | null; readonly supported: readonly [1] }
  | { readonly kind: "invalid"; readonly problems: readonly InvalidProblem[] }
  | { readonly kind: "invariant"; readonly problems: readonly PolicyProblem[] };
export interface LoadedRoutingConfiguration {
  readonly configuration: RoutingConfiguration;
  readonly source: { readonly id: string; readonly digest: string; readonly bytes: number; readonly schemaVersion: 1; readonly name: string };
}
export type LoadOutcome = { readonly ok: true; readonly loaded: LoadedRoutingConfiguration } | { readonly ok: false; readonly refusal: LoadRefusal };

/** Scan tokens before parsing to cap nesting. Strings cannot contribute bracket tokens. */
function tooDeep(text: string): boolean {
  let depth = 0;
  for (const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[\[\]{}]/g)) {
    if (token[0] === "[" || token[0] === "{") { if (depth++ > MAX_DEPTH) return true; }
    else if (token[0] === "]" || token[0] === "}") depth--;
  }
  return false;
}
/** JSON.parse discards duplicate keys. Inspect the already syntax-checked token stream as well. */
function duplicateKeys(text: string): InvalidProblem[] {
  const tokens = text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? [];
  let offset = 0;
  const problems: InvalidProblem[] = [];
  function visit(path: string): void {
    const token = tokens[offset++];
    if (token === "{") {
      const seen = new Set<string>();
      let i = 0;
      while (tokens[offset] !== "}") {
        const key = JSON.parse(tokens[offset++]!) as string;
        if (seen.has(key)) problems.push({ code: "duplicate", path: fieldPath(path, key, i) });
        seen.add(key);
        offset++; // colon
        visit(fieldPath(path, key, i++));
        if (tokens[offset] !== ",") break;
        offset++;
      }
      offset++;
    } else if (token === "[") {
      let i = 0;
      while (tokens[offset] !== "]") {
        visit(`${path}[${i++}]`);
        if (tokens[offset] !== ",") break;
        offset++;
      }
      offset++;
    }
  }
  visit("$");
  return problems;
}

export function parseRoutingDocument(text: string, sourceId: string): LoadOutcome {
  if (typeof text !== "string") return { ok: false, refusal: { kind: "malformed", code: "not-json" } };
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_DOCUMENT_BYTES) return { ok: false, refusal: { kind: "invalid", problems: [{ code: "size-exceeded", path: "$" }] } };
  // Lone UTF-16 surrogates have no exact UTF-8 representation. Never hash replacement bytes.
  if (Buffer.from(text, "utf8").toString("utf8") !== text) return { ok: false, refusal: { kind: "malformed", code: "not-utf8" } };
  if (tooDeep(text)) return { ok: false, refusal: { kind: "invalid", problems: [{ code: "depth-exceeded", path: "$" }] } };
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { return { ok: false, refusal: { kind: "malformed", code: "not-json" } }; }
  const duplicates = duplicateKeys(text);
  if (duplicates.length) return { ok: false, refusal: { kind: "invalid", problems: duplicates } };
  const validated = validateRoutingConfiguration(value);
  if (!validated.ok) return validated;
  return { ok: true, loaded: deepFreeze({ configuration: validated.configuration, source: {
    id: sourceId, digest: `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
    bytes, schemaVersion: validated.configuration.schemaVersion, name: validated.configuration.name,
  } }) };
}

export async function loadRoutingConfiguration({ path }: { readonly path: string }): Promise<LoadOutcome> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile()) return { ok: false, refusal: { kind: "unreadable", code: "not-a-file" } };
    if (stat.size > MAX_DOCUMENT_BYTES) return { ok: false, refusal: { kind: "unreadable", code: "too-large" } };
    // Bounded reads even if a file grows after stat; never allocate from an untrusted size.
    const buffer = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > MAX_DOCUMENT_BYTES) return { ok: false, refusal: { kind: "unreadable", code: "too-large" } };
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length)); }
    catch { return { ok: false, refusal: { kind: "malformed", code: "not-utf8" } }; }
    return parseRoutingDocument(text, path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, refusal: { kind: "unreadable", code: code === "ENOENT" || code === "ENOTDIR" ? "absent" : code === "EISDIR" ? "not-a-file" : "permission" } };
  } finally { await file?.close().catch(() => {}); }
}

export function describeLoadRefusal(refusal: LoadRefusal): string {
  if ("code" in refusal) return `${refusal.kind}: ${refusal.code}`;
  if (refusal.kind === "unsupported-schema-version") return `${refusal.kind}: seen ${refusal.seen ?? "unknown"}; supported 1`;
  return `${refusal.kind}: ${refusal.problems.map(p => "path" in p ? `${p.code} at ${p.path}` : `${p.code} at ${p.lane}${p.index === undefined ? "" : `.chain[${p.index}]`}`).join("; ")}`;
}
