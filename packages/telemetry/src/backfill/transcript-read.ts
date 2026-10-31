/** Bounded native transcript IO. Every byte, including unusable records, is charged. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { RunRecord } from "../model.js";
import type { FileHandle } from "node:fs/promises";
import { codexTurnOutcome, KNOWN_TYPES, OBSERVED_UNREAD_ENVELOPES } from "./codex.js";
export interface Transcript { readonly path: string; readonly mtimeMs: number }
/** Additional state lookup is still charged against the caller's remaining frame budget. */
export const CODEX_TURN_SCAN_BYTES = 32 * 1_048_576;
const TURN_SCAN_CHUNK_BYTES = 262_144;

/** Last native boundary in a fully read suffix. A malformed suffix cannot certify a turn. */
function boundary(text: string, notAfterMs: number): string | null | false {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    let row;
    try { row = JSON.parse(line); } catch { return false; }
    if (row === null || typeof row !== "object" || Array.isArray(row)) return false;
    const at = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
    if (!Number.isFinite(at)) return false;
    if (at > notAfterMs) continue;
    if (!KNOWN_TYPES.has(row.type) && !OBSERVED_UNREAD_ENVELOPES.has(row.type)) return false;
    if (codexTurnOutcome(row.payload?.type) !== null) return line + "\n";
  }
  return null;
}

/** Walk contiguous complete native records backwards; never carry state across an unread gap. */
async function readTurnBoundary(file: FileHandle, position: number, stop: number, carry: Buffer,
  budget: number, charge: (bytes: number) => void, notAfterMs: number): Promise<string> {
  let remaining = Math.min(budget, CODEX_TURN_SCAN_BYTES);
  let pending: Buffer[] = [carry];
  while (position > stop && remaining > 0) {
    const length = Math.min(TURN_SCAN_CHUNK_BYTES, remaining, position - stop);
    const bytes = Buffer.allocUnsafe(length);
    let size = 0;
    while (size < length) {
      const read = await file.read(bytes, size, length - size, position - length + size);
      charge(read.bytesRead); remaining -= read.bytesRead;
      if (read.bytesRead === 0) return "";
      size += read.bytesRead;
    }
    position -= length;
    // At stop we know the preceding byte was a newline in the head. Otherwise keep the clipped line.
    const from = position === stop ? 0 : bytes.indexOf(10) + 1;
    if (from === 0 && position !== stop) { pending.unshift(bytes); continue; }
    const found = boundary(Buffer.concat([bytes.subarray(from), ...pending]).toString("utf8"), notAfterMs);
    if (found === false) return "";
    if (found !== null) return found;
    pending = [bytes.subarray(0, from)];
  }
  return "";
}
/**
 * Read the file as it stood when it was opened: never past the size measured then, plus one
 * sentinel byte that shows whether it grew. A file that grew keeps exactly the complete records it
 * held at open, including a final record without its newline when that record is complete JSON on
 * its own; bytes past the measured size are not yet seen and belong to the next read. `charge`
 * receives every byte as it is read, usable or not, so a refusal or an error still pays for it.
 */
export async function readBounded(path: string, maxBytes: number, charge: (bytes: number) => void): Promise<string | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const bytes = Buffer.allocUnsafe(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
      charge(bytesRead);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size <= info.size) return bytes.subarray(0, size).toString("utf8");
    const snapshot = bytes.subarray(0, info.size);
    const lastLine = snapshot.lastIndexOf(10) + 1;
    try {
      // Complete at open: it stays, whatever was appended after it.
      JSON.parse(snapshot.subarray(lastLine).toString("utf8"));
      return snapshot.toString("utf8");
    } catch {
      // Still being written at open: only the records before it were seen.
      return snapshot.subarray(0, lastLine).toString("utf8");
    }
  } finally { await file.close(); }
}

const CODEX_WINDOW_HEAD_BYTES = 262_144;
const CODEX_WINDOW_TAIL_BYTES = 2_097_152;

/**
 * A dispatch-matched rollout past the per-transcript read bound, as its first and last complete
 * records. The head holds the session identity; a bounded reverse read can recover native turn state.
 * Null when either part has no complete record. Nothing is read unless both windows and the tail's
 * one byte of look-behind fit the budget; `charge` receives every byte read, usable or not.
 */
export async function readHeadTail(path: string, maxBytes: number, charge: (bytes: number) => void,
  frameBytes = maxBytes, notAfterMs = Infinity):
  Promise<{ readonly head: string; readonly tail: string; readonly state: string } | null> {
  if (maxBytes < CODEX_WINDOW_HEAD_BYTES + CODEX_WINDOW_TAIL_BYTES + 1) return null;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) return null;
    let charged = 0;
    const account = (bytes: number) => { charged += bytes; charge(bytes); };
    const read = async (position: number, length: number) => {
      const bytes = Buffer.allocUnsafe(length);
      let size = 0;
      while (size < length) {
        const { bytesRead } = await file.read(bytes, size, length - size, position + size);
        account(bytesRead);
        if (bytesRead === 0) break;
        size += bytesRead;
      }
      return bytes.subarray(0, size);
    };
    // The size is fixed here: lines a growing file appends later belong to the next read.
    const head = await read(0, Math.min(info.size, CODEX_WINDOW_HEAD_BYTES));
    const headEnd = head.lastIndexOf(10);
    const tailStart = Math.max(info.size - CODEX_WINDOW_TAIL_BYTES, head.length);
    // One byte of look-behind says whether the tail starts on a record boundary: the first record
    // begins after the first newline, so after a newline at the look-behind byte it is complete and
    // kept, while a clipped first record is dropped unparsed.
    const tail = await read(tailStart - 1, info.size - tailStart + 1);
    const tailFrom = tail.indexOf(10) + 1;
    if (headEnd < 0 || tailFrom === 0) return null;
    // The tail runs to the end of the file: a final record without its newline is still a record.
    const tailText = tail.subarray(tailFrom).toString("utf8");
    const inTail = boundary(tailText, notAfterMs);
    const state = inTail === null ? await readTurnBoundary(file, tailStart, headEnd + 1,
      tailFrom === 1 ? Buffer.alloc(0) : tail.subarray(1, tailFrom),
      Math.max(0, frameBytes - charged), account, notAfterMs) : "";
    return { head: head.subarray(0, headEnd + 1).toString("utf8"), tail: tailText, state };
  } finally { await file.close(); }
}

/**
 * One run from a head and a tail window. Identity comes from the head. State comes only from the
 * tail or its contiguous backward boundary scan: a turn the head saw finish says nothing about one
 * the unread middle may have started. Token history between the windows stays partial.
 */
export function headTailRun(head: RunRecord, tail: RunRecord): RunRecord {
  const samples = tail.tokenSamples;
  return {
    ...tail,
    startedAt: head.startedAt,
    identity: { model: tail.identity.model ?? head.identity.model, effort: tail.identity.effort ?? head.identity.effort,
      provider: head.identity.provider ?? tail.identity.provider, profile: head.identity.profile ?? tail.identity.profile },
    linkedIssues: head.linkedIssues,
    ...(samples === undefined ? {} : { tokenSamples: { ...samples, partial: true } }),
  };
}
