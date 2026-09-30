import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { readAccountUsageEnvelope, type AccountUsageEnvelope } from "@rickylabs/harness-contracts";
import { collectAccountUsage, readAccountUsageSource, usageFile, usageScopeHash } from "./account-usage.js";

export const ACCOUNT_USAGE_HELP = `dsh-telemetry account-usage --source <descriptor> [--watch]

Read configured native stores and sessionless Codex account quota. No model calls.
--watch emits JSONL every 180 seconds; otherwise emits one JSON document.
The private descriptor binds explicit seat/cwd aliases, store roots, a mode-600
HMAC key file (at least 32 bytes), optional Codex binary/home and a private state file.
Run one collector per state file. Changed source/key scope starts a new baseline.
Claude direct quota is unavailable; missing measurements remain null.
`;
/** CLI diagnostics are fixed strings: local paths, native ids, auth and stderr never leave. */
export async function accountUsageCommand(argv: readonly string[]): Promise<number> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { process.stdout.write(ACCOUNT_USAGE_HELP); return 0; }
  if ((argv.length !== 2 && argv.length !== 3) || argv[0] !== "--source" || !argv[1] || !isAbsolute(argv[1]) ||
      /[\x00-\x1f\x7f]/.test(argv[1]) || (argv.length === 3 && argv[2] !== "--watch")) {
    process.stderr.write("account-usage: invalid command line\n"); return 2;
  }
  try {
    const source = readAccountUsageSource(JSON.parse((await usageFile(argv[1], 65536)).toString("utf8")));
    const key = await usageFile(source.keyFile, 4096, true);
    if (key.length < 32) throw new Error("usage key unavailable");
    const sourceHash = usageScopeHash(source, key);
    let previous: AccountUsageEnvelope | undefined;
    try {
      const state = JSON.parse((await usageFile(source.stateFile, 4 * 1024 * 1024, true)).toString("utf8")) as { sourceHash?: unknown; snapshot?: unknown };
      const read = readAccountUsageEnvelope(state.snapshot);
      if (state.sourceHash === sourceHash && read.ok) previous = read.envelope;
    } catch { /* Missing, corrupt or changed state means no inference baseline, never empty history. */ }
    do {
      const snapshot = await collectAccountUsage(source, key, previous === undefined ? {} : { previous });
      const state = await open(source.stateFile, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try {
        const info = await state.stat();
        if (!info.isFile() || (info.mode & 0o777) !== 0o600) throw new Error("usage state unavailable");
        await state.truncate(0);
        await state.writeFile(JSON.stringify({ sourceHash, snapshot }));
        await state.sync();
      } finally { await state.close(); }
      process.stdout.write(`${JSON.stringify(snapshot)}\n`);
      previous = snapshot;
      if (argv[2] !== "--watch") return snapshot.coverage.every(c => c.state === "complete") ? 0 : 3;
      await pause(180000);
    } while (true);
  } catch { process.stderr.write("account-usage: descriptor, key, state or collection unavailable\n"); return 1; }
}
