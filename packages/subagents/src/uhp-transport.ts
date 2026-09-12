/**
 * The HTTP port to a HarnessRouter, and the only place in this package that touches a credential.
 *
 * Issue #286: "Push credentials never enter the dispatch payload (`admit.ts:14`); authenticate via
 * credential profile `HARNESSROUTER_API_KEY`." Run artifacts: `.llm/runs/provider-uhp--e37/`.
 *
 * ## Why the credential lives here and not in the provider
 *
 * `uhp-provider.ts` builds request bodies. If it also held the token, then every future edit to a body —
 * a new metadata key, a debug echo, a retry that logs what it sent — would be one line away from putting
 * a credential in a payload. So the provider never receives one: it hands this port a call, and the port
 * attaches `Authorization: Bearer` from the environment at send time. The provider cannot leak what it
 * cannot see, which is a structural version of the rule rather than a reminder about it.
 *
 * What the provider does hold is the **profile name** — `HARNESSROUTER_API_KEY` — and a name is not a
 * secret. `createUhpTransport` refuses a profile that is not shaped like an environment variable name,
 * because the one mistake this shape prevents is somebody passing the token itself where the name goes.
 *
 * ## Authentication requirements this honours
 *
 * Security §1: "A server MUST authenticate every endpoint except `GET /v1/uhp`", and MUST NOT echo a
 * credential in any response body, error message, event, log line or artifact. Nothing here logs, and
 * nothing here returns a header it sent. Lifecycle §1: every request declares `UHP-Version`, so a server
 * that cannot serve this version fails with `400 unsupported_protocol_version` rather than silently
 * serving another one.
 *
 * Errors §4: "Retries of `POST /v1/responses` MUST carry an `Idempotency-Key`. Without one, a retry after
 * a timeout runs the task a second time — and the first may still be running, editing the same files."
 * The key is a caller-supplied field on the call rather than something minted here, because the identity
 * a retry must share is the *run's*, and only the caller knows that.
 *
 * Nothing in this module has met a live HarnessRouter. See `verification.md`.
 */

import { UHP_VERSION, UHP_VERSION_HEADER } from "./uhp-wire.js";

/** One HTTP call, described in protocol terms rather than in URL terms. */
export interface UhpCall {
  readonly method: "GET" | "POST";
  /** Path under the base URL, without a leading slash: `responses`, `harnesses`, `responses/x/cancel`. */
  readonly path: string;
  /** JSON request body. Omitted for `GET`, and for a `POST` that has none (cancel). */
  readonly body?: unknown;
  /** Ask for `text/event-stream`. The body is returned as text either way. */
  readonly stream?: boolean;
  /** `Idempotency-Key` (Tasks §6). Required by Errors §4 on any retry of a task creation. */
  readonly idempotencyKey?: string;
}

/**
 * What came back, or the fact that nothing did.
 *
 * `sent` is the field that keeps a verdict honest. A call that never left this process launched nothing,
 * so a retry is safe; a call that was sent and not answered may be running, and a retry would put two
 * agents in one working directory. Errors §5 says so directly: "A client that gives up MUST NOT assume
 * the task stopped. It has not."
 */
export interface UhpAnswer {
  /** `true` once the request left this process. `false` means nothing was launched, definitively. */
  readonly sent: boolean;
  /** HTTP status, or `0` when there was no answer to read. */
  readonly httpStatus: number;
  readonly contentType: string;
  readonly body: string;
  /** The `UHP-Version` the server says it served, or `null`. Never rewritten to what we asked for. */
  readonly version: string | null;
  /** Why there is no answer, when there is none. Free of credential material by construction. */
  readonly cause: string | null;
}

export interface UhpTransport {
  call(call: UhpCall): Promise<UhpAnswer>;
}

/**
 * A credential profile name: an environment variable name, and nothing that could be a token.
 *
 * Upper snake case with no separators a secret would survive. `admit.ts` refuses credential-shaped
 * material in a dispatch payload by matching the shapes a key takes; this is the same rule from the other
 * end, allowing only the shape a *name* takes.
 */
export const CREDENTIAL_PROFILE = /^[A-Z][A-Z0-9_]{2,63}$/;

/** The profile the RFC names for HarnessRouter Community Edition. A name, never a value. */
export const HARNESSROUTER_PROFILE = "HARNESSROUTER_API_KEY" as const;

export interface UhpTransportOptions {
  /** `$HARNESSROUTER_BASE_URL`, e.g. loopback `http://127.0.0.1:3000/api/harness/v1`. */
  readonly baseUrl: string;
  /** The **name** of the environment entry holding the bearer token. Never the token. */
  readonly credentialProfile?: string;
  /** Where the profile is resolved from. Injected so a test never needs a real environment. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Injected for tests; defaults to the platform `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Inactivity ceiling in milliseconds. Errors §5: "A client SHOULD set generous timeouts. Agent tasks
   * routinely run for minutes; a 30-second HTTP timeout will cancel healthy work."
   */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 600_000;

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Build the port.
 *
 * Throws on a malformed base URL or a profile name that is not one. Both are composition defects rather
 * than outcomes of a call — the distinction `provider.ts` draws — and a provider built on a broken
 * transport would answer `unknown` for the life of the deployment while looking like a network problem.
 */
export function createUhpTransport(options: UhpTransportOptions): UhpTransport {
  const profile = options.credentialProfile ?? HARNESSROUTER_PROFILE;
  if (!CREDENTIAL_PROFILE.test(profile)) {
    throw new Error(
      "credentialProfile must be the NAME of an environment entry holding the bearer token " +
        "(upper snake case, e.g. HARNESSROUTER_API_KEY), not the token itself; refusing to build a " +
        "transport that may have been handed a credential where a name belongs",
    );
  }
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new Error("baseUrl is not a URL; set HARNESSROUTER_BASE_URL to the UHP base, e.g. the loopback deployment's /api/harness/v1");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error(`baseUrl must be http or https, not ${base.protocol}`);
  }
  const env = options.env ?? process.env;
  const send = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async call(call: UhpCall): Promise<UhpAnswer> {
      const token = env[profile];
      if (typeof token !== "string" || token.trim().length === 0) {
        // Not sent. Naming the profile is safe and is the only actionable thing to say; the value is
        // absent, which is precisely the fact being reported.
        return {
          sent: false,
          httpStatus: 0,
          contentType: "",
          body: "",
          version: null,
          cause: `the credential profile ${profile} is not set in this environment, so no request was sent`,
        };
      }
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        accept: call.stream === true ? "text/event-stream" : "application/json",
        [UHP_VERSION_HEADER]: UHP_VERSION,
      };
      if (call.body !== undefined) headers["content-type"] = "application/json";
      if (call.idempotencyKey !== undefined) headers["idempotency-key"] = call.idempotencyKey;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let sent = false;
      try {
        const init: RequestInit = {
          method: call.method,
          headers,
          signal: controller.signal,
          ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
        };
        sent = true;
        const response = await send(joinUrl(options.baseUrl, call.path), init);
        const body = await response.text();
        return {
          sent: true,
          httpStatus: response.status,
          contentType: response.headers.get("content-type") ?? "",
          body,
          version: response.headers.get(UHP_VERSION_HEADER),
          cause: null,
        };
      } catch (error) {
        // The message of a transport error can name a host and a port. It cannot name a credential: the
        // token is only ever a header value, and no runtime echoes one into an exception. It is still kept
        // out of anything published — `uhp-provider.ts` redacts every detail it emits.
        return {
          sent,
          httpStatus: 0,
          contentType: "",
          body: "",
          version: null,
          cause: error instanceof Error ? error.message : "the request failed with a non-error throw",
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
