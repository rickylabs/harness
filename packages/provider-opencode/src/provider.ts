/**
 * The four verbs, over a long-lived `opencode serve`.
 *
 * The second `SubagentProvider` in the repository, and the first one that talks to something it does
 * not own. `provider-claude` holds a child process: it is the run's parent, and when it goes away the
 * run goes with it. This provider holds a socket to a server that was already running and will still
 * be running afterwards, and every difference below follows from that one fact.
 *
 * ## What the two-call launch buys
 *
 * `POST /session` mints the id; `POST /session/:id/prompt_async` starts the agent. So the handle
 * exists before the work does, and a prompt whose reply is lost leaves a run that is still
 * observable, steerable and stoppable. `provider-claude`'s `unknown` is blind — it has nothing to
 * name. This one's is a live run with an id, which is the difference between "something may be
 * happening somewhere" and "session `ses_x` may be working; go and look".
 *
 * The same split decides the verdicts. A failed `POST /session` means no prompt was ever sent, so
 * nothing is executing and a retry is safe — `refused`. A failed *prompt* means an agent may be
 * working right now — `unknown`, which `isSafeToRetry` deliberately does not license.
 *
 * ## A dispatch that cannot be watched is refused
 *
 * Everything this provider knows about a live run arrives on `GET /event`. If that stream cannot be
 * opened, a dispatch would launch a run into silence — and this repository exists because its owner
 * had to keep asking an orchestrator "status ?". So the stream is opened *before* the session is
 * created, and a dispatch that cannot get one is refused with nothing sent. Refusing to start is a
 * cost; starting something nobody can see is the failure.
 *
 * ## And an observation nobody can confirm says so
 *
 * The other side of the same coin. While the stream is down the record is a photograph: it was true,
 * and nothing says it still is. `observe` reconnects on demand and, if it still cannot, downgrades a
 * live run to `unknown` with the time the photograph was taken. Terminal states are exempt — they are
 * facts about something that already happened, and they do not expire.
 *
 * ## Shutting down does not stop anything
 *
 * `shutdown()` closes the event stream and nothing else. Runs on a long-lived server are meant to
 * outlive the coordinator process; a provider that aborted them on the way out would turn a restart
 * into an outage. `provider-claude` reaps on shutdown because its runs are its children. These are
 * not.
 */

import {
  type DispatchRequest,
  type DispatchResult,
  type Observation,
  type ProviderCapabilities,
  type RunRef,
  type SteerResult,
  type StopResult,
  type SubagentProvider,
  validateDispatch,
} from "@rickylabs/subagents";
import { timeoutMs } from "@rickylabs/subagents";

import { PATHS, promptBody, readBoolean, readSessionId, sessionBody, type WireModel } from "./api.js";
import { NO_FRAMES, type FrameState, classify, feed, readEvent, sessionOf } from "./events.js";
import { answered, describeOutcome, type HttpFn, type StreamFn } from "./http.js";
import { translateModel, untranslated } from "./model.js";
import { pathIsCredentialFile, scrub } from "./secrets.js";
import {
  type RunRecord,
  applySignal,
  describe,
  isOver,
  markFinished,
  markQueued,
  markStopped,
  markStopping,
  markUnknown,
  newRun,
  unverified,
} from "./run.js";

/** Registration id when a deployment does not name one. */
export const DEFAULT_ID = "opencode-http";

/**
 * What this provider can do.
 *
 * Both opencode harnesses, because the difference between `opencode` and `opencode-run` is how a
 * divybot agent is invoked, and neither reaches this server differently: a prompt is a prompt. All
 * three optional calls are real — `observe` off the event bus, `steer` as a second prompt into the
 * same session, `stop` as `POST /session/:id/abort`.
 */
export const CAPABILITIES: ProviderCapabilities = {
  harnesses: ["opencode", "opencode-run"],
  observe: true,
  steer: true,
  stop: true,
};

export interface OpencodeProviderOptions {
  /** One request, one outcome. `createTransport` builds the real one; the suite binds a fake. */
  readonly http: HttpFn;
  /** The `GET /event` connection. Same transport, different lifetime. */
  readonly stream: StreamFn;
  /** Registration id. Defaults to `opencode-http`. */
  readonly id?: string;
  /**
   * A directory worth collecting evidence from, if the deployment has one.
   *
   * Reported as an artifact, so it is published. Deliberately not defaulted to the opencode data
   * directory: that is where `auth.json` lives, and pointing evidence collection at it would be a
   * leak with a delay on it. A `logDir` that names a credential file is refused outright.
   */
  readonly logDir?: string;
  /** The server-side agent to run prompts as, when a deployment configures one. */
  readonly agent?: string;
  /** Prefix for the session title a run is created with. Never carries the prompt. */
  readonly titlePrefix?: string;
  /** Clock, injected so the suite can assert on timestamps. */
  readonly now?: () => Date;
}

/** Everything held for one run: the record, and the timer that may end it. */
interface Live {
  record: RunRecord;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Where the one event connection has got to. */
interface Bus {
  controller: AbortController | null;
  connected: boolean;
  /** Why it is not connected, in a sentence `observe` can quote. */
  detail: string;
  frames: FrameState;
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  const maybe = timer as { unref?: () => void };
  if (typeof maybe.unref === "function") maybe.unref();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class OpencodeProvider implements SubagentProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities = CAPABILITIES;

  readonly #http: HttpFn;
  readonly #stream: StreamFn;
  readonly #logDir: string | null;
  readonly #agent: string | null;
  readonly #titlePrefix: string;
  readonly #now: () => Date;

  readonly #runs = new Map<string, Live>();
  /** Session id to run id. The bus is server-wide, so every event has to be routed. */
  readonly #bySession = new Map<string, string>();

  readonly #bus: Bus = {
    controller: null,
    connected: false,
    detail: "the event stream has not been opened yet",
    frames: NO_FRAMES,
  };
  /** In-flight `#ensureStream`, so concurrent dispatches open one connection between them. */
  #opening: Promise<string | null> | null = null;

  constructor(options: OpencodeProviderOptions) {
    this.id = options.id ?? DEFAULT_ID;
    this.#http = options.http;
    this.#stream = options.stream;
    this.#logDir = options.logDir ?? null;
    this.#agent = options.agent ?? null;
    this.#titlePrefix = options.titlePrefix ?? "dsh";
    this.#now = options.now ?? ((): Date => new Date());
  }

  async dispatch(request: DispatchRequest, runId: string): Promise<DispatchResult> {
    const refusal = this.#refuseDispatch(request, runId);
    if (refusal !== null) return this.#refused(refusal);

    const translation = translateModel(request);
    if (!translation.ok) return this.#refused(translation.detail);
    const model = translation.model;

    // Before anything is created. A run this provider cannot watch is the failure it exists to
    // prevent, and refusing here is the only point at which refusing is still free.
    const busProblem = await this.#ensureStream();
    if (busProblem !== null) {
      return this.#refused(
        `the event stream could not be opened (${busProblem}), so this run could not be watched; ` +
          "nothing was launched",
      );
    }

    const created = await this.#http({
      method: "POST",
      path: PATHS.sessions,
      body: sessionBody(`${this.#titlePrefix} ${runId}`),
    });
    if (created.kind !== "ok") {
      // Refused, including when the server did not answer — because a session is inert until it is
      // prompted, and no prompt was sent. The worst case is an unprompted session nobody uses, which
      // is litter rather than a second agent on the branch. That distinction is the whole reason
      // `isSafeToRetry` exists, and this is the side of it a retry is safe on.
      return this.#refused(
        `the session could not be created (${describeOutcome(created)}); nothing was prompted, ` +
          (answered(created) ? "so nothing was launched" : "though an unused session may now exist"),
      );
    }

    const sessionId = readSessionId(created.body);
    if (sessionId === null) {
      return this.#refused(
        "the server accepted the session but its reply carried no id, so there was nothing to " +
          "prompt and nothing was launched",
      );
    }

    const at = this.#stamp();
    const live: Live = {
      record: newRun({
        runId,
        external: sessionId,
        askedModel: model.modelID,
        router: model.providerID,
        at,
        artifacts: this.#artifacts(),
      }),
      timer: null,
    };
    this.#runs.set(runId, live);
    this.#bySession.set(sessionId, runId);

    const prompted = await this.#http({
      method: "POST",
      path: PATHS.prompt(sessionId),
      body: promptBody(model, request.prompt, this.#agent),
    });

    if (prompted.kind === "ok") {
      live.record = markQueued(live.record, this.#stamp());
      this.#armTimeout(live, request);
      const lost = untranslated(request);
      const parts = [
        `session ${sessionId} on ${model.providerID}/${model.modelID}`,
        "queued; the first bus event will promote it to running",
      ];
      if (lost.length > 0) parts.push(`not translated: ${lost.join(", ")}`);
      return { verdict: "accepted", run: this.#ref(live.record), detail: this.#say(parts.join("; ")) };
    }

    if (answered(prompted)) {
      // The server read the prompt and said no. Nothing is executing, so the run id is handed back
      // rather than held: a retry licensed by `isSafeToRetry` must not then be refused here as a
      // duplicate, and the session it would have used is dropped on the way out.
      this.#forget(runId, sessionId);
      await this.#discard(sessionId);
      return this.#refused(`the server rejected the prompt (${describeOutcome(prompted)})`);
    }

    // The one case this provider handles better than any other in the repository. The reply is lost,
    // so whether the agent started is genuinely unknown — but the session id is already ours, the run
    // is in the map, the bus is watching it, and the next event settles the question by itself.
    const detail =
      `the prompt's reply was lost (${describeOutcome(prompted)}), so this run may or may not have ` +
      `started; it is watchable as session ${sessionId} — observe it, and stop it if it is alive`;
    live.record = markUnknown(live.record, detail, this.#stamp());
    this.#armTimeout(live, request);
    return { verdict: "unknown", run: this.#ref(live.record), detail: this.#say(detail) };
  }

  async observe(run: RunRef): Promise<Observation> {
    const at = this.#stamp();
    const live = this.#known(run);
    if (live === null) {
      return {
        run,
        liveness: "unknown",
        observedAt: at,
        detail: this.#say(
          `${this.id} has no record of this run; it may still be alive on the server under another ` +
            "process — list the server's sessions before assuming otherwise",
        ),
        artifacts: [],
      };
    }

    // Reconnect on demand rather than on a timer. A background reconnect loop would keep a socket
    // warm for runs that finished hours ago; this one runs when somebody asks a question the socket
    // is needed to answer.
    const busProblem = isOver(live.record) ? null : await this.#ensureStream();
    const view =
      busProblem === null
        ? { liveness: live.record.liveness, detail: describe(live.record) }
        : unverified(live.record, busProblem);

    return {
      run: this.#ref(live.record),
      liveness: view.liveness,
      observedAt: at,
      detail: this.#say(view.detail),
      artifacts: live.record.artifacts,
    };
  }

  async steer(run: RunRef, message: string): Promise<SteerResult> {
    const live = this.#known(run);
    if (live === null) return { verdict: "unknown", detail: `${this.id} has no record of this run` };
    if (message.trim() === "") {
      return { verdict: "refused", detail: "an empty message would reach the agent as a blank turn" };
    }
    if (isOver(live.record)) {
      return { verdict: "refused", detail: `the run is ${live.record.liveness}` };
    }
    const sessionId = live.record.external;
    if (sessionId === null) {
      return { verdict: "refused", detail: "this run has no session id, so nothing can be sent to it" };
    }

    // A second prompt into the same session, with the same model the run was dispatched on. Reusing
    // the record's own model rather than re-reading configuration is what keeps an interjection from
    // silently switching the model mid-run.
    const model: WireModel = { providerID: live.record.router, modelID: live.record.askedModel };
    const sent = await this.#http({
      method: "POST",
      path: PATHS.prompt(sessionId),
      body: promptBody(model, message, this.#agent),
    });
    if (sent.kind === "ok") {
      return { verdict: "delivered", detail: this.#say(`queued into session ${sessionId}`) };
    }
    if (answered(sent)) {
      return { verdict: "refused", detail: this.#say(describeOutcome(sent)) };
    }
    return {
      verdict: "unknown",
      detail: this.#say(`${describeOutcome(sent)}; the message may or may not have been queued`),
    };
  }

  async stop(run: RunRef, reason: string): Promise<StopResult> {
    const live = this.#known(run);
    if (live === null) return { verdict: "unknown", detail: `${this.id} has no record of this run` };
    if (isOver(live.record)) {
      return { verdict: "already-over", detail: `the run is ${live.record.liveness}` };
    }
    const sessionId = live.record.external;
    if (sessionId === null) {
      return { verdict: "refused", detail: "this run has no session id, so there is nothing to abort" };
    }

    // Recorded before the request goes out, so that whatever the bus reports next — an idle, or the
    // session disappearing — reads as this stop working rather than as the run failing.
    live.record = markStopping(live.record, reason, this.#stamp());
    this.#clearTimer(live);

    const aborted = await this.#http({ method: "POST", path: PATHS.abort(sessionId) });
    if (aborted.kind !== "ok") {
      const detail = `${describeOutcome(aborted)}; the run may still be alive`;
      if (answered(aborted)) return { verdict: "refused", detail: this.#say(detail) };
      return { verdict: "unknown", detail: this.#say(detail) };
    }

    const value = readBoolean(aborted.body);
    if (value === null) {
      return {
        verdict: "unknown",
        detail: this.#say(
          "the server answered the abort with something other than a boolean, so whether the run " +
            "was stopped cannot be read from it",
        ),
      };
    }
    if (value) {
      live.record = markStopped(live.record, reason, this.#stamp());
      return { verdict: "stopped", detail: this.#say(`aborted session ${sessionId}: ${reason}`) };
    }
    live.record = markFinished(
      live.record,
      "the server reported there was nothing to abort, so the run was already over",
      this.#stamp(),
    );
    return {
      verdict: "already-over",
      detail: this.#say(`session ${sessionId} had nothing to abort`),
    };
  }

  /**
   * Close the event stream. Nothing else.
   *
   * Not an oversight and not a weaker `provider-claude.shutdown()`. Runs here belong to a server that
   * outlives this process by design, and ending them because the coordinator is restarting would
   * make every deploy an interruption. What is released is the socket; what is left is a set of runs
   * a later process can find by listing the server's sessions.
   */
  async shutdown(): Promise<void> {
    this.#closeStream("the provider was shut down");
    for (const live of this.#runs.values()) this.#clearTimer(live);
  }

  /** Runs this provider is holding, live and finished. Read-only; for tests and for `check`. */
  records(): readonly RunRecord[] {
    return [...this.#runs.values()].map((live) => live.record);
  }

  /** Whether the event stream is currently connected, and why not when it is not. */
  busState(): { readonly connected: boolean; readonly detail: string } {
    return { connected: this.#bus.connected, detail: this.#bus.detail };
  }

  #refuseDispatch(request: DispatchRequest, runId: string): string | null {
    if (runId === "") return "the run id is empty, so the run could not be found again";
    if (this.#runs.has(runId)) return `run id ${JSON.stringify(runId)} is already dispatched here`;
    if (!(CAPABILITIES.harnesses as readonly string[]).includes(request.harness)) {
      return (
        `this provider launches ${CAPABILITIES.harnesses.join(" and ")} only, and the request asks ` +
        `for ${request.harness}`
      );
    }
    const problems = validateDispatch(request);
    if (problems.length > 0) return `the request is not launchable: ${problems.join("; ")}`;
    if (this.#logDir !== null && pathIsCredentialFile(this.#logDir)) {
      return (
        "this provider is configured with an evidence directory that names a credential file; " +
        "artifact paths are published, so nothing will be dispatched until it is changed"
      );
    }
    return null;
  }

  /**
   * Make sure the event stream is connected, and say why it is not.
   *
   * `null` means connected. Concurrent callers share one attempt: two dispatches arriving together
   * on a cold provider must not open two server-wide connections, because the second one's events
   * would be folded into the same records twice.
   */
  async #ensureStream(): Promise<string | null> {
    if (this.#bus.connected) return null;
    const existing = this.#opening;
    if (existing !== null) return await existing;

    const attempt = (async (): Promise<string | null> => {
      const controller = new AbortController();
      let outcome;
      try {
        outcome = await this.#stream({ path: PATHS.events, signal: controller.signal });
      } catch (error) {
        this.#bus.detail = messageOf(error);
        return this.#bus.detail;
      }
      if (outcome.kind !== "open") {
        this.#bus.detail =
          outcome.kind === "http"
            ? `HTTP ${outcome.status}: ${outcome.detail}`
            : `the server could not be reached: ${outcome.detail}`;
        return this.#bus.detail;
      }
      this.#bus.controller = controller;
      this.#bus.connected = true;
      this.#bus.detail = "connected";
      this.#bus.frames = NO_FRAMES;
      this.#consume(outcome.chunks, controller);
      return null;
    })();

    this.#opening = attempt;
    try {
      return await attempt;
    } finally {
      this.#opening = null;
    }
  }

  /**
   * Fold the stream into the records, for as long as it lasts.
   *
   * Not awaited by anything. The loop's only job is to keep records true; a caller that needed to
   * wait for a particular event would be a caller polling a socket, which is the shape this design
   * replaced.
   */
  #consume(chunks: AsyncIterable<string>, controller: AbortController): void {
    void (async () => {
      let ending = "the event stream ended";
      try {
        for await (const chunk of chunks) {
          const step = feed(this.#bus.frames, chunk);
          this.#bus.frames = step.state;
          for (const frame of step.frames) this.#route(frame);
        }
      } catch (error) {
        ending = `the event stream failed: ${messageOf(error)}`;
      } finally {
        // Only if this is still the live connection. A stream that ended after `shutdown` opened no
        // replacement, but one that ended after a reconnect must not un-connect its successor.
        if (this.#bus.controller === controller) {
          this.#bus.connected = false;
          this.#bus.controller = null;
          this.#bus.detail = ending;
        }
      }
    })();
  }

  /** One frame: parse it, find whose run it is about, fold it in. Anything unrecognised is dropped. */
  #route(frame: string): void {
    const event = readEvent(frame);
    if (event === null) return;
    const signal = classify(event);
    if (signal.kind === "connected" || signal.kind === "ignored") return;
    const sessionId = sessionOf(event);
    if (sessionId === null) return;
    const runId = this.#bySession.get(sessionId);
    if (runId === undefined) return;
    const live = this.#runs.get(runId);
    if (live === undefined) return;
    live.record = applySignal(live.record, signal, this.#stamp());
    if (isOver(live.record)) this.#clearTimer(live);
  }

  /**
   * Honour the request's deadline.
   *
   * Same argument as `provider-claude`'s: a dispatch that names a deadline and then runs past it
   * forever is a lease nobody reclaims. The difference is what expiry does — there it aborts a child
   * this process owns, here it sends an abort to a server that may ignore it, and `stop` reports
   * which of those happened.
   */
  #armTimeout(live: Live, request: DispatchRequest): void {
    const ms = timeoutMs(request);
    if (ms === null) return;
    const timeout = request.timeout;
    const timer = setTimeout(() => {
      if (isOver(live.record)) return;
      void this.stop(this.#ref(live.record), `timeout after ${timeout}`);
    }, ms);
    unref(timer);
    live.timer = timer;
  }

  #clearTimer(live: Live): void {
    if (live.timer === null) return;
    clearTimeout(live.timer);
    live.timer = null;
  }

  #closeStream(reason: string): void {
    const controller = this.#bus.controller;
    this.#bus.controller = null;
    this.#bus.connected = false;
    this.#bus.detail = reason;
    if (controller !== null) controller.abort();
  }

  /** Drop a run this provider is no longer holding, so its id and session are reusable. */
  #forget(runId: string, sessionId: string): void {
    const live = this.#runs.get(runId);
    if (live !== undefined) this.#clearTimer(live);
    this.#runs.delete(runId);
    this.#bySession.delete(sessionId);
  }

  /** Best effort: drop a session that was created and never prompted. Its failure changes nothing. */
  async #discard(sessionId: string): Promise<void> {
    try {
      await this.#http({ method: "DELETE", path: PATHS.session(sessionId) });
    } catch {
      // A session nobody prompted does nothing. Leaving one behind is litter, and litter is not
      // worth turning a clean refusal into a thrown error.
    }
  }

  #refused(detail: string): DispatchResult {
    return { verdict: "refused", run: null, detail: this.#say(detail) };
  }

  #known(run: RunRef): Live | null {
    if (run.provider !== this.id) return null;
    return this.#runs.get(run.runId) ?? null;
  }

  #ref(record: RunRecord): RunRef {
    return { runId: record.runId, provider: this.id, external: record.external };
  }

  #artifacts(): readonly string[] {
    return this.#logDir === null ? [] : [this.#logDir];
  }

  /**
   * The one place a string leaves this provider.
   *
   * Every detail goes through it, including the ones built entirely from our own words, because the
   * ones that are not are indistinguishable at the call site — a server's error body reaches a detail
   * through `describeOutcome` and looks like any other interpolation. A redaction applied at forty
   * call sites is a redaction missing at one of them.
   */
  #say(text: string): string {
    return scrub(text);
  }

  #stamp(): string {
    return this.#now().toISOString();
  }
}

/** Build a provider. The function form the composition root registers. */
export function createProvider(options: OpencodeProviderOptions): OpencodeProvider {
  return new OpencodeProvider(options);
}
