/**
 * The input side of a streaming run: an async queue the SDK pulls from and `steer` pushes into.
 *
 * `query()` in streaming-input mode takes an `AsyncIterable` and consumes it for the life of the
 * run. That iterable is the only channel a second message can travel down, so it is also the whole
 * of what `steer` means here — and `Query.interrupt()` exists only when the prompt was an iterable,
 * so it is the whole of what a graceful `stop` means too. One small queue decides two capabilities.
 *
 * ## Single consumer, by construction
 *
 * `stream()` parks at most one waiter and overwrites the slot when it parks again, which is correct
 * for exactly one consumer and silently drops a wake-up for two. There is exactly one: the SDK. The
 * constraint is stated rather than defended against because the alternative — a waiter list for a
 * second consumer that does not exist — would be code no test could justify.
 *
 * ## Closing is the end of the run
 *
 * The provider closes the inbox when the run's first `result` arrives. That ends the iterable, which
 * ends `query()`, which ends the child process — the ordinary path by which a run stops holding a
 * worktree. A `steer` after that returns `refused` rather than pretending to deliver, which is what
 * `push` returning `false` is for.
 */

/** A queue of messages a streaming run reads, in order, until it is closed and drained. */
export class Inbox<T extends object> {
  readonly #items: T[] = [];
  #at = 0;
  #wake: (() => void) | null = null;
  #closed = false;

  /** Whether the queue has been closed. A closed inbox accepts nothing and ends its stream. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Messages accepted but not yet handed to the consumer. */
  get pending(): number {
    return this.#items.length - this.#at;
  }

  /** Messages the consumer has taken. */
  get delivered(): number {
    return this.#at;
  }

  /**
   * Offer a message.
   *
   * @returns `false` when the inbox is closed, which the caller must report rather than swallow:
   * the message was not queued and no run will ever see it.
   */
  push(item: T): boolean {
    if (this.#closed) return false;
    this.#items.push(item);
    this.#signal();
    return true;
  }

  /** End the stream once what is already queued has been read. Idempotent. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#signal();
  }

  #signal(): void {
    const wake = this.#wake;
    this.#wake = null;
    if (wake !== null) wake();
  }

  /**
   * The iterable handed to `query()`.
   *
   * Drains what is queued before honouring a close, so a message pushed in the same tick as the
   * close is still delivered — the ordinary shape of "say this, then finish".
   */
  async *stream(): AsyncGenerator<T> {
    for (;;) {
      while (this.#at < this.#items.length) {
        const item = this.#items[this.#at];
        this.#at += 1;
        if (item !== undefined) yield item;
      }
      if (this.#closed) return;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
  }
}
