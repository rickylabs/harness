/**
 * `ClaudeProvider` — a `SubagentProvider` over the Claude Agent SDK's in-process `query()`.
 *
 * No PTY, no `send-keys`, no directory-trust prompt to auto-Enter. The run is a generator this
 * process holds, which is what makes `observe` a read of memory rather than an expedition, and what
 * makes `stop` a thing that actually happens rather than a signal aimed at a terminal multiplexer.
 *
 * ## Four verbs, and where each one's honesty lives
 *
 * The contract's difficult word is `unknown`, and this provider produces it in exactly three places,
 * each for the same reason — a run may be alive and we cannot say:
 *
 * - `query()` threw before the stream produced anything. The SDK spawns its child lazily, so most
 *   likely nothing launched; "most likely" is not a claim worth attaching a retry to, and
 *   `isSafeToRetry` licenses a retry only for `refused`.
 * - The session did not announce itself inside `readyTimeoutMs`. Silence is not death.
 * - A verb was handed a `RunRef` this provider has no record of — after a restart, say. The run this
 *   process lost track of may still be holding a worktree.
 *
 * Everything decidable is decided: a malformed request, a harness this provider does not launch, a
 * duplicate run id and an unusable config directory are all `refused` before anything is spawned.
 *
 * ## What is deliberately not translated
 *
 * `DispatchRequest` carries fields the SDK has no option for — `effort` above all, which is how the
 * matrix says *opus 5 medium* rather than *opus 5*. Dropping those silently would be the house's
 * most expensive bug shape: a run that succeeds while being not quite the run that was ordered. So
 * `untranslated()` names them and the dispatch detail carries them, on every dispatch that has any.
 * Mapping `effort` onto a thinking budget is not guesswork this package should do from a Windows
 * workstation; it needs one real run on the box, which is #49's.
 *
 * The model id itself is passed **verbatim**, with no table in between. `@rickylabs/routing` owns
 * every pin and says so: *do not add a second spelling to this table until something can [verify
 * it]*. A translation layer here would be a second, unverified spelling in a second place.
 */

import {
  parseGoDuration,
  validateDispatch,
  type DispatchRequest,
  type DispatchResult,
  type Observation,
  type ProviderCapabilities,
  type RunRef,
  type SteerResult,
  type StopResult,
  type SubagentProvider,
} from "@rickylabs/subagents";

import { envProblems, fatalEnvProblems, isolatedEnv, type BaseEnv } from "./env.js";
import { Inbox } from "./inbox.js";
import {
  applyMessage,
  describe,
  endStream,
  isOver,
  markStopping,
  modelNote,
  newRun,
  type MessageReaders,
  type RunRecord,
} from "./run.js";
import {
  isTurn,
  readInit,
  readResult,
  userMessage,
  type AgentQuery,
  type QueryFn,
  type SdkUserMessage,
} from "./sdk.js";

/** The id this provider registers under. A lowercase slug, as `conformanceProblems` requires. */
export const DEFAULT_ID = "claude-sdk";

/**
 * How long `dispatch` waits for the session to announce itself before answering `unknown`.
 *
 * Long enough that a cold CLI start is not mistaken for a failure, short enough that a coordinator
 * dispatching a wave is not blocked behind one wedged launch.
 */
export const DEFAULT_READY_MS = 60_000;

/**
 * What this provider can do.
 *
 * `steer` and `stop` are both `true` because the prompt is an `AsyncIterable` rather than a string.
 * That is the whole reason for the choice: `Query.interrupt()` does not exist in string-prompt mode,
 * and neither does any channel for a second message. Declaring a capability wrongly is worse than
 * not declaring it, so the two that depend on streaming input are declared together with it.
 */
export const CAPABILITIES: ProviderCapabilities = {
  harnesses: ["claude"],
  observe: true,
  steer: true,
  stop: true,
};

const READERS: MessageReaders = { readInit, readResult, isTurn };

/**
 * The longest delay `setTimeout` actually honours.
 *
 * Past `2^31 - 1` milliseconds Node wraps the delay to `1` and fires on the next tick, which turns
 * "stop this run in a month" into "stop this run immediately". Clamping is the lesser wrong of the
 * two, and `untranslated` says so out loud on any request that hits it.
 */
export const TIMER_CEILING_MS = 2_147_483_647;

/**
 * A request's deadline, in milliseconds this provider can arm a timer with.
 *
 * `parseGoDuration` returns **nanoseconds** — it exists to reproduce Go's `time.ParseDuration` for
 * the executor's own `timeoutNs` field. Handing its result to `setTimeout` is a units bug that reads
 * as correct code and fails in the most expensive direction available: a `30m` deadline becomes
 * `1.8e12`, overflows the timer, fires on the next tick, and every bounded run is stopped the moment
 * it starts. The conversion lives in a named, exported function so that the next caller has one to
 * reach for instead of the raw parser.
 */
export function timeoutMs(request: DispatchRequest): number | null {
  const timeout = request.timeout;
  if (timeout === undefined || timeout === "") return null;
  const ns = parseGoDuration(timeout);
  if (ns === null || ns <= 0) return null;
  return Math.min(Math.ceil(ns / 1e6), TIMER_CEILING_MS);
}

export interface ClaudeProviderOptions {
  /** The SDK's `query`. Injected — see `sdk.ts` for why this package does not depend on it. */
  readonly query: QueryFn;
  /** Absolute, isolated `CLAUDE_CONFIG_DIR`. `$HOME` is deliberately not changed alongside it. */
  readonly configDir: string;
  /** Registration id. Defaults to `claude-sdk`. */
  readonly id?: string;
  /** Working directory for every run this provider launches. */
  readonly cwd?: string;
  /** Environment to layer the config directory onto. Defaults to this process's. */
  readonly env?: BaseEnv;
  /** Milliseconds `dispatch` waits for the init message. Defaults to `DEFAULT_READY_MS`. */
  readonly readyTimeoutMs?: number;
  /** Upper bound on agent turns, when the deployment sets one. */
  readonly maxTurns?: number;
  /** Clock, injected so the suite can assert on timestamps. */
  readonly now?: () => Date;
}

/**
 * Request fields this provider cannot carry to `query()`.
 *
 * Named rather than dropped. Every entry here is a way the run that happens differs from the run
 * that was ordered, and the point of saying so in the dispatch detail is that the difference reaches
 * telemetry at the moment it is introduced instead of being reconstructed later from a transcript.
 */
export function untranslated(request: DispatchRequest): readonly string[] {
  const lost: string[] = [];
  if (request.effort !== undefined && request.effort !== "") {
    lost.push(`effort=${request.effort} (the SDK exposes no effort option)`);
  }
  if (request.maxTokens !== undefined && request.maxTokens !== "") {
    lost.push(`max-tokens=${request.maxTokens} (the SDK budgets turns, not tokens)`);
  }
  if (request.profile !== undefined && request.profile !== "") {
    lost.push(`profile=${request.profile} (a divybot concept with no SDK equivalent)`);
  }
  if (request.router !== undefined) {
    lost.push(`router=${request.router} (a claude run does not go through a router)`);
  }
  if (timeoutMs(request) === TIMER_CEILING_MS) {
    lost.push(`timeout=${request.timeout} (clamped to ${TIMER_CEILING_MS}ms, the timer ceiling)`);
  }
  return lost;
}

/** Everything held for one live run. */
interface Live {
  record: RunRecord;
  readonly controller: AbortController;
  readonly inbox: Inbox<SdkUserMessage>;
  query: AgentQuery | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** A promise something else resolves, resolved at most once. */
interface Gate {
  readonly promise: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  const maybe = timer as { unref?: () => void };
  if (typeof maybe.unref === "function") maybe.unref();
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class ClaudeProvider implements SubagentProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities = CAPABILITIES;

  readonly #query: QueryFn;
  readonly #configDir: string;
  readonly #cwd: string | null;
  readonly #env: BaseEnv;
  readonly #readyMs: number;
  readonly #maxTurns: number | null;
  readonly #now: () => Date;
  readonly #runs = new Map<string, Live>();

  constructor(options: ClaudeProviderOptions) {
    this.id = options.id ?? DEFAULT_ID;
    this.#query = options.query;
    this.#configDir = options.configDir;
    this.#cwd = options.cwd ?? null;
    this.#env = options.env ?? process.env;
    this.#readyMs = options.readyTimeoutMs ?? DEFAULT_READY_MS;
    this.#maxTurns = options.maxTurns ?? null;
    this.#now = options.now ?? ((): Date => new Date());
  }

  async dispatch(request: DispatchRequest, runId: string): Promise<DispatchResult> {
    const refusal = this.#refuseDispatch(request, runId);
    if (refusal !== null) return { verdict: "refused", run: null, detail: refusal };

    // `validateDispatch` has already refused an absent model; this narrows it for the compiler
    // without inventing a fallback, because inheriting a model from the provider config is exactly
    // what `dispatch.ts` refuses a request for not stating.
    const model = request.model;
    if (model === undefined) {
      return { verdict: "refused", run: null, detail: "the request names no model" };
    }

    const at = this.#stamp();
    const inbox = new Inbox<SdkUserMessage>();
    const controller = new AbortController();
    const live: Live = {
      record: newRun({ runId, askedModel: model, at, artifacts: [this.#evidenceDir()] }),
      controller,
      inbox,
      query: null,
      timer: null,
    };
    this.#runs.set(runId, live);

    inbox.push(userMessage(request.prompt));

    let stream: AgentQuery;
    try {
      stream = this.#query({ prompt: inbox.stream(), options: this.#optionsFor(model, controller) });
    } catch (error) {
      // The SDK spawns lazily, so this most likely means nothing launched — and "most likely" is
      // not a claim to hang an automatic retry on. `unknown` blocks the retry and leaves the run
      // observable; a caller who wants to reclaim the id can `stop` it.
      const detail = `query() refused to start: ${messageOf(error)}`;
      live.record = endStream(live.record, this.#stamp(), messageOf(error));
      inbox.close();
      controller.abort();
      return { verdict: "unknown", run: this.#ref(live.record), detail };
    }

    live.query = stream;
    this.#armTimeout(live, request);
    const ready = gate();
    this.#consume(live, ready);

    const arrived = await this.#waitReady(ready.promise);
    const record = live.record;
    if (!arrived && record.external === null && !isOver(record)) {
      return {
        verdict: "unknown",
        run: this.#ref(record),
        detail: `no session id after ${this.#readyMs}ms; the run may be alive — observe it`,
      };
    }
    if (record.external === null) {
      return { verdict: "unknown", run: this.#ref(record), detail: describe(record) };
    }

    const lost = untranslated(request);
    const note = modelNote(record);
    const parts = [`session ${record.external}`];
    if (note !== null) parts.push(note);
    if (lost.length > 0) parts.push(`not translated: ${lost.join(", ")}`);
    return { verdict: "accepted", run: this.#ref(record), detail: parts.join("; ") };
  }

  async observe(run: RunRef): Promise<Observation> {
    const at = this.#stamp();
    const live = this.#known(run);
    if (live === null) {
      return {
        run,
        liveness: "unknown",
        observedAt: at,
        detail: `${this.id} has no record of this run; it may still be alive under another process`,
        artifacts: [],
      };
    }
    return {
      run: this.#ref(live.record),
      liveness: live.record.liveness,
      observedAt: at,
      detail: describe(live.record),
      artifacts: live.record.artifacts,
    };
  }

  async steer(run: RunRef, message: string): Promise<SteerResult> {
    const live = this.#known(run);
    if (live === null) {
      return { verdict: "unknown", detail: `${this.id} has no record of this run` };
    }
    if (message.trim() === "") {
      return { verdict: "refused", detail: "an empty message would reach the agent as a blank turn" };
    }
    if (isOver(live.record)) {
      return { verdict: "refused", detail: `the run is ${live.record.liveness}` };
    }
    if (!live.inbox.push(userMessage(message, live.record.external ?? ""))) {
      return { verdict: "refused", detail: "the run's input stream is closed" };
    }
    const ahead = Math.max(0, live.inbox.pending - 1);
    return { verdict: "delivered", detail: `queued behind ${ahead} message(s)` };
  }

  async stop(run: RunRef, reason: string): Promise<StopResult> {
    const live = this.#known(run);
    if (live === null) {
      return { verdict: "unknown", detail: `${this.id} has no record of this run` };
    }
    if (isOver(live.record)) {
      return { verdict: "already-over", detail: `the run is ${live.record.liveness}` };
    }

    live.record = markStopping(live.record, reason, this.#stamp());
    live.inbox.close();

    // Interrupt first, abort as the fallback. The difference is whether the agent gets to finish
    // what it is holding — a tool call mid-write, a commit half-made — so the graceful path is
    // tried even though the hard one is always available.
    const interrupt = live.query?.interrupt;
    if (typeof interrupt === "function") {
      try {
        await interrupt.call(live.query);
        return { verdict: "stopped", detail: `interrupted: ${reason}` };
      } catch (error) {
        live.controller.abort();
        return { verdict: "stopped", detail: `interrupt failed (${messageOf(error)}); aborted` };
      }
    }
    live.controller.abort();
    return { verdict: "stopped", detail: `aborted: ${reason}` };
  }

  /**
   * End every live run.
   *
   * The structural half of #52's second acceptance criterion. A run's child is reaped when its
   * stream ends by any path, and this is the path for the one exit a stream cannot see: the process
   * holding it going away. What it cannot do is prove the process table is clean afterwards — that
   * is a claim about a real box, and it belongs to #49.
   */
  async shutdown(reason = "provider shutting down"): Promise<void> {
    const runs = [...this.#runs.values()];
    await Promise.all(
      runs.map(async (live) => {
        if (isOver(live.record)) return;
        await this.stop(this.#ref(live.record), reason);
      }),
    );
  }

  /** Runs this provider is holding, live and finished. Read-only; for tests and for `check`. */
  records(): readonly RunRecord[] {
    return [...this.#runs.values()].map((live) => live.record);
  }

  #refuseDispatch(request: DispatchRequest, runId: string): string | null {
    if (runId === "") return "the run id is empty, so the run could not be found again";
    if (this.#runs.has(runId)) return `run id ${JSON.stringify(runId)} is already dispatched here`;
    if (request.harness !== "claude") {
      return `this provider launches claude only, and the request asks for ${request.harness}`;
    }
    const problems = validateDispatch(request);
    if (problems.length > 0) return `the request is not launchable: ${problems.join("; ")}`;
    const fatal = fatalEnvProblems(envProblems(this.#configDir, this.#env));
    const first = fatal[0];
    if (first !== undefined) return `the run environment is unusable: ${first.detail}`;
    return null;
  }

  #optionsFor(model: string, controller: AbortController): {
    readonly model: string;
    readonly env: Record<string, string>;
    readonly abortController: AbortController;
    readonly cwd?: string;
    readonly maxTurns?: number;
  } {
    return {
      model,
      env: isolatedEnv(this.#env, this.#configDir),
      abortController: controller,
      ...(this.#cwd === null ? {} : { cwd: this.#cwd }),
      ...(this.#maxTurns === null ? {} : { maxTurns: this.#maxTurns }),
    };
  }

  /**
   * Honour the request's `timeout`, since this provider owns the controller that can.
   *
   * A dispatch that names a deadline and then runs past it forever is a lease nobody reclaims. The
   * timer is unref'd so it never keeps a process alive on its own, and cleared the moment the stream
   * ends.
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

  #consume(live: Live, ready: Gate): void {
    const stream = live.query;
    if (stream === null) return;
    void (async () => {
      let error: string | null = null;
      try {
        for await (const message of stream) {
          live.record = applyMessage(live.record, message, this.#stamp(), READERS);
          if (live.record.external !== null) ready.open();
          if (isOver(live.record)) break;
        }
      } catch (thrown) {
        error = messageOf(thrown);
      } finally {
        live.inbox.close();
        live.record = endStream(live.record, this.#stamp(), error);
        if (live.timer !== null) {
          clearTimeout(live.timer);
          live.timer = null;
        }
        // Unconditional, including on a clean finish: the run is over either way, and a child that
        // outlives the stream that was reading it is exactly the leak this criterion is about.
        live.controller.abort();
        ready.open();
      }
    })();
  }

  async #waitReady(ready: Promise<void>): Promise<boolean> {
    let expire: (value: false) => void = () => {};
    const expiry = new Promise<false>((resolve) => {
      expire = resolve;
    });
    const timer = setTimeout(() => expire(false), this.#readyMs);
    unref(timer);
    try {
      return await Promise.race([ready.then(() => true), expiry]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The record for a ref this provider actually issued, or `null`. */
  #known(run: RunRef): Live | null {
    if (run.provider !== this.id) return null;
    return this.#runs.get(run.runId) ?? null;
  }

  #ref(record: RunRecord): RunRef {
    return { runId: record.runId, provider: this.id, external: record.external };
  }

  /**
   * Where a run's evidence lands.
   *
   * The isolated config directory is not the one `dsh-telemetry` scans by default, so a run launched
   * here would otherwise leave transcripts nothing goes looking for. The directory is reported
   * rather than the per-session file because the CLI's project-slug scheme is the CLI's, and
   * guessing it is the failure this package avoids everywhere else — the backfill walks for
   * `*.jsonl` and does not need the slug.
   */
  #evidenceDir(): string {
    return `${this.#configDir.replace(/[\\/]+$/, "")}/projects`;
  }

  #stamp(): string {
    return this.#now().toISOString();
  }
}

/** Build a provider. The function form the composition root registers. */
export function createProvider(options: ClaudeProviderOptions): ClaudeProvider {
  return new ClaudeProvider(options);
}
