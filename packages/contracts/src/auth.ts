/**
 * How a cockpit reaches the coordinator, and what it is allowed to send.
 *
 * Two shapes, because there are two situations and they are not variations of one another.
 *
 * - **On the LAN**, the coordinator is reached directly and the browser holds a session cookie. This
 *   package never sees that cookie's value, and does not want to: the browser attaches it, and the
 *   only thing worth naming here is which cookie it is.
 * - **Off-LAN**, through `dsh-relay`, there is no cookie — a cookie is bound to the coordinator's
 *   origin and the relay is a different one — so the client presents a bearer token, over TLS
 *   pinned to the coordinator's key.
 *
 * ## The token is a function, not a field
 *
 * `BearerCredential.token` is a supplier. That is not ceremony. A string field is picked up by
 * `JSON.stringify`, by a Redux devtools trace, by a crash reporter serialising its store, and by
 * every "log the config on startup" line anyone has ever written — and a bearer token that reaches
 * a log is a bearer token that has been given away. A function survives none of those: serialising
 * a credential yields the mode and nothing else.
 *
 * `authHeaders` is the one place the value becomes a string, and its result is meant to go straight
 * into a request.
 *
 * ## The token never goes in a URL
 *
 * Browsers cannot set headers on a `WebSocket`, which is the reason so many designs put the token in
 * a query parameter. This one does not: a URL is written into proxy logs, browser history and
 * `Referer`, and none of those are places a credential can be withdrawn from. `muxAuth` returns the
 * `Sec-WebSocket-Protocol` values instead, which is the one header a browser will send on an
 * upgrade — and that is why `endpointProblems` checks the token is spelled in characters a
 * subprotocol value permits, since a token that is not will fail at the handshake with an error
 * naming nothing useful.
 *
 * ## Pinning
 *
 * The pin is over the SubjectPublicKeyInfo, not the certificate: the certificate is replaced at
 * every renewal and the key need not be, so pinning the certificate is a plan to lock every phone
 * out on a schedule. For the same reason a pin set with only one key is reported as a problem —
 * RFC 7469 requires a backup pin, and the failure it prevents is total and remote.
 */

import { MUX_PATH } from "./events.js";
import { commandPath } from "./routes.js";
import type { CommandName } from "./routes.js";

export const AUTH_MODES = ["session", "bearer"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** LAN. The browser holds the value; this package holds only the name. */
export interface SessionCredential {
  readonly mode: "session";
  readonly cookieName: string;
}

/** Off-LAN, through `dsh-relay`. */
export interface BearerCredential {
  readonly mode: "bearer";
  /** A supplier, so the value is never a field on anything that can be serialised. */
  readonly token: () => string;
  readonly pin: CertificatePin;
}

export type Credential = SessionCredential | BearerCredential;

/** Base64 SHA-256 over the SubjectPublicKeyInfo, as in RFC 7469. */
export interface CertificatePin {
  /** Plural, and at least two: one in use and one held back for renewal. */
  readonly spkiSha256: readonly string[];
  /** When the pin set stops being trustworthy, if it is dated. ISO 8601. */
  readonly expiresAt: string | null;
}

/**
 * Where the coordinator is and how to talk to it.
 *
 * `origin` is an origin: scheme, host, port. No path — the paths are the contract's, and an origin
 * carrying one produces URLs with a doubled prefix that fail as a 404 rather than as a
 * configuration error.
 */
export interface Endpoint {
  readonly origin: string;
  /** True when the coordinator is being reached through `dsh-relay` rather than directly. */
  readonly relayed: boolean;
  readonly credential: Credential;
}

/**
 * Headers for a `POST /api/*` request.
 *
 * The session case is empty on purpose: the cookie is the browser's to attach, and a client that
 * tried to set it here would be reading a value it is not allowed to have.
 */
export function authHeaders(credential: Credential): Record<string, string> {
  if (credential.mode === "session") return {};
  return { Authorization: `Bearer ${credential.token()}` };
}

/** What a `WebSocket` upgrade needs, given that a browser cannot set headers on one. */
export type MuxAuth =
  | { readonly kind: "cookie" }
  | { readonly kind: "subprotocol"; readonly protocols: readonly string[] };

/** The subprotocol prefix the relay strips before comparing the rest to the expected token. */
export const BEARER_SUBPROTOCOL_PREFIX = "dsh.bearer." as const;
/** Always sent, so a server can tell a dsh client from anything else that finds the path. */
export const MUX_SUBPROTOCOL = "dsh.v1" as const;

export function muxAuth(credential: Credential): MuxAuth {
  if (credential.mode === "session") return { kind: "cookie" };
  return {
    kind: "subprotocol",
    protocols: [MUX_SUBPROTOCOL, `${BEARER_SUBPROTOCOL_PREFIX}${credential.token()}`],
  };
}

/** The WebSocket URL for an endpoint. `https` becomes `wss`, and `http` becomes `ws`. */
export function muxUrl(endpoint: Endpoint): string {
  return `${websocketOrigin(endpoint.origin)}${MUX_PATH}`;
}

/** The URL for one command. */
export function commandUrl(endpoint: Endpoint, name: CommandName): string {
  return `${trimSlash(endpoint.origin)}${commandPath(name)}`;
}

/** A description safe to put in a log line, a status bar, or a bug report. */
export function describeEndpoint(endpoint: Endpoint): string {
  const route = endpoint.relayed ? "relayed" : "direct";
  if (endpoint.credential.mode === "session") {
    return `${endpoint.origin} (${route}, session cookie ${endpoint.credential.cookieName})`;
  }
  const pins = endpoint.credential.pin.spkiSha256.length;
  return `${endpoint.origin} (${route}, bearer, ${pins} pin${pins === 1 ? "" : "s"})`;
}

/**
 * Everything wrong with an endpoint, in one pass.
 *
 * Returns sentences rather than codes because every one of these is a configuration mistake read by
 * whoever wrote the configuration, and a code would send them here to look it up.
 *
 * `now` is passed in rather than read, so the expiry check is replayable; passing null skips it.
 *
 * This function calls the token supplier to check how the token is spelled. It never puts the value
 * in a message, and nothing it returns depends on the value beyond its shape.
 */
export function endpointProblems(endpoint: Endpoint, now: string | null = null): readonly string[] {
  const problems: string[] = [];
  const url = parseOrigin(endpoint.origin);

  if (url === null) {
    problems.push(`origin ${JSON.stringify(endpoint.origin)} is not a URL`);
  } else {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      problems.push(`origin scheme ${url.protocol} is not http or https`);
    }
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      problems.push("origin carries a path, query or fragment; it must be scheme, host and port only");
    }
    if (url.protocol === "http:") {
      if (endpoint.relayed) {
        problems.push("a relayed endpoint must be https; the relay carries the credential");
      }
      if (endpoint.credential.mode === "bearer") {
        problems.push("a bearer token over http is a bearer token given away");
      }
    }
  }

  if (endpoint.credential.mode === "session") {
    if (endpoint.relayed) {
      problems.push(
        "session auth cannot be relayed: a cookie is bound to the coordinator's origin and the relay is a different one",
      );
    }
    if (!isHttpToken(endpoint.credential.cookieName)) {
      problems.push("cookie name is not a valid cookie name");
    }
  } else {
    const token = endpoint.credential.token();
    if (token.length === 0) {
      problems.push("bearer token is empty");
    } else if (!isHttpToken(token)) {
      problems.push(
        "bearer token contains characters a WebSocket subprotocol value cannot carry; use base64url without padding",
      );
    }
    problems.push(...pinProblems(endpoint.credential.pin, endpoint.relayed, now));
  }

  return problems;
}

function pinProblems(
  pin: CertificatePin,
  relayed: boolean,
  now: string | null,
): readonly string[] {
  const problems: string[] = [];
  if (pin.spkiSha256.length === 0) {
    if (relayed) problems.push("a relayed bearer endpoint must pin the coordinator's key");
  } else if (pin.spkiSha256.length === 1) {
    problems.push(
      "a pin set with no backup key locks every deployed client out at the next key rotation (RFC 7469)",
    );
  }
  for (const value of pin.spkiSha256) {
    if (!isSha256Base64(value)) {
      problems.push(`pin ${JSON.stringify(value)} is not base64 SHA-256 over a SubjectPublicKeyInfo`);
    }
  }
  if (pin.expiresAt !== null && now !== null) {
    const expires = Date.parse(pin.expiresAt);
    const at = Date.parse(now);
    if (Number.isNaN(expires)) {
      problems.push(`pin expiry ${JSON.stringify(pin.expiresAt)} is not a date`);
    } else if (!Number.isNaN(at) && expires <= at) {
      problems.push(`pin set expired at ${pin.expiresAt}`);
    }
  }
  return problems;
}

/** RFC 7230 `token`: the characters a header value, a cookie name and a subprotocol all permit. */
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function isHttpToken(value: string): boolean {
  return HTTP_TOKEN.test(value);
}

/** 32 bytes of SHA-256, base64-encoded: 43 characters and one pad. */
const SHA256_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

function isSha256Base64(value: string): boolean {
  return SHA256_BASE64.test(value);
}

function parseOrigin(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function trimSlash(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

function websocketOrigin(origin: string): string {
  const trimmed = trimSlash(origin);
  if (trimmed.startsWith("https:")) return `wss:${trimmed.slice("https:".length)}`;
  if (trimmed.startsWith("http:")) return `ws:${trimmed.slice("http:".length)}`;
  return trimmed;
}
