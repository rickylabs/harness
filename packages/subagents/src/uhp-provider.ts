/**
 * `provider-uhp` — the `SubagentProvider` for runs hosted on a HarnessRouter over UHP `2026-08-11`.
 *
 * Issue [#286](https://github.com/rickylabs/harness/issues/286), under E3 ([#33](https://github.com/rickylabs/harness/issues/33)).
 * Run artifacts: `.llm/runs/provider-uhp--e37/`. Depends on spikes S10 (#288, route identity) and S11
 * (#289, the stream adapter), both merged.
 *
 * ## What this file is, and what it is not
 *
 * It is composition. Every hard part already exists and is used rather than restated:
 *
 *   `uhp-stream.ts`     reads the SSE and refuses a stream it cannot read     (one reader)
 *   `uhp-lifecycle.ts`  maps UHP status onto `RunLiveness` per #287           (one table)
 *   `uhp-gate.ts`       reads the route off the wire and gates it             (one gate)
 *   `uhp-session.ts`    chains turns on `previous_response_id`, keyed on runId (one ledger)
 *   `uhp-harnesses.ts`  pins console ids and refuses on drift                 (F1)
 *   `uhp-redact.ts`     the publication boundary                              (the `detail` rule)
 *   `uhp-transport.ts`  the credential, which this file never sees            (`admit.ts:14`)
 *
 * It is not a second copy of any of them, and the four verbs below contain no protocol parsing that
 * those modules already do.
 *
 * ## The three verdict rules that decide every branch here
 *
 * **1. A contradiction refuses; a silence is unknown; the order is the rule.** `uhpRouteVerdict` checks
 * the contradicted set before the absence branch, which is what makes a refusal reachable over a
 * transport where `status` is pinned to `unknown`. The owner ratified that on 2026-09-12 —
 * "report refused on model mismatch or contradiction, not unknown" — and it is already the shipped
 * behaviour, so the job here is not to regress it. This file never branches on `evidence.status`, and it
 * widens the *negatives* rather than the gate's signature when a second source of contradiction appears:
 * `metadata.model_fallback` and `metadata.ignored_fields` join `evidence.mismatches` in the
 * `contradicted` set, and `uhpRouteVerdict` still decides. Its parameter type has no `status` field and
 * nothing here adds one.
 *
 * **2. `sent` decides whether a retry is safe, and nothing else does.** A call that never left this
 * process launched nothing, so the verdict is `refused`, which `isSafeToRetry` licenses a retry on. A
 * call that was sent and not answered may be running: `unknown`, and no retry. Errors §5 is blunt about
 * it — "A client that gives up MUST NOT assume the task stopped. It has not." — and the destructive
 * failure is asymmetric: a dispatch wrongly reported as failed gets retried, and the retry puts two
 * agents on one branch.
 *
 * **3. Nothing published carries a path.** `detail` is a documented-unsafe diagnostic on the producing
 * side. Every string this provider returns goes through `redactPaths`, every route evidence through
 * `redactRouteEvidence`, and the unredacted form goes to the local diagnostic sink instead. The last act
 * of each verb is to run the fence over its own result.
 *
 * ## What the owner decided on 2026-09-12, and what is still open
 *
 * Over UHP, three of the four route fields are unreportable — S10's reading of the specification, which is
 * **owner-certified and not independently re-derived**. Until the risk ruling of 2026-09-12 that meant
 * every conformant response yielded `unknown` and this provider refused everything.
 *
 * **The ruling: an unattested `effort`, `cwd` and `provider` do not block a turn.** UHP and DeepSeek are
 * both written to guarantee the model and effort they are given, so their non-observability is an
 * observability gap rather than a safety problem. A response whose `model` was reported and agreed is now
 * `accepted`. Three qualifications travel with it and are enforced here rather than remembered:
 *
 * - it is accepted **by owner risk decision, not because the risk was measured** — the two substitution
 *   cases the ruling names (Codex rerouting Astra to Sol, Fable 5.1 rerouting to Opus under security
 *   policy) are deferred, not dismissed, and both occur on transports where these fields *are* observable;
 * - a contradiction still refuses, still from the mismatch set widened by what the server states about
 *   itself, and still before the absence branch;
 * - `accepted` is not `verified`. `isRouteVerified` on the result stays `false` over UHP, so F2 still bars
 *   certifying evaluator use. The two questions — may this run proceed, and may it certify — were fused in
 *   one verdict and are now answered separately.
 *
 * **The drift refusal is narrowed to the harness being dispatched to**, with unrelated drift kept visible
 * as a distinct non-blocking signal. `uhp-harnesses.ts` carries the reasoning.
 *
 * **Still open, and not resolved by any branch in this file:** whether the verdict vocabulary should
 * separate "I cannot name this run" from "I can name it but cannot attest three fields". The gate grades
 * that distinction internally (`UhpRouteAttestation`) and says which it found in the detail, because the
 * accepted case had to be told from the genuinely uncorrelated one; `DispatchVerdict` is unchanged, since
 * widening a shipped enum is how an open question stops being visible.
 *
 * ## What no test here proves
 *
 * Anything about a live HarnessRouter. There is no reachable instance and no container runtime on this
 * host; the suite runs against `uhp-mock.ts` over a loopback socket. The live round-trip is
 * [#294](https://github.com/rickylabs/harness/issues/294). See `verification.md` for the split.
 */

import { validateDispatch, type DispatchRequest, type Harness } from "./dispatch.js";
import { compareRouteIdentity, type RouteField } from "./route.js";
import type {
  DispatchResult,
  Observation,
  ProviderCapabilities,
  RunRef,
  SteerResult,
  SteerVerdict,
  StopResult,
  StopVerdict,
  SubagentProvider,
} from "./provider.js";
import { decideUhpRoute, observeUhpRoute, uhpRouteNegatives, uhpRouteVerdict } from "./uhp-gate.js";
import {
  detectHarnessDrift,
  describeHarnessDrift,
  describeUnrelatedHarnessDrift,
  manifestHarnesses,
  pinnedHarness,
  readUhpHarnessList,
  selectHarnessDrift,
  type HarnessManifest,
  type PinnedHarness,
} from "./uhp-harnesses.js";
import { uhpObservation, type UhpOutcome } from "./uhp-lifecycle.js";
import { pathShapedStrings, redactPaths, redactRouteEvidence, type PublishedRouteEvidence } from "./uhp-redact.js";
import {
  lastUhpTurn,
  nextUhpRequest,
  openUhpSession,
  recordUhpTurn,
  uhpRunRef,
  uhpSessionOf,
  withUhpSession,
  EMPTY_UHP_LEDGER,
  type UhpSessionLedger,
} from "./uhp-session.js";
import { consumeUhpStream } from "./uhp-stream.js";
import {
  isUhpLifecycleStatus,
  uhpErrorCode,
  type UhpCreateRequest,
  type UhpResponse,
} from "./uhp-wire.js";
import { HARNESSROUTER_PROFILE, type UhpAnswer, type UhpTransport } from "./uhp-transport.js";

/* -------------------------------------------------------------------------------------------------
 * Options, diagnostics and the provider surface
 * ---------------------------------------------------------------------------------------------- */

/**
 * The unredacted record of one decision, for an operator on this host.
 *
 * It exists because redaction must not cost a diagnostic. `detail` here is the full string, paths
 * included; it is handed to a sink the composition root owns and is never part of a returned result.
 * Keep it out of anything durable a consumer reads — that is the whole reason there are two forms.
 */
export interface UhpDiagnostic {
  readonly at: string;
  readonly runId: string;
  readonly verb: "dispatch" | "observe" | "steer" | "stop";
  readonly verdict: string;
  /** UNREDACTED. May contain absolute paths and caller prose. Local only. */
  readonly detail: string;
}

export interface UhpProviderOptions {
  /** `SubagentProvider.id`, appearing verbatim in every `RunRef` and every telemetry row. */
  readonly id?: string;
  readonly transport: UhpTransport;
  /** The pinned console manifest. Parsed by `parseHarnessManifest`; never a raw JSON blob. */
  readonly manifest: HarnessManifest;
  /**
   * The model provider this repository asked for, in the routing document's vocabulary.
   *
   * Supplied by composition, exactly as `provider-codex` takes `modelProvider`. It is the *requested*
   * side of the route: UHP reports no provider, so this value is never compared to an observation and
   * never certifies anything on its own.
   */
  readonly modelProvider: string;
  /** Canonical absolute working directory of the run. Requested side only; UHP never reports one. */
  readonly cwd: string;
  /** The **name** of the credential profile, for refusal prose. Never a token. */
  readonly credentialProfile?: string;
  readonly clock?: () => string;
  readonly onDiagnostic?: (diagnostic: UhpDiagnostic) => void;
}

export interface UhpProvider extends SubagentProvider {
  /** The turn ledger, for a composition root that persists or inspects it. Keyed on `runId`. */
  sessions(): UhpSessionLedger;
}

/**
 * What this provider knows about a run that the UHP turn ledger does not model.
 *
 * Two fields, both needed by a later verb: the pinned harness (so a continuation names the same console
 * object) and the requested route (so a later response can be compared against what was asked for
 * rather than against what it says about itself). This is not a second session ledger — the turn chain
 * lives in `uhp-session.ts` and is read from there — it is the dispatch-time context a `RunRef` cannot
 * carry.
 */
interface RunState {
  readonly harness: Harness;
  readonly pinned: PinnedHarness;
  readonly requested: {
    readonly provider: string;
    readonly model: string | null;
    readonly effort: string | null;
    readonly cwd: string;
  };
}

const DEFAULT_ID = "uhp";

/**
 * The diagnostic label for console drift that did not block the dispatch it was found on.
 *
 * A distinct label rather than a sentence inside a dispatch verdict, because it is a distinct event: the
 * dispatch has its own outcome and this is a fact about the console that outlived it. Exported so an
 * operator surface can select on it and so a test can assert the signal fired without matching prose.
 */
export const UHP_UNRELATED_DRIFT = "drift-unrelated";

/* -------------------------------------------------------------------------------------------------
 * Small readers
 * ---------------------------------------------------------------------------------------------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonblank(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Read a body as a UHP response object, or `null`.
 *
 * `id`, `status` and the `response` object shape are checked, and `status` must be one of the five the
 * lifecycle chapter defines. A body that is JSON but not a response is not a response: a lenient read
 * here would invent a liveness out of an error page.
 */
function readUhpResponse(value: unknown): UhpResponse | null {
  if (!isObject(value)) return null;
  const id = nonblank(value["id"]);
  if (id === null || !isUhpLifecycleStatus(value["status"])) return null;
  return value as unknown as UhpResponse;
}

/* -------------------------------------------------------------------------------------------------
 * Contradictions the response states about itself
 * ---------------------------------------------------------------------------------------------- */

/**
 * A statement by the server that it did not do what the request said.
 *
 * Three sources, all of them positive facts rather than absences, which is what makes them
 * contradictions rather than silences:
 *
 * - **`metadata.model_fallback`** — Tasks §1.3: a server that cannot serve the requested model must
 *   either fail with `422 model_unavailable` or "Substitute the harness's authorized default, and record
 *   the substitution in the response" with `requested_model`, `model_fallback` and
 *   `model_fallback_reason`. A `model_fallback: true` is the server saying so in writing.
 * - **`metadata.requested_model` disagreeing with `model`** — the comparison the chapter says a client
 *   can always make: "A client can therefore always answer 'did the model I asked for actually run?' by
 *   comparing `model` with `metadata.requested_model`." A server whose own two fields disagree with each
 *   other has substituted, whatever it set the boolean to.
 * - **`metadata.ignored_fields`** — Tasks §1.1: "When a server does not act on a field the request
 *   carried, it MUST name that field in `metadata.ignored_fields`". A server that ignored `model` chose
 *   the model itself; one that ignored the harness selection ran a harness we did not pin. Both are
 *   contradictions of a request this repository made deliberately.
 *
 * `requested_model` is never read as an *observation* — that would launder a substitution into an
 * agreement, and `observeUhpRoute` is careful about it for the same reason. It is read only as the
 * server's own account of the disagreement.
 */
interface StatedContradictions {
  readonly fields: readonly RouteField[];
  /** `true` when the server ran a harness other than the one pinned for this dispatch. */
  readonly harnessIgnored: boolean;
  readonly notes: readonly string[];
}

const HARNESS_SELECTORS = ["metadata", "metadata.harness_id", "harness_id"] as const;

function statedContradictions(response: UhpResponse, requestedModel: string | null): StatedContradictions {
  const metadata = response.metadata ?? {};
  const notes: string[] = [];
  const fields = new Set<RouteField>();

  if (metadata.model_fallback === true) {
    fields.add("model");
    notes.push(
      `the server reports metadata.model_fallback with reason ${
        nonblank(metadata.model_fallback_reason) ?? "(none given)"
      }`,
    );
  }
  const echoed = nonblank(metadata.requested_model);
  const ran = nonblank(response.model);
  if (echoed !== null && ran !== null && echoed !== ran) {
    fields.add("model");
    notes.push(`the server reports it was asked for ${echoed} and ran ${ran}`);
  }
  if (echoed !== null && requestedModel !== null && echoed !== requestedModel) {
    fields.add("model");
    notes.push(
      `the server reports it was asked for ${echoed} and this dispatch asked for ${requestedModel}, so the two do not describe one request`,
    );
  }
  const ignored = metadata.ignored_fields;
  let harnessIgnored = false;
  if (Array.isArray(ignored)) {
    const named = ignored.filter((entry): entry is string => typeof entry === "string");
    if (named.includes("model")) {
      fields.add("model");
      notes.push("the server names model in metadata.ignored_fields, so the requested model had no effect");
    }
    if (named.some((entry) => (HARNESS_SELECTORS as readonly string[]).includes(entry))) {
      harnessIgnored = true;
      notes.push(
        "the server names the harness selector in metadata.ignored_fields, so the task ran on a harness this dispatch did not pin",
      );
    }
  }
  return { fields: [...fields], harnessIgnored, notes };
}

/* -------------------------------------------------------------------------------------------------
 * The provider
 * ---------------------------------------------------------------------------------------------- */

/**
 * Build the provider.
 *
 * Pure construction: no socket, no filesystem, no environment read. The manifest arrives parsed and the
 * transport arrives built, so a composition root can validate both at boot and refuse to start rather
 * than discovering a bad configuration at the first dispatch of the night.
 */
export function createUhpProvider(options: UhpProviderOptions): UhpProvider {
  const id = options.id ?? DEFAULT_ID;
  const clock = options.clock ?? (() => new Date().toISOString());
  const profile = options.credentialProfile ?? HARNESSROUTER_PROFILE;
  const capabilities: ProviderCapabilities = {
    // Honest by construction: what the manifest pins is what can be dispatched. A word with no pinned
    // console id is a word this provider cannot launch, and `selectProvider` passes it over rather than
    // sending a task the server would answer with `404 harness_not_found`.
    harnesses: manifestHarnesses(options.manifest),
    observe: true,
    steer: true,
    stop: true,
  };

  let ledger: UhpSessionLedger = EMPTY_UHP_LEDGER;
  const runs = new Map<string, RunState>();
  /**
   * Unrelated console drift seen while dispatching a run, by `runId`.
   *
   * It is kept here rather than threaded through a dozen return statements because every one of those
   * returns has to carry it: the whole obligation is that the narrowing did not make the drift silent, and
   * an obligation discharged at eleven of twelve exits is discharged at none. `publish` reads it, so the
   * signal is appended to whatever the dispatch reports, redacted by the same fence as the rest of the
   * detail, and it reaches a caller that supplied no diagnostic sink. Keyed on `runId` because a second
   * dispatch under one run id is already refused, so the key cannot collide with a live entry.
   */
  const unrelatedByRun = new Map<string, string>();

  const diagnose = (
    verb: UhpDiagnostic["verb"],
    runId: string,
    verdict: string,
    detail: string,
  ): void => {
    options.onDiagnostic?.({ at: clock(), runId, verb, verdict, detail });
  };

  /**
   * The last act of every verb: publish a redacted string, and check it.
   *
   * The fence is not decoration. `redactPaths` is one function and one function is one place to be wrong;
   * running the independent finder over what is about to be returned is what makes "nothing published
   * carries a path" a property of the boundary rather than of a helper. A finding degrades the detail to
   * a notice rather than throwing, because throwing after a task has launched would lose the `RunRef`
   * that is the only way to stop it — the unredacted text is already with the diagnostic sink.
   */
  const publish = (verb: UhpDiagnostic["verb"], runId: string, verdict: string, detail: string): string => {
    // Unrelated drift rides along on whatever the dispatch reports. It is joined *before* redaction and
    // before the fence, so a console `base` or default model that happens to look like a path is handled by
    // the same guard as everything else here rather than by nobody.
    const unrelated = verb === "dispatch" ? unrelatedByRun.get(runId) : undefined;
    const full = unrelated === undefined ? detail : `${detail}; ${unrelated}`;
    const redacted = redactPaths(full);
    diagnose(verb, runId, verdict, full);
    const found = pathShapedStrings(redacted);
    if (found.length === 0) return redacted;
    return `${verb} ${verdict}: the diagnostic for run ${runId} was withheld because ${found.length} path-shaped value(s) survived redaction; the unredacted form went to this deployment's diagnostic sink`;
  };

  /* -----------------------------------------------------------------------------------------------
   * Shared pieces of the four verbs
   * -------------------------------------------------------------------------------------------- */

  /** Map a non-2xx or unanswered call onto the outcome vocabulary `uhp-lifecycle.ts` maps from. */
  const outcomeOf = (answer: UhpAnswer): UhpOutcome => {
    if (answer.httpStatus === 0) {
      return answer.cause === null ? { kind: "unreachable" } : { kind: "unreachable", cause: answer.cause };
    }
    if (answer.httpStatus === 404) {
      const code = uhpErrorCode(parseJson(answer.body));
      return code === null ? { kind: "not-found" } : { kind: "not-found", code };
    }
    return { kind: "transport", httpStatus: answer.httpStatus };
  };

  /**
   * Read a `POST /responses` answer: the terminal response, or why there is not one.
   *
   * Streaming and non-streaming bodies are both accepted, because `stream` is a request field and a
   * server MAY answer either way; the SSE half delegates to `consumeUhpStream` rather than looking at the
   * bytes here. A stream that is open, truncated or malformed is **not** a response: `readUhpStream`
   * refuses it, and an unreadable stream is not a failed run.
   */
  const readTask = (
    answer: UhpAnswer,
  ): { readonly ok: true; readonly response: UhpResponse } | { readonly ok: false; readonly detail: string } => {
    if (answer.contentType.startsWith("text/event-stream")) {
      const state = consumeUhpStream(answer.body);
      if (!state.ok) {
        return { ok: false, detail: `the event stream was refused as ${state.refusal}: ${state.detail}` };
      }
      if (!state.done) {
        return {
          ok: false,
          detail: `the event stream ended without a terminal event after ${state.frames} frame(s), so the task may still be running`,
        };
      }
      return { ok: true, response: state.response };
    }
    const response = readUhpResponse(parseJson(answer.body));
    if (response === null) {
      return { ok: false, detail: "the answer was not a readable UHP response object" };
    }
    return { ok: true, response };
  };

  /** The version the server says it served, when it disagrees with ours. Reported, never corrected. */
  const versionNote = (answer: UhpAnswer): string =>
    answer.version === null || answer.version === "" ? "" : `; the server served protocol ${answer.version}`;

  /**
   * Record a later sighting of the turn already in the ledger — a read-back, or a cancel answer.
   *
   * `recordUhpTurn` takes the request as well as the response because the chain is a claim about both
   * sides. A read-back is not a new task, so there is no new request: the parent is taken from the ledger
   * entry being advanced, which is the only value that can be right. A refusal is ignored on purpose —
   * `replayed-response` for a turn that was already terminal is the normal case and says nothing is new.
   */
  const advanceTurn = (runId: string, response: UhpResponse): void => {
    const session = uhpSessionOf(ledger, runId);
    if (session === undefined) return;
    const turn = lastUhpTurn(session);
    if (turn === null || turn.responseId !== response.id) return;
    const parent = turn.previousResponseId;
    const advanced = recordUhpTurn(
      session,
      parent === null ? { input: "" } : { input: "", previous_response_id: parent },
      response,
    );
    if (advanced.ok) ledger = withUhpSession(ledger, advanced.session);
  };

  /* -----------------------------------------------------------------------------------------------
   * dispatch
   * -------------------------------------------------------------------------------------------- */

  const refusedDispatch = (runId: string, detail: string, run: RunRef | null = null): DispatchResult => ({
    verdict: "refused",
    run,
    detail: publish("dispatch", runId, "refused", detail),
  });

  const unknownDispatch = (
    runId: string,
    detail: string,
    run: RunRef | null = null,
    route?: PublishedRouteEvidence,
  ): DispatchResult => ({
    verdict: "unknown",
    run,
    detail: publish("dispatch", runId, "unknown", detail),
    ...(route === undefined ? {} : { route }),
  });

  async function dispatch(request: DispatchRequest, runId: string): Promise<DispatchResult> {
    if (nonblank(runId) === null) {
      return refusedDispatch(
        "(unnamed run)",
        "the caller supplied no run id; the record has to exist before the run does, and a provider that minted one would leave a window where something executes and nothing can name it",
      );
    }
    // The same validator the `/swarm` seam uses, reused rather than paraphrased. A second, laxer check
    // here would let this seam dispatch what the other one refuses.
    const problems = validateDispatch(request);
    if (problems.length > 0) {
      return refusedDispatch(runId, `the request would not dispatch faithfully: ${problems.join("; ")}`);
    }
    if (!capabilities.harnesses.includes(request.harness)) {
      return refusedDispatch(
        runId,
        `${request.harness} is not pinned in this manifest, so no console harness id can be named for it; nothing was sent`,
      );
    }
    const pinned = pinnedHarness(options.manifest, request.harness);
    if (pinned === null) {
      return refusedDispatch(runId, `${request.harness} has no pinned console harness id; nothing was sent`);
    }
    if (uhpSessionOf(ledger, runId) !== undefined) {
      return refusedDispatch(
        runId,
        `run ${runId} already has a UHP session on this provider; a second dispatch under one run id would put two agents in one working directory`,
      );
    }

    // F1. The console drift check, before anything is launched. A `GET` cannot start a task, so every
    // failure of this leg is a refusal: nothing ran, and a retry is safe once the cause is fixed.
    //
    // The detection is over the whole manifest and the **refusal is narrowed to the harness this dispatch
    // selected**, per the owner decision of 2026-09-12. The property being protected is never sending an
    // identifier nobody verified, which needs only the identifier about to be sent; refusing on a row
    // nobody is dispatching to bought that nothing and cost one edited console row halting every lane.
    //
    // Two halves of that decision are carried below and neither is optional. An unreadable listing still
    // blocks — it cleared no id, including the selected one — and unrelated drift is still reported, on the
    // dispatch result and to the diagnostic sink, because a narrowing that made it silent would trade one
    // failure for absence reported as normality.
    const listing = await options.transport.call({ method: "GET", path: "harnesses" });
    if (!listing.sent) {
      return refusedDispatch(runId, `the console listing was not requested: ${listing.cause ?? "no cause given"}; nothing was sent`);
    }
    if (listing.httpStatus !== 200) {
      const code = uhpErrorCode(parseJson(listing.body));
      return refusedDispatch(
        runId,
        `the console listing answered HTTP ${listing.httpStatus}${code === null ? "" : ` (${code})`}, so the pinned harness ids could not be cleared; no task was sent${versionNote(listing)}`,
      );
    }
    const drift = detectHarnessDrift(options.manifest, readUhpHarnessList(parseJson(listing.body)));
    const selected = selectHarnessDrift(drift, request.harness);
    if (selected.blocking.length > 0) {
      return refusedDispatch(
        runId,
        `the console has drifted from the pinned manifest on ${request.harness}, so no task was sent: ${
          describeHarnessDrift(options.manifest, selected.blocking)
        }`,
      );
    }
    // The non-blocking signal. Emitted before the task is sent so it exists even if the dispatch then fails
    // for an unrelated reason, and emitted with its own verdict label rather than folded into the dispatch
    // verdict, because it is a different event from whatever this dispatch turns out to be. It is also
    // appended to the dispatch detail below, since the diagnostic sink is a local operator surface and the
    // detail is what a caller keeps.
    const unrelatedDrift = describeUnrelatedHarnessDrift(options.manifest, selected.unrelated);
    if (unrelatedDrift !== null) {
      diagnose("dispatch", runId, UHP_UNRELATED_DRIFT, unrelatedDrift);
      unrelatedByRun.set(runId, unrelatedDrift);
    }

    // The requested route. `model` falls back to the pinned `defaultModel` because that is what the server
    // runs when a request omits one (Tasks §1.1, "Omitted means the harness's default"), so the comparison
    // is then against the model that will actually run rather than against nothing.
    //
    // The fallback is unreachable today: `validateDispatch` refuses a request with no model, on the grounds
    // that a run inheriting a provider default is not the run the matrix selected. It is kept because the
    // alternative — comparing against `null` — would make an omitted model an unknown route instead of a
    // checked one, the day that validator or this seam changes. F10's `defaultModel` clause is carried by
    // the drift check above, where a console default that differs from the pinned one refuses the dispatch.
    const requestedModel = request.model ?? pinned.defaultModel;
    const state: RunState = {
      harness: request.harness,
      pinned,
      requested: {
        provider: options.modelProvider,
        model: requestedModel,
        effort: request.effort ?? null,
        cwd: options.cwd,
      },
    };

    const session = openUhpSession(runId, id);
    const built = nextUhpRequest(session, request.prompt, requestedModel ?? undefined, false);
    if (!built.ok) {
      return refusedDispatch(runId, `${built.refusal}: ${built.detail}`);
    }
    // The payload, in full. Protocol fields only: no profile, no token, no routing document, no lane. The
    // credential is attached by `uhp-transport.ts` as a header it owns and this function never reads.
    //
    // `background: true`, `stream: false`. A dispatch returns once the executor has the run — that is what
    // the verb means on this seam — and Tasks §1.1 defines `background` as exactly that: "Return as soon as
    // the task is accepted; follow it with the events endpoint." Streaming instead would hold this call
    // open for the whole agent run, so `dispatch` would not return until the work was finished and
    // `observe` would have nothing left to observe. Streaming §5 settles the follow-up: "A client SHOULD
    // treat the stream as an optimisation and the stored response as the source of truth", which is why
    // `observe` re-reads `GET /responses/{id}` rather than holding a connection open.
    //
    // A server that does not act on `background` must name it in `metadata.ignored_fields` (Tasks §1.1),
    // and then this call blocks and returns a terminal response — which `readTask` accepts. Both shapes
    // are handled because both are conformant.
    const body: UhpCreateRequest = {
      ...built.request,
      background: true,
      metadata: { harness_id: pinned.id },
    };
    const answer = await options.transport.call({
      method: "POST",
      path: "responses",
      body,
      // Errors §4: a retry of a task creation MUST carry an idempotency key, and the identity a retry
      // shares is the run's. Keying on `runId` is what makes a repeated dispatch return the first result
      // instead of running the work twice.
      idempotencyKey: runId,
    });

    if (!answer.sent) {
      return refusedDispatch(runId, `no task was sent: ${answer.cause ?? "no cause given"}`);
    }
    if (answer.httpStatus === 0) {
      return unknownDispatch(
        runId,
        `the task was sent and nothing answered (${answer.cause ?? "no cause given"}); a dropped connection does not abort the task, so a run may be executing — observe before dispatching again`,
      );
    }
    if (answer.httpStatus !== 200) {
      const code = uhpErrorCode(parseJson(answer.body));
      const named = code === null ? `HTTP ${answer.httpStatus}` : `HTTP ${answer.httpStatus} (${code})`;
      if (code === "harness_not_found") {
        return refusedDispatch(
          runId,
          `the pinned console id for ${request.harness} was accepted by the listing and rejected by the task endpoint (${named}); the console changed between the two calls and nothing ran`,
        );
      }
      if (answer.httpStatus === 409) {
        // `session_busy` on a run with no prior turn is the server contradicting itself about what is
        // running in a session we have not used. Something may be executing under it; that is `unknown`.
        return unknownDispatch(
          runId,
          `the task endpoint answered ${named} for a run with no prior turn, so a task may be executing in a session this run cannot name`,
        );
      }
      if (answer.httpStatus >= 500) {
        return unknownDispatch(
          runId,
          `the task endpoint answered ${named}; a server error is not a verdict on the run, which may have started`,
        );
      }
      return refusedDispatch(
        runId,
        `the task endpoint answered ${named}, so nothing ran${answer.httpStatus === 401 || answer.httpStatus === 403 ? `; the credential profile in use is ${profile}` : ""}${versionNote(answer)}`,
      );
    }

    const task = readTask(answer);
    if (!task.ok) {
      return unknownDispatch(
        runId,
        `the task endpoint answered 200 and ${task.detail}; nothing can be concluded about the run, which may be executing`,
      );
    }
    const response = task.response;

    // The ledger. A refusal here is a server contradicting the protocol about identity, so the turn is not
    // recorded and the verdict is `unknown` — something is running and this repository cannot name it.
    const recorded = recordUhpTurn(session, body, response);
    if (!recorded.ok) {
      ledger = withUhpSession(ledger, session);
      runs.set(runId, state);
      return unknownDispatch(
        runId,
        `the session ledger refused the turn as ${recorded.refusal}: ${recorded.detail}; the server's response id is ${
          nonblank(response.id) ?? "(absent)"
        }, which is the only handle an operator has for it`,
        uhpRunRef(session),
      );
    }
    ledger = withUhpSession(ledger, recorded.session);
    runs.set(runId, state);
    const run = uhpRunRef(recorded.session);

    const evidence = compareRouteIdentity(
      {
        provider: state.requested.provider,
        model: state.requested.model,
        effort: state.requested.effort,
        cwd: state.requested.cwd,
      },
      observeUhpRoute(response),
    );
    const stated = statedContradictions(response, state.requested.model);
    if (stated.harnessIgnored) {
      // The harness selection is not a route field, so no verdict derived from route negatives can carry
      // it. It is a refusal in its own right: the work ran somewhere this dispatch did not name.
      return {
        verdict: "refused",
        run,
        detail: publish(
          "dispatch",
          runId,
          "refused",
          `the server did not honour the pinned harness selection: ${stated.notes.join("; ")}; ${decideUhpRoute(evidence).detail}`,
        ),
        route: redactRouteEvidence(evidence),
      };
    }

    const negatives = uhpRouteNegatives(evidence);
    const contradicted = [...new Set<RouteField>([...negatives.contradicted, ...stated.fields])];
    // The ratified rule, composed rather than reimplemented: the negatives are widened by what the server
    // stated about itself, and `uhpRouteVerdict` — whose parameter type has no `status` field — decides.
    const verdict = uhpRouteVerdict({
      contradicted,
      unreported: negatives.unreported,
      // `unattested` is **not** widened by `stated.fields`, and that is deliberate rather than an oversight.
      // Every stated field is already in `contradicted` above, and a contradiction decides first, so widening
      // this list could not change an outcome — it would be unreachable code that reads like a safeguard, and
      // the next person would maintain it as one. The contradiction is the single widening.
      unattested: negatives.unattested,
      unverified: negatives.unverified,
    });
    const decision = decideUhpRoute(evidence);
    const lifecycle = `the task reported status ${response.status}`;
    const detail = verdict === "refused"
      ? `the server contradicted the requested route on ${contradicted.join(", ")}${
        stated.notes.length === 0 ? "" : `: ${stated.notes.join("; ")}`
      }; the comparison status is "${decision.status}" because the wire did not report ${
        negatives.unreported.join(", ") || "nothing"
      }, so the status cannot carry this; ${lifecycle}; ${evidence.detail}`
      // Both remaining branches take the gate's own words. The accepted one especially: it names the fields
      // that could not be attested and the owner risk ruling that accepts them anyway, and a second
      // paraphrase here would be the place those grounds quietly stopped being reported.
      : `${decision.detail}; ${lifecycle}`;

    return {
      verdict,
      run,
      detail: publish("dispatch", runId, verdict, detail),
      route: redactRouteEvidence(evidence),
    };
  }

  /* -----------------------------------------------------------------------------------------------
   * observe
   * -------------------------------------------------------------------------------------------- */

  const unknownObservation = (run: RunRef, detail: string): Observation => ({
    run,
    liveness: "unknown",
    observedAt: clock(),
    detail: publish("observe", run.runId, "unknown", detail),
    artifacts: [],
  });

  async function observe(run: RunRef): Promise<Observation> {
    if (run.provider !== id) {
      return unknownObservation(
        run,
        `run ${run.runId} is owned by provider ${run.provider}, and nothing else may observe it`,
      );
    }
    const session = uhpSessionOf(ledger, run.runId);
    const turn = session === undefined ? null : lastUhpTurn(session);
    if (session === undefined || turn === null) {
      return unknownObservation(
        run,
        `this provider holds no recorded turn for run ${run.runId}, so there is no response id to read back; a task may be executing under a session this provider cannot name`,
      );
    }

    const answer = await options.transport.call({ method: "GET", path: `responses/${encodeURIComponent(turn.responseId)}` });
    if (answer.httpStatus !== 200) {
      const outcome = outcomeOf(answer);
      const observed = uhpObservation(run, outcome, clock());
      return { ...observed, detail: publish("observe", run.runId, observed.liveness, observed.detail) };
    }
    const response = readUhpResponse(parseJson(answer.body));
    if (response === null) {
      const observed = uhpObservation(run, { kind: "unreadable", refusal: "frame-unreadable" }, clock());
      return {
        ...observed,
        detail: publish(
          "observe",
          run.runId,
          observed.liveness,
          `the read-back of response ${turn.responseId} was not a readable UHP response object; ${observed.detail}`,
        ),
      };
    }
    // Sessions §1 requires a continued chain to report the same `metadata.session_id`, and a read-back is
    // the same task: a different session id means a different working directory, and the files the turn
    // wrote are not there. Nothing about what the run did can be concluded from it.
    const reported = nonblank(response.metadata?.session_id);
    if (session.sessionId !== null && reported !== null && reported !== session.sessionId) {
      return unknownObservation(
        run,
        `response ${turn.responseId} now reports session ${reported} and this run is in session ${session.sessionId}; a task cannot change session, so this observation is not about a state this provider can attribute`,
      );
    }

    advanceTurn(run.runId, response);
    const observed = uhpObservation(run, { kind: "lifecycle", status: response.status }, clock());
    const state = runs.get(run.runId);
    const stated = statedContradictions(response, state?.requested.model ?? null);
    // A substitution can appear on a read-back that was absent at dispatch. An observation has no verdict
    // to refuse with, so it says so in the one place an operator reads.
    const detail = stated.fields.length === 0 && !stated.harnessIgnored
      ? observed.detail
      : `${observed.detail}; the server also states a contradiction of the requested route: ${stated.notes.join("; ")}`;
    return { ...observed, detail: publish("observe", run.runId, observed.liveness, detail) };
  }

  /* -----------------------------------------------------------------------------------------------
   * steer
   * -------------------------------------------------------------------------------------------- */

  const steerResult = (run: RunRef, verdict: SteerVerdict, detail: string): SteerResult => ({
    verdict,
    detail: publish("steer", run.runId, verdict, detail),
  });

  /**
   * Send the next turn of the conversation.
   *
   * **What `steer` means over UHP, stated because it is narrower than the word suggests.** There is no
   * way to inject a message into a task that is running: Lifecycle §5 has the server refuse a second
   * concurrent task in one session with `409 session_busy`, because "a session has one working directory
   * and one conversation, and two agents writing to both is not a defined state". Steering here is
   * therefore turn-boundary continuation — the next task in the session, chained on
   * `previous_response_id` — and an attempt to steer a live turn is refused rather than queued, locally,
   * before anything is sent.
   */
  async function steer(run: RunRef, message: string): Promise<SteerResult> {
    if (run.provider !== id) {
      return steerResult(run, "unknown", `run ${run.runId} is owned by provider ${run.provider}, and nothing else may steer it`);
    }
    if (nonblank(message) === null) {
      return steerResult(run, "refused", "an empty message is not a turn; nothing was sent");
    }
    const session = uhpSessionOf(ledger, run.runId);
    const state = runs.get(run.runId);
    if (session === undefined || state === undefined) {
      return steerResult(
        run,
        "unknown",
        `this provider holds no session for run ${run.runId}, so there is no chain to continue; a message sent without one would start a new conversation the coordinator could not attribute`,
      );
    }
    const built = nextUhpRequest(session, message, state.requested.model ?? undefined, false);
    if (!built.ok) {
      // `prior-turn-open` is the local form of `session_busy`: the refusal is the same and it costs no
      // dispatch. Errors §4 says to retry once the in-flight task is terminal, which is a caller decision.
      return steerResult(run, "refused", `${built.refusal}: ${built.detail}`);
    }
    const body: UhpCreateRequest = {
      ...built.request,
      background: true,
      metadata: { harness_id: state.pinned.id },
    };
    const answer = await options.transport.call({ method: "POST", path: "responses", body });

    if (!answer.sent) {
      return steerResult(run, "refused", `the message was not sent: ${answer.cause ?? "no cause given"}`);
    }
    if (answer.httpStatus === 0) {
      return steerResult(
        run,
        "unknown",
        `the message was sent and nothing answered (${answer.cause ?? "no cause given"}); a turn may be running`,
      );
    }
    if (answer.httpStatus !== 200) {
      const code = uhpErrorCode(parseJson(answer.body));
      const named = code === null ? `HTTP ${answer.httpStatus}` : `HTTP ${answer.httpStatus} (${code})`;
      if (code === "session_expired" || code === "response_not_found" || answer.httpStatus === 404) {
        return steerResult(
          run,
          "unknown",
          `the task endpoint answered ${named}; the chain could not be continued and no terminal state may be synthesized from it`,
        );
      }
      if (answer.httpStatus >= 500) {
        return steerResult(run, "unknown", `the task endpoint answered ${named}, which is not a verdict on the message`);
      }
      return steerResult(run, "refused", `the task endpoint answered ${named}, so the message did not land`);
    }
    const task = readTask(answer);
    if (!task.ok) {
      return steerResult(run, "unknown", `the task endpoint answered 200 and ${task.detail}; the turn may be running`);
    }
    const recorded = recordUhpTurn(session, body, task.response);
    if (!recorded.ok) {
      return steerResult(
        run,
        "unknown",
        `the turn was answered and the ledger refused it as ${recorded.refusal}: ${recorded.detail}`,
      );
    }
    ledger = withUhpSession(ledger, recorded.session);

    const stated = statedContradictions(task.response, state.requested.model);
    // `delivered` is a statement about the message, and the message did land. The route contradiction is a
    // different fact and `SteerResult` has nowhere structured to put it, so it is named in the detail and
    // in the diagnostic, and the next `observe` or `dispatch` sees it too. The seam's inability to carry
    // route evidence through `steer` is recorded as a proposal in this run's notes, not fixed here.
    const detail = stated.fields.length === 0 && !stated.harnessIgnored
      ? `turn ${recorded.session.turns.length} was accepted and reported status ${task.response.status}`
      : `turn ${recorded.session.turns.length} was accepted with status ${task.response.status}, and the server states a contradiction of the requested route: ${stated.notes.join("; ")}`;
    return steerResult(run, "delivered", detail);
  }

  /* -----------------------------------------------------------------------------------------------
   * stop
   * -------------------------------------------------------------------------------------------- */

  const stopResult = (run: RunRef, verdict: StopVerdict, detail: string): StopResult => ({
    verdict,
    detail: publish("stop", run.runId, verdict, detail),
  });

  /**
   * Cancel the task this run is executing.
   *
   * Sessions §4 semantics, honoured rather than smoothed: cancellation is a request and not a guarantee
   * of immediacy, a cancelled task ends at `cancelled` and never `failed`, cancelling an already-terminal
   * task succeeds and changes nothing, and cancelling does not delete the session. The three outcomes a
   * downstream consumer asked to be able to distinguish (#286, Cockpit Seat 1) are kept apart:
   * `stopped` for an observed `cancelled`, `already-over` for a task that was terminal before the
   * request, and `unknown` for a `404` or a `session_expired` — never a synthesized terminal state.
   *
   * A task still `in_progress` in the cancel answer is also `unknown`. The server accepted the request and
   * the work has not stopped yet; reporting `stopped` there would be a terminal claim about a live agent.
   */
  async function stop(run: RunRef, reason: string): Promise<StopResult> {
    if (run.provider !== id) {
      return stopResult(run, "unknown", `run ${run.runId} is owned by provider ${run.provider}, and nothing else may stop it`);
    }
    const session = uhpSessionOf(ledger, run.runId);
    const turn = session === undefined ? null : lastUhpTurn(session);
    if (session === undefined || turn === null) {
      return stopResult(
        run,
        "unknown",
        `this provider holds no recorded turn for run ${run.runId}, so there is no task id to cancel; a task may still be executing`,
      );
    }
    // The caller's reason is prose and may carry anything, including a path. It goes to the local
    // diagnostic and never into a published detail.
    diagnose("stop", run.runId, "requested", `cancellation requested for response ${turn.responseId}: ${reason}`);

    const answer = await options.transport.call({
      method: "POST",
      path: `responses/${encodeURIComponent(turn.responseId)}/cancel`,
    });
    if (!answer.sent) {
      return stopResult(
        run,
        "unknown",
        `the cancellation was not sent (${answer.cause ?? "no cause given"}), so the task was not stopped`,
      );
    }
    if (answer.httpStatus === 0) {
      return stopResult(
        run,
        "unknown",
        `the cancellation was sent and nothing answered (${answer.cause ?? "no cause given"}); whether the task stopped is unknown`,
      );
    }
    if (answer.httpStatus !== 200) {
      const code = uhpErrorCode(parseJson(answer.body));
      const named = code === null ? `HTTP ${answer.httpStatus}` : `HTTP ${answer.httpStatus} (${code})`;
      if (answer.httpStatus === 401 || answer.httpStatus === 403) {
        return stopResult(
          run,
          "refused",
          `the cancel endpoint answered ${named} for credential profile ${profile}, so the task was not stopped`,
        );
      }
      return stopResult(
        run,
        "unknown",
        `the cancel endpoint answered ${named}; no terminal state may be synthesized from it, and the task may still be executing`,
      );
    }
    const response = readUhpResponse(parseJson(answer.body));
    if (response === null) {
      return stopResult(run, "unknown", "the cancel endpoint answered 200 with something that is not a UHP response object");
    }
    advanceTurn(run.runId, response);

    if (response.status === "cancelled") {
      return stopResult(run, "stopped", `the server reports the task cancelled; partial output may exist and the session remains continuable`);
    }
    if (response.status === "in_progress") {
      return stopResult(
        run,
        "unknown",
        "the server accepted the cancellation and the task has not reached a terminal state yet; cancellation is a request rather than a guarantee of immediacy",
      );
    }
    return stopResult(
      run,
      "already-over",
      `the task was already ${response.status} when the cancellation arrived, so there was nothing left to stop`,
    );
  }

  return {
    id,
    capabilities,
    dispatch,
    observe,
    steer,
    stop,
    sessions: () => ledger,
  };
}
