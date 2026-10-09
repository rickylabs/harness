/**
 * Test support: a `fetch` that answers from one recorded `opencode serve` session.
 *
 * `recorded-session.json` holds real 1.18.35 replies (its `provenance` field says how they were taken
 * and what was scrubbed). Paths absent from it answer `404`, as the server does for an unknown id. Not
 * a test file, so the runner does not collect it.
 */

import { readFileSync } from "node:fs";

import { record, respond, type Recorded, type Reply } from "./fake-fetch.js";

export interface Recording {
  readonly rootID: string;
  readonly childID: string;
  readonly unknownID: string;
  readonly replies: Readonly<Record<string, { readonly status: number; readonly body: unknown }>>;
  readonly events: readonly unknown[];
}

// From dist/tests/fixtures/ back to the source tree: JSON is read, never compiled.
export const recording = JSON.parse(readFileSync(new URL("../../../tests/fixtures/recorded-session.json", import.meta.url), "utf8")) as Recording;

/** Serve the recording; `override` may answer a path differently. Every request is recorded. */
export function recordedFetch(override: (path: string) => Reply | Response | undefined = () => undefined) {
  const calls: Recorded[] = [], urls: URL[] = [];
  const fetch = (async (request: Request): Promise<Response> => {
    calls.push(await record(request)); urls.push(new URL(request.url));
    // As a real fetch does: an aborted request never reaches the server.
    if (request.signal.aborted) throw request.signal.reason;
    const path = new URL(request.url).pathname;
    const replaced = override(path);
    if (replaced !== undefined) return replaced instanceof Response ? replaced : respond(replaced);
    const reply = recording.replies[path];
    return respond(reply === undefined
      ? { status: 404, json: { name: "NotFoundError", data: { message: "Session not found" } } }
      : { status: reply.status, json: reply.body });
  }) as typeof globalThis.fetch;
  return { fetch, calls, urls };
}
