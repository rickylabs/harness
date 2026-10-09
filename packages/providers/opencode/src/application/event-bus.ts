/**
 * The one event connection a provider holds, and where it has got to.
 *
 * The stream is server-wide, so there is exactly one per provider, opened on demand and never on a
 * timer: a background reconnect loop would keep a connection warm for runs that finished hours ago.
 * What the bus does not do is interpret anything — every item it receives is handed to `onEvent`,
 * and the provider decides whose run it is about.
 */

import type { StreamOutcome } from "../domain/outcome.js";
import type { OpencodeServer } from "../ports/server.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  const maybe = timer as { unref?: () => void };
  if (typeof maybe.unref === "function") maybe.unref();
}

/** How an open attempt ended before its stream was accepted. */
type Opened =
  | { readonly kind: "outcome"; readonly outcome: StreamOutcome }
  | { readonly kind: "threw"; readonly error: unknown }
  | { readonly kind: "expired" }
  | { readonly kind: "closed" };

/**
 * Release a stream nobody will read: one that arrived after its open was abandoned. Best effort; the
 * aborted signal already asked the transport to let go, and this covers a port that ignores it.
 */
function release(pending: Promise<StreamOutcome>): void {
  void pending.then(
    (outcome) => {
      if (outcome.kind === "open") void outcome.events[Symbol.asyncIterator]().return?.(undefined);
    },
    () => {},
  );
}

export class EventBus {
  readonly #server: OpencodeServer;
  readonly #onEvent: (item: unknown) => void;
  /** How long an open waits for the stream's first event before giving up on it. */
  readonly #readyMs: number;
  #controller: AbortController | null = null;
  #connected = false;
  /** Why it is not connected, in a sentence `observe` can quote. */
  #detail = "the event stream has not been opened yet";
  /**
   * How many times a connection has been opened. Incremented per successful open, never reset.
   *
   * The reason it is a counter and not a timestamp: a reconnect is not a point in time to compare
   * against, it is a *discontinuity*, and what matters is which side of it a record was last written
   * on. Comparing timestamps would also make the check depend on clock resolution — under the frozen
   * clock the suite injects, every stamp is equal and no timestamp comparison can ever be true.
   */
  #generation = 0;
  /** The in-flight open, so concurrent callers share one connection between them. */
  #opening: Promise<string | null> | null = null;
  /** The in-flight open's controller and its way out, so `close` can abandon it rather than wait. */
  #pending: { readonly controller: AbortController; readonly abandon: () => void } | null = null;
  /** How many times `close` has run. An open that started before a close may not connect after it. */
  #closures = 0;

  constructor(server: OpencodeServer, onEvent: (item: unknown) => void, readyMs: number) {
    this.#server = server;
    this.#onEvent = onEvent;
    this.#readyMs = readyMs;
  }

  get connected(): boolean {
    return this.#connected;
  }

  get detail(): string {
    return this.#detail;
  }

  get generation(): number {
    return this.#generation;
  }

  /**
   * Make sure the event stream is connected, and say why it is not.
   *
   * `null` means connected. Concurrent callers share one attempt: two dispatches arriving together
   * on a cold provider must not open two server-wide connections, because the second one's events
   * would be folded into the same records twice.
   */
  async ensure(): Promise<string | null> {
    if (this.#connected) return null;
    const existing = this.#opening;
    if (existing !== null) return await existing;

    const attempt = (async (): Promise<string | null> => {
      const controller = new AbortController();
      const closures = this.#closures;
      let abandon = (): void => {};
      const abandoned = new Promise<Opened>((resolve) => {
        abandon = (): void => resolve({ kind: "closed" });
      });
      this.#pending = { controller, abandon };
      let timer: ReturnType<typeof setTimeout> | null = null;
      const expired = new Promise<Opened>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "expired" }), this.#readyMs);
        unref(timer);
      });
      // Started inside the attempt so the controller is held — and abortable by `close` — from the
      // first byte of the open, not only once the stream has said hello.
      const pending = (async (): Promise<StreamOutcome> => await this.#server.events(controller.signal))();
      let opened: Opened;
      try {
        opened = await Promise.race([
          pending.then(
            (outcome): Opened => ({ kind: "outcome", outcome }),
            (error: unknown): Opened => ({ kind: "threw", error }),
          ),
          expired,
          abandoned,
        ]);
      } finally {
        if (timer !== null) clearTimeout(timer);
        if (this.#pending?.controller === controller) this.#pending = null;
      }

      // A close that ran while this open was in flight wins, whatever the open produced: connecting
      // now would watch for a provider that has been shut down, and a dispatch waiting on this open
      // would go on to create and prompt a session after it.
      if (opened.kind !== "outcome" || opened.outcome.kind !== "open" || closures !== this.#closures) {
        controller.abort();
        release(pending);
      }
      if (closures !== this.#closures || opened.kind === "closed") return this.#detail;
      if (opened.kind === "expired") {
        this.#detail = `the event stream sent nothing within ${this.#readyMs}ms of being opened`;
        return this.#detail;
      }
      if (opened.kind === "threw") {
        this.#detail = messageOf(opened.error);
        return this.#detail;
      }
      const outcome = opened.outcome;
      if (outcome.kind !== "open") {
        this.#detail = outcome.detail;
        return this.#detail;
      }
      this.#controller = controller;
      this.#connected = true;
      this.#detail = "connected";
      // A new connection is a new generation. `GET /event` is live-only — it replays nothing — so every
      // record last written on an earlier generation now sits behind a gap of unknown length.
      this.#generation += 1;
      this.#consume(outcome.events, controller);
      return null;
    })();

    this.#opening = attempt;
    try {
      return await attempt;
    } finally {
      this.#opening = null;
    }
  }

  /** Close the connection, and any open still in flight, and record why. */
  close(reason: string): void {
    const controller = this.#controller;
    const pending = this.#pending;
    this.#closures += 1;
    this.#controller = null;
    this.#pending = null;
    this.#connected = false;
    this.#detail = reason;
    if (controller !== null) controller.abort();
    if (pending !== null) {
      pending.controller.abort();
      pending.abandon();
    }
  }

  /**
   * Hand the stream to `onEvent`, for as long as it lasts.
   *
   * Not awaited by anything. The loop's only job is to keep records true; a caller that needed to
   * wait for a particular event would be a caller polling a socket, which is the shape this design
   * replaced.
   */
  #consume(events: AsyncIterable<unknown>, controller: AbortController): void {
    void (async () => {
      let ending = "the event stream ended";
      try {
        for await (const item of events) this.#onEvent(item);
      } catch (error) {
        ending = `the event stream failed: ${messageOf(error)}`;
      } finally {
        // Only if this is still the live connection. A stream that ended after `close` opened no
        // replacement, but one that ended after a reconnect must not un-connect its successor.
        if (this.#controller === controller) {
          this.#connected = false;
          this.#controller = null;
          this.#detail = ending;
        }
      }
    })();
  }
}
