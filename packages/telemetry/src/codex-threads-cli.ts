import { CodexReadError } from "./codex-thread-connection.js";
import type { Writable } from "node:stream";
import { openCodexThreadReader, type CodexThreadReader, type CodexThreadReadOptions } from "./codex-threads.js";
/** The JSON stream is for an authenticated consumer, never an application log. */
export async function codexThreadsCommand(args: readonly string[], open: (options: CodexThreadReadOptions) => Promise<Pick<CodexThreadReader, "read" | "events" | "close">> = openCodexThreadReader, output: Writable = process.stdout): Promise<number> {
  let limit = 500, includeSensitive = false, watch = false;
  const seen = new Set<string>();
  try {
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]!;
      if (seen.has(flag)) throw new Error();
      seen.add(flag);
      if (flag === "--private") includeSensitive = true;
      else if (flag === "--watch") watch = true;
      else if (flag === "--json") { /* Always JSON. */ }
      else if (flag === "--limit" && /^[1-9]\d*$/.test(args[i + 1] ?? "")) limit = Number(args[++i]);
      else throw new Error();
    }
    if (limit > 5000) throw new Error();
  } catch { process.stderr.write("codex-threads: invalid command line\n"); return 2; }
  let reader: Pick<CodexThreadReader, "read" | "events" | "close"> | undefined;
  let stopped = false;
  let rejectWrite: ((error: CodexReadError) => void) | undefined;
  const stop = () => { stopped = true; reader?.close(); rejectWrite?.(new CodexReadError("source_closed")); output.destroy(); };
  output.on("error", stop); output.on("close", stop);
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    reader = await open({ limit, includeSensitive });
    if (stopped) { reader.close(); return 3; }
    // Await each write callback: one message at a time, including when write() accepts it immediately.
    const write = (value: unknown) => new Promise<void>((resolve, reject) => {
      rejectWrite = reject;
      output.write(JSON.stringify(value) + "\n", error => {
        rejectWrite = undefined;
        if (error) reject(new CodexReadError("source_unavailable")); else resolve();
      });
    });
    const snapshot = await reader.read(); await write(snapshot);
    if (watch) {
      for await (const event of reader.events()) {
        await write(event);
        if (event.type === "unavailable") return 3;
      }
    }
    return !stopped && snapshot.complete ? 0 : 3;
  } catch (error) { process.stderr.write(`codex-threads: ${error instanceof CodexReadError ? error.reason : "source_unavailable"}\n`); return 3; }
  finally { reader?.close(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); output.removeListener("error", stop); output.removeListener("close", stop); }
}
