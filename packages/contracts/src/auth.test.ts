import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BEARER_SUBPROTOCOL_PREFIX,
  MUX_SUBPROTOCOL,
  authHeaders,
  commandUrl,
  describeEndpoint,
  endpointProblems,
  muxAuth,
  muxUrl,
  type BearerCredential,
  type CertificatePin,
  type Endpoint,
  type SessionCredential,
} from "./auth.js";
import { MUX_PATH } from "./events.js";

const TOKEN = "d3ad-b33f.Ab_C~9";

const PINS: CertificatePin = {
  spkiSha256: [`${"A".repeat(43)}=`, `${"B".repeat(43)}=`],
  expiresAt: null,
};

const SESSION: SessionCredential = { mode: "session", cookieName: "dsh_session" };

function bearer(token: string = TOKEN, pin: CertificatePin = PINS): BearerCredential {
  return { mode: "bearer", token: () => token, pin };
}

const LAN: Endpoint = { origin: "http://n5.local:2299", relayed: false, credential: SESSION };
const RELAYED: Endpoint = { origin: "https://relay.example:443", relayed: true, credential: bearer() };

test("a bearer token is not a field, so serialising a credential cannot leak it", () => {
  // The failure this prevents: a devtools trace, a crash reporter serialising its store, or the
  // "log the config on startup" line that every project eventually grows.
  assert.equal(JSON.stringify(RELAYED).includes(TOKEN), false);
  assert.equal(JSON.stringify(RELAYED.credential).includes(TOKEN), false);
  assert.equal(String(Object.keys(RELAYED.credential)).includes(TOKEN), false);
  // And it is still reachable where it is meant to be.
  assert.equal(authHeaders(RELAYED.credential).Authorization, `Bearer ${TOKEN}`);
});

test("the session case sends no auth header, because the cookie is the browser's to attach", () => {
  assert.deepEqual(authHeaders(SESSION), {});
});

test("a description is safe to put in a log line", () => {
  const described = describeEndpoint(RELAYED);
  assert.equal(described.includes(TOKEN), false);
  assert.match(described, /relayed/);
  assert.match(described, /2 pins/);
  assert.match(describeEndpoint(LAN), /dsh_session/);
});

test("the token rides the one header a browser will send on an upgrade, never the URL", () => {
  // A URL is written into proxy logs, browser history and `Referer`, none of which a credential can
  // be withdrawn from.
  const url = muxUrl(RELAYED);
  assert.equal(url, `wss://relay.example:443${MUX_PATH}`);
  assert.equal(url.includes(TOKEN), false);

  const auth = muxAuth(RELAYED.credential);
  if (auth.kind !== "subprotocol") throw new Error("a bearer credential must use a subprotocol");
  assert.deepEqual(auth.protocols, [MUX_SUBPROTOCOL, `${BEARER_SUBPROTOCOL_PREFIX}${TOKEN}`]);

  assert.deepEqual(muxAuth(SESSION), { kind: "cookie" });
  assert.equal(muxUrl(LAN), `ws://n5.local:2299${MUX_PATH}`);
});

test("command URLs are the endpoint plus the contract's own path", () => {
  assert.equal(commandUrl(LAN, "snapshot"), "http://n5.local:2299/api/snapshot");
  assert.equal(commandUrl({ ...LAN, origin: "http://n5.local:2299/" }, "dispatch"),
    "http://n5.local:2299/api/dispatch");
});

test("a LAN session endpoint and a relayed bearer endpoint both check out", () => {
  assert.deepEqual(endpointProblems(LAN), []);
  assert.deepEqual(endpointProblems(RELAYED, "2026-09-05T00:00:00.000Z"), []);
});

test("a cookie cannot be relayed, because it is bound to the coordinator's origin", () => {
  const problems = endpointProblems({ ...LAN, origin: "https://relay.example", relayed: true });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /cookie is bound to the coordinator's origin/);
});

test("a bearer token over http is a bearer token given away", () => {
  const problems = endpointProblems({ origin: "http://n5.local:2299", relayed: false, credential: bearer() });
  assert.deepEqual(problems, ["a bearer token over http is a bearer token given away"]);
});

test("an origin carrying a path is a configuration error, not a 404 to debug later", () => {
  const problems = endpointProblems({ ...LAN, origin: "http://n5.local:2299/dsh" });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /path, query or fragment/);
});

test("a relayed bearer endpoint must pin the coordinator's key", () => {
  const unpinned = bearer(TOKEN, { spkiSha256: [], expiresAt: null });
  const problems = endpointProblems({ ...RELAYED, credential: unpinned });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /must pin the coordinator's key/);
});

test("a pin set with one key is a scheduled outage for every deployed client", () => {
  // RFC 7469 requires a backup pin. The failure it prevents is total and remote: the key rotates,
  // every phone refuses the connection, and no phone can be reached to fix it.
  const single = bearer(TOKEN, { spkiSha256: [`${"A".repeat(43)}=`], expiresAt: null });
  const problems = endpointProblems({ ...RELAYED, credential: single });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /backup key/);
});

test("an expired pin set is only a problem once someone says what time it is", () => {
  const dated = bearer(TOKEN, { ...PINS, expiresAt: "2026-01-01T00:00:00.000Z" });
  const endpoint: Endpoint = { ...RELAYED, credential: dated };
  assert.deepEqual(endpointProblems(endpoint), [], "no clock means no verdict");
  const problems = endpointProblems(endpoint, "2026-09-05T00:00:00.000Z");
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /expired at 2026-01-01/);
});

test("a token spelled in characters a subprotocol cannot carry fails now, not at the handshake", () => {
  const problems = endpointProblems({ ...RELAYED, credential: bearer("has spaces and /slashes") });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /base64url without padding/);
});

test("an empty token is reported as empty rather than as badly spelled", () => {
  const problems = endpointProblems({ ...RELAYED, credential: bearer("") });
  assert.deepEqual(problems, ["bearer token is empty"]);
});

test("a pin that is not a SubjectPublicKeyInfo digest is named", () => {
  const wrong = bearer(TOKEN, { spkiSha256: [`${"A".repeat(43)}=`, "not-a-digest"], expiresAt: null });
  const problems = endpointProblems({ ...RELAYED, credential: wrong });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /is not base64 SHA-256/);
});

test("an origin that is not a URL is reported once, without cascading", () => {
  const problems = endpointProblems({ ...LAN, origin: "not a url" });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /is not a URL/);
});

test("a host with no scheme is caught, since URL parsing alone would accept it", () => {
  // `new URL("n5.local:2299")` succeeds — it reads "n5.local:" as the scheme. Checking the scheme is
  // what turns that into an error at configuration time rather than a connection that never opens.
  const problems = endpointProblems({ ...LAN, origin: "n5.local:2299" });
  assert.ok(problems.some((problem) => /is not http or https/.test(problem)));
});
