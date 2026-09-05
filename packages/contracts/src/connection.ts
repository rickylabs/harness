/**
 * `ConnectionLoop` — the generation binding, with nothing that opens a socket in it.
 *
 * There are two identities in play and they are not the same thing, which is why both exist here.
 *
 * - **`link`** is the client's own attempt counter. It increments every time the loop asks for a
 *   connection. Its job is to answer "did this signal come from the socket I am currently reading?"
 *   A socket the client has already given up on is not obliged to stop delivering: a `close` handler
 *   fires late, a queued message arrives after the reconnect, and every one of those events looks
 *   exactly like an event from the new socket unless it is tagged.
 * - **`generation`** is the *server's* counter, learned from `hello`. Its job is to answer "is this
 *   frame about the state I am holding?" A coordinator that restarted issues a new generation, and
 *   frames from before the restart describe a world that no longer exists.
 *
 * Either one alone leaves a hole. A client-side link id says nothing about a server restart on the
 * same socket; a server generation says nothing about two sockets the client itself opened. So the
 * loop checks the link, `EventFold` checks the generation, and neither is asked to do the other's
 * job.
 *
 * ## Live means bound, not connected
 *
 * The loop reaches `live` on `hello`, never on `opened`. The distinction is what keeps `attempt`
 * honest: a server that accepts a TCP connection and immediately drops it — starting up, out of
 * file descriptors, refusing an expired token — would otherwise reset the backoff on every attempt
 * and turn a polite retry into a hot loop against a machine that is already struggling.
 *
 * ## The caller supplies the randomness
 *
 * `stepLink` takes `now` and takes its jitter as an argument, for the same reason `projectBoard`
 * takes its timestamp: a function that reads a clock or a random number cannot be replayed, and a
 * reconnect policy that cannot be replayed cannot be tested. Jitter is not decoration — when the
 * coordinator restarts, every cockpit in the house is woken by the same event and will otherwise
 * reconnect in lockstep, which is a self-inflicted stampede against a process that has just come up.
 */

export const LINK_STATES = ["idle", "connecting", "live", "waiting", "stopped"] as const;
export type LinkState = (typeof LINK_STATES)[number];

export const LINK_COMMANDS = ["connect", "close", "none"] as const;
export type LinkCommand = (typeof LINK_COMMANDS)[number];

/**
 * Exponential backoff, capped.
 *
 * `jitterRatio` is how much of the nominal delay may be given away to spread a herd: at 0.5 the
 * actual wait lies between half the nominal delay and all of it. It never lengthens the wait, so the
 * cap stays a real bound.
 */
export interface BackoffPolicy {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly factor: number;
  readonly jitterRatio: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 500,
  maxMs: 30_000,
  factor: 2,
  jitterRatio: 0.5,
};

export interface ConnectionLoop {
  readonly state: LinkState;
  /** The client's attempt id. Increments on every connect; signals from older links are ignored. */
  readonly link: number;
  /** The server generation this link is bound to, learned from `hello`. */
  readonly generation: number | null;
  /** Consecutive failures since the last successful bind. Drives the backoff. */
  readonly attempt: number;
  /** When to connect again, in the caller's own clock. Only meaningful while `waiting`. */
  readonly retryAt: number | null;
  /** When the loop last changed state. */
  readonly since: number;
  readonly detail: string | null;
}

/**
 * What happened to the link, from the caller's side.
 *
 * Every signal that could have come from a socket carries the `link` it came from. A signal whose
 * link is not the current one is ignored, which is the whole point of the field.
 */
export type LinkSignal =
  | { readonly kind: "start" }
  | { readonly kind: "opened"; readonly link: number }
  | { readonly kind: "bound"; readonly link: number; readonly generation: number }
  | { readonly kind: "dropped"; readonly link: number; readonly detail: string }
  | { readonly kind: "rejected"; readonly detail: string }
  | { readonly kind: "stop" }
  | { readonly kind: "tick" };

export interface LinkStep {
  readonly loop: ConnectionLoop;
  readonly command: LinkCommand;
  readonly detail: string;
}

export interface StepOptions {
  readonly policy?: BackoffPolicy;
  /** A number in `[0, 1]`, supplied by the caller. 1 — the default — is the full nominal delay. */
  readonly jitter?: number;
}

export function idleLink(now = 0): ConnectionLoop {
  return {
    state: "idle",
    link: 0,
    generation: null,
    attempt: 0,
    retryAt: null,
    since: now,
    detail: null,
  };
}

/**
 * Whether a frame arriving from `link` belongs to the connection this loop is reading.
 *
 * Callers apply this *before* `foldFrame`. It is cheap and it is the only thing standing between a
 * late frame from an abandoned socket and a fold that would otherwise be asked to reason about it.
 */
export function acceptsFrom(loop: ConnectionLoop, link: number): boolean {
  if (loop.link !== link) return false;
  return loop.state === "connecting" || loop.state === "live";
}

/** The nominal wait before attempt number `attempt`, with `jitter` in `[0, 1]` shortening it. */
export function backoffDelay(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  jitter = 1,
): number {
  const steps = attempt > 0 ? attempt : 0;
  const nominal = Math.min(policy.maxMs, policy.baseMs * policy.factor ** steps);
  const ratio = clamp(policy.jitterRatio);
  const floor = nominal * (1 - ratio);
  return Math.round(floor + (nominal - floor) * clamp(jitter));
}

function clamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}

export function stepLink(
  loop: ConnectionLoop,
  signal: LinkSignal,
  now: number,
  options: StepOptions = {},
): LinkStep {
  switch (signal.kind) {
    case "start":
      if (loop.state === "connecting" || loop.state === "live") {
        return hold(loop, "already connecting");
      }
      return connect(loop, now, "connecting");

    case "stop":
      if (loop.state === "stopped") return hold(loop, "already stopped");
      return {
        loop: { ...loop, state: "stopped", retryAt: null, since: now, detail: "stopped" },
        command: loop.state === "connecting" || loop.state === "live" ? "close" : "none",
        detail: "stopped",
      };

    case "rejected":
      // Not a failure to retry: the server was reached and this client cannot talk to it. Retrying
      // produces the same answer forever while looking, from the outside, like a flaky network.
      return {
        loop: { ...loop, state: "stopped", retryAt: null, since: now, detail: signal.detail },
        command: loop.state === "connecting" || loop.state === "live" ? "close" : "none",
        detail: signal.detail,
      };

    case "opened":
      if (!fromCurrentLink(loop, signal.link)) return stale(loop, signal.link);
      if (loop.state !== "connecting") return hold(loop, `opened while ${loop.state}`);
      // Deliberately does not touch `attempt`. See the note at the top of this file.
      return hold({ ...loop, since: now, detail: "open, waiting for hello" }, "open");

    case "bound": {
      if (!fromCurrentLink(loop, signal.link)) return stale(loop, signal.link);
      const bound: ConnectionLoop = {
        ...loop,
        state: "live",
        generation: signal.generation,
        attempt: 0,
        retryAt: null,
        since: now,
        detail: `generation ${signal.generation}`,
      };
      return { loop: bound, command: "none", detail: `bound to generation ${signal.generation}` };
    }

    case "dropped": {
      if (!fromCurrentLink(loop, signal.link)) return stale(loop, signal.link);
      if (loop.state === "stopped") return hold(loop, "stopped");
      const delay = backoffDelay(loop.attempt, options.policy ?? DEFAULT_BACKOFF, options.jitter);
      const waiting: ConnectionLoop = {
        ...loop,
        state: "waiting",
        attempt: loop.attempt + 1,
        retryAt: now + delay,
        since: now,
        detail: signal.detail,
      };
      return { loop: waiting, command: "none", detail: `retry in ${delay}ms: ${signal.detail}` };
    }

    case "tick": {
      if (loop.state !== "waiting" || loop.retryAt === null) return hold(loop, `${loop.state}`);
      if (now < loop.retryAt) return hold(loop, `waiting ${loop.retryAt - now}ms more`);
      return connect(loop, now, "retrying");
    }
  }
}

function fromCurrentLink(loop: ConnectionLoop, link: number): boolean {
  return loop.link === link;
}

function stale(loop: ConnectionLoop, link: number): LinkStep {
  return { loop, command: "none", detail: `signal from link ${link}; reading link ${loop.link}` };
}

function hold(loop: ConnectionLoop, detail: string): LinkStep {
  return { loop, command: "none", detail };
}

function connect(loop: ConnectionLoop, now: number, detail: string): LinkStep {
  const next: ConnectionLoop = {
    ...loop,
    state: "connecting",
    link: loop.link + 1,
    retryAt: null,
    since: now,
    detail,
  };
  return { loop: next, command: "connect", detail };
}
