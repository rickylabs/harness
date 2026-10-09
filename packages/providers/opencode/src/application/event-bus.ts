/**
 * The one event connection a provider holds, and where it has got to.
 *
 * The stream is server-wide, so there is exactly one per provider, opened on demand and never on a
 * timer: a background reconnect loop would keep a connection warm for runs that finished hours ago.
 * What the bus does not do is interpret anything — every item it receives is handed to `onEvent`,
 * and the provider decides whose run it is about.
 */

import type { OpencodeServer } from "../ports/server.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class EventBus {
  readonly #server: OpencodeServer;
  readonly #onEvent: (item: unknown) => void;
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

  constructor(server: OpencodeServer, onEvent: (item: unknown) => void) {
    this.#server = server;
    this.#onEvent = onEvent;
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
      let outcome;
      try {
        outcome = await this.#server.events(controller.signal);
      } catch (error) {
        this.#detail = messageOf(error);
        return this.#detail;
      }
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

  /** Close the connection, if there is one, and record why. */
  close(reason: string): void {
    const controller = this.#controller;
    this.#controller = null;
    this.#connected = false;
    this.#detail = reason;
    if (controller !== null) controller.abort();
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
