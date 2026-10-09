import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { createHash } from "node:crypto";
import { readAccountUsageDocument, type AccountUsageEnvelope } from "@rickylabs/harness-contracts";
import { usageFile, usageScopeHash } from "./account-usage.js";
import { collectAccountUsageDocument, readAccountUsageDocumentSource } from "./paid-account-usage.js";
import { resolveWireFamily } from "./producer-names.js";

export const ACCOUNT_USAGE_HELP = `harness-telemetry account-usage --source <descriptor> [--watch]

Read configured native stores and sessionless Codex account quota. No model calls.
--watch emits JSONL every 180 seconds; otherwise emits one JSON document.
The private descriptor binds explicit seat/cwd aliases, store roots, a mode-600
HMAC key file (at least 32 bytes), optional Codex binary/home and a private state file.
Run one collector per state file. Changed source/key scope starts a new baseline.
Claude direct quota is unavailable; missing measurements remain null.
Descriptor schema 2 wraps accountUsage plus configured provider adapters. It emits
the 0.33 reader document with independent billing, local-history and price rows.
GitHub needs GITHUB_COPILOT_PLAN_READ_TOKEN in githubCopilot.credentialFile;
without that owner-only Plan-read credential its billing state is unknown.
Descriptor schema 3 adds capacity ({host} alias or null) and emits the 0.40 document:
schema 2 plus a source capability row for every CLI and dimension, and the host capacity.
`;
/** CLI diagnostics are fixed strings: local paths, native ids, auth and stderr never leave. */
export async function accountUsageCommand(argv: readonly string[]): Promise<number> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { process.stdout.write(ACCOUNT_USAGE_HELP); return 0; }
  if ((argv.length !== 2 && argv.length !== 3) || argv[0] !== "--source" || !argv[1] || !isAbsolute(argv[1]) ||
      /[\x00-\x1f\x7f]/.test(argv[1]) || (argv.length === 3 && argv[2] !== "--watch")) {
    process.stderr.write("account-usage: invalid command line\n"); return 2;
  }
  try {
    const wireFamily = resolveWireFamily(process.env);
    const source = readAccountUsageDocumentSource(JSON.parse((await usageFile(argv[1], 65536)).toString("utf8")));
    const native = source.schemaVersion === 1 ? source : source.accountUsage;
    const key = await usageFile(native.keyFile, 4096, true);
    if (key.length < 32) throw new Error("usage key unavailable");
    const sourceHash = source.schemaVersion === 1 ? usageScopeHash(source, key) : createHash("sha256").update(JSON.stringify(source)).update(key).digest("hex");
    let previous: AccountUsageEnvelope | undefined;
    try {
      const state = JSON.parse((await usageFile(native.stateFile, 4 * 1024 * 1024, true)).toString("utf8")) as { sourceHash?: unknown; snapshot?: unknown };
      const read = readAccountUsageDocument(state.snapshot);
      if (state.sourceHash === sourceHash && read.ok) previous = read.document.schemaVersion === 1 ? read.document : read.document.account;
    } catch { /* Missing, corrupt or changed state means no inference baseline, never empty history. */ }
    do {
      const snapshot = await collectAccountUsageDocument(source, key, previous === undefined ? { wireFamily } : { previous, wireFamily });
      const state = await open(native.stateFile, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try {
        const info = await state.stat();
        if (!info.isFile() || (info.mode & 0o7777) !== 0o600 || info.uid !== process.getuid?.()) throw new Error("usage state unavailable");
        await state.truncate(0);
        await state.writeFile(JSON.stringify({ sourceHash, snapshot }));
        await state.sync();
      } finally { await state.close(); }
      process.stdout.write(`${JSON.stringify(snapshot)}\n`);
      previous = snapshot.schemaVersion === 1 ? snapshot : snapshot.account;
      if (argv[2] !== "--watch") {
        const complete = previous.coverage.every(c => c.state === "complete") && (snapshot.schemaVersion === 1 ||
          Object.values(snapshot.providers.coverage).every(c => c === "not-configured" || c === "known" || c === "complete")) &&
          (snapshot.schemaVersion !== 3 || snapshot.localCapacity.availability === "available" || snapshot.localCapacity.reason === "source_not_bound");
        return complete ? 0 : 3;
      }
      await pause(180000);
    } while (true);
  } catch { process.stderr.write("account-usage: descriptor, key, state or collection unavailable\n"); return 1; }
}
