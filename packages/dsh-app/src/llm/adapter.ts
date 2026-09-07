import type { PlacementConfiguration } from "@rickylabs/routing";
/**
 * The `LlmAdapter` registered on `ctx.llm` for our three destinations.
 *
 * `ctx.llm` is not ours to claim — `@deepseek-ai/dsh-llm` claims it, and the composed profile
 * already mounts it. What was missing is narrower: no adapter of ours was registered on it, so
 * every request to `lm-studio`, `llama-rocm` or `openrouter` came back `NO_ADAPTER`. This class is
 * the registration, and `plugins/llm.ts` is the row that installs it.
 *
 * ## Why the adapter lives here and not in `@rickylabs/llm-local`
 *
 * `llm-local` answers *where does a request for `x` go, and where must it never go*, and it answers
 * it without a socket, a runtime or a plugin system — which is what makes its rules testable and
 * reusable. Putting the adapter there would give it a dependency on dsh and cordis for the sake of
 * one class. The facts stay in `llm-local`; the wiring to a runtime stays in the app shell.
 *
 * ## Every route registers, including one that is misconfigured
 *
 * All three providers are registered even when a deployment's base-URL override is unusable. The
 * alternative — registering only the routes that resolved — makes a typo'd override indistinguishable
 * from a backend nobody wired up, because both answer `NO_ADAPTER`. Refusing at boot is worse still:
 * it takes the daemon down over one destination that may never be addressed. A refused route
 * registers and answers with a terminal `error` finish that names what is wrong and where to fix it.
 *
 * ## Refusals are values here too
 *
 * `stream()` never throws. Every way a request can fail before the wire — an unknown provider, an
 * unusable endpoint, a model the matrix refuses on this backend, a missing credential, a ceiling
 * below the reasoning floor, an image in the history — comes back as one terminal `finish` chunk
 * carrying an `LlmFailure` with a stable code. The runtime would convert a throw into much the same
 * thing, but it would convert every throw into the same thing, and *which* refusal it was is exactly
 * the part an operator needs.
 *
 * ## What this adapter deliberately does not decide
 *
 * - **Retries.** `providerRetryPolicy` keeps its default of `undefined`. The service executes no
 *   retries at all — `@deepseek-ai/dsh-llm-retry` does — and a policy we invented offline would be
 *   a guess about three backends whose throttling nobody here has observed.
 * - **Image pricing.** `imageRequestPricing` keeps its default too. These routes are text-only.
 * - **Whether the model that answered is the model that was asked for.** A gateway that silently
 *   substitutes is the success-coded failure this house has been bitten by three times, and the
 *   guard belongs here. It is absent because it cannot be written correctly offline: strict equality
 *   false-positives on gateways that canonicalise an id, and a prefix rule breaks on `n5air/`, which
 *   `capability.ts` documents as part of the id rather than a router key. Deciding it needs one
 *   observation per backend, which is #49's.
 */

import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from "@deepseek-ai/dsh-llm";
import {
  type Backend,
  requirePlacements,
  type Placement,
  describeEndpoint,
  isBackend,
  placementOf,
  resolveEndpoint,
} from "@rickylabs/llm-local";

import { buildRequest, requestRefusalCode } from "./request.js";
import {
  failureChunk,
  liftProviderMessage,
  llmFailure,
  sseData,
  translateStream,
} from "./stream.js";
import type { Transport, WireExchange } from "./transport.js";

/**
 * The codes this file mints, beside the ones `request.ts` and `stream.ts` mint for their own layers.
 *
 * Listed as a closed tuple because a code is a contract: a caller routes on it, and a code that
 * exists only as a string literal three levels down is one nobody can enumerate to handle.
 */
export const ADAPTER_FAILURE_CODES = [
  "UNKNOWN_PROVIDER",
  "ENDPOINT_REFUSED",
  "MODEL_REFUSED",
  "TRANSPORT",
  "STREAM_FAULT",
  "ABORTED",
  "AUTH",
  "RATE_LIMIT",
  "PROVIDER_ERROR",
] as const;
export type AdapterFailureCode = (typeof ADAPTER_FAILURE_CODES)[number];

/** Display names, for a picker that has to render a provider id to a person. */
export const PROVIDER_NAMES: Readonly<Record<Backend, string>> = {
  "lm-studio": "LM Studio",
  "llama-rocm": "llama.cpp (ROCm)",
  openrouter: "OpenRouter",
};

/**
 * The environment variable each backend's credential is read from, or `null` for the two that need
 * none.
 *
 * A variable *name* is configuration and belongs in the repository; a variable *value* is a
 * credential and does not. The two on-box backends listen on the loopback interface with no
 * authentication, which `backends.ts` records as `credentialed: false`; asking for a key there would
 * invent a requirement the server does not have.
 */
export const CREDENTIAL_REF: Readonly<Record<Backend, string | null>> = {
  "lm-studio": null,
  "llama-rocm": null,
  openrouter: "OPENROUTER_API_KEY",
};

/** Untrusted-input lookup: `providerInfo` is handed whatever the runtime was asked for. */
const NAME_BY_PROVIDER = new Map<string, string>(Object.entries(PROVIDER_NAMES));

/** Where a credential comes from. One function, so a test never touches the real environment. */
export type CredentialReader = (variable: string) => string | undefined;

/**
 * The reader the daemon uses.
 *
 * Not the default. A test that forgets to supply a reader gets `undefined` and therefore a
 * `MISSING_CREDENTIAL` refusal, which is a visible failure; a default that read `process.env` would
 * instead reach for the operator's real key and pass, which is the same test failing invisibly.
 */
export function envCredentials(env: NodeJS.ProcessEnv = process.env): CredentialReader {
  return (variable: string): string | undefined => env[variable];
}

/** Everything the adapter needs that is not a fact about a backend. */
export interface AdapterOptions {
  readonly placements: PlacementConfiguration;
  /** The socket. `fetchTransport()` in the daemon, a canned exchange in the suite. */
  readonly transport: Transport;
  /** Per-backend base-URL overrides from the profile. Blank or absent uses the table default. */
  readonly overrides?: Readonly<Partial<Record<Backend, string>>>;
  /** Where credentials are read at dispatch. Defaults to a reader that finds nothing. */
  readonly credentials?: CredentialReader;
}

/**
 * HTTP statuses worth a name of their own.
 *
 * `AUTH` and `RATE_LIMIT` are dsh's own codes, and both name a distinct remedy: rebind the
 * credential, or wait. Everything else is `PROVIDER_ERROR` carrying the status, on purpose — a 404
 * on a completions path is a wrong base URL and an unknown model id in equal measure, and this layer
 * cannot tell them apart without reading a body whose wording is the provider's to change.
 */
const STATUS_CODES = new Map<number, AdapterFailureCode>([
  [401, "AUTH"],
  [403, "AUTH"],
  [429, "RATE_LIMIT"],
]);

/** How much of an error body is read before giving up on finding a message in it. */
const MAX_ERROR_BODY = 64 * 1024;

/** `code` is a `string` rather than the tuple above because `request.ts` mints its own and they are
 * as much part of what `stream()` reports as these are. */
function errorFinish(code: string, message: string, status?: number): StreamChunk {
  return failureChunk(llmFailure(code, message, status));
}

/** An abort is its own finish kind: nothing went wrong, the caller changed its mind. */
function abortedFinish(message: string): StreamChunk {
  return { type: "finish", reason: { kind: "aborted", failure: llmFailure("ABORTED", message) } };
}

/** Read an error body, bounded, and never let reading it become the failure being reported. */
async function drain(chunks: AsyncIterable<string>): Promise<string> {
  const parts: string[] = [];
  let size = 0;
  try {
    for await (const chunk of chunks) {
      parts.push(chunk);
      size += chunk.length;
      if (size >= MAX_ERROR_BODY) break;
    }
  } catch {
    // A body that fails halfway still has a first half worth parsing, and the status is the fact
    // being reported either way. Whatever was collected is returned.
  }
  return parts.join("");
}

export class LocalLlmAdapter extends LlmAdapter {
  private readonly transport: Transport;
  private readonly overrides: Readonly<Partial<Record<Backend, string>>>;
  private readonly credentials: CredentialReader;

  private readonly placements: readonly Placement[];

  constructor(options: AdapterOptions) {
    super();
    this.placements = requirePlacements(options.placements);
    this.transport = options.transport;
    this.overrides = options.overrides ?? {};
    this.credentials = options.credentials ?? ((): undefined => undefined);
  }

  /**
   * Display metadata for one route.
   *
   * The id is echoed rather than validated: the runtime requires `info.id === provider`, and a
   * provider we do not know is refused where refusing matters, in `stream()`. Answering a display
   * question with a throw would break registration over a name nobody was going to send anything to.
   */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: NAME_BY_PROVIDER.get(provider) ?? provider };
  }

  /**
   * The models the matrix says run on this backend.
   *
   * Only `runs` placements. `unverified` is deliberately absent: the catalog is what a picker shows,
   * and a pair nobody has tried presented beside one that is known good invites the choice the
   * matrix exists to prevent. It stays *dispatchable* — see `stream()` — because a caller naming
   * both provider and model is performing the probe, not browsing.
   *
   * Advisory, per the contract: absence here must never become a request rejection, and it does not.
   * The placement's own `why` is carried as the description because it is the most useful thing this
   * repository knows about the pair, and a picker that shows it beats one that shows an id twice.
   */
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const models = this.placements.filter(
      (placement) => placement.backend === provider && placement.verdict === "runs",
    ).map(
      (placement): LlmModelInfo => ({
        provider,
        id: placement.model,
        name: placement.model,
        description: placement.why,
        inputModalities: ["text"],
      }),
    );
    return Promise.resolve(models);
  }

  /**
   * Metadata for one exact model.
   *
   * `inputModalities: ["text"]` is the one claim made, and it is load-bearing: an explicit omission
   * of `image` is negative capability, so the runtime projects images out of the history before
   * dispatch instead of sending a request whose answer is about a picture that never arrived.
   *
   * `context`, `defaultMaxTokens` and `reasoning` are omitted on purpose. Absent means unknown, and
   * unknown is the truth — a context window is a property of the loaded weights and the server's
   * launch flags, both of which change under us between one request and the next. A committed
   * number would be confidently wrong exactly when a caller sized a request against it.
   */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ["text"] });
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const aborted = (): boolean => options.signal?.aborted === true;
    if (aborted()) {
      yield abortedFinish("the request was aborted before it was sent.");
      return;
    }

    if (!isBackend(options.provider)) {
      yield errorFinish(
        "UNKNOWN_PROVIDER",
        `this adapter serves lm-studio, llama-rocm and openrouter; it was asked for ` +
          `${JSON.stringify(options.provider)}. A route it does not own reaching it means the ` +
          "registration and this table disagree.",
      );
      return;
    }
    const backend: Backend = options.provider;

    const resolved = resolveEndpoint(backend, this.overrides[backend]);
    if (!resolved.ok) {
      yield errorFinish("ENDPOINT_REFUSED", resolved.message);
      return;
    }
    const endpoint = resolved.endpoint;

    const placement = placementOf(this.placements, options.model, backend);
    if (placement !== null && placement.verdict === "refused") {
      yield errorFinish(
        "MODEL_REFUSED",
        `the selected placement refuses ${backend} (${placement.reason}); consult the routing document for evidence`,
      );
      return;
    }

    const ref = CREDENTIAL_REF[backend];
    const credential = ref === null ? undefined : this.credentials(ref);
    const built = buildRequest({
      endpoint,
      options,
      ...(credential === undefined ? {} : { credential }),
    });
    if (!built.ok) {
      const where = built.reason === "missing-credential" && ref !== null ? ` Set ${ref}.` : "";
      yield errorFinish(requestRefusalCode(built.reason), `${built.message}${where}`);
      return;
    }

    let exchange: WireExchange;
    try {
      exchange = await this.transport(built.request);
    } catch (error) {
      // A `Transport` is documented not to throw, and `fetchTransport` does not. An injected one
      // might, and a broken test double must not become an unhandled rejection in the daemon.
      yield errorFinish(
        "TRANSPORT",
        `the transport for ${describeEndpoint(endpoint)} threw: ${describeError(error)}`,
      );
      return;
    }

    if (!exchange.reached) {
      if (aborted()) {
        yield abortedFinish("the request was aborted before a response arrived.");
        return;
      }
      yield errorFinish(
        "TRANSPORT",
        `${describeEndpoint(endpoint)} could not be reached: ${exchange.error}. ` +
          "Nothing was sent, so nothing was spent; the remedy is at the destination, not in the " +
          "request.",
      );
      return;
    }

    const { status } = exchange;
    if (status < 200 || status >= 300) {
      const lifted = liftProviderMessage(await drain(exchange.chunks));
      const said =
        lifted === undefined
          ? "and its body carried no error message to quote"
          : `and said: ${lifted}`;
      yield errorFinish(
        STATUS_CODES.get(status) ?? "PROVIDER_ERROR",
        `${describeEndpoint(endpoint)} answered HTTP ${status} for ${options.model} ${said}.`,
        status,
      );
      return;
    }

    try {
      for await (const chunk of translateStream(sseData(exchange.chunks))) yield chunk;
    } catch (error) {
      // Reaching here means the body stopped mid-flight: a socket reset, or an abort during the
      // response. `translateStream` itself reports through chunks and does not throw, so the fault
      // is under it. Either way no `finish` has been emitted yet, and one has to be.
      if (aborted()) {
        yield abortedFinish("the response was aborted while it was being read.");
        return;
      }
      yield errorFinish(
        "STREAM_FAULT",
        `the response from ${describeEndpoint(endpoint)} ended mid-stream: ${describeError(error)}`,
      );
    }
  }
}

/** An unknown thrown value, as one line. Never the value itself — a thrown object may hold anything. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
