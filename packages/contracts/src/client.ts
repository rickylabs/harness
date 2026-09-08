/**
 * The reference cockpit binding: one state machine both surfaces run.
 *
 * `EventFold`, `ConnectionLoop` and the auth shapes each answer one question correctly. Nothing so
 * far answers the question a cockpit actually asks, which is how they fit together — when a `hello`
 * becomes a `bound` signal, whether a late frame is folded or dropped, which repair a gap gets, what
 * a fetched board is allowed to overwrite. Every one of those has a wrong answer that keeps
 * rendering, and a cockpit whose board is quietly frozen looks exactly like a cockpit whose board
 * has not changed.
 *
 * So the wiring is written once, here, and the two cockpits differ only in the glue underneath it.
 *
 * ## Effects are values, not calls
 *
 * `stepCockpit` opens no socket, sends no request and reads no clock. It returns `Effect` values
 * describing what the host should do, and the host does them in whatever way its platform wants —
 * `WebSocket` and `fetch` in the browser, whatever React Native has that week on the phone, three
 * arrays in a test.
 *
 * That is what "no UI framework dependency" means here in a form that can be checked rather than
 * asserted: the whole binding is a pure function of state and input, and its tests drive a full
 * connect / snapshot / dispatch / approve cycle without a socket, a timer or a global. A binding
 * that called the transport directly would be a binding testable only against the transport, which
 * is how a shared client becomes two clients that merely started from the same file.
 *
 * The counter-example named in the issue drives a web plugin through CSS-suffix selectors. This is
 * the opposite choice, and the reason to make it is not taste: a selector breaks silently when the
 * other side restyles, and so does hand-copied wiring when the other side reconnects.
 *
 * ## Connecting is subscribing
 *
 * There is no subscribe input, because there is no subscribe frame — a client connects, hears
 * `hello`, then a `snapshot`, then deltas. `start` is therefore the whole of "subscribe", and the
 * absence is the protocol's, not an omission here.
 *
 * ## A fetched board may not overwrite a live one
 *
 * `POST /api/snapshot` answers with a `RemoteSnapshot` that has no connection behind it, so its
 * `generation` is the projection's own and not the one the socket is streaming in. Folding it while
 * the link is live would rebind the fold to a generation no frame will ever carry, and every delta
 * after that is discarded as stale — the board stops moving, the socket stays open, and nothing
 * reports a fault. So a fetched board is taken only while the link is *not* live: at a cold start,
 * or when the socket is down and something still wants to show a board. Such a board remains
 * unbound and retained, with its original timestamps; it cannot establish synchronization.
 * On a live link the repair for a gap is `resync`, in band, in the current generation.
 *
 * ## The caller mints the idempotency key
 *
 * Only the caller knows whether this tap is a retry of the last one or a second intent, and a
 * binding that minted keys would turn every retry into a second dispatch — the precise failure the
 * key exists to prevent. What the binding adds is the other half: a key already in flight is not
 * sent again, so a retry that reuses its key costs nothing, and an empty key is refused outright,
 * because an empty key makes every command in flight the same command.
 *
 * ## What the binding deliberately does not decide
 *
 * It does not pre-judge governance. A cockpit that greyed out dispatch from the board's own quota
 * numbers would be a second copy of an admission rule that lives in the coordinator, and the two
 * would disagree on the day the rule changed. It sends the command and reports the refusal.
 *
 * It does not apply its own approval outcome either. `approval.resolved` is broadcast to every
 * connection including the one that decided, exactly so no client needs a special case for its own
 * side effects, and a client that also applied the HTTP answer would have written that special case
 * anyway.
 */

import {
  MUX_SUBPROTOCOL,
  authHeaders,
  commandUrl,
  describeEndpoint,
  endpointProblems,
  muxAuth,
  muxUrl,
} from "./auth.js";
import type { Credential, Endpoint } from "./auth.js";
import { acceptsFrom, idleLink, stepLink } from "./connection.js";
import type { ConnectionLoop, LinkSignal, StepOptions } from "./connection.js";
import { emptyFold, foldFromSnapshot, foldValue, isBound, snapshotOf } from "./fold.js";
import type { EventFold } from "./fold.js";
import { COMMAND_METHOD } from "./routes.js";
import type {
  ApprovalCommand,
  CommandError,
  CommandName,
  CommandRequest,
  CommandResponse,
  DispatchCommand,
  SnapshotReason,
} from "./routes.js";
import type { ClientFrame } from "./events.js";
import type { PendingApproval } from "./governance.js";
import type { LaunchIdentity } from "./runs.js";
import type { RemoteSnapshot } from "./snapshot.js";

/** A command the binding has sent and not yet heard back about. */
export interface InFlight {
  readonly key: string;
  readonly command: CommandName;
  /** The caller's clock, at the moment the post effect was emitted. */
  readonly since: number;
}

/**
 * Everything one cockpit knows.
 *
 * Three parts that already exist plus the set of commands awaiting an answer. There is deliberately
 * no room here for anything a screen would want — a selected tab, a filter, a scroll position — so
 * that the same value can be held by a phone and a browser without either learning the other's
 * shape.
 */
export interface Cockpit {
  readonly endpoint: Endpoint;
  readonly loop: ConnectionLoop;
  readonly fold: EventFold;
  readonly inFlight: ReadonlyMap<string, InFlight>;
}

/** What one command is: its name and the body that goes with that name, kept correlated. */
type IntentOf<N> = N extends CommandName
  ? { readonly command: N; readonly body: CommandRequest<N> }
  : never;
export type CommandIntent = IntentOf<CommandName>;

/** The answer to one command: the value that name returns, or the error. */
type ResultOf<N> = N extends CommandName
  ?
      | { readonly ok: true; readonly value: CommandResponse<N> }
      | { readonly ok: false; readonly error: CommandError }
  : never;
export type CommandResult = ResultOf<CommandName>;

export interface OpenEffect {
  readonly kind: "open";
  /** Tag every signal from this socket with it. It is how a late frame is recognised. */
  readonly link: number;
  readonly url: string;
  readonly protocols: readonly string[];
}

export interface CloseEffect {
  readonly kind: "close";
  readonly link: number;
  readonly why: string;
}

export interface SendEffect {
  readonly kind: "send";
  readonly link: number;
  readonly frame: ClientFrame;
}

type PostOf<N> = N extends CommandName
  ? {
      readonly kind: "post";
      readonly key: string;
      readonly method: typeof COMMAND_METHOD;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly command: N;
      readonly body: CommandRequest<N>;
    }
  : never;
export type PostEffect = PostOf<CommandName>;

/** Call back with a `tick` no earlier than this, on the same clock `stepCockpit` was given. */
export interface WaitEffect {
  readonly kind: "wait";
  readonly untilMs: number;
}

export type Effect = OpenEffect | CloseEffect | SendEffect | PostEffect | WaitEffect;

type AnsweredOf<N> = N extends CommandName
  ? {
      readonly kind: "answered";
      readonly key: string;
      readonly command: N;
      readonly result: ResultOf<N>;
    }
  : never;

/**
 * Everything that can happen to a cockpit.
 *
 * Signals from a socket carry the `link` they came from, for the reason `ConnectionLoop` gives: a
 * socket the client has given up on is not obliged to stop delivering, and an untagged late frame is
 * indistinguishable from a current one.
 */
export type CockpitInput =
  | { readonly kind: "start" }
  | { readonly kind: "stop" }
  | { readonly kind: "opened"; readonly link: number }
  | { readonly kind: "message"; readonly link: number; readonly value: unknown }
  | { readonly kind: "dropped"; readonly link: number; readonly detail: string }
  | { readonly kind: "rejected"; readonly detail: string }
  | { readonly kind: "tick" }
  | { readonly kind: "ask"; readonly key: string; readonly reason: SnapshotReason }
  | { readonly kind: "dispatch"; readonly command: DispatchCommand }
  | { readonly kind: "approve"; readonly command: ApprovalCommand }
  | AnsweredOf<CommandName>
  | { readonly kind: "failed"; readonly key: string; readonly detail: string };

export interface CockpitStep {
  readonly cockpit: Cockpit;
  readonly effects: readonly Effect[];
  /** Written to be read by a person: a status line, a log, a bug report. */
  readonly notes: readonly string[];
}

/** `at` is an ISO instant, used only to judge whether a certificate pin has expired. */
export interface CockpitOptions extends StepOptions {
  readonly at?: string;
}

export function openCockpit(endpoint: Endpoint, now = 0): Cockpit {
  return { endpoint, loop: idleLink(now), fold: emptyFold(), inFlight: new Map() };
}

export function stepCockpit(
  cockpit: Cockpit,
  input: CockpitInput,
  now: number,
  options: CockpitOptions = {},
): CockpitStep {
  switch (input.kind) {
    case "start": {
      // A misconfigured endpoint is not a flaky network. Retrying it produces the same answer
      // forever while looking, in every log, exactly like a server that is down.
      const problems = endpointProblems(cockpit.endpoint, options.at ?? null);
      if (problems.length > 0) {
        const detail = `endpoint is not usable: ${problems.join("; ")}`;
        return note(drive(cockpit, { kind: "rejected", detail }, now, options), detail);
      }
      return drive(cockpit, { kind: "start" }, now, options);
    }

    case "stop":
      return drive(cockpit, { kind: "stop" }, now, options);

    case "opened":
      return drive(cockpit, { kind: "opened", link: input.link }, now, options);

    case "dropped":
      return drive(cockpit, { kind: "dropped", link: input.link, detail: input.detail }, now, options);

    case "rejected":
      return drive(cockpit, { kind: "rejected", detail: input.detail }, now, options);

    case "tick":
      return drive(cockpit, { kind: "tick" }, now, options);

    case "message":
      return receive(cockpit, input.link, input.value, now, options);

    case "ask": {
      const asking = held(cockpit, "snapshot");
      if (asking !== null) {
        return still(cockpit, `a board was already asked for as ${asking.key}; not asking twice`);
      }
      return send(cockpit, input.key, { command: "snapshot", body: { reason: input.reason } }, now);
    }

    case "dispatch":
      return send(
        cockpit,
        input.command.idempotencyKey,
        { command: "dispatch", body: input.command },
        now,
      );

    case "approve":
      return send(
        cockpit,
        input.command.idempotencyKey,
        { command: "approve", body: input.command },
        now,
      );

    case "answered":
      return answered(cockpit, input, now, options);

    case "failed": {
      const settled = forget(cockpit, input.key);
      // Deliberately not retried here. The caller retries with the same key, which is now free.
      return still(settled, `${input.key} did not come back: ${input.detail}`);
    }
  }
}

/** The board as a snapshot, or null while this cockpit has never had one. */
export function board(cockpit: Cockpit): RemoteSnapshot | null {
  return snapshotOf(cockpit.fold);
}

/** The board's relationship to this connection, derived without a second projection. */
export type BoardStatus = "absent" | "retained" | "synchronized";

/**
 * Return absent when no board exists, synchronized only for a live matching bound stream with
 * no resync pending, and retained otherwise. A hello alone cannot synchronize a retained board.
 *
 * It says only that this connection's board is the one the currently bound stream last sent.
 * It is not completeness — that is RemoteSnapshot.complete and the anomalies beside it.
 * It is not evidence recency — generatedAt is when the board was produced, not when it was received.
 * It is not run execution: admitted is not running, and pending or unknown effects stay their own dimension.
 * It is not certification or capability — nothing about authority, approval or what a caller may do is expressed here.
 *
 * A retained or synchronized board grants no display, persistence or command right. Backend authorization
 * and revocation remain separate; late HTTP answers do not restore revoked permission.
 */
export function boardStatus(cockpit: Cockpit): BoardStatus {
  if (board(cockpit) === null) return "absent";
  const { loop, fold } = cockpit;
  return loop.state === "live" && loop.generation !== null &&
    loop.generation === fold.generation && isBound(fold) && !fold.needsResync
    ? "synchronized"
    : "retained";
}

/** What is waiting on a person right now. */
export function waitingOn(cockpit: Cockpit): readonly PendingApproval[] {
  return cockpit.fold.governance?.pending ?? [];
}

/** One line for a status bar. Carries no credential and no path — see `describeEndpoint`. */
export function cockpitStatus(cockpit: Cockpit): string {
  const { loop, fold, inFlight } = cockpit;
  const bound = loop.generation === null ? "unbound" : `generation ${loop.generation}`;
  const counts = fold.counts;
  return [
    describeEndpoint(cockpit.endpoint),
    `${loop.state}, ${bound}`,
    `${fold.tasks.size} tasks, ${fold.runs.size} runs${boardStatus(cockpit) === "retained" ? " (stale)" : ""}`,
    `${counts.applied} applied, ${counts.gapped} lost, ${counts.resyncs} resyncs`,
    `${inFlight.size} in flight`,
  ].join(" · ");
}

function receive(
  cockpit: Cockpit,
  link: number,
  value: unknown,
  now: number,
  options: CockpitOptions,
): CockpitStep {
  // Applied before the fold, which is the whole point of `acceptsFrom`: the fold reasons about
  // generations, and it should never be handed a frame from a socket this client has abandoned.
  if (!acceptsFrom(cockpit.loop, link)) {
    return still(
      cockpit,
      `ignored a frame from link ${link}; reading link ${cockpit.loop.link} (${cockpit.loop.state})`,
    );
  }

  const folded = foldValue(cockpit.fold, value);
  let next: Cockpit = { ...cockpit, fold: folded.fold };
  const effects: Effect[] = [];
  const notes: string[] = [folded.detail];

  // `hello` is where the server's generation becomes the client's binding. The loop reaches `live`
  // here and nowhere else — not on `opened`, which a server can grant and then immediately drop.
  if (folded.kind === "hello" && folded.outcome === "applied" && folded.fold.generation !== null) {
    const bound = drive(
      next,
      { kind: "bound", link, generation: folded.fold.generation },
      now,
      options,
    );
    next = bound.cockpit;
    effects.push(...bound.effects);
    notes.push(...bound.notes);
  }

  if (folded.resync !== null) {
    effects.push({ kind: "send", link, frame: folded.resync });
    notes.push(`asking for a fresh board on link ${link}`);
  }

  return { cockpit: next, effects, notes };
}

function answered(
  cockpit: Cockpit,
  input: AnsweredOf<CommandName>,
  now: number,
  options: CockpitOptions,
): CockpitStep {
  const settled = forget(cockpit, input.key);
  const unexpected = cockpit.inFlight.has(input.key)
    ? []
    : [`an answer to ${input.key}, which this cockpit was not waiting for`];

  switch (input.command) {
    case "snapshot": {
      if (!input.result.ok) return before(unexpected, refused(settled, input.result.error, now, options));
      // See the header: a fetched board carries no connection generation.
      if (settled.loop.state === "live") {
        return before(
          unexpected,
          still(
            settled,
            "discarded a fetched board: the link is live, and folding a board with no connection behind it would unbind this cockpit from the stream it is reading",
          ),
        );
      }
      const fetched = input.result.value;
      return before(unexpected, {
        cockpit: { ...settled, fold: foldFromSnapshot(fetched) },
        effects: [],
        notes: [`took a fetched board: ${fetched.tasks.length} tasks, ${fetched.runs.length} runs`],
      });
    }

    case "dispatch": {
      if (!input.result.ok) return before(unexpected, refused(settled, input.result.error, now, options));
      const outcome = input.result.value;
      // Admitted is not launched. The launch arrives as `run.upserted`, and only that means running.
      return before(
        unexpected,
        still(
          settled,
          outcome.accepted
            ? `dispatch admitted on #${outcome.item} as ${resolved(outcome.identity)}; the launch arrives as run.upserted`
            : `dispatch refused: ${outcome.reason} — ${outcome.detail}`,
        ),
      );
    }

    case "approve": {
      if (!input.result.ok) return before(unexpected, refused(settled, input.result.error, now, options));
      const outcome = input.result.value;
      const already = outcome.alreadySettled ? " (it was already settled)" : "";
      // Not applied here. It arrives on the stream, for everyone, including us.
      return before(
        unexpected,
        still(settled, `${outcome.verdict} recorded for ${outcome.id}${already}; approval.resolved will arrive on the stream`),
      );
    }
  }
}

/**
 * A command came back an error.
 *
 * Two of the codes are not about this command at all: `unauthorized` means this client cannot talk
 * to this coordinator, and `protocol-mismatch` means it was built against a contract the server will
 * not serve. Both will answer the same way forever, and both would otherwise leave a socket
 * reconnecting politely in the background against a door that is shut. The rest are the caller's to
 * retry or report.
 */
function refused(
  cockpit: Cockpit,
  error: CommandError,
  now: number,
  options: CockpitOptions,
): CockpitStep {
  const detail = `${error.error}: ${error.detail}`;
  if (error.error === "unauthorized" || error.error === "protocol-mismatch") {
    return note(drive(cockpit, { kind: "rejected", detail }, now, options), detail);
  }
  return still(cockpit, `${detail}${error.retryable ? " (retryable)" : ""}`);
}

function send(cockpit: Cockpit, key: string, intent: CommandIntent, now: number): CockpitStep {
  if (key.length === 0) {
    return still(
      cockpit,
      `refused a ${intent.command} with an empty idempotency key: every command would share it`,
    );
  }
  const already = cockpit.inFlight.get(key);
  if (already !== undefined) {
    return still(cockpit, `${key} is already in flight as ${already.command}; not sending it twice`);
  }
  const inFlight = new Map(cockpit.inFlight);
  inFlight.set(key, { key, command: intent.command, since: now });
  const effect: Effect = {
    kind: "post",
    key,
    method: COMMAND_METHOD,
    url: commandUrl(cockpit.endpoint, intent.command),
    headers: authHeaders(cockpit.endpoint.credential),
    ...intent,
  };
  return {
    cockpit: { ...cockpit, inFlight },
    effects: [effect],
    notes: [`posting ${intent.command} as ${key}`],
  };
}

/** Run one link signal and turn whatever it commands into effects. */
function drive(
  cockpit: Cockpit,
  signal: LinkSignal,
  now: number,
  options: CockpitOptions,
): CockpitStep {
  const stepped = stepLink(cockpit.loop, signal, now, options);
  const effects: Effect[] = [];

  if (stepped.command === "connect") {
    effects.push({
      kind: "open",
      link: stepped.loop.link,
      url: muxUrl(cockpit.endpoint),
      protocols: protocolsFor(cockpit.endpoint.credential),
    });
  } else if (stepped.command === "close") {
    effects.push({ kind: "close", link: cockpit.loop.link, why: stepped.detail });
  }

  if (stepped.loop.retryAt !== null && stepped.loop.retryAt !== cockpit.loop.retryAt) {
    effects.push({ kind: "wait", untilMs: stepped.loop.retryAt });
  }

  const fold = stepped.command === "connect" ||
    (cockpit.loop.state === "live" && stepped.loop.state !== "live")
    ? rebind(cockpit.fold)
    : cockpit.fold;
  return { cockpit: { ...cockpit, loop: stepped.loop, fold }, effects, notes: [stepped.detail] };
}

/** Drop only stream bookkeeping; keep the last board, its source clocks and counters. */
function rebind(fold: EventFold): EventFold {
  return { ...fold, bound: false, lastSeq: null, needsResync: true };
}

/**
 * The subprotocols to open with.
 *
 * `MUX_SUBPROTOCOL` is documented as always sent, so a server can tell a dsh client from anything
 * else that finds the path. `muxAuth` returns it only in the bearer case, because that is the case
 * where it has to be interleaved with the token; supplying it in the other case is this binding's
 * job, and doing it here is why both cockpits will do it.
 */
function protocolsFor(credential: Credential): readonly string[] {
  const auth = muxAuth(credential);
  return auth.kind === "subprotocol" ? auth.protocols : [MUX_SUBPROTOCOL];
}

/**
 * What routing resolved a lane to, in one phrase.
 *
 * Shown because the operator authorised a lane and is entitled to see what that turned out to mean.
 * Every field is nullable — the coordinator may know less than all of it — and an unknown field is
 * printed as unknown rather than dropped, since a phrase that silently omits the model reads as a
 * run with no model rather than as a run whose model was not reported.
 */
function resolved(identity: LaunchIdentity): string {
  const harness = identity.harness ?? "an unnamed harness";
  const model = identity.model ?? "an unnamed model";
  return identity.effort === null ? `${harness}/${model}` : `${harness}/${model} at ${identity.effort}`;
}

function held(cockpit: Cockpit, command: CommandName): InFlight | null {
  for (const entry of cockpit.inFlight.values()) {
    if (entry.command === command) return entry;
  }
  return null;
}

function forget(cockpit: Cockpit, key: string): Cockpit {
  if (!cockpit.inFlight.has(key)) return cockpit;
  const inFlight = new Map(cockpit.inFlight);
  inFlight.delete(key);
  return { ...cockpit, inFlight };
}

function still(cockpit: Cockpit, detail: string): CockpitStep {
  return { cockpit, effects: [], notes: [detail] };
}

function note(step: CockpitStep, detail: string): CockpitStep {
  return { ...step, notes: [detail, ...step.notes] };
}

function before(notes: readonly string[], step: CockpitStep): CockpitStep {
  return notes.length === 0 ? step : { ...step, notes: [...notes, ...step.notes] };
}
