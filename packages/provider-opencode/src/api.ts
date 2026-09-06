/**
 * The `opencode serve` HTTP surface this package uses, as paths, request bodies and checked readers.
 *
 * Six endpoints, and the shape of each one is a claim about somebody else's server:
 *
 * | call | endpoint | reply |
 * | --- | --- | --- |
 * | create a session | `POST /session` | the session object, whose `id` is our external handle |
 * | start the agent | `POST /session/:id/prompt_async` | `204`, no body |
 * | interject | `POST /session/:id/prompt_async` | `204`, no body |
 * | end the run | `POST /session/:id/abort` | a bare `true`/`false` |
 * | drop an unused session | `DELETE /session/:id` | a bare `true`/`false` |
 * | watch everything | `GET /event` | an endless `text/event-stream` |
 *
 * ## Two calls, and why that matters more here than anywhere else
 *
 * Creating the session and starting the agent are separate requests. `provider-claude` launches in
 * one act, so a launch it did not see the end of leaves it with no handle at all — its `unknown` is
 * blind. Here the handle exists *before* the agent does. A prompt whose reply is lost leaves a run
 * this provider can still observe, steer and stop, because the session id came back from the call
 * before it. That is the single largest behavioural difference between the two providers, and it is
 * a property of the vendor's API rather than of anything this package does.
 *
 * It also decides the verdicts. A failed `POST /session` means no prompt was ever sent, so nothing
 * is running — while a failed prompt means an agent may be working right now.
 *
 * ## Nothing is read by property access
 *
 * The endpoint set comes from the vendor's own HTTP documentation. The reply *shapes* are a guess
 * until #49 can put a real `opencode serve` in front of them, so every field the provider needs
 * comes out of a reader here that checks the shape at runtime and returns `null` when the reply is
 * not what it was assumed to be. `null` becomes a `malformed` outcome, which becomes `unknown` —
 * a state the contract has a meaning for — instead of a `TypeError` in a background loop.
 */

/** A record with unknown values — the widest thing a reader can safely index. */
type Bag = Readonly<Record<string, unknown>>;

export function bagOf(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

export function stringAt(bag: Bag, key: string): string | null {
  const value = bag[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * A path segment, escaped.
 *
 * A session id is the server's to choose, and an id containing a `/` would silently address a
 * different endpoint — `POST /session/a/b/abort` is not `abort` on session `a/b`. Escaping it here
 * means no caller has to remember to.
 */
export function segment(value: string): string {
  return encodeURIComponent(value);
}

/** Every path this package requests. Built rather than interpolated at the call sites. */
export const PATHS = {
  sessions: "/session",
  session: (id: string): string => `/session/${segment(id)}`,
  prompt: (id: string): string => `/session/${segment(id)}/prompt_async`,
  abort: (id: string): string => `/session/${segment(id)}/abort`,
  events: "/event",
  health: "/global/health",
} as const;

/** The model an opencode run is asked for: a provider and an id within it. */
export interface WireModel {
  readonly providerID: string;
  readonly modelID: string;
}

export interface PromptBody {
  readonly model: WireModel;
  readonly parts: readonly { readonly type: "text"; readonly text: string }[];
  readonly agent?: string;
}

/**
 * The body a prompt travels as.
 *
 * The one shape in this file we *construct* rather than read, and therefore the one a wrong guess
 * breaks quietly: a body the server rejects comes back as an HTTP status, which is loud — but a body
 * it accepts while ignoring a field is not. `agent` is the field that could do that, so it is only
 * ever present when a deployment asked for one.
 */
export function promptBody(model: WireModel, text: string, agent: string | null): PromptBody {
  return {
    model,
    parts: [{ type: "text", text }],
    ...(agent === null ? {} : { agent }),
  };
}

/** The title a new session is created with. Carries the run id and never the prompt. */
export function sessionBody(title: string): { readonly title: string } {
  return { title };
}

/**
 * The session id out of a `POST /session` reply.
 *
 * Probed at the top level and one level in, because a reply that wraps the session in `info` or
 * `session` is the ordinary way an HTTP API grows an envelope, and either spelling means the same
 * thing to us. A reply with no id anywhere is `null`, which is the honest answer: we have no handle.
 *
 * `session` and `data` are probed alongside `info` because those are the other two names an HTTP
 * reply grows an envelope under, and either spelling would otherwise cost a working dispatch.
 */
export function readSessionId(body: unknown): string | null {
  const bag = bagOf(body);
  if (bag === null) return null;
  const direct = stringAt(bag, "id");
  if (direct !== null) return direct;
  for (const key of ["info", "session", "data"]) {
    const nested = bagOf(bag[key]);
    if (nested === null) continue;
    const id = stringAt(nested, "id");
    if (id !== null) return id;
  }
  return null;
}

/**
 * A bare boolean reply, as `abort` sends.
 *
 * `null` for anything else, including for an object that merely contains a boolean — guessing which
 * field of `{ ok: true, aborted: false }` was meant is how a run gets reported stopped while it is
 * still working.
 */
export function readBoolean(body: unknown): boolean | null {
  return typeof body === "boolean" ? body : null;
}

export interface Health {
  readonly healthy: boolean;
  readonly version: string | null;
}

/** `GET /global/health`, for a deployment that wants to check the server before registering. */
export function readHealth(body: unknown): Health | null {
  const bag = bagOf(body);
  if (bag === null) return null;
  if (typeof bag["healthy"] !== "boolean") return null;
  return { healthy: bag["healthy"], version: stringAt(bag, "version") };
}
