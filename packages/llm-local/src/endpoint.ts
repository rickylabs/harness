/**
 * Turning a backend name and an optional override into a request target.
 *
 * `backends.ts` says a base URL is a default rather than a fact about a deployment, and leaves
 * resolving an override to E4.1 (#57). This is that: the one place in the package where text from
 * outside the repository — a profile field, an environment variable — becomes something a request
 * is aimed at.
 *
 * ## One builder, because all three speak the same protocol
 *
 * The first acceptance criterion of #57 reads like a description and is actually a constraint. All
 * three destinations are `openai-completions`, so the routes are derived once here rather than three
 * times in three adapters. If one of them spoke something else the matrix in `capability.ts` would
 * stop being a table — every cell would need to know which of two clients it belonged to — and the
 * package would have acquired a second code path for a difference nobody has.
 *
 * ## No message here echoes the override
 *
 * A base URL is written into a receipt, a run log and an issue body, and the shapes people actually
 * type include `https://KEY@host/v1` and `https://host/v1?api-key=KEY`. Both are refused, and the
 * refusal cannot quote what it refused without doing precisely the thing it exists to prevent.
 *
 * Rather than exempt those two messages, no message in this file quotes the override at all. Each
 * one names the backend, the structural fact that was wrong, and — where parsing got that far — the
 * scheme, which is a short closed vocabulary and never a secret. A refusal that says *the override
 * for lm-studio carries a query string* is enough to find the line in a config; one that says it
 * while pasting the query string is a credential in the log. `admit.ts` reaches the same conclusion
 * from the other direction, refusing a payload that carries credential material on that ground
 * alone so no other message can name the field holding it.
 *
 * ## A query string is refused rather than dropped
 *
 * Silently discarding one would be worse than either accepting or refusing it: the operator who put
 * `?api-key=` there believes the key is being sent, the request goes out without it, and the 401
 * that comes back reads as a bad key rather than as a dropped one. Credentials are bound by profile
 * at dispatch — see `routing`'s `unbound-credential` — and a URL is not a place to put one.
 */

import { BACKENDS, type Backend, type BackendApi, backendRecord } from "./backends.js";

/** Why a proposed endpoint was refused. */
export const ENDPOINT_REFUSALS = [
  "unknown-backend",
  "unparseable",
  "not-http",
  "credentials-in-url",
  "carries-query",
  "carries-fragment",
] as const;
export type EndpointRefusal = (typeof ENDPOINT_REFUSALS)[number];

const ENDPOINT_REFUSAL_TEXT: Readonly<Record<EndpointRefusal, string>> = {
  "unknown-backend": "not a backend this package describes",
  unparseable: "not a URL",
  "not-http": "not an http or https URL",
  "credentials-in-url": "carries credential material in the URL itself",
  "carries-query": "carries a query string",
  "carries-fragment": "carries a fragment",
};

/** One line for a refusal, for a log that has no room for the full message. */
export const describeEndpointRefusal = (reason: EndpointRefusal): string =>
  ENDPOINT_REFUSAL_TEXT[reason];

/** Whether the target came from the table or from a deployment. */
export const ENDPOINT_SOURCES = ["default", "override"] as const;
export type EndpointSource = (typeof ENDPOINT_SOURCES)[number];

/** A resolved destination: where to send, and what the sender still owes. */
export interface Endpoint {
  readonly backend: Backend;
  /** Scheme, host, port and path, with no trailing slash. Never a query and never userinfo. */
  readonly baseUrl: string;
  readonly api: BackendApi;
  readonly source: EndpointSource;
  /**
   * Whether a credential must be bound before a request is sent.
   *
   * Which profile binds it is `routing`'s answer, not this package's: it owns the profile table and
   * refuses an unbound relay dispatch as `unbound-credential`. Naming one here would be a second
   * answer to a question that must only have one.
   */
  readonly credentialed: boolean;
}

/** The answer to "where does a request for this backend go". */
export type EndpointVerdict =
  | { readonly ok: true; readonly endpoint: Endpoint }
  | { readonly ok: false; readonly reason: EndpointRefusal; readonly message: string };

function refuse(reason: EndpointRefusal, message: string): EndpointVerdict {
  return { ok: false, reason, message };
}

/**
 * Strip the trailing slash a base URL is as likely to carry as not.
 *
 * `http://host/v1/` and `http://host/v1` name the same thing, and only one of them produces
 * `http://host/v1//models` when a route is appended.
 */
function stripTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text.charAt(end - 1) === "/") {
    end -= 1;
  }
  return text.slice(0, end);
}

/**
 * Resolve a backend name and an optional override into a target.
 *
 * An override that is absent, `null`, or blank falls through to the table default. Blank is treated
 * as absent rather than refused because that is what an unset environment variable reads as, and a
 * daemon that will not boot because `LLM_BASE_URL=` appears in a compose file has refused the wrong
 * thing. A value with any content in it is resolved or refused on its merits.
 */
export function resolveEndpoint(backend: string, override?: string | null): EndpointVerdict {
  const record = backendRecord(backend);
  if (record === null) {
    return refuse(
      "unknown-backend",
      `${backend} is not a backend this package describes. Known: ${BACKENDS.join(", ")}.`,
    );
  }

  const proposed = typeof override === "string" ? override.trim() : "";
  if (proposed === "") {
    return {
      ok: true,
      endpoint: {
        backend: record.backend,
        baseUrl: stripTrailingSlashes(record.defaultBaseUrl),
        api: record.api,
        source: "default",
        credentialed: record.credentialed,
      },
    };
  }

  let url: URL;
  try {
    url = new URL(proposed);
  } catch {
    return refuse(
      "unparseable",
      `the override for ${record.backend} is not a URL. It is not quoted here on purpose: an ` +
        "override is one of the places a credential gets pasted, and a refusal that echoes it puts " +
        "the credential in the log.",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return refuse(
      "not-http",
      `the override for ${record.backend} is a ${url.protocol.replace(":", "")} URL. The three ` +
        "destinations are HTTP services; nothing here can send a request over anything else. A " +
        "value written as `host:1234/v1` lands here too, because that parses as a scheme — write " +
        "`http://host:1234/v1`.",
    );
  }

  if (url.username !== "" || url.password !== "") {
    return refuse(
      "credentials-in-url",
      `the override for ${record.backend} carries credential material in the URL itself. A base ` +
        "URL is written into receipts, run logs and issue bodies, so a secret in one is a secret " +
        "in all three. Bind it by profile at dispatch instead.",
    );
  }

  if (url.search !== "") {
    return refuse(
      "carries-query",
      `the override for ${record.backend} carries a query string. It is refused rather than ` +
        "dropped: a key put there would silently not be sent, and the 401 that came back would " +
        "read as a bad credential rather than as a discarded one.",
    );
  }

  if (url.hash !== "") {
    return refuse(
      "carries-fragment",
      `the override for ${record.backend} carries a fragment. A fragment is never sent to a ` +
        "server, so one here means the value was copied from a browser rather than written for a " +
        "client.",
    );
  }

  return {
    ok: true,
    endpoint: {
      backend: record.backend,
      baseUrl: `${url.protocol}//${url.host}${stripTrailingSlashes(url.pathname)}`,
      api: record.api,
      source: "override",
      credentialed: record.credentialed,
    },
  };
}

/**
 * Where a readiness check is sent.
 *
 * `/models` and not a one-token completion, for two reasons that point the same way. It spends
 * nothing — no quota window on a subscription, no balance on the relay — so it is a check an
 * operator has no reason to turn off, and a check that gets turned off is not a check. And its
 * *body* answers the question a bare liveness ping cannot: LM Studio's server accepts connections
 * long before a model has finished loading, and sometimes when one never will, so "something
 * answered" is not "this model can run here". The models list is the cheapest place that difference
 * is visible.
 */
export function modelsUrl(endpoint: Endpoint): string {
  return `${endpoint.baseUrl}/models`;
}

/**
 * Where work is sent.
 *
 * Derived rather than stored, because a stored route is a second place the protocol is asserted and
 * `api` already asserts it once.
 */
export function completionsUrl(endpoint: Endpoint): string {
  return `${endpoint.baseUrl}/chat/completions`;
}

/** What a sender must do to a request, beyond aiming it. */
export interface ReadinessRequest {
  readonly method: "GET";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The sender binds the credential. This says only that one is owed. */
  readonly credentialed: boolean;
}

/**
 * The readiness call, as data.
 *
 * A value rather than a call, so the thing that decides what to send and the thing that opens the
 * socket are different objects and only one of them needs a network to test. It holds no credential
 * and no header that could carry one — see `credentialed`.
 */
export function readinessRequest(endpoint: Endpoint): ReadinessRequest {
  return {
    method: "GET",
    url: modelsUrl(endpoint),
    headers: { accept: "application/json" },
    credentialed: endpoint.credentialed,
  };
}

/** One line for an operator: what was resolved, and whether the table or a deployment said so. */
export function describeEndpoint(endpoint: Endpoint): string {
  return `${endpoint.backend}: ${endpoint.baseUrl} (${endpoint.source})`;
}
