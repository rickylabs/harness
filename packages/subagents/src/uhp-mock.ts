/**
 * Mock UHP loopback server and fixture set for route-identity testing.
 *
 * WHAT THIS FILE IS EVIDENCE OF, AND WHAT IT IS NOT
 *
 * This is a mock. It proves what *this repository* does when handed a given wire shape. It proves
 * nothing whatsoever about what a real HarnessRouter returns. Read that sentence before trusting any
 * test that imports this module: a fixture that echoes a value and a test that then reports the
 * value "observable" is a fabricated PASS, and it is the specific failure spike S10
 * (issue #288) exists to prevent.
 *
 * Whether a field is genuinely observable over UHP is settled by the published specification, not by
 * anything here. That reading is recorded in `.llm/runs/route-identity-uhp--s10/research.md`, and
 * its conclusion is:
 *
 *   model     requestable and echoed, echo REQUIRED       -> observable
 *   provider  no request field, no response field          -> unobservable
 *   effort    no request field, no response field          -> unobservable
 *   cwd       no request field, no response field          -> unobservable AND unrequestable
 *
 * Citations, all retrieved 2026-09-12 against UHP `2026-08-11`:
 *
 *   model      Tasks 1.1 request table and Tasks 1.3 substitution rule
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/tasks
 *              `Response.required` includes `model`; `model` is "The model that actually ran"
 *              https://unifiedharnessprotocol.org/schema/uhp-2026-08-11.openapi.yaml (lines 823, 836)
 *   provider   absent from `CreateResponseRequest` and `Response`; the only occurrence in the
 *              protocol is the failure code `provider_error`
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/errors
 *   effort     absent from the Tasks 1.1 request table, which is exhaustive. The protocol's only
 *              "reasoning" surface is the reasoning *summary* stream, which reports that the agent
 *              thought and not the effort it ran at
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/streaming (section 2.4)
 *   cwd        a first-class concept that is deliberately never named on the wire. A session shares
 *              "conversational context and a working directory", and the server owns it; the client
 *              receives only an opaque `metadata.session_id`
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/sessions (section 1)
 *              https://unifiedharnessprotocol.org/spec/2026-08-11/lifecycle (section 4)
 *
 * There is no container runtime on this host and no reachable HarnessRouter instance. Per the owner
 * ruling of 2026-09-12, S10 develops against a local mock inside the test suite rather than blocking
 * on one. This module is that mock. It is intentionally the smallest thing that can carry a real
 * HTTP request and a real `text/event-stream`, because a fixture that never crosses a socket cannot
 * show that the stream decoder is also fail-closed.
 *
 * This module ships no behaviour the package exports. It is not re-exported from `index.ts` and it
 * is not part of the public surface of `@rickylabs/subagents`; it exists so that issue #286 can
 * build `provider-uhp` against a wire shape that was written from the specification rather than from
 * an implementation's memory of it.
 */

import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { RouteIdentityInput } from "./route.js";

/* -------------------------------------------------------------------------------------------------
 * Wire types — a faithful subset of `uhp-2026-08-11.openapi.yaml`
 * ---------------------------------------------------------------------------------------------- */

/**
 * `Response.metadata`. `additionalProperties: true` in the schema, so a server MAY volunteer keys
 * this protocol never defined. That permission is exactly why `observeUhpRoute` must not read them.
 */
export interface UhpResponseMetadata {
  readonly session_id?: string;
  /** Present when the server ran a different model than was requested (openapi.yaml:852-854). */
  readonly requested_model?: string;
  readonly model_fallback?: boolean;
  readonly model_fallback_reason?: string;
  /** Request fields the server did not act on, by name (Tasks 1.1). */
  readonly ignored_fields?: readonly string[];
  /** Undefined-by-UHP extension keys a non-conformant or vendor-extended server might add. */
  readonly [extension: string]: unknown;
}

/** `Response`. `required: [id, object, created_at, status, output, model]` (openapi.yaml:823). */
export interface UhpResponse {
  readonly id: string;
  readonly object: "response";
  readonly created_at: number;
  readonly status: "in_progress" | "completed" | "failed" | "incomplete" | "cancelled";
  readonly output: readonly unknown[];
  /** "The model that actually ran" (openapi.yaml:836). Required. */
  readonly model?: string;
  readonly metadata?: UhpResponseMetadata;
  readonly [extension: string]: unknown;
}

/** `CreateResponseRequest` (openapi.yaml:778-819), narrowed to what route identity cares about. */
export interface UhpCreateRequest {
  readonly input: string;
  readonly model?: string;
  readonly stream?: boolean;
  readonly metadata?: { readonly harness_id?: string; readonly [extension: string]: unknown };
  /** Undefined-by-UHP keys. `additionalProperties: true` permits sending them; nothing honours them. */
  readonly [extension: string]: unknown;
}

/* -------------------------------------------------------------------------------------------------
 * The observation adapters
 * ---------------------------------------------------------------------------------------------- */

/**
 * The conformant adapter: map a UHP response onto the four route fields, reading ONLY fields the
 * specification defines.
 *
 * Three of the four are hardcoded `undefined`. That is not laziness and it is not a stub. UHP
 * defines no wire field for `provider`, `effort` or `cwd`, so there is nothing to read, and
 * inventing a read would be the fabricated agreement this contract exists to refuse.
 * `compareRouteIdentity` renders an absent observation as `{ value: null }` and a status of
 * `unknown`, which is the correct and honest encoding of "the wire did not report this".
 *
 * `model` is read from `response.model` because the schema makes that field REQUIRED and defines it
 * as "The model that actually ran" (openapi.yaml:823, 836).
 *
 * Note what this function does NOT do with a substitution. Tasks 1.3 requires a substituting server
 * to report `metadata.requested_model` alongside the model that ran. This adapter reports the model
 * that ran, so `compareRouteIdentity` sees the substituted value against the requested one and
 * records a difference. Reading `requested_model` back in and reporting *that* as the observation
 * would launder a substitution into an agreement, which is precisely the measurement error Tasks 1.3
 * exists to prevent.
 */
export function observeUhpRoute(response: UhpResponse): RouteIdentityInput {
  return {
    // UHP defines no `provider` on request or response. See the module docblock.
    provider: undefined,
    model: response.model,
    // UHP defines no reasoning-effort field anywhere in the protocol.
    effort: undefined,
    // UHP never names the working directory on the wire; the server owns it.
    cwd: undefined,
  };
}

/**
 * The credulous adapter — DELIBERATELY WRONG. Do not use it outside its one regression test.
 *
 * This reads undefined-by-UHP extension keys out of `metadata` and reports them as observations. A
 * cooperative fixture that sets `metadata.effort` then makes this adapter produce a verified route,
 * and a test written against it would report "effort is observable over UHP" while having proved
 * only that the fixture's author typed the value twice.
 *
 * It is kept, named and tested so the failure mode is a documented artefact rather than a mistake
 * waiting to be made again. The test that uses it asserts that it manufactures a PASS, which is the
 * evidence that `observeUhpRoute` is right to refuse.
 */
export function observeUhpRouteCredulous(response: UhpResponse): RouteIdentityInput {
  const meta = response.metadata ?? {};
  return { provider: meta["provider"], model: response.model, effort: meta["effort"], cwd: meta["cwd"] };
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

/** The route this repository asks for. Mirrors a `formal_impl_evaluation` step shape. */
export const UHP_REQUESTED: RouteIdentityInput = {
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "xhigh",
  cwd: "/work/harness",
};

function response(over: Partial<UhpResponse> & { readonly metadata?: UhpResponseMetadata }): UhpResponse {
  return {
    id: "resp_s10",
    object: "response",
    created_at: 1_757_635_200,
    status: "completed",
    output: [],
    ...over,
  };
}

/**
 * The fixture set. Names are the shapes deliverable 3 requires, plus the two the specification
 * actually describes.
 *
 * Every fixture is written from the schema, not from an implementation. Where a fixture carries a
 * key UHP does not define, its name says so (`*Extended`) and the comment says which clause permits
 * it, so no reader can mistake it for protocol behaviour.
 */
export const UHP_FIXTURES = {
  /**
   * The conformant happy path. A completed task that reports the model that ran and the session it
   * ran in — which is everything UHP has to say about route identity.
   */
  conformant: response({
    model: "claude-opus-5",
    metadata: { session_id: "sess_s10" },
  }),

  /**
   * "All three fields present and agreeing" (deliverable 3, shape 1).
   *
   * READ THE NAME. This server volunteers `provider`, `effort` and `cwd` in `metadata`, which
   * `additionalProperties: true` permits and which no clause of UHP defines, requires or tests. The
   * values agree with `UHP_REQUESTED` on purpose. The correct behaviour of this repository when
   * handed this shape is to refuse it anyway: agreement on a field the protocol does not define is
   * not evidence, because any server can write anything there and a conformant server writes
   * nothing.
   */
  allThreeAgreeingExtended: response({
    model: "claude-opus-5",
    metadata: {
      session_id: "sess_s10",
      provider: "anthropic",
      effort: "xhigh",
      cwd: "/work/harness",
    },
  }),

  /**
   * "A field present and contradicting the request" (deliverable 3, shape 3) — the real one.
   *
   * Model substitution, exactly as Tasks 1.3 specifies it: the server could not serve
   * `claude-opus-5`, substituted the harness's authorized default, and reported the substitution
   * rather than pretending. This is the only contradiction UHP is capable of reporting, and it is
   * the model-substitution safety signal the `mismatch` status exists for.
   */
  modelSubstituted: response({
    model: "claude-sonnet-5",
    metadata: {
      session_id: "sess_s10",
      requested_model: "claude-opus-5",
      model_fallback: true,
      model_fallback_reason: "model 'claude-opus-5' is not available for this harness's backend",
    },
  }),

  /**
   * A contradiction on an undefined-by-UHP extension key. The server's `metadata.effort` disagrees
   * with the request. A credulous adapter would call this a `mismatch`; the conformant adapter never
   * sees it at all and calls the route `unknown`, because an undefined key cannot contradict any
   * more than it can agree.
   */
  effortContradictingExtended: response({
    model: "claude-opus-5",
    metadata: { session_id: "sess_s10", provider: "anthropic", effort: "low", cwd: "/work/harness" },
  }),

  /**
   * "Each field absent" (deliverable 3, shape 2) for the one field UHP defines. A response with no
   * `model` violates `Response.required` (openapi.yaml:823) and fails conformance check T-03, whose
   * message is "response has no `model`, so a client cannot tell what ran". A client must still
   * survive it, because a non-conformant server is a thing that exists.
   */
  modelAbsent: response({ metadata: { session_id: "sess_s10" } }),

  /** No `metadata` at all. The most degenerate shape a server can return and still be parseable. */
  bareMinimum: response({ model: "claude-opus-5" }),
} as const satisfies Readonly<Record<string, UhpResponse>>;

export type UhpFixtureName = keyof typeof UHP_FIXTURES;

/* -------------------------------------------------------------------------------------------------
 * SSE encoding — Streaming section 1
 * ---------------------------------------------------------------------------------------------- */

/**
 * Encode a response as the SSE frames a streaming UHP task produces.
 *
 * Rules honoured, from https://unifiedharnessprotocol.org/spec/2026-08-11/streaming section 1:
 * every event carries `type` and `sequence_number`; `sequence_number` starts at 0 and increases by
 * exactly 1; `response.created` is the first event and carries the initial response with
 * `status: in_progress`; the stream ends with exactly one terminal event.
 */
export function encodeUhpStream(final: UhpResponse): string {
  const created: UhpResponse = { ...final, status: "in_progress", output: [] };
  const frames = [
    { type: "response.created", sequence_number: 0, response: created },
    { type: "response.in_progress", sequence_number: 1, response: created },
    { type: "response.completed", sequence_number: 2, response: final },
  ];
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

/**
 * Decode a UHP SSE body and return the response carried by the terminal event.
 *
 * Fail-closed by construction: a body with no terminal event yields `undefined` rather than the
 * last-seen response, because "the stream stopped early" and "the task finished" are different
 * facts and a decoder that conflates them reports a truncated run as a completed one.
 */
export function decodeUhpStream(body: string): UhpResponse | undefined {
  const terminal = new Set([
    "response.completed",
    "response.incomplete",
    "response.failed",
    "response.cancelled",
  ]);
  let expected = 0;
  let result: UhpResponse | undefined;
  for (const block of body.split("\n\n")) {
    const line = block.trim();
    if (!line.startsWith("data:")) continue;
    const frame: unknown = JSON.parse(line.slice("data:".length).trim());
    if (typeof frame !== "object" || frame === null) return undefined;
    const event = frame as { type?: unknown; sequence_number?: unknown; response?: unknown };
    // A dropped event is detectable, and detecting it is the whole point of the counter.
    if (event.sequence_number !== expected) return undefined;
    expected += 1;
    if (typeof event.type === "string" && terminal.has(event.type)) {
      result = event.response as UhpResponse;
    }
  }
  return result;
}

/* -------------------------------------------------------------------------------------------------
 * The loopback server
 * ---------------------------------------------------------------------------------------------- */

export interface UhpMock {
  readonly origin: string;
  /** POST /v1/responses, returning the decoded terminal response, over JSON or SSE. */
  post(body: UhpCreateRequest): Promise<UhpResponse | undefined>;
  close(): Promise<void>;
}

function read(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => { text += chunk; });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
  });
}

/**
 * Start a UHP loopback server on an ephemeral port that answers `POST /v1/responses` with the named
 * fixture, as JSON or as `text/event-stream` depending on the request's `stream` flag.
 *
 * It binds `127.0.0.1` and port `0`, so tests never collide with each other or with anything on the
 * host, and it requires no container runtime — there is none on this host to require.
 */
export async function startUhpMock(fixture: UhpResponse): Promise<UhpMock> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const body: unknown = JSON.parse((await read(req)) || "{}");
      const wantsStream = typeof body === "object" && body !== null
        && (body as { stream?: unknown }).stream === true;
      if (req.method !== "POST" || req.url !== "/v1/responses") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "not_found" } }));
        return;
      }
      if (wantsStream) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        res.end(encodeUhpStream(fixture));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(fixture));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    async post(payload) {
      const encoded = JSON.stringify(payload);
      const raw = await new Promise<{ text: string; contentType: string }>((resolve, reject) => {
        const req = httpRequest(
          `${origin}/v1/responses`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(encoded),
              // A real deployment sends `Authorization: Bearer <token>`. The mock never reads one,
              // and this repository is public, so no credential appears here or in any fixture.
            },
          },
          (res) => {
            void read(res).then((text) =>
              resolve({ text, contentType: String(res.headers["content-type"] ?? "") })
            ).catch(reject);
          },
        );
        req.on("error", reject);
        req.end(encoded);
      });
      if (raw.contentType.startsWith("text/event-stream")) return decodeUhpStream(raw.text);
      return JSON.parse(raw.text) as UhpResponse;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
