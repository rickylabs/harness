/**
 * The command surface: `POST /api/*`.
 *
 * Reads arrive over the event stream; this is the half that changes something. Three commands —
 * ask for the whole state, dispatch an agent, settle an approval — and every one of them is a POST,
 * including `snapshot`, which is a read. A GET is retried by proxies, browsers and phones on a
 * hunch, and keeping one method for the whole surface removes a class of "why did this run twice"
 * before it can exist.
 *
 * ## Dispatch names a lane, never a model
 *
 * A cockpit says "do docs polish on #79". It does not say "run Fable at medium effort". Routing owns
 * that table, including the fallback chain, the effort escalations that are permitted and the rule
 * that an evaluator may not be the author. A client that could name a model could route around every
 * one of those rules by accident, from a phone, with no reviewer — and the invariants are structural
 * precisely so that they cannot be talked around.
 *
 * This also means a routing change reaches every cockpit with no client release.
 *
 * ## Every mutating command carries an idempotency key
 *
 * The client is a phone on a flaky link. It will retry a POST it never saw the response to, and a
 * retried dispatch spends real quota on a duplicate agent. The key is required rather than optional
 * because an optional safety property is one that is absent exactly when someone was in a hurry.
 */

import type { LaunchIdentity } from "./runs.js";
import type { PendingApproval, ApprovalVerdict, ApprovalResolution } from "./governance.js";
import type { RemoteSnapshot } from "./snapshot.js";

/** Every command path begins here. */
export const API_PREFIX = "/api" as const;

/** The one method. See the file header. */
export const COMMAND_METHOD = "POST" as const;

export const COMMANDS = ["snapshot", "dispatch", "approve"] as const;
export type CommandName = (typeof COMMANDS)[number];

/** Path for each command, spelled out so a reader can grep for the literal a client will send. */
export const COMMAND_PATHS = {
  snapshot: "/api/snapshot",
  dispatch: "/api/dispatch",
  approve: "/api/approve",
} as const satisfies Record<CommandName, string>;

/** The path a command is posted to. */
export function commandPath(name: CommandName): (typeof COMMAND_PATHS)[CommandName] {
  return COMMAND_PATHS[name];
}

/**
 * Why the client is asking for a full snapshot.
 *
 * Not needed to serve the request — the server's answer is the same either way — and carried anyway
 * because it is the only signal distinguishing a client that reconnected cleanly from one that is
 * asking again because it detected a gap in the sequence. The second is a bug somewhere, and it is
 * invisible without this field.
 */
export type SnapshotReason = "cold-start" | "reconnect" | "manual" | "gap";

export interface SnapshotCommand {
  readonly reason?: SnapshotReason;
}

/**
 * Dispatch an agent onto an issue.
 *
 * `prompt` travels one way. It is the operator's instruction to the agent, it goes to the
 * coordinator, and nothing in this contract carries it back out — see the asymmetry note in
 * `index.ts`.
 */
export interface DispatchCommand {
  /** The issue to work on. */
  readonly item: number;
  /** The lane, from the routing table. Not a model. See the file header. */
  readonly lane: string;
  readonly prompt: string;
  /** Optional cap in milliseconds; the coordinator's default applies when absent. */
  readonly timeout?: number;
  /** Required. A retry of the same request must not launch a second agent. */
  readonly idempotencyKey: string;
}

/**
 * The result of asking.
 *
 * `accepted: true` means **admitted**, not launched. The dispatcher polls on its own interval and
 * an agent typically starts something like half a minute later; a client that renders acceptance as
 * "running" shows an agent that does not exist yet, and if the pickup fails it shows one that never
 * will. The launch arrives as a `run.upserted` event, which is the only thing that means running.
 *
 * `runId` is therefore optional: it is present when the coordinator allocated an id at admission
 * time and absent when the id will only exist once the agent starts.
 */
export type DispatchOutcome =
  | {
      readonly accepted: true;
      readonly runId: string | null;
      readonly item: number;
      /** What routing resolved the lane to, so the operator can see what they authorised. */
      readonly identity: LaunchIdentity;
      readonly at: string;
    }
  | {
      readonly accepted: false;
      /** A short machine-ish reason, e.g. `quota-paused`, `lane-unknown`, `needs-approval`. */
      readonly reason: string;
      /** Written to be read by a person. */
      readonly detail: string;
      /** Present when a human decision would unblock this. Answer it with the `approve` command. */
      readonly approval?: PendingApproval;
    };

export interface ApprovalCommand {
  readonly id: string;
  readonly verdict: ApprovalVerdict;
  /** Optional note recorded with the decision. */
  readonly reason?: string;
  /** Required, for the same reason as on dispatch: two taps must not settle two ways. */
  readonly idempotencyKey: string;
}

/**
 * The result of settling an approval.
 *
 * `alreadySettled` is true when the decision had already been made — by another cockpit, by a
 * timeout, or by this same client's earlier attempt. The response still reports the verdict that
 * stands, so a retry converges instead of erroring, and a client that lost the first response learns
 * what actually happened rather than being told it failed.
 */
export interface ApprovalOutcome extends ApprovalResolution {
  readonly alreadySettled: boolean;
}

/**
 * Why a command failed.
 *
 * Closed, because each code selects a different client behaviour — re-authenticate, resync, give
 * up, retry — and an unrecognised code has no safe default. `retryable` carries the server's own
 * judgement so a client does not have to encode the table twice.
 *
 * `protocol-mismatch` is the one worth naming: it means the client was built against a version of
 * this contract the server will not serve, and the only cure is a client update. Reporting that as
 * `malformed` sends a developer looking for a bug in a payload that is correct.
 */
export const COMMAND_ERROR_CODES = [
  "unauthorized",
  "not-found",
  "malformed",
  "unavailable",
  "internal",
  "protocol-mismatch",
] as const;
export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export interface CommandError {
  readonly error: CommandErrorCode;
  readonly detail: string;
  readonly retryable: boolean;
}

/**
 * The request and response type of each command, in one place.
 *
 * Written as a map rather than as three pairs of exported aliases so that a client's transport can
 * be a single generic function — `post<N extends CommandName>(name: N, body: CommandRequest<N>)` —
 * instead of three hand-written wrappers that can drift from each other.
 */
export interface CommandTypes {
  readonly snapshot: { readonly request: SnapshotCommand; readonly response: RemoteSnapshot };
  readonly dispatch: { readonly request: DispatchCommand; readonly response: DispatchOutcome };
  readonly approve: { readonly request: ApprovalCommand; readonly response: ApprovalOutcome };
}

export type CommandRequest<N extends CommandName> = CommandTypes[N]["request"];
export type CommandResponse<N extends CommandName> = CommandTypes[N]["response"];
