/**
 * Whether a node is alive, and on what evidence.
 *
 * The rule this module exists to enforce, stated on #85 and worth quoting because everything below
 * is a consequence of it: **liveness is not progress — a node is green on a growing artifact, a new
 * commit or a live turn, never on an open socket.**
 *
 * An open socket is the tempting signal. It is cheap, it is real-time, and it is what every process
 * supervisor uses. It is also the signal that produced the problem this repository exists to solve:
 * a coordinator that answers "yes, it's running" because a session is attached, on a board where
 * nothing has moved for six hours. A held connection says a process has not exited. It says nothing
 * about work.
 *
 * So the only inputs here are timestamps on things that grew:
 *
 * - `turn` — a transcript gained a turn. The strongest evidence, because a turn is a unit of work.
 * - `item` — GitHub recorded a change to the issue or pull request. Weaker, and honestly so: it
 *   moves on a pushed commit and equally on a label edit, so it says the artifact changed without
 *   saying what changed it.
 *
 * A claim of "still running" is carried through as `claimsRunning`, and it can only ever make a
 * node *worse*: it turns quiet into `stalled`. It can never make one green. That asymmetry is the
 * rule above, encoded — a run that says it is running and has not produced a turn in six hours is
 * the single most useful thing a status screen can point at, and the one thing an open-socket check
 * reports as healthy.
 */

/** What grew. `none` when nothing did, which is not the same as something that grew long ago. */
export type LivenessEvidence = "turn" | "item" | "none";

/**
 * How alive a node is.
 *
 * Four states rather than a boolean, because "not green" collapses two opposite situations: work
 * that finished and work that is wedged. `quiet` is a board at rest. `stalled` is a page to open.
 */
export type LivenessState = "live" | "recent" | "stalled" | "quiet";

/** The boundaries between the states, in milliseconds. Passed in so tests do not sleep. */
export interface LivenessWindows {
  /** Newer than this and the node is `live`. */
  readonly liveMs: number;
  /** Newer than this and the node is at least `recent`. */
  readonly recentMs: number;
}

/**
 * Fifteen minutes and a day.
 *
 * The live window is a model's turn plus its tool calls plus the slack a queued dispatch adds —
 * short enough that `live` means "look at it now", long enough that a thinking agent does not blink
 * out. The recent window is a working day, because the question a day-old node answers is "did
 * anything happen while I was asleep", which is the question that produced this package.
 */
export const DEFAULT_WINDOWS: LivenessWindows = {
  liveMs: 15 * 60 * 1000,
  recentMs: 24 * 60 * 60 * 1000,
};

/** One thing that grew, or claimed to be growing. */
export interface Evidence {
  /** When it grew. ISO 8601, or `null` when there is nothing to date. */
  readonly at: string | null;
  readonly kind: LivenessEvidence;
  /** True when something under this node says it is still running. Never makes a node green. */
  readonly claimsRunning: boolean;
}

/** A node's state, with the evidence that produced it named rather than implied. */
export interface Liveness {
  readonly state: LivenessState;
  readonly evidence: LivenessEvidence;
  /** The timestamp the verdict rests on. `null` when nothing datable was found. */
  readonly at: string | null;
  /** Age of that timestamp at `now`. `null` for the same reason `at` is. */
  readonly ageMs: number | null;
}

/**
 * Combine evidence into the single newest piece, keeping any running claim from any of it.
 *
 * The newest wins rather than the strongest kind, because the question is when something last
 * happened. A four-hour-old turn does not make a node more alive than a label edit two minutes ago;
 * it makes it a node whose most recent activity was a label edit, which is what the reader should
 * be told. `kind` carries that distinction so a reader can weigh it.
 */
export function newest(evidence: readonly Evidence[]): Evidence {
  let best: Evidence | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  let running = false;

  for (const item of evidence) {
    if (item.claimsRunning) running = true;
    if (item.at === null) continue;
    const ms = Date.parse(item.at);
    // An unparseable timestamp is not evidence of anything. Dropping it here rather than letting
    // NaN through is what keeps `Math.max` from poisoning the whole rollup.
    if (!Number.isFinite(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = item;
  }

  if (best === null) return { at: null, kind: "none", claimsRunning: running };
  return { at: best.at, kind: best.kind, claimsRunning: running };
}

/**
 * Turn evidence into a state.
 *
 * Read the branches in order and the rule is visible: freshness is the only route to `live`, and
 * `claimsRunning` is consulted only after that route has already failed.
 */
export function classify(
  evidence: Evidence,
  now: string,
  windows: LivenessWindows = DEFAULT_WINDOWS,
): Liveness {
  const nowMs = Date.parse(now);
  const atMs = evidence.at === null ? Number.NaN : Date.parse(evidence.at);
  const datable = Number.isFinite(nowMs) && Number.isFinite(atMs);

  if (!datable) {
    // Nothing to date. A running claim still earns `stalled`: something says it is working and
    // cannot show a single turn for it, which is precisely the case worth surfacing.
    //
    // The evidence kind is reported as `none` whatever the caller passed, because an undatable
    // timestamp is not weaker evidence of a turn — it is no evidence at all, and a node reading
    // `quiet (turn)` would claim a turn was seen.
    return { state: evidence.claimsRunning ? "stalled" : "quiet", evidence: "none", at: null, ageMs: null };
  }

  // Clamped at zero: a transcript written by a box whose clock is ahead is a common and harmless
  // condition, and a negative age would render as a node updated in the future.
  const ageMs = Math.max(0, nowMs - atMs);
  const state: LivenessState =
    ageMs <= windows.liveMs
      ? "live"
      : evidence.claimsRunning
        ? "stalled"
        : ageMs <= windows.recentMs
          ? "recent"
          : "quiet";

  return { state, evidence: evidence.kind, at: evidence.at, ageMs };
}

/** Combine and classify in one step, which is what every caller in `tree.ts` wants. */
export function liveness(
  evidence: readonly Evidence[],
  now: string,
  windows: LivenessWindows = DEFAULT_WINDOWS,
): Liveness {
  return classify(newest(evidence), now, windows);
}
