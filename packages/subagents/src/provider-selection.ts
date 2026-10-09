/**
 * `selectProvider` — choose the `SubagentProvider` that will carry a request, or say why none will.
 *
 * Split out of `provider.ts`, which owns the interface and the verdict vocabulary this module reads.
 * Pure: no I/O, so the decision replays from the journal exactly.
 */

import { validateDispatch, type DispatchRequest } from "./dispatch.js";
import { duplicateIds } from "./provider-conformance.js";
import { isInstrumented, type SubagentProvider, type SubagentRegistry } from "./provider.js";

/** How a provider was passed over. Every candidate gets one; none is dropped silently. */
export type RejectionRule =
  | "duplicate-id"
  | "uninstrumented"
  | "wrong-harness"
  | "cannot-observe"
  | "not-preferred";

export interface Rejection {
  readonly provider: string;
  readonly rule: RejectionRule;
  readonly detail: string;
}

export type BlockRule =
  | "invalid-request"
  | "no-providers"
  | "duplicate-id"
  | "uninstrumented"
  | "no-candidate";

export interface SelectedProvider {
  readonly selected: true;
  readonly provider: SubagentProvider;
  readonly rejected: readonly Rejection[];
}

export interface BlockedSelection {
  readonly selected: false;
  readonly rule: BlockRule;
  readonly detail: string;
  readonly rejected: readonly Rejection[];
}

export type Selection = SelectedProvider | BlockedSelection;

export interface SelectionOptions {
  /**
   * Whether the run has to be watchable.
   *
   * Defaults to `true`, and the default is the argument: this whole project exists because the
   * owner had to ask an orchestrator "status ?" to find out what was happening. A provider that
   * cannot answer that question is not a cheaper option, it is the problem. Setting this to
   * `false` is legitimate — a fire-and-forget formatting run does not need supervision — but it
   * has to be written down at the call site rather than inherited from a permissive default.
   */
  readonly supervised?: boolean;
}

/**
 * Choose the provider that will carry a request, or say why none will.
 *
 * Pure, and deliberately so: this is the decision that has to be reproducible from the journal
 * (#71), and a selection that consulted the network would replay differently every time.
 *
 * The request is validated first. `validateDispatch` is the wire-format validator that already
 * exists for the `/swarm` path, and it is reused rather than paraphrased — a second, laxer check
 * here would let a dispatch through this seam that the other seam refuses, and the two seams are
 * supposed to be two encodings of one request.
 *
 * It then fails closed on telemetry: a registry holding any provider that nothing has marked as
 * instrumented is refused whole, rather than the unmarked one being passed over. The argument is
 * with the check itself.
 */
export function selectProvider(
  registry: SubagentRegistry,
  request: DispatchRequest,
  options: SelectionOptions = {},
): Selection {
  const supervised = options.supervised ?? true;
  const rejected: Rejection[] = [];

  const problems = validateDispatch(request);
  if (problems.length > 0) {
    return {
      selected: false,
      rule: "invalid-request",
      detail: `the request would not dispatch faithfully: ${problems.join("; ")}`,
      rejected,
    };
  }

  if (registry.providers.length === 0) {
    return {
      selected: false,
      rule: "no-providers",
      detail: "no providers are registered on ctx.subagents",
      rejected,
    };
  }

  // Two providers answering to one id is not a tie to break. `RunRef.provider` is how an
  // observation finds its way home, so an ambiguous id means a later `observe` or `stop` can be
  // routed to the wrong executor — and picking the first registration is a coin toss wearing a
  // rule's clothes. Refuse the whole selection rather than resolve it.
  const duplicates = duplicateIds(registry.providers);
  if (duplicates.length > 0) {
    for (const id of duplicates) {
      rejected.push({
        provider: id,
        rule: "duplicate-id",
        detail: "more than one provider is registered under this id",
      });
    }
    return {
      selected: false,
      rule: "duplicate-id",
      detail:
        `provider id(s) ${duplicates.join(", ")} are registered more than once; a run reference ` +
        "would not identify one executor",
      rejected,
    };
  }

  // A provider nothing has wrapped is a wiring defect, not a candidate that happens not to fit, so
  // it fails the whole selection the way a duplicate id does rather than being quietly passed over.
  //
  // Skipping it instead would be worse than useless on the registry that matters — a half-wired one.
  // Dispatches would keep succeeding through the wrapped half while the raw provider sat there
  // reachable by anything that iterates `registry.providers` itself, and the first run that reached
  // it would be the one run nobody could account for afterwards. The defect is the registry's, and
  // that is the granularity the refusal is stated at.
  const unmarked = registry.providers.filter((provider) => !isInstrumented(provider));
  if (unmarked.length > 0) {
    for (const provider of unmarked) {
      rejected.push({
        provider: provider.id,
        rule: "uninstrumented",
        detail: "nothing has marked this provider as instrumented, so its runs would leave no trace",
      });
    }
    return {
      selected: false,
      rule: "uninstrumented",
      detail:
        `provider(s) ${unmarked.map((provider) => provider.id).join(", ")} reached the registry ` +
        "without being wrapped for telemetry; a dispatch through them would run an agent that no " +
        "log can account for. Register through the composition root that wraps, or call " +
        "markInstrumented if something else already did",
      rejected,
    };
  }

  const candidates: SubagentProvider[] = [];
  for (const provider of registry.providers) {
    if (!provider.capabilities.harnesses.includes(request.harness)) {
      rejected.push({
        provider: provider.id,
        rule: "wrong-harness",
        detail: `cannot launch ${request.harness} (declares ${describeHarnesses(provider)})`,
      });
      continue;
    }
    if (supervised && !provider.capabilities.observe) {
      rejected.push({
        provider: provider.id,
        rule: "cannot-observe",
        detail: "cannot observe its runs, and this dispatch is supervised",
      });
      continue;
    }
    candidates.push(provider);
  }

  const chosen = candidates[0];
  if (chosen === undefined) {
    return {
      selected: false,
      rule: "no-candidate",
      detail: `no registered provider can launch ${request.harness}${supervised ? " and be observed" : ""}`,
      rejected,
    };
  }

  // Registration order is the tiebreak, and it is a real choice rather than an accident of
  // iteration: the composition root decides precedence by the order it registers, which is
  // visible in one file, instead of this function inventing a ranking nobody can see.
  for (const other of candidates.slice(1)) {
    rejected.push({
      provider: other.id,
      rule: "not-preferred",
      detail: `legal, but ${chosen.id} is registered ahead of it`,
    });
  }

  return { selected: true, provider: chosen, rejected };
}

const describeHarnesses = (provider: SubagentProvider): string =>
  provider.capabilities.harnesses.length === 0
    ? "none"
    : provider.capabilities.harnesses.join(", ");
