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
 *
 * ## Why it depends on telemetry
 *
 * Empty is not the same as unwatched. Whatever E3 · #33 eventually registers, it goes through
 * `instrumentRegistry` before it reaches the context, so an uninstrumented provider is not
 * something a provider package can produce by forgetting — it is something this seam cannot hand
 * out. That is why the dependency is declared with `inject` rather than resolved with an optional
 * read: a plugin that could load without telemetry would load without telemetry exactly once, on
 * the box where it mattered, and the evidence for that run would simply not exist.
 *
 * The cost is that this row sits `PENDING` until `harness-telemetry` is on the context. That is the
 * intended failure: a coordinator that can dispatch but cannot record is worse than one that
 * refuses to dispatch, because the first kind loses runs silently.
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { CONTEXT_KEY, type SubagentRegistry } from "@rickylabs/subagents";
import type { SessionTelemetrySink } from "@rickylabs/telemetry";

import { instrumentRegistry } from "../instrument.js";
// Type-only, and empty on purpose: it pulls in the `harnessTelemetry` declaration on `Context`
// without creating a runtime edge between two sibling plugins.
import type {} from "./telemetry.js";

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

/**
 * Services this row requires. It stays `PENDING` while any of them is missing.
 *
 * Typed as `string[]` rather than a `const` tuple because cordis's `Inject` is `(keyof Dict)[]`,
 * and a readonly tuple does not satisfy it.
 */
export const inject: string[] = ["harnessTelemetry"];

/** What `ctx.subagents` holds before any provider package attaches. */
export function emptyRegistry(): SubagentRegistry {
  return { providers: [] };
}

/**
 * Build the registry without a context, so the wrapping is testable without booting cordis.
 *
 * The sink is a parameter for the same reason `createService` takes an `env`: a test that cannot
 * supply one can only assert that nothing was written.
 */
export function createRegistry(sink: SessionTelemetrySink): SubagentRegistry {
  return instrumentRegistry(emptyRegistry(), { sink });
}

export function apply(ctx: Context): void {
  ctx.provide(CONTEXT_KEY, createRegistry(ctx.harnessTelemetry.sink));
}

export default { name, Config, inject, apply };
