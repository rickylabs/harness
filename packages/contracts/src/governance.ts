/**
 * What the fleet is allowed to spend, and what is waiting on a human.
 *
 * ## Three regimes, not one number
 *
 * Capacity is not a scalar. A subscription is a percentage of a rolling window that refills on its
 * own clock; a metered API key is dollars that never come back; a local GPU is bytes that are
 * either free right now or not. They fail differently — a subscription runs out and resumes, a card
 * runs out and stops, a GPU that is oversubscribed does not stop but thrashes, serving every
 * request slowly instead of refusing any — and a cockpit that renders all three as one "capacity"
 * bar cannot tell the operator which of those is happening.
 *
 * So `RegimeStatus` is a discriminated union. A client that only knows how to draw a percentage
 * draws the subscription regime and says so, rather than inventing a percentage for a GPU.
 *
 * ## The governor fails open; the contract makes the failure visible
 *
 * The governor never blocks work because it could not read a meter — it only ever refuses new
 * admissions, never touches a run in flight, and when in doubt it allows. That is the right
 * behaviour and it has one bad consequence on a screen: "allowed" and "we could not check" look
 * identical.
 *
 * Every regime therefore carries `observedAt`, and an unread regime reports `state: "allow"` with
 * `observedAt: null` and a note saying why. It is never omitted. A missing regime is indistinguishable
 * from a regime that does not exist, and a green bar with no reading behind it is the most expensive
 * kind of wrong thing to show someone who is deciding whether to dispatch.
 */

/**
 * How spend is counted in a regime.
 *
 * `subscription` is a percentage of a rolling window, per account. `metered` is dollars per token.
 * `capacity` is bytes of VRAM and RAM on a host. Closed, because each value selects a different
 * renderer and a different unit; an unrecognised regime cannot be drawn at all.
 */
export const REGIMES = ["subscription", "metered", "capacity"] as const;
export type Regime = (typeof REGIMES)[number];

/**
 * What the governor is currently doing about a regime.
 *
 * `throttle` is the middle state that makes the other two useful: the governor paces admissions
 * against a linear burn target rather than running flat out until it hits a wall and stops. Without
 * it every window ends in a `pause`.
 */
export const REGIME_STATES = ["allow", "throttle", "pause"] as const;
export type RegimeState = (typeof REGIME_STATES)[number];

/**
 * One rolling window on a subscription account.
 *
 * Accounts have more than one window at a time — a short one and a long one — and they do not run
 * out together. `binding` marks the window currently deciding the account's state, because the
 * operator's question is never "what are all my windows" but "which one is about to stop me". A
 * five-hour window at 30% and a weekly window at 91% is an account that is nearly out, and only the
 * `binding` flag says so at a glance.
 */
export interface SubscriptionWindow {
  /** Human name for the window, e.g. `5h` or `weekly`. */
  readonly label: string;
  readonly windowMinutes: number;
  readonly usedPercent: number;
  readonly resetsAt: string | null;
  /** True for the window currently determining the account's state. */
  readonly binding: boolean;
}

/**
 * One subscription account under governance.
 *
 * `account` is a handle the operator recognises, never an address — see `ApprovalResolution.by`.
 * `seam` names which of the two seams the account is spent through, because the same vendor can be
 * reached as an autonomous CLI metered by window and as an API key metered per token, and those are
 * different budgets.
 */
export interface SubscriptionAccount {
  readonly seam: string;
  readonly account: string;
  readonly state: RegimeState;
  readonly windows: readonly SubscriptionWindow[];
  /** When the meters were last read, or `null` when they never were. */
  readonly observedAt: string | null;
}

/** Metered spend against a ceiling, in dollars, for one provider. */
export interface MeteredSpend {
  readonly provider: string;
  readonly spentUsd: number;
  /** The configured ceiling, or `null` when none is set — which is not the same as zero. */
  readonly ceilingUsd: number | null;
  readonly windowLabel: string;
  readonly observedAt: string | null;
}

/**
 * Local hardware headroom on one host.
 *
 * Bytes, not gigabytes. A contract does not pick a unit that loses precision on the way out and
 * forces every reader to guess whether 24 meant GiB or GB; a client formats for display, which is
 * a display decision.
 */
export interface CapacityReading {
  readonly host: string;
  readonly vramUsedBytes: number | null;
  readonly vramTotalBytes: number | null;
  readonly ramUsedBytes: number | null;
  readonly ramTotalBytes: number | null;
  readonly observedAt: string | null;
}

/**
 * The state of one regime.
 *
 * Discriminated on `regime`, so adding a fourth kind of budget is a new member rather than four more
 * optional fields on a shared shape, and a client that cannot draw it fails at the switch instead of
 * rendering an empty gauge.
 */
export type RegimeStatus =
  | {
      readonly regime: "subscription";
      readonly state: RegimeState;
      readonly accounts: readonly SubscriptionAccount[];
      readonly note: string | null;
    }
  | {
      readonly regime: "metered";
      readonly state: RegimeState;
      readonly providers: readonly MeteredSpend[];
      readonly note: string | null;
    }
  | {
      readonly regime: "capacity";
      readonly state: RegimeState;
      readonly hosts: readonly CapacityReading[];
      readonly note: string | null;
    };

/**
 * What a human is being asked to decide.
 *
 * Left open as a plain string rather than closed to today's four: an unrecognised kind is a prompt
 * to display, and a cockpit renders it from `summary` and offers the same two buttons. Refusing to
 * show an approval because its kind is new is how a fleet stalls waiting on a decision nobody was
 * shown.
 *
 * `KNOWN_APPROVAL_KINDS` is what exists today, for clients that want to render a familiar kind
 * specially.
 */
export const KNOWN_APPROVAL_KINDS = [
  "dispatch-admission",
  "paid-fallback",
  "close-gate-override",
  "worktree-removal",
] as const;
export type KnownApprovalKind = (typeof KNOWN_APPROVAL_KINDS)[number];

/**
 * One decision waiting on a person.
 *
 * `summary` is written to be read on a phone with no other context, because that is where it will
 * be read. It is the one place in this contract where prose crosses the wire outward, and it is
 * generated by the coordinator rather than copied from a prompt — see the privacy note in
 * `index.ts`.
 */
export interface PendingApproval {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  /** The issue this decision is about, when it is about one. */
  readonly item: number | null;
  /** The run this decision is about, when it is about one. */
  readonly runId: string | null;
  /** The budget this decision would spend from, when it would spend. */
  readonly regime: Regime | null;
  readonly requestedAt: string;
  /** When the request lapses. `null` means it waits indefinitely. */
  readonly expiresAt: string | null;
}

/** The two answers. Closed, and it stays closed: a third answer is a different command. */
export const APPROVAL_VERDICTS = ["approve", "deny"] as const;
export type ApprovalVerdict = (typeof APPROVAL_VERDICTS)[number];

/**
 * How a pending approval was settled.
 *
 * `by` is a handle — the name an operator recognises — and never an email or an account id. This
 * travels to every connected cockpit, and an audit trail that is also a directory of addresses is
 * a worse trade than it looks.
 */
export interface ApprovalResolution {
  readonly id: string;
  readonly verdict: ApprovalVerdict;
  readonly at: string;
  readonly by: string | null;
}

/**
 * Everything a cockpit needs to answer "may I dispatch, and what is waiting on me".
 *
 * `regimes` carries all three, always. `notes` holds anything the governor wants an operator to
 * read that is not attached to one regime.
 */
export interface GovernanceState {
  readonly generatedAt: string;
  readonly regimes: readonly RegimeStatus[];
  readonly pending: readonly PendingApproval[];
  readonly notes: readonly string[];
}
