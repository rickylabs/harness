/** Receipt-window filename discovery; does not follow process ancestry or widen the read window. */
import { lstat, opendir } from "node:fs/promises";
import { join } from "node:path";
import type { CodexName } from "./codex-selection.js";
import type { Transcript } from "./transcript-read.js";
import type { Scan } from "./index.js";
/** The machine-readable part of a thrown error. No message, and therefore no path in it. */
export function errorCode(error: unknown): string {
  const code = (error as { readonly code?: unknown } | null)?.code;
  if (typeof code === "string" && code.length > 0) return code;
  return error instanceof Error ? error.name : "unknown error";
}

/**
 * The longest receipt window an issue scan accepts: a run read up to seven days after its dispatch,
 * plus ten minutes before the dispatch and ten after the end. Rollout names stay under the same
 * per-directory entry bound and per-scan name bound whatever the window's length.
 */
export const CODEX_WINDOW_MAX_MS = 7 * 86_400_000 + 2 * 600_000;

/**
 * Visit an offset-safe envelope around receipt dates; filename clocks may be local to another process.
 * With `namesOnly`, canonical names are listed with their creation clock and session id and no
 * file is opened or stat'ed: an issue scan picks the ones it reads by name.
 */
export async function collectCodexWindows(root: string, windows: readonly { readonly startMs: number; readonly endMs: number }[], limit: number,
  offsetEnvelopeMs: number, namesOnly = false): Promise<Scan> {
  try {
    if (!(await lstat(root)).isDirectory()) return { kind: "unreadable", reason: "not a directory" };
  } catch (error) {
    const reason = errorCode(error);
    return reason === "ENOENT" ? { kind: "absent" } : { kind: "unreadable", reason };
  }
  if (windows.length === 0 || windows.length > 8 || windows.some(w => !Number.isSafeInteger(w.startMs) ||
      !Number.isSafeInteger(w.endMs) || w.endMs < w.startMs || w.endMs - w.startMs > CODEX_WINDOW_MAX_MS)) {
    return { kind: "unreadable", reason: "invalid receipt window" };
  }
  const dates = new Set<string>();
  for (const window of windows) {
    for (let day = Math.floor((window.startMs - offsetEnvelopeMs) / 86_400_000);
      day <= Math.floor((window.endMs + offsetEnvelopeMs) / 86_400_000); day++) {
      dates.add(new Date(day * 86_400_000).toISOString().slice(0, 10));
    }
  }
  const files: Transcript[] = [];
  const names: CodexName[] = [];
  let skipped = 0;
  let limited = false;
  for (const date of [...dates].sort()) {
    const [year, month, day] = date.split("-");
    const dir = join(root, year!, month!, day!);
    let dirHandle;
    try {
      for (const part of [join(root, year!), join(root, year!, month!), dir]) {
        if (!(await lstat(part)).isDirectory()) throw new Error("not a directory");
      }
      dirHandle = await opendir(dir);
    }
    catch (error) { if (errorCode(error) !== "ENOENT") skipped++; continue; }
    let entriesSeen = 0;
    try {
      for await (const entry of dirHandle) {
        if (++entriesSeen > 1000) { limited = true; break; }
        if (!entry.name.startsWith("rollout-")) continue;
        const match = /^rollout-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-([0-9a-f-]{36})\.jsonl$/.exec(entry.name);
        if (!entry.isFile() || !match || match[1] !== date) { skipped++; continue; }
        const created = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.000Z`);
        if (!Number.isFinite(created) || !windows.some(w =>
          created >= w.startMs - offsetEnvelopeMs && created <= w.endMs + offsetEnvelopeMs)) continue;
        const path = join(dir, entry.name);
        if (namesOnly) {
          names.push({ path, createdMs: created, id: match[5]! });
          if (names.length > limit) break;
          continue;
        }
        const found = await lstat(path).catch(() => null);
        if (!found?.isFile()) skipped++;
        else files.push({ path, mtimeMs: found.mtimeMs });
        if (files.length > limit) break;
      }
    } catch { skipped++; }
    if (limited || files.length > limit || names.length > limit) break;
  }
  return { kind: "found", files, skipped, limited, ...(namesOnly ? { names } : {}) };
}
