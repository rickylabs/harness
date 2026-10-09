/** The usage-probe invocation for one configured source: a pinned Deno permission vector and a minimal child environment. */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { UsageSource } from "../domain/source.js";
import type { UsageCommand } from "../ports/source.js";

export function usageCommand(source: UsageSource, credential: string): UsageCommand {
  const imports = {
    "harness:usage": pathToFileURL(join(source.checkout, ".llm/tools/agentic/runtime/provider-usage.ts")).href,
    "harness:usage-validity": pathToFileURL(join(source.checkout, ".llm/tools/agentic/config/subscriptions.ts")).href,
  };
  return { bin: source.denoBin, args: ["run", "--no-config", "--no-lock", "--no-prompt", "--no-remote", "--no-code-cache",
    `--import-map=data:application/json,${encodeURIComponent(JSON.stringify({ imports }))}`,
    `--allow-env=${source.credentialEnv}`, `--allow-net=${source.allowNet}`, source.probe,
    source.model, source.credentialEnv, String(source.maxBytes), String(source.timeoutMs)],
    env: { [source.credentialEnv]: credential, DENO_NO_UPDATE_CHECK: "1", DENO_DIR: "/dev/null" },
    timeoutMs: source.timeoutMs, maxBytes: source.maxBytes };
}
