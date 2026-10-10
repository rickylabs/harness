/** The bounded store read the application needs; the adapter owns every file and SQL access. */
import type { StoreRow } from "../domain/trajectory.js";

/** Decodes one conversation's rows as they are read; null refuses the whole store read. */
export type DecodeConversation<T> = (summary: StoreRow, rows: readonly StoreRow[], origin: string) => T | null;

export type StoreScan<T> =
  | { readonly conversations: readonly T[]; readonly bytesRead: number; readonly files: readonly string[]; readonly reason: null }
  | { readonly conversations: readonly []; readonly bytesRead: number; readonly files: readonly string[];
      readonly reason: "scan_limit" | "source_unavailable" };

export interface StoreSource {
  /** The bound root conversation (`matches`) and its descendants, at most `limit` and `maxBytes`. */
  scan<T>(root: string, matches: (id: string) => boolean, limit: number, maxBytes: number,
    decode: DecodeConversation<T>): Promise<StoreScan<T>>;
}
