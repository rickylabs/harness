/** Native Orchid change invalidations. Structured snapshots, never events, establish facts. */
import { createConnection, type Socket } from "node:net";
import { isAbsolute } from "node:path";
import { EventEmitter, once } from "node:events";
export interface IssueFeedChanges {
  consume(): boolean;
  /** Wait without consuming: hints received during a scan or write must survive registration. */
  wait(signal: AbortSignal): Promise<void>;
  close(): void;
}
const WAKE = "change", SUBSCRIPTION = "run-changes";
const HANDSHAKE_MS = 5000, RECONNECT_MS = 1000, FRAME_BYTES = 65536;
/** A fixed read-only subscription; one dirty bit and one bounded frame, no receipt/history watch. */
export function openIssueFeedChanges(socket: string | undefined): IssueFeedChanges {
  let dirty = false, closed = false, connection: Socket | undefined, retry: NodeJS.Timeout | undefined;
  const wake = new EventEmitter();
  const invalidate = () => { if (!closed) { dirty = true; wake.emit(WAKE); } };
  const connect = () => {
    if (closed || !socket || !isAbsolute(socket)) return;
    let bytes = Buffer.alloc(0), acknowledged = false;
    const conn = connection = createConnection(socket);
    conn.setTimeout(HANDSHAKE_MS, () => { if (!acknowledged) conn.destroy(); });
    // Close owns loss invalidation; failed reconnects cannot generate a scan every second.
    conn.on("error", () => {});
    conn.once("connect", () => conn.write(JSON.stringify({ id: SUBSCRIPTION, method: "run.subscribe", params: {} }) + "\n"));
    conn.on("data", (chunk: Buffer) => {
      if (bytes.length + chunk.length > FRAME_BYTES) { conn.destroy(); return; }
      bytes = Buffer.concat([bytes, chunk]);
      for (let at = bytes.indexOf(10); at >= 0; at = bytes.indexOf(10)) {
        try {
          const frame = JSON.parse(bytes.subarray(0, at).toString("utf8")); bytes = bytes.subarray(at + 1);
          if (!acknowledged && frame.id === SUBSCRIPTION && frame.result?.type === "subscription_started") {
            acknowledged = true; invalidate(); conn.setTimeout(0);
          } else if (acknowledged && frame.event?.type === "runs_changed") invalidate();
          else throw Error();
        } catch { conn.destroy(); return; }
      }
    });
    conn.once("close", () => {
      if (acknowledged) invalidate();
      if (!closed) { retry = setTimeout(connect, RECONNECT_MS); retry.unref(); }
    });
    conn.unref();
  };
  connect();
  return { consume() { const value = dirty; dirty = false; return value; }, async wait(signal) {
    signal.throwIfAborted();
    if (dirty || closed) return;
    await once(wake, WAKE, { signal });
  }, close() {
    closed = true; if (retry) clearTimeout(retry); connection?.destroy(); wake.emit(WAKE);
  } };
}
