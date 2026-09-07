import type { RoutingService } from "./routing.js";
/**
 * `harness-llm` — our adapter, registered on the `ctx.llm` seam dsh already owns.
 *
 * This row claims nothing. `@deepseek-ai/dsh-llm` provides `ctx.llm`, the composed profile already
 * mounts it, and `ctx.llm` is a `LlmRuntime` at boot whether or not this row is present. What is
 * missing without it is narrower and more useful: no adapter of ours is registered, so a request for
 * any of our three destinations answers `NO_ADAPTER` — a refusal that names only the absence of a
 * route, when the interesting refusal is `lm-studio is not loaded, see its server log at ...`.
 *
 * ## Why this is `inject`, not `provide`
 *
 * `subagents.ts` provides a service because nothing else can: `ctx.subagents` is ours, and the row
 * exists so a dispatch with nothing registered gets a named refusal instead of a crash. Here the
 * seam belongs to dsh and the runtime already gives a named refusal. Injecting `llm` makes the
 * dependency explicit and lets cordis order the boot; providing it would be a second claim on a key
 * that already has an owner, which is how two runtimes end up half-installed.
 *
 * ## Why the registration is bound to an effect
 *
 * `registerAdapter` returns a disposer, and a plugin that takes it and forgets it leaves the routes
 * registered against an adapter whose fiber is gone — a reload then hits `DUPLICATE_ADAPTER` and the
 * new fiber has no routes at all. `ctx.effect` ties the disposer to this fiber's lifetime, so an
 * unload releases the three routes and a reload re-registers them. Calling a cordis disposer twice
 * is documented as a no-op, so the effect and an explicit dispose cannot fight.
 *
 * ## What this row does not wire
 *
 * Telemetry. `ctx.subagents` is metered by quota window and `ctx.llm` by token, and the two meters
 * are different enough that sharing one sink would produce a board where a `dsh-telemetry` figure
 * silently mixes them. Token accounting for `ctx.llm` calls is its own scope, and saying so here is
 * cheaper than leaving a reader to conclude it was forgotten.
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { BACKENDS, type Backend } from "@rickylabs/llm-local";

import { LocalLlmAdapter, envCredentials } from "../llm/adapter.js";
import { fetchTransport, type Transport } from "../llm/transport.js";

/** Row id in `cordis.patch.yml`. */
export const name = "harness-llm";

/**
 * Typed as `string[]` rather than a `const` tuple because cordis's `Inject` is `(keyof Dict)[]`.
 *
 * `llm` is `@deepseek-ai/dsh-llm`'s key, not ours. Naming it here is what makes the boot order a
 * fact rather than a hope.
 */
export const inject: string[] = ["llm", "harnessRouting"];

/**
 * What a deployment may set on the `harness-llm` row.
 *
 * Base URLs only. A credential is never a config key: the profile is committed and a credential must
 * not be, so keys are read from the environment at dispatch — see `CREDENTIAL_REF`.
 *
 * Empty means "use the table default", which is the same thing `resolveEndpoint` already does with a
 * blank override, so a deployment that sets none of these gets `backends.ts` and no special case.
 */
export interface LlmConfig {
  readonly lmStudioUrl: string;
  readonly llamaRocmUrl: string;
  readonly openrouterUrl: string;
}

export const Config = z.object({
  lmStudioUrl: z
    .string()
    .default("")
    .description("Base URL override for lm-studio. Empty uses the backend table's default."),
  llamaRocmUrl: z
    .string()
    .default("")
    .description("Base URL override for llama-rocm. Empty uses the backend table's default."),
  openrouterUrl: z
    .string()
    .default("")
    .description("Base URL override for openrouter. Empty uses the backend table's default."),
});

/** The config's three keys as a per-backend map, with blanks left out. */
export function resolveOverrides(
  config: Partial<LlmConfig> | undefined,
): Readonly<Partial<Record<Backend, string>>> {
  const overrides: Partial<Record<Backend, string>> = {};
  const lmStudio = config?.lmStudioUrl ?? "";
  const llamaRocm = config?.llamaRocmUrl ?? "";
  const openrouter = config?.openrouterUrl ?? "";
  if (lmStudio !== "") overrides["lm-studio"] = lmStudio;
  if (llamaRocm !== "") overrides["llama-rocm"] = llamaRocm;
  if (openrouter !== "") overrides.openrouter = openrouter;
  return overrides;
}

/**
 * Build the adapter without a context, so it can be tested without booting cordis.
 *
 * `transport` is a parameter for the reason `transport.ts` exists at all: everything between a
 * `GenerateOptions` and a `StreamChunk` is reachable from a test with no server running, and only
 * the socket is not.
 */
export function createAdapter(
  routing: RoutingService,
  config: Partial<LlmConfig> | undefined,
  transport: Transport = fetchTransport(),
): LocalLlmAdapter {
  return new LocalLlmAdapter({
    transport,
    placements: routing.configuration.placements,
    overrides: resolveOverrides(config),
    credentials: envCredentials(),
  });
}

export function apply(ctx: Context, config?: Partial<LlmConfig>): void {
  const adapter = createAdapter(ctx.harnessRouting, config);
  ctx.effect(() => {
    // All three register, including a backend whose override is unusable. A refused route answers
    // with a terminal `error` finish naming the refusal; registering only the good ones would make
    // a typo'd base URL indistinguishable from a backend nobody wired up.
    const handle = ctx.llm.registerAdapter([...BACKENDS], adapter);
    return () => {
      handle();
    };
  }, "harness-llm adapter registration");
}

export default { name, Config, inject, apply };
