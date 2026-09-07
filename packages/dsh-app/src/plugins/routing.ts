/** One explicit document selection, loaded once per Cordis service instance. */
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { describeLoadRefusal, loadRoutingConfiguration, type LoadedRoutingConfiguration } from "@rickylabs/routing";

export const name = "harness-routing";
export const CONTEXT_KEY = "harnessRouting";
export interface RoutingConfig { readonly document: string }
// Optional at the schema layer so createService supplies the same fixed RangeError in every caller.
export const Config = z.object({ document: z.string().description("Required routing JSON path or package subpath. No implicit selection.") });
export type RoutingService = LoadedRoutingConfiguration;
declare module "@deepseek-ai/cordis" { interface Context { harnessRouting: RoutingService } }

export async function createService(config?: Partial<RoutingConfig>): Promise<RoutingService> {
  const document = config?.document;
  if (typeof document !== "string" || !document.trim()) throw new RangeError("routing-document-not-configured");
  let path: string;
  try {
    const packageSpecifier = document.startsWith("@") || (!isAbsolute(document) && !document.startsWith("."));
    path = packageSpecifier ? fileURLToPath(import.meta.resolve(document)) : document;
  } catch { throw new RangeError("unreadable: absent"); }
  const outcome = await loadRoutingConfiguration({ path });
  if (!outcome.ok) throw new RangeError(describeLoadRefusal(outcome.refusal));
  return outcome.loaded;
}
export async function apply(ctx: Context, config?: Partial<RoutingConfig>): Promise<void> {
  ctx.provide(CONTEXT_KEY, await createService(config));
}
export default { name, Config, apply };
