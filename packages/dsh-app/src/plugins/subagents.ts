/**
 * `ctx.subagents` — the autonomous-vendor-CLI seam, claimed empty.
 *
 * This is one of the two seams AGENTS.md keeps apart on purpose. A subagent provider launches a
 * vendor CLI that runs a whole task on a subscription, and what has to be metered is a **quota
 * window**; `ctx.llm` takes an API key and meters **per token**. Collapsing them into one
 * abstraction is the design error this split exists to prevent, so this plugin claims one key and
 * knows nothing about the other.
 *
 * ## Why it registers an empty registry
 *
 * E3 · #33 owns providers. Nothing here anticipates their registration shape, because pre-empting
 * that decision is how a seam acquires an API before it has a caller. What this row does buy today
 * is the failure mode: with the service claimed and empty, a dispatch attempt reaches
 * `selectProvider` and comes back with the `no-providers` rule and a sentence saying why. Without
 * the row it reaches `ctx.subagents` and throws on `undefined`, which reads as a broken daemon
 * rather than an unconfigured one.
 *
 * The key is not spelled here. It comes from `CONTEXT_KEY` in `@rickylabs/subagents`, next to the
 * interface it names, so the string exists once in the repository.
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { CONTEXT_KEY, type SubagentRegistry } from "@rickylabs/subagents";

declare module "@deepseek-ai/cordis" {
  interface Context {
    subagents: SubagentRegistry;
  }
}

/**
 * Where this service attaches — re-exported, not redeclared.
 *
 * The other three plugins define their own `CONTEXT_KEY`; this one borrows `@rickylabs/subagents`'s,
 * because the four provider packages have to agree with it too. Re-exporting keeps the four plugin
 * modules answerable to the same question without the string existing twice.
 */
export { CONTEXT_KEY } from "@rickylabs/subagents";

/** Row id in `cordis.patch.yml`. */
export const name = "harness-subagents";

/**
 * No configuration.
 *
 * Declared rather than omitted so dsh's settings surface shows an empty section instead of nothing
 * at all — "this plugin takes no options" and "this plugin was not loaded" should not look alike.
 */
export const Config = z.object({});

/** What `ctx.subagents` holds before any provider package attaches. */
export function emptyRegistry(): SubagentRegistry {
  return { providers: [] };
}

export function apply(ctx: Context): void {
  ctx.provide(CONTEXT_KEY, emptyRegistry());
}

export default { name, Config, apply };
