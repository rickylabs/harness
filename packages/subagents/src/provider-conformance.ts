/**
 * Composition-time checks on what a provider and a registry claim about themselves.
 *
 * Split out of `provider.ts`, which owns the interface. `duplicateIds` lives here and is shared with
 * `selectProvider`, so both refuse the same ambiguous registry for the same reason.
 */

import { isInstrumented, type SubagentProvider, type SubagentRegistry } from "./provider.js";

/** A provider declaration that contradicts itself or cannot be used. */
export type ConformanceRule =
  | "no-id"
  | "unusable-id"
  | "no-harnesses"
  | "blind"
  | "unstoppable"
  | "uninstrumented";

export interface ConformanceProblem {
  readonly provider: string;
  readonly rule: ConformanceRule;
  readonly detail: string;
  /** `true` when the provider cannot be used at all, `false` when it is usable but diminished. */
  readonly fatal: boolean;
}

const USABLE_ID = /^[a-z][a-z0-9-]*$/;

/**
 * Check what a provider claims about itself, before it is asked to do anything.
 *
 * This is composition-time validation: a composition root builds a registry from config and can run
 * this over it with no executor present. It catches the declarations that are wrong on their face —
 * a provider that launches nothing, an id that cannot appear in a `RunRef` — and reports the two
 * that are merely bad news (blind, unstoppable) without failing them, because both are real
 * providers. divybot is genuinely unsteerable, and saying so is the contract working.
 */
export function conformanceProblems(provider: SubagentProvider): readonly ConformanceProblem[] {
  const found: ConformanceProblem[] = [];
  const id = provider.id;

  if (id === "") {
    found.push({
      provider: "(unnamed)",
      rule: "no-id",
      detail: "a provider with no id cannot be named in a RunRef, so its runs cannot be found again",
      fatal: true,
    });
  } else if (!USABLE_ID.test(id)) {
    found.push({
      provider: id,
      rule: "unusable-id",
      detail: `id ${JSON.stringify(id)} is not a lowercase slug; it appears verbatim in run references and telemetry`,
      fatal: true,
    });
  }

  if (provider.capabilities.harnesses.length === 0) {
    found.push({
      provider: id,
      rule: "no-harnesses",
      detail: "declares no harnesses, so selectProvider can never choose it",
      fatal: true,
    });
  }

  if (!provider.capabilities.observe) {
    found.push({
      provider: id,
      rule: "blind",
      detail: "cannot observe; every supervised dispatch will pass it over",
      fatal: false,
    });
  }

  if (!provider.capabilities.stop) {
    found.push({
      provider: id,
      rule: "unstoppable",
      detail: "cannot stop a run; a governance decision to reclaim capacity cannot be enforced here",
      fatal: false,
    });
  }

  return found;
}

/**
 * Whether a registry is usable as it stands. Fatal problems only; the rest are reported, not blocking.
 *
 * The two checks that live here rather than in `conformanceProblems` are the two that a provider
 * cannot answer about itself: whether another provider took its id, and whether the composition root
 * remembered to wrap it. Both are properties of the assembly, and both are visible at boot — which
 * is when a deployment should hear about them, rather than at the first dispatch of the night.
 */
export function registryProblems(registry: SubagentRegistry): readonly ConformanceProblem[] {
  const found = registry.providers.flatMap((provider) => conformanceProblems(provider));
  for (const id of duplicateIds(registry.providers)) {
    found.push({
      provider: id,
      rule: "unusable-id",
      detail: "registered more than once; run references under this id are ambiguous",
      fatal: true,
    });
  }
  for (const provider of registry.providers) {
    if (isInstrumented(provider)) continue;
    found.push({
      provider: provider.id,
      rule: "uninstrumented",
      // Fatal, and it says the same thing `selectProvider` will say: this registry cannot dispatch.
      // Reporting it as merely diminished would describe a seam that in fact refuses every request.
      detail: "not wrapped for telemetry, so selectProvider refuses every dispatch to this registry",
      fatal: true,
    });
  }
  return found;
}

/** Ids registered more than once, sorted, each named once. */
export function duplicateIds(providers: readonly SubagentProvider[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const provider of providers) {
    counts.set(provider.id, (counts.get(provider.id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
}
