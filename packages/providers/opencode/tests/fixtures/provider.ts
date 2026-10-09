/**
 * Test support for the provider suites: a fake `opencode serve` behind the real SDK adapter.
 *
 * The provider is composed exactly as a deployment composes it — `createSdkServer` over
 * `@opencode-ai/sdk` — and only `fetch` is fake. So the suites can produce what a real server does
 * and a happy-path fake never would: a prompt whose reply is lost, an abort answered with `false`, an
 * event stream that drops in the middle of a run. Those three are where the verdicts are decided, and
 * a verdict decided wrong here puts a second agent on a branch that already has one.
 */

import type { DispatchRequest, RunRef } from "@rickylabs/subagents";

import { createSdkServer } from "../../src/adapters/sdk-server.js";
import { DEFAULT_ID } from "../../src/application/options.js";
import { createProvider, type OpencodeProvider } from "../../src/application/provider.js";
import {
  BASE_URL,
  eventChannel,
  json,
  record,
  respond,
  settle,
  type EventChannel,
  type Recorded,
  type Reply,
} from "./fake-fetch.js";

export { BASE_URL, respond, settle, text, unreachable } from "./fake-fetch.js";

/** A path that names the credential file, as a server error body might. Synthetic. */
export const AUTH_PATH = "/fixture/opencode/data/auth.json";

/** A successful reply: an empty one when there is no body, as `prompt_async` sends. */
export function ok(status: number, body: unknown = null): Reply {
  return body === null ? { status } : json(status, body);
}

export function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`nothing recorded at ${index}`);
  return value;
}

export async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

export interface Server {
  readonly provider: OpencodeProvider;
  /** Every request except `GET /event`. */
  readonly calls: Recorded[];
  /** Every `GET /event`. */
  readonly streamCalls: Recorded[];
  /** `null` mints an incrementing session id; a reply overrides every session creation. */
  session: Reply | null;
  prompt: Reply;
  /**
   * Run while a prompt request is in flight, before its reply is returned.
   *
   * The one thing a fake that answers instantly cannot produce: a reply that is *late*. A real
   * server starts the agent and then answers, so the bus can carry a session all the way to idle
   * while the request that started it is still on the wire — and the provider has to decide which of
   * the two it believes.
   */
  onPrompt: (() => Promise<void>) | null;
  abort: Reply;
  remove: Reply;
  /** `null` opens a fresh event connection; a reply makes `GET /event` fail with it instead. */
  stream: Reply | null;
  /** Deliver one bus event and wait for the fold. */
  emit(event: unknown): Promise<void>;
  /** End the connection, as a server restart or a proxy timeout would. */
  drop(): Promise<void>;
  paths(): string[];
}

export function server(options: { readonly logDir?: string; readonly agent?: string } = {}): Server {
  const calls: Recorded[] = [];
  const streamCalls: Recorded[] = [];
  // A fresh one per connection, as a reconnect really gets. Reusing a closed channel would make the
  // second connection end the instant it opened, which is a fake artefact and not a server.
  let bus: EventChannel | null = null;
  let minted = 0;

  const state = {
    calls,
    streamCalls,
    session: null as Reply | null,
    prompt: ok(204),
    onPrompt: null as (() => Promise<void>) | null,
    abort: ok(200, true),
    remove: ok(200, true),
    stream: null as Reply | null,
    provider: undefined as unknown as OpencodeProvider,
    emit: async (event: unknown): Promise<void> => {
      bus?.send(event);
      await settle();
    },
    drop: async (): Promise<void> => {
      bus?.close();
      await settle();
    },
    paths: (): string[] => calls.map((call) => `${call.method} ${call.path}`),
  };

  const fetch = (async (request: Request): Promise<Response> => {
    const seen = await record(request);
    if (seen.path === "/event") {
      streamCalls.push(seen);
      if (state.stream !== null) return respond(state.stream);
      bus = eventChannel();
      return bus.response;
    }
    calls.push(seen);
    if (seen.method === "DELETE") return respond(state.remove);
    if (seen.path.endsWith("/abort")) return respond(state.abort);
    if (seen.path.endsWith("/prompt_async")) {
      if (state.onPrompt !== null) await state.onPrompt();
      return respond(state.prompt);
    }
    if (state.session !== null) return respond(state.session);
    minted += 1;
    return respond(json(200, { id: `ses_${minted}` }));
  }) as typeof globalThis.fetch;

  const provider = createProvider({
    server: createSdkServer({ baseUrl: BASE_URL, fetch }),
    now: (): Date => new Date("2026-01-01T00:00:00.000Z"),
    ...(options.logDir === undefined ? {} : { logDir: options.logDir }),
    ...(options.agent === undefined ? {} : { agent: options.agent }),
  });
  state.provider = provider;
  return state;
}

export function request(overrides: Partial<DispatchRequest> = {}): DispatchRequest {
  return {
    harness: "opencode",
    model: "z-ai/glm-5.2",
    effort: "medium",
    router: "openrouter",
    prompt: "implement the thing",
    ...overrides,
  };
}

export function ref(runId: string, external: string | null = "ses_1"): RunRef {
  return { runId, provider: DEFAULT_ID, external };
}
