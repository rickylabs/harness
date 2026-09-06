/**
 * Readiness: what a backend has to have answered before work is sent to it.
 *
 * ## Container state is not readiness, and this is where that stops being a comment
 *
 * `backends.ts` gives `ReadinessCheck` exactly one member so nothing can express the wrong check.
 * That makes the wrong check unspellable; it does not make the right one happen. This file is the
 * right one — #57's second criterion — and the failure it exists to prevent is specific rather than
 * general. The llama-rocm container's entrypoint is `sleep infinity`. It comes up, stays up, reports
 * healthy to anything that asks the runtime, and serves nothing at all. A scheduler that reads
 * "container is running" dispatches into a socket with no listener and files the result under the
 * model.
 *
 * ## Five outcomes, because each one is a different next action
 *
 * The same test the refusal vocabulary in `capability.ts` has to pass. `unreachable` is fixed by
 * starting the server, `not-loaded` by loading the model, `rejected` by fixing the credential or the
 * path, `unreadable` means the thing answering is not the service we think it is, and `ready` needs
 * nothing. Collapsing any pair of them loses the remedy, and the remedy is the only reason an
 * operator reads a health check.
 *
 * `not-loaded` is the one that would not exist if readiness were a liveness ping. LM Studio accepts
 * connections well before a model has finished loading, and keeps accepting them when a load has
 * failed outright — which is why the check asks `/models` and reads the answer, rather than asking
 * whether anything answered.
 *
 * ## Nothing here opens a socket
 *
 * The exchange arrives as data. Same split as `routing`'s `probe.ts` and `lease.ts`, same reason: a
 * rule that opens a socket cannot be tested, and a readiness rule that cannot be tested is wrong on
 * the day the box is on fire. The caller sends `readinessRequest(endpoint)` and hands back what came
 * out; this decides what it means.
 *
 * ## Nothing derived from the response body is quoted
 *
 * Facts computed from the body are reported — a status code, how many models were listed — and no
 * text from it is ever passed through into a message or into an `Observation`. The body is written
 * by the far end, `probe.ts` scans an observation's `output` for a marker, and a body that could put
 * text into that field could steer a routing verdict by containing the marker. The output line in a
 * projected observation is authored here for that reason, and a test asserts a hostile models list
 * cannot make a verdict `degraded`.
 *
 * The transport error is the exception, and only because of what happens upstream: `endpoint.ts`
 * refuses any URL carrying userinfo or a query string, so a client error that names the URL it
 * failed to reach cannot be naming a credential.
 *
 * ## Where a failed load is read
 *
 * #57's third criterion, and the reason `BackendRecord.diagnostics` exists. For LM Studio
 * `nerdctl logs` is not merely unhelpful, it is misleading: the container's stdout shows a healthy
 * server while every request fails, so an operator sent there concludes the backend is fine and goes
 * looking at the model. Every failing outcome carries the path where its evidence actually is, as a
 * field rather than as something a human is expected to remember.
 */

import type { Observation } from "@rickylabs/routing";

import { type Backend, type BackendRecord, backendRecord } from "./backends.js";
import { type Endpoint, type EndpointRefusal, modelsUrl, resolveEndpoint } from "./endpoint.js";

/** What a readiness check can establish. */
export const READINESS = ["ready", "not-loaded", "rejected", "unreadable", "unreachable"] as const;
export type Readiness = (typeof READINESS)[number];

const READINESS_TEXT: Readonly<Record<Readiness, string>> = {
  ready: "the endpoint answered and serves this model",
  "not-loaded": "the endpoint answered and does not serve this model",
  rejected: "the endpoint refused the request",
  unreadable: "something answered, and it was not a models list",
  unreachable: "nothing answered",
};

/** One line for a readiness state. */
export const describeReadiness = (readiness: Readiness): string => READINESS_TEXT[readiness];

/**
 * What came back, as data.
 *
 * A union rather than one shape with optional fields, so "no response, and here is the client
 * error" and "a response, and here is its status" cannot be spelled at the same time — which is
 * exactly the confusion a health check must not be able to make.
 */
export type Exchange =
  | { readonly reached: false; readonly error: string }
  | { readonly reached: true; readonly status: number; readonly body: string };

/** One readiness question. */
export interface HealthRequest {
  readonly backend: string;
  /** The pinned id, as `routing` spells it. What gets recorded. */
  readonly model: string;
  /**
   * What the endpoint calls the same weights, when that differs from the pin.
   *
   * Defaults to `model`. There is deliberately no translation table here: `routing`'s README puts
   * pin-to-wire spelling on the provider boundary, and a second table in this package would be a
   * second answer to a question that must only have one. A caller that knows the served name says
   * it; one that does not gets an honest `not-loaded` rather than a guess.
   */
  readonly servedAs?: string;
  /** A deployment override for the base URL, or absent for the table default. */
  readonly baseUrl?: string | null;
  readonly exchange: Exchange;
  /** ISO 8601. When the exchange happened, not when it is being read. */
  readonly at: string;
}

/** What a readiness check established, and where to go next if it is bad news. */
export interface Health {
  readonly backend: Backend;
  readonly model: string;
  readonly servedAs: string;
  /** The URL that was asked. Credential-free by construction — see `endpoint.ts`. */
  readonly url: string;
  readonly readiness: Readiness;
  /** What happened, in the terms an operator would use. Never quotes the response body. */
  readonly detail: string;
  /** Where this failure is actually read. Not always where the container's logs are. */
  readonly diagnostics: string;
  readonly observedAt: string;
}

/** The answer, or the reason the question could not be asked. */
export type HealthVerdict =
  | { readonly ok: true; readonly health: Health }
  | { readonly ok: false; readonly reason: EndpointRefusal; readonly message: string };

/** Nothing failed, so there is nothing to look up. */
const NOTHING_TO_DIAGNOSE = "Nothing failed.";

/**
 * A running container is not a running server, said once, where it is needed.
 *
 * The record's `diagnostics` field points at where a *load* failure is read, and a load that never
 * started has left nothing there. Sending an operator to a log file that is empty for a good reason
 * is how a check acquires a reputation for lying.
 */
const NOTHING_LISTENING =
  "Nothing accepted a connection. A running container is not a running server — llama-rocm's " +
  "entrypoint is `sleep infinity` — so start the server process before reading any log.";

function diagnosticsFor(readiness: Readiness, record: BackendRecord): string {
  if (readiness === "ready") {
    return NOTHING_TO_DIAGNOSE;
  }
  if (readiness === "unreachable") {
    return NOTHING_LISTENING;
  }
  return record.diagnostics;
}

/**
 * Keep a client error quotable.
 *
 * Long enough to carry a `connect ECONNREFUSED 10.0.0.4:8081`, short enough that a stack traced
 * through three layers of undici does not become the log line.
 */
const MAX_ERROR = 200;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_ERROR ? flat : `${flat.slice(0, MAX_ERROR)}…`;
}

/**
 * The ids a models list offers, or `null` when the body is not one.
 *
 * Lenient about everything except the shape that matters: an entry without a string `id` is skipped
 * rather than fatal, because the three services disagree on every other field and agreeing on `id`
 * is the whole reason one client serves all three. `null` is reserved for a body that is not a list
 * at all — an HTML error page, a proxy's JSON, an empty string — which is a different problem with a
 * different fix.
 */
export function parseModelsList(body: string): readonly string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const data = (parsed as Record<string, unknown>)["data"];
  if (!Array.isArray(data)) {
    return null;
  }
  const ids: string[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const id = (entry as Record<string, unknown>)["id"];
    if (typeof id === "string" && id !== "") {
      ids.push(id);
    }
  }
  return ids;
}

/** Why a non-2xx is a distinct problem, by the class of status it is. */
function rejectionClause(status: number): string {
  if (status === 401 || status === 403) {
    return "The credential was missing or not accepted; it is bound by profile at dispatch.";
  }
  if (status === 404) {
    return "Nothing serves that route — most often a base URL missing its `/v1` segment.";
  }
  if (status >= 500) {
    return "The server answered with a fault of its own, so this is not a routing problem.";
  }
  return "The request was refused before any model was consulted.";
}

function readinessOf(exchange: Exchange, servedAs: string): {
  readonly readiness: Readiness;
  readonly detail: string;
} {
  if (!exchange.reached) {
    return {
      readiness: "unreachable",
      detail: `no response: ${clip(exchange.error)}`,
    };
  }
  const { status } = exchange;
  if (status < 200 || status > 299) {
    return {
      readiness: "rejected",
      detail: `HTTP ${String(status)}. ${rejectionClause(status)}`,
    };
  }
  const ids = parseModelsList(exchange.body);
  if (ids === null) {
    return {
      readiness: "unreadable",
      detail:
        `HTTP ${String(status)}, and the body is not a models list. Whatever answered is not the ` +
        "service this endpoint is supposed to reach.",
    };
  }
  if (!ids.some((id) => id === servedAs)) {
    return {
      readiness: "not-loaded",
      detail:
        `the endpoint served a list of ${String(ids.length)} model(s) and ${servedAs} was not ` +
        "among them. The server is up; this model is not.",
    };
  }
  return { readiness: "ready", detail: `${servedAs} is served here.` };
}

/**
 * Read one readiness exchange.
 *
 * Resolving the endpoint first is not ceremony: a health check aimed at a URL that would have been
 * refused reports on a destination no dispatch could have used, and reporting `unreachable` for it
 * would send an operator to look at a server that was never the problem.
 */
export function checkHealth(request: HealthRequest): HealthVerdict {
  const resolved = resolveEndpoint(request.backend, request.baseUrl ?? null);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, message: resolved.message };
  }
  const endpoint: Endpoint = resolved.endpoint;
  const record = backendRecord(endpoint.backend);
  if (record === null) {
    // Unreachable: `resolveEndpoint` succeeded, so the backend is in the table.
    return {
      ok: false,
      reason: "unknown-backend",
      message: `${request.backend} resolved to a backend with no record.`,
    };
  }
  const servedAs = request.servedAs ?? request.model;
  const { readiness, detail } = readinessOf(request.exchange, servedAs);
  return {
    ok: true,
    health: {
      backend: endpoint.backend,
      model: request.model,
      servedAs,
      url: modelsUrl(endpoint),
      readiness,
      detail,
      diagnostics: diagnosticsFor(readiness, record),
      observedAt: request.at,
    },
  };
}

/** Whether work may be sent, on this evidence alone. Fails closed on everything but `ready`. */
export function isReady(health: Health): boolean {
  return health.readiness === "ready";
}

/**
 * What this health check is worth in `routing`'s availability vocabulary — or `null`.
 *
 * Four of the five outcomes project cleanly. `not-loaded` does not, and inventing a projection for
 * it would be the worse of the two mistakes available.
 *
 * `Observation.reachable` is documented as *the destination answered at all*, and in the
 * `not-loaded` case it did. Setting it to `false` to force `unavailable` would get the verdict right
 * by writing a false statement into a record that other code reads and telemetry keeps. There is no
 * member of that vocabulary for *answered, and does not serve this model* — `degraded` is reached
 * only through the metadata marker, which belongs to a CLI transcript and not to a models list.
 *
 * So this returns `null`, and a caller that consults only the projection gets no observation, which
 * `availabilityOf` reads as `unknown` and `mayDispatch` refuses. The fact is not lost: it is on the
 * `Health` value, under `readiness`. Naming the divergence is the house habit; teaching `probe.ts` a
 * third kind of evidence is a decision, not a patch, and it is not this issue's.
 */
export function toObservation(health: Health): Observation | null {
  if (health.readiness === "not-loaded") {
    return null;
  }
  return {
    target: health.backend,
    model: health.model,
    observedAt: health.observedAt,
    reachable: health.readiness !== "unreachable",
    completed: health.readiness === "ready",
    // Authored, never the server's text. See the file header.
    output: `readiness: ${health.readiness}`,
  };
}

/** One line for an operator: what was asked, what came back, and where to look. */
export function describeHealth(health: Health): string {
  const where = health.readiness === "ready" ? "" : ` — see ${health.diagnostics}`;
  return `${health.backend}/${health.model}: ${health.readiness} (${health.detail})${where}`;
}
