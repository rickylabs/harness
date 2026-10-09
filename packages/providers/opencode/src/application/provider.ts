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

import { promptBody, readBoolean, readSessionId, type WireModel } from "../domain/api.js";
import { classify, readEvent, sessionOf } from "../domain/events.js";
import { describeOutcome, refutes } from "../domain/outcome.js";
import { pathIsCredentialFile, scrub } from "../domain/secrets.js";
import type { OpencodeServer } from "../ports/server.js";
import { EventBus } from "./event-bus.js";
import { translateModel, untranslated } from "./model.js";
import { CAPABILITIES, DEFAULT_ID, type OpencodeProviderOptions } from "./options.js";
import {
  type RunRecord,
  applySignal,
  busSpoke,
  isOver,
  markFinished,
  markQueued,
  markSessionCreated,
  markStopped,
  markStopping,
  markUnknown,
  reservedRun,
  viewOf,
} from "./run.js";
import { RunTable, type Live } from "./run-table.js";

export class OpencodeProvider implements SubagentProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities = CAPABILITIES;

  readonly #server: OpencodeServer;
  readonly #logDir: string | null;
  readonly #agent: string | null;
  readonly #titlePrefix: string;
  readonly #now: () => Date;
  readonly #runs = new RunTable();
  readonly #bus: EventBus;

  constructor(options: OpencodeProviderOptions) {
    this.id = options.id ?? DEFAULT_ID;
    this.#server = options.server;
    this.#bus = new EventBus(options.server, (item) => this.#route(item));
    this.#logDir = options.logDir ?? null;
    this.#agent = options.agent ?? null;
    this.#titlePrefix = options.titlePrefix ?? "harness";
    this.#now = options.now ?? ((): Date => new Date());
  }

  async dispatch(request: DispatchRequest, runId: string): Promise<DispatchResult> {
    const refusal = this.#refuseDispatch(request, runId);
    if (refusal !== null) return this.#refused(refusal);

    const translation = translateModel(request);
    if (!translation.ok) return this.#refused(translation.detail);
    const model = translation.model;

    // The id is claimed here, synchronously, before the first `await`. `#refuseDispatch` asks whether
    // the id is already taken, and two dispatches for the same id that both reached that question
    // before either had a session to store would both have been told no. Reserving between the check
    // and the first suspension is what makes the answer mean something.
    const live: Live = {
      record: reservedRun({
        runId,
        askedModel: model.modelID,
        router: model.providerID,
        at: this.#stamp(),
        artifacts: this.#artifacts(),
      }),
      timer: null,
      generation: this.#bus.generation,
    };
    this.#runs.claim(runId, live);

    // Before anything is created. A run this provider cannot watch is the failure it exists to
    // prevent, and refusing here is the only point at which refusing is still free.
    const busProblem = await this.#bus.ensure();
    if (busProblem !== null) {
      this.#runs.forget(runId, null);
      return this.#refused(
        `the event stream could not be opened (${busProblem}), so this run could not be watched; ` +
          "nothing was launched",
      );
    }
    live.generation = this.#bus.generation;

    const created = await this.#server.createSession(`${this.#titlePrefix} ${runId}`);
    if (created.kind !== "ok") {
      // Refused, including when the server did not answer — because a session is inert until it is
      // prompted, and no prompt was sent. The worst case is an unprompted session nobody uses, which
      // is litter rather than a second agent on the branch. That distinction is the whole reason
      // `isSafeToRetry` exists, and this is the side of it a retry is safe on.
      this.#runs.forget(runId, null);
      return this.#refused(
        `the session could not be created (${describeOutcome(created)}); nothing was prompted, ` +
          (refutes(created) ? "so nothing was launched" : "though an unused session may now exist"),
      );
    }

    const sessionId = readSessionId(created.body);
    if (sessionId === null) {
      this.#runs.forget(runId, null);
      return this.#refused(
        "the server accepted the session but its reply carried no id, so there was nothing to " +
          "prompt and nothing was launched",
      );
    }

    live.record = markSessionCreated(live.record, sessionId, this.#stamp());
    this.#runs.bindSession(sessionId, runId);

    const prompted = await this.#server.prompt(sessionId, promptBody(model, request.prompt, this.#agent));

    if (prompted.kind === "ok") {
      // Guarded, because this reply is now the *older* of two sources. While it was in flight the bus
      // may have carried this session all the way to idle, and writing `queued` over that would
      // report a finished run as one that has not begun.
      if (!busSpoke(live.record)) live.record = markQueued(live.record, this.#stamp());
      this.#arm(live, request);
      const lost = untranslated(request);
      const parts = [
        `session ${sessionId} on ${model.providerID}/${model.modelID}`,
        busSpoke(live.record)
          ? `accepted; the bus already reports it ${live.record.liveness}`
          : "queued; the first bus event will promote it to running",
      ];
      if (lost.length > 0) parts.push(`not translated: ${lost.join(", ")}`);
      return { verdict: "accepted", run: this.#ref(live.record), detail: this.#say(parts.join("; ")) };
    }

    if (refutes(prompted)) {
      // The server read the prompt and said no. Nothing is executing, so the run id is handed back
      // rather than held: a retry licensed by `isSafeToRetry` must not then be refused here as a
      // duplicate, and the session it would have used is dropped on the way out.
      //
      // Only a `4xx` reaches this. A `5xx` is the gateway's patience running out, which says nothing
      // about whether the agent behind it started — and `refused` is the one verdict `isSafeToRetry`
      // licenses, so reading a `504` as one is how a second agent lands on a live branch.
      this.#runs.forget(runId, sessionId);
      await this.#discard(sessionId);
      return this.#refused(`the server rejected the prompt (${describeOutcome(prompted)})`);
    }

    if (busSpoke(live.record)) {
      // The reply is lost and it does not matter: the bus watched this session start. A launch that
      // has been *seen* is `accepted` however badly the request that caused it ended.
      const detail =
        `the prompt's reply was lost (${describeOutcome(prompted)}), but session ${sessionId} has ` +
        `since reported activity, so the run did start; it is ${live.record.liveness}`;
      this.#arm(live, request);
      return { verdict: "accepted", run: this.#ref(live.record), detail: this.#say(detail) };
    }

    // The one case this provider handles better than any other in the repository. The reply is lost,
    // so whether the agent started is genuinely unknown — but the session id is already ours, the run
    // is in the map, the bus is watching it, and the next event settles the question by itself.
    const detail =
      `the prompt's reply was lost (${describeOutcome(prompted)}), so this run may or may not have ` +
      `started; it is watchable as session ${sessionId} — observe it, and stop it if it is alive`;
    live.record = markUnknown(live.record, detail, this.#stamp());
    this.#arm(live, request);
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
    const busProblem = isOver(live.record) ? null : await this.#bus.ensure();
    const view = viewOf(live.record, busProblem, live.generation < this.#bus.generation);

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
    const sent = await this.#server.prompt(sessionId, promptBody(model, message, this.#agent));
    if (sent.kind === "ok") {
      return { verdict: "delivered", detail: this.#say(`queued into session ${sessionId}`) };
    }
    if (refutes(sent)) {
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
    this.#runs.clearTimer(live);

    const aborted = await this.#server.abort(sessionId);
    if (aborted.kind !== "ok") {
      const detail = `${describeOutcome(aborted)}; the run may still be alive`;
      if (refutes(aborted)) return { verdict: "refused", detail: this.#say(detail) };
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
    this.#bus.close("the provider was shut down");
    for (const live of this.#runs.all()) this.#runs.clearTimer(live);
  }

  /** Runs this provider is holding, live and finished. Read-only; for tests and for `check`. */
  records(): readonly RunRecord[] {
    return this.#runs.all().map((live) => live.record);
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

  /** One item off the bus: read it, find whose run it is about, fold it in. Anything else is dropped. */
  #route(item: unknown): void {
    const event = readEvent(item);
    if (event === null) return;
    const signal = classify(event);
    if (signal.kind === "connected" || signal.kind === "ignored") return;
    const sessionId = sessionOf(event);
    if (sessionId === null) return;
    const live = this.#runs.forSession(sessionId);
    if (live === null) return;
    live.record = applySignal(live.record, signal, this.#stamp());
    // This record has now been spoken for on the current connection, so it is no longer behind a
    // reconnect gap however many connections came before this one.
    live.generation = this.#bus.generation;
    if (isOver(live.record)) this.#runs.clearTimer(live);
  }

  #arm(live: Live, request: DispatchRequest): void {
    this.#runs.armTimeout(live, request, (reason) => void this.stop(this.#ref(live.record), reason));
  }

  #known(run: RunRef): Live | null {
    return this.#runs.known(run, this.id);
  }

  /** Best effort: drop a session that was created and never prompted. Its failure changes nothing. */
  async #discard(sessionId: string): Promise<void> {
    try {
      await this.#server.remove(sessionId);
    } catch {
      // A session nobody prompted does nothing. Leaving one behind is litter, and litter is not
      // worth turning a clean refusal into a thrown error.
    }
  }

  #refused(detail: string): DispatchResult {
    return { verdict: "refused", run: null, detail: this.#say(detail) };
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
