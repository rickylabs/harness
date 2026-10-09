/**
 * Test support for the provider suites: a fake `query()`, the fixtures, and the helpers that let a
 * background consume loop catch up. Not a test file, so the runner does not collect it.
 *
 * The fake is the whole reason this package injects the SDK instead of depending on it. Every path
 * that matters — a session that never announces itself, a stream that dies mid-run, an interrupt
 * that works, an interrupt that is not offered — is something the real CLI does rarely and on
 * somebody else's schedule. Made injectable, they are ordinary tests.
 */

import assert from "node:assert/strict";

import type { DispatchRequest, RunRef } from "@rickylabs/subagents";

import type { BaseEnv } from "../../src/domain/env.js";
import type { SdkUserMessage } from "../../src/domain/sdk-messages.js";
import type { AgentQuery, QueryFn, QueryOptions } from "../../src/ports/sdk.js";
import { createProvider, type ClaudeProvider } from "../../src/application/provider.js";

// --- the fake -----------------------------------------------------------------------------------

export interface FakeSdk {
  readonly query: QueryFn;
  /** The options each `query()` call was made with. */
  readonly calls: QueryOptions[];
  /** Everything the provider pushed down a prompt stream: the brief, then every steer. */
  readonly received: SdkUserMessage[];
  interrupts: number;
  aborted: boolean;
  /** Yield a message to every open stream. */
  emit: (message: unknown) => void;
  /** End every open stream, the way a CLI exiting on its own would. */
  end: () => void;
}

/** One `query()` call's view of the emitted messages. Per call, so two runs do not share a cursor. */
interface Channel {
  at: number;
  wake: (() => void) | null;
  closed: boolean;
  failure: string | null;
}

/**
 * A `query()` that yields what a test tells it to, when a test tells it to.
 *
 * It consumes the prompt iterable the way the real SDK does, so `steer` is tested end to end rather
 * than by inspecting the inbox, and it listens to the abort signal, so "the child goes away when the
 * stream ends" is observable instead of assumed.
 */
export function fakeSdk(options: { readonly interrupt?: boolean } = {}): FakeSdk {
  const out: unknown[] = [];
  const channels: Channel[] = [];

  const nudge = (channel: Channel): void => {
    const waiter = channel.wake;
    channel.wake = null;
    if (waiter !== null) waiter();
  };

  const fake: FakeSdk = {
    calls: [],
    received: [],
    interrupts: 0,
    aborted: false,
    emit: (message: unknown): void => {
      out.push(message);
      for (const channel of channels) nudge(channel);
    },
    end: (): void => {
      for (const channel of channels) {
        channel.closed = true;
        nudge(channel);
      }
    },
    query: (input): AgentQuery => {
      const channel: Channel = { at: 0, wake: null, closed: false, failure: null };
      channels.push(channel);
      fake.calls.push(input.options);
      void (async (): Promise<void> => {
        for await (const message of input.prompt) fake.received.push(message);
      })();
      input.options.abortController?.signal.addEventListener("abort", () => {
        fake.aborted = true;
        channel.failure = "aborted";
        nudge(channel);
      });
      const iterate = async function* (): AsyncGenerator<unknown> {
        for (;;) {
          while (channel.at < out.length) {
            const item = out[channel.at];
            channel.at += 1;
            yield item;
          }
          if (channel.failure !== null) throw new Error(channel.failure);
          if (channel.closed) return;
          await new Promise<void>((resolve) => {
            channel.wake = resolve;
          });
        }
      };
      return {
        [Symbol.asyncIterator]: iterate,
        ...(options.interrupt === false
          ? {}
          : {
              interrupt: async (): Promise<void> => {
                fake.interrupts += 1;
                channel.closed = true;
                nudge(channel);
              },
            }),
      };
    },
  };
  return fake;
}

/** Let the consumer loop and the prompt reader run to a standstill. */
export async function settle(ticks = 6): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("expected at least one item");
  return item;
}

/**
 * Hold the event loop open for the body.
 *
 * Every timer the provider arms is `unref`'d, deliberately: a provider holding a deadline must never
 * be the reason a daemon refuses to exit. The cost lands here — a test whose only pending work is one
 * of those timers has nothing keeping the loop alive, so Node drains it and the runner reports
 * "Promise resolution is still pending but the event loop has already resolved". A ref'd timer of the
 * test's own is the fix, and it is a fact about the suite rather than about the provider.
 */
export async function awake<T>(body: () => Promise<T>): Promise<T> {
  const hold = setTimeout(() => {}, 30_000);
  try {
    return await body();
  } finally {
    clearTimeout(hold);
  }
}

// --- fixtures -----------------------------------------------------------------------------------

export const NOW = "2026-09-06T10:00:00.000Z";
export const CONFIG_DIR = "/fixture/pool/.claude";
export const EVIDENCE = "/fixture/pool/.claude/projects";
export const ENV: BaseEnv = { HOME: "/fixture/user", USERPROFILE: "C:\\fixture\\user", PATH: "/usr/bin" };

export const REQUEST: DispatchRequest = {
  harness: "claude",
  model: "opus-5",
  effort: "medium",
  prompt: "review the diff on #52",
};

/** The same request with nothing optional on it, for the checks about what is *not* carried. */
export const BARE: DispatchRequest = { harness: "claude", model: "opus-5", prompt: "review the diff" };

export const INIT = { type: "system", subtype: "init", session_id: "ses_test_0001", model: "opus-5" };
export const RESULT = { type: "result", subtype: "success", num_turns: 3, total_cost_usd: 0.12 };

export interface Extra {
  readonly configDir?: string;
  readonly env?: BaseEnv;
  readonly readyTimeoutMs?: number;
  readonly cwd?: string;
  readonly maxTurns?: number;
}

export function makeProvider(query: QueryFn, extra: Extra = {}): ClaudeProvider {
  return createProvider({
    query,
    configDir: extra.configDir ?? CONFIG_DIR,
    env: extra.env ?? ENV,
    readyTimeoutMs: extra.readyTimeoutMs ?? 50,
    now: () => new Date(NOW),
    ...(extra.cwd === undefined ? {} : { cwd: extra.cwd }),
    ...(extra.maxTurns === undefined ? {} : { maxTurns: extra.maxTurns }),
  });
}

/** A provider carrying one accepted, still-running run. */
export async function running(
  fake: FakeSdk = fakeSdk(),
): Promise<{ provider: ClaudeProvider; fake: FakeSdk; run: RunRef }> {
  const provider = makeProvider(fake.query);
  fake.emit(INIT);
  const dispatched = await provider.dispatch(REQUEST, "run-1");
  assert.equal(dispatched.verdict, "accepted");
  const run = dispatched.run;
  if (run === null) throw new Error("an accepted dispatch must carry a run");
  return { provider, fake, run };
}

// --- what the provider says about itself --------------------------------------------------------
