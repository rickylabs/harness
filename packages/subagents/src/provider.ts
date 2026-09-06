/**
 * `SubagentProvider` — the one interface every autonomous vendor CLI attaches behind.
 *
 * Owned by E3 · #33, defined by #51. Four packages implement it (`provider-claude`,
 * `provider-codex`, `provider-acp`, `provider-opencode`) and one more consumes it without
 * implementing it: the divybot path in E7, which dispatches by writing a `/swarm` block into a
 * GitHub issue and has no process to hold on to. That last case is why this file is written the
 * way it is. A contract shaped around an SDK that hands back a session object would fit three of
 * the five and force the fourth to lie.
 *
 * ## The vocabulary is four verbs and one word
 *
 * `dispatch`, `observe`, `steer`, `stop`. The word is **unknown**, and every verdict in this file
 * carries it.
 *
 * A provider that cannot reach its executor does not know whether the run is alive. A dispatch
 * whose HTTP request timed out may or may not have launched an agent. Reporting either as a
 * failure is not conservative — it is a specific, wrong claim, and the actions that follow it are
 * destructive in different directions: a dispatch reported as failed gets retried, and the retry
 * launches a second agent onto the same branch.
 *
 * So `unknown` is a first-class verdict rather than an error, and `isSafeToRetry` is the function
 * that keeps the distinction load-bearing instead of decorative. Only an explicit refusal — the
 * executor was reached, and said no — licenses a second attempt.
 *
 * ## Capabilities are declared, not discovered by calling
 *
 * divybot cannot steer. The Codex app-server can. A contract that pretends otherwise leaves each
 * caller to discover the difference by calling and interpreting whatever comes back, and "it threw"
 * is indistinguishable from "it is down". `ProviderCapabilities` is therefore part of the
 * interface, checked before dispatch by `selectProvider` and before every optional call by
 * `capabilityProblem`, so an unsupported operation is a fact the caller reads rather than an
 * outcome it has to provoke.
 *
 * ## What this module deliberately does not do
 *
 * It does not choose models — the routing matrix is the only answer to that question, and #61
 * validates model ids at the dispatch boundary. It does not hold a lease; single-writer session
 * ownership lives in `lease.ts` (#56), which keys on the run id `RunRef` carries and which nothing
 * on this interface consults on its behalf — a caller resumes a run only after `admitResume` says
 * it may, and a provider has no way to check that for itself. It does not implement any
 * provider. It does no I/O at all, which is what lets `selectProvider` and `conformanceProblems`
 * run in CI against a table of declarations with nothing installed.
 */

import { validateDispatch, type DispatchRequest, type Harness } from "./dispatch.js";

/**
 * Where a `SubagentRegistry` attaches on the dsh context.
 *
 * Named here so the four provider packages and `dsh-app` agree on it without a shared string
 * literal drifting between them. The other seam is `ctx.llm` (E4 · #34) and the two are kept
 * apart on purpose: vendor CLIs are metered by quota window, API and local models per token.
 */
export const CONTEXT_KEY = "subagents" as const;

/**
 * A run, as both sides can name it.
 *
 * `runId` is the coordinator's, and it is the join key for everything else in the system —
 * telemetry, the journal, the board. `external` is the provider's own handle, and is `null` until
 * there is one: divybot has no id to give at dispatch time, only an issue number that appears
 * later. A contract that required an external id up front would have forced that provider to
 * invent one, and an invented id joins to nothing.
 */
export interface RunRef {
  readonly runId: string;
  /** The `id` of the provider that owns this run. Nothing else may observe, steer or stop it. */
  readonly provider: string;
  readonly external: string | null;
}

/** What a provider says it can do, before anybody asks it to do any of it. */
export interface ProviderCapabilities {
  /** Harnesses this provider can actually launch. A request outside this set is never sent. */
  readonly harnesses: readonly Harness[];
  /** Whether `observe` returns real state. A provider that answers `false` runs blind. */
  readonly observe: boolean;
  /** Whether a message can reach a run in flight. divybot: no. */
  readonly steer: boolean;
  /** Whether a run can be ended early. A provider that cannot stop cannot be reclaimed. */
  readonly stop: boolean;
}

/** The optional calls. Named so `capabilityProblem` can be asked about one without a string. */
export type OptionalCall = "observe" | "steer" | "stop";

/**
 * `accepted` — the executor has the run. `refused` — the executor was reached and said no.
 * `unknown` — nobody knows, and that is the answer, not an omission.
 */
export type DispatchVerdict = "accepted" | "refused" | "unknown";

export interface DispatchResult {
  readonly verdict: DispatchVerdict;
  /** Present on `accepted`. On `unknown` it may also be present, if the provider got that far. */
  readonly run: RunRef | null;
  /** Why. A verdict with no reason cannot be acted on by anything except a coin toss. */
  readonly detail: string;
}

/**
 * What a run is doing.
 *
 * `queued` and `running` are both alive; the split matters because a run that is queued for
 * forty minutes is a governance problem and a run that is executing for forty minutes is not.
 */
export type Liveness = "queued" | "running" | "finished" | "failed" | "unknown";

export interface Observation {
  readonly run: RunRef;
  readonly liveness: Liveness;
  /** ISO 8601, from the caller's clock. When this was true, not when it was asked. */
  readonly observedAt: string;
  readonly detail: string;
  /** What the run has produced so far: branch names, PR urls, artifact paths. */
  readonly artifacts: readonly string[];
}

export type SteerVerdict = "delivered" | "unsupported" | "refused" | "unknown";

export interface SteerResult {
  readonly verdict: SteerVerdict;
  readonly detail: string;
}

/** `already-over` is a success: the run cannot be stopped because there is nothing left to stop. */
export type StopVerdict = "stopped" | "already-over" | "unsupported" | "refused" | "unknown";

export interface StopResult {
  readonly verdict: StopVerdict;
  readonly detail: string;
}

/**
 * The seam itself.
 *
 * Every method returns a result rather than throwing for an expected outcome. A refusal, an
 * unsupported call and an unreachable executor are all things that happen in normal operation,
 * and an exception flattens them into one shape that callers then have to un-flatten by reading
 * message strings. Exceptions remain correct for a provider that is broken — a missing binary, a
 * malformed config — because those are not outcomes of the call.
 */
export interface SubagentProvider {
  /** Stable, unique within a registry. Appears in `RunRef.provider` and in telemetry. */
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  /**
   * Launch a run. `runId` is supplied by the caller so that the record exists before the run does;
   * a provider that minted its own id would leave a window in which something is executing and
   * nothing can name it.
   */
  dispatch(request: DispatchRequest, runId: string): Promise<DispatchResult>;
  observe(run: RunRef): Promise<Observation>;
  steer(run: RunRef, message: string): Promise<SteerResult>;
  stop(run: RunRef, reason: string): Promise<StopResult>;
}

/** What sits at `ctx.subagents`. */
export interface SubagentRegistry {
  readonly providers: readonly SubagentProvider[];
}

/**
 * Whether a dispatch may be sent again.
 *
 * The whole point of the `unknown` verdict. A refusal was answered by the executor, so nothing
 * launched and a second attempt is a second attempt. Anything else may already be running, and
 * retrying it puts two agents on one branch — which is not a degraded outcome, it is a corrupted
 * one, and it is invisible until their commits interleave.
 *
 * `accepted` returns `false` for the same reason it would be absurd to retry a success.
 */
export function isSafeToRetry(result: DispatchResult): boolean {
  return result.verdict === "refused";
}

/** What to do about a dispatch that did not plainly succeed, in a sentence. */
export function retryGuidance(result: DispatchResult): string {
  switch (result.verdict) {
    case "accepted":
      return "accepted — there is nothing to retry";
    case "refused":
      return "refused by the executor, so nothing launched — a retry is safe once the cause is fixed";
    case "unknown":
      return (
        "the executor was not reached, so a run may or may not have started — do not retry; " +
        "observe first, and dispatch again only once something has established that nothing is running"
      );
  }
}

/**
 * Why an optional call cannot be made on this provider, or `null` if it can.
 *
 * Asked before the call, not derived from its failure. `observe` is included even though it looks
 * harmless: a provider that cannot observe will answer `unknown` forever, and a supervisor that
 * treats that as a transient condition waits on it for the life of the run.
 */
export function capabilityProblem(provider: SubagentProvider, call: OptionalCall): string | null {
  if (provider.capabilities[call]) return null;
  switch (call) {
    case "observe":
      return `${provider.id} cannot observe its runs — liveness will be unknown for the whole run`;
    case "steer":
      return `${provider.id} cannot steer a run in flight — the message would go nowhere`;
    case "stop":
      return `${provider.id} cannot stop a run — it ends on its own deadline or not at all`;
  }
}

/** How a provider was passed over. Every candidate gets one; none is dropped silently. */
export type RejectionRule = "duplicate-id" | "wrong-harness" | "cannot-observe" | "not-preferred";

export interface Rejection {
  readonly provider: string;
  readonly rule: RejectionRule;
  readonly detail: string;
}

export type BlockRule = "invalid-request" | "no-providers" | "duplicate-id" | "no-candidate";

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

/** Ids registered more than once, sorted, each named once. */
function duplicateIds(providers: readonly SubagentProvider[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const provider of providers) {
    counts.set(provider.id, (counts.get(provider.id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
}

const describeHarnesses = (provider: SubagentProvider): string =>
  provider.capabilities.harnesses.length === 0
    ? "none"
    : provider.capabilities.harnesses.join(", ");

/** A provider declaration that contradicts itself or cannot be used. */
export type ConformanceRule = "no-id" | "unusable-id" | "no-harnesses" | "blind" | "unstoppable";

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
 * This is composition-time validation: `dsh-app` builds a registry from config and can run this
 * over it with no executor present. It catches the declarations that are wrong on their face —
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

/** Whether a registry is usable as it stands. Fatal problems only; the rest are reported, not blocking. */
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
  return found;
}
