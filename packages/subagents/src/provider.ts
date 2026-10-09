/**
 * `SubagentProvider` — the one interface every autonomous vendor CLI attaches behind.
 *
 * Owned by E3 · #33, defined by #51. Three packages implement it (`provider-claude`,
 * `provider-codex`, `provider-opencode`) and one more consumes it without implementing it: the
 * divybot path in E7, which dispatches by writing a `/swarm` block into a GitHub issue and has no
 * process to hold on to. That last case is why this file is written the way it is. A contract
 * shaped around an SDK that hands back a session object would fit the SDK-backed providers and
 * force that last one to lie.
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

import type { DispatchRequest, Harness } from "./dispatch.js";
import { isRouteEvidenceVerified, type RouteIdentityEvidence } from "./route.js";

/**
 * The context key for a `SubagentRegistry`.
 *
 * Named here so the provider packages and their composition root agree on it without a shared string
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
  /**
   * Present on `accepted`. It may also be present on `unknown`, or on `refused` when an identified
   * empty session was created but no useful work was sent and the handle is needed for cleanup.
   */
  readonly run: RunRef | null;
  /** Why. A verdict with no reason cannot be acted on by anything except a coin toss. */
  readonly detail: string;
  /**
   * Requested-versus-observed route evidence when the provider can obtain it.
   *
   * Optional for compatibility with providers that predate route observation. Absence is
   * unverified, never agreement; callers use `isRouteVerified` rather than optional chaining.
   */
  readonly route?: RouteIdentityEvidence;
}

/**
 * What a run is doing, **as its executor reports it**.
 *
 * `queued` and `running` are both alive; the split matters because a run that is queued for
 * forty minutes is a governance problem and a run that is executing for forty minutes is not.
 *
 * `Run-` is load-bearing. `@rickylabs/telemetry` publishes a `LivenessVerdict` that is a different
 * question about the same run: not what the executor said, but what the *evidence* supports — a
 * growing artifact, a new commit, a live turn. The two disagree exactly where a status screen earns
 * its keep, on the run that claims `running` and has produced nothing for six hours. Both types were
 * once called `Liveness`, in one npm scope, and a consumer that imports from both packages in one
 * file could not tell them apart. See #206.
 */
export type RunLiveness = "queued" | "running" | "finished" | "failed" | "unknown";

export interface Observation {
  readonly run: RunRef;
  readonly liveness: RunLiveness;
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
 * The mark a wrapper leaves on a provider it has instrumented.
 *
 * `Symbol.for` rather than a fresh `Symbol`. A unique symbol belongs to one module instance, so two
 * copies of this package on one disk — a hoisting accident, a linked workspace — would each mint
 * their own and neither would see the other's mark. Every provider would then read as
 * uninstrumented and nothing would dispatch. The realm-global registry is what makes the mark
 * survive that, and the cost of it is stated on `markInstrumented`.
 */
const INSTRUMENTED = Symbol.for("@rickylabs/subagents.instrumented");

/**
 * Record that a provider has been wrapped, and by what.
 *
 * ## Why this exists at all
 *
 * The seam's promise was prose. The former router's subagent plugin wrapped the registry it built, and
 * its comment concluded from that that "an uninstrumented provider is not something a provider package can
 * produce by forgetting" — but `providers` is a readonly array on a plain object, and the only way
 * for E3 to add a provider is to hand over a **new registry**. That path never touches the wrapper.
 * The guarantee held for the empty registry the plugin built itself and for nothing that would ever
 * actually run. A property that can only be read is not enforced; this is the mark that lets it be
 * checked. See #208.
 *
 * ## What it does and does not prove
 *
 * It proves that *something calling itself `wrapper` said it had wrapped this object*. That is
 * enough for the failure this defends against, which is a raw provider reaching `ctx.subagents`
 * because a composition root forgot a call — and it is the whole of what it proves.
 *
 * It is not a security boundary. `Symbol.for` is a public key: anything in the process can write
 * this property, and a wrapper that marks a provider whose sink is broken, full, or pointed at
 * `/dev/null` produces exactly the same mark as one that works. Durable evidence is the sink's
 * problem and is checked where the sink is, not here. Read this as a wiring assertion, in the same
 * family as `conformanceProblems` — a thing the composition root states and the seam can hold it to.
 *
 * Two wrappers around one provider is refused rather than allowed, because it is not a harmless
 * belt-and-braces: each layer writes its own events, and the log would then report every dispatch
 * twice with no way for a reader to tell the duplicate from a genuine retry.
 */
export function markInstrumented<P extends SubagentProvider>(provider: P, wrapper: string): P {
  if (wrapper === "") {
    throw new Error("markInstrumented needs the name of what did the wrapping, not an empty string");
  }
  const already = instrumentedBy(provider);
  if (already === wrapper) return provider;
  if (already !== null) {
    throw new Error(
      `provider ${provider.id} is already marked as instrumented by ${already}; adding ${wrapper} ` +
        "would put two wrappers around one provider and write every event twice",
    );
  }
  Object.defineProperty(provider, INSTRUMENTED, {
    value: wrapper,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return provider;
}

/**
 * What wrapped this provider, or `null` if nothing claims to have.
 *
 * Named as the provenance question rather than a boolean because that is what a refusal needs to
 * print: "unmarked" and "marked by something you did not expect" are different wiring bugs.
 */
export function instrumentedBy(provider: SubagentProvider): string | null {
  const mark = (provider as unknown as Record<symbol, unknown>)[INSTRUMENTED];
  return typeof mark === "string" && mark !== "" ? mark : null;
}

/** Whether anything has claimed to instrument this provider. */
export function isInstrumented(provider: SubagentProvider): boolean {
  return instrumentedBy(provider) !== null;
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

/** True only for an accepted dispatch with complete, matching route evidence. */
export function isRouteVerified(result: DispatchResult): boolean {
  return result.verdict === "accepted" && isRouteEvidenceVerified(result.route);
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
