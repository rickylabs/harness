/** The bounded file read the application needs, so it can be exercised without a filesystem. */
export type TranscriptTailRead =
  | { readonly bytes: Uint8Array; readonly fromStart: boolean }
  /** `missing`: no such file. `refused`: present but failing an ownership, link or path check. */
  | { readonly bytes: null; readonly reason: "missing" | "refused" };

export interface TranscriptTail {
  /** At most `maxBytes` from the end of `path`, which must resolve to itself beneath `root`. */
  read(root: string, path: string, maxBytes: number): Promise<TranscriptTailRead>;
}
