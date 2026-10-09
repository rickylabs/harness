/**
 * The dispatcher's per-transport availability (Orchid divybot, transport_availability.go): which
 * matrix transports its admission would offer now, and why each other one is out. The snapshot is
 * private: an owner-only regular file, never a link, read whole under a small bound. This adapter reads the
 * bytes; `application/transport-availability.ts` maps them.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { SourceError } from "../domain/source.js";

const MAX_BYTES = 512 * 1024;

export async function readTransportAvailabilityFile(path: string): Promise<string> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { throw new SourceError("file-unreadable"); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== process.getuid?.()) throw new SourceError("file-unreadable");
    if (stat.size > MAX_BYTES) throw new SourceError("oversize");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size) throw new SourceError("file-unreadable");
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally { await handle.close(); }
}
