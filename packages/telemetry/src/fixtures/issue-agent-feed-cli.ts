/** Shared synthetic fixtures for the issue-agent feed CLI tests. Test support only. */
import { Writable } from "node:stream";

export const at = "2026-01-01T00:00:00.000Z";
/** Collects every written frame line. */
export class Capture extends Writable {
  readonly lines: string[] = [];
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString("utf8")); callback();
  }
}
