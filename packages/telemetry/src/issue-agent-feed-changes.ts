/** Native Orchid change invalidations. Structured snapshots, never events, establish facts. */
import { createConnection, type Socket } from "node:net";
import { isAbsolute } from "node:path";
export interface IssueFeedChanges {
  consume(): boolean;
  close(): void;
}
/** A fixed read-only subscription; one dirty bit and one bounded frame, no receipt/history watch. */
export function openIssueFeedChanges(socket: string | undefined): IssueFeedChanges {
  let dirty = false, closed = false, connection: Socket | undefined, retry: NodeJS.Timeout | undefined;
  const connect = () => {
    if (closed || !socket || !isAbsolute(socket)) return;
    let bytes = Buffer.alloc(0), acknowledged = false;
    connection = createConnection(socket);
    connection.setTimeout(5000, () => { if (!acknowledged) connection?.destroy(); });
    connection.on("error", () => { dirty = true; });
    connection.once("connect", () => connection?.write(JSON.stringify({ id: "run-changes", method: "run.subscribe", params: {} }) + "\n"));
    connection.on("data", (chunk: Buffer) => {
      if (bytes.length + chunk.length > 65536) { connection?.destroy(); return; }
      bytes = Buffer.concat([bytes, chunk]);
      for (let at = bytes.indexOf(10); at >= 0; at = bytes.indexOf(10)) {
        try {
          const frame = JSON.parse(bytes.subarray(0, at).toString("utf8")); bytes = bytes.subarray(at + 1);
          if (!acknowledged && frame.id === "run-changes" && frame.result?.type === "subscription_started") {
            acknowledged = true; dirty = true; connection?.setTimeout(0);
          } else if (acknowledged && frame.event?.type === "runs_changed") dirty = true;
          else throw Error();
        } catch { connection?.destroy(); return; }
      }
    });
    connection.once("close", () => {
      dirty = true;
      if (!closed) { retry = setTimeout(connect, 1000); retry.unref(); }
    });
    connection.unref();
  };
  connect();
  return { consume() { const value = dirty; dirty = false; return value; }, close() {
    closed = true; if (retry) clearTimeout(retry); connection?.destroy();
  } };
}
