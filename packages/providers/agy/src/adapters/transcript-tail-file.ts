/** Private, read-only tail read of one vendor log under a store root already certified by the binding. */
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { TranscriptTail, TranscriptTailRead } from "../ports/transcript-tail.js";

const refused: TranscriptTailRead = { bytes: null, reason: "refused" };

/** `expectedUid` defaults to this process: a log owned by anyone else is never read. */
export function transcriptTailFile(expectedUid: number | undefined = process.getuid?.()): TranscriptTail {
  return {
    async read(root, path, maxBytes) {
      const tail = relative(root, path);
      if (!isAbsolute(root) || !isAbsolute(path) || tail === "" || tail === ".." || tail.startsWith(".." + sep) ||
          isAbsolute(tail) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || expectedUid === undefined) return refused;
      let handle;
      try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? { bytes: null, reason: "missing" } : refused; }
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.uid !== expectedUid || stat.nlink !== 1) return refused;
        // A symlinked parent directory resolves elsewhere; only the exact path under the root is read.
        if (await realpath(path) !== path) return refused;
        const start = Math.max(0, stat.size - maxBytes), length = stat.size - start;
        const bytes = new Uint8Array(length);
        let offset = 0;
        while (offset < length) {
          const { bytesRead } = await handle.read(bytes, offset, length - offset, start + offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        return { bytes: bytes.subarray(0, offset), fromStart: start === 0 };
      } catch { return refused; }
      finally { await handle.close(); }
    },
  };
}
