/**
 * OpenCode change hints for the issue feed's watch loop, from the server's own event stream: an event
 * naming a session the last scan read marks the feed dirty, so the next pass rescans now rather than
 * at the safety rescan. A hint, never evidence — the scan reads the session again.
 *
 * No polling: one stream, open only while there is a session to watch, never retried in the
 * background. A stream that could not open stays closed until the next scan asks again; one that
 * ended after opening may have dropped events, so it marks the feed dirty once. Nothing is buffered:
 * memory is the watched id set (bounded by the scan) and one flag.
 */
import type { OpenCodeSessionReads } from "./opencode-reads.js";

export interface OpenCodeChanges {
  consume(): boolean;
  /** The sessions the last scan read. An empty set closes the stream. */
  watch(sessions: ReadonlySet<string>): void;
  close(): void;
}

export function openOpenCodeChanges(reads: Pick<OpenCodeSessionReads, "sessionEvents">): OpenCodeChanges {
  let dirty = false, closed = false;
  let watched: ReadonlySet<string> = new Set();
  let stream: AbortController | null = null;
  const open = (): void => {
    const abort = new AbortController();
    stream = abort;
    void (async () => {
      let opened = false;
      try {
        const events = await reads.sessionEvents(abort.signal);
        if (events.kind !== "open") return;
        opened = true;
        for await (const session of events.sessions) if (watched.has(session)) dirty = true;
      } catch { /* A dropped stream is an ended one. */ }
      finally {
        if (stream === abort) stream = null;
        if (opened && !abort.signal.aborted) dirty = true;
      }
    })();
  };
  return {
    consume() { const changed = dirty; dirty = false; return changed; },
    watch(sessions) {
      if (closed) return;
      watched = new Set(sessions);
      if (watched.size === 0) { stream?.abort(); stream = null; }
      else if (stream === null) open();
    },
    close() { closed = true; stream?.abort(); stream = null; },
  };
}
