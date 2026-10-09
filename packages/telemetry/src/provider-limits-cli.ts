import { readProviderLimitsFile } from "@rickylabs/governance";
/** Private source command: fixed diagnostics, no source paths or environment names in output. */
export async function providerLimitsCommand(args: readonly string[], io: { out: (text: string) => void; err: (text: string) => void }): Promise<number> {
  if (args.length !== 2 || args[0] !== "--source" || !args[1]) { io.err("provider-limits requires --source\n"); return 2; }
  try { io.out(JSON.stringify(await readProviderLimitsFile(args[1])) + "\n"); return 0; }
  catch { io.err("provider limits unavailable\n"); return 3; }
}
