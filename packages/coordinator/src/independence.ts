/**
 * Evaluator independence, as a decision rather than a convention.
 *
 * `doctrine/WORKFLOW.md` says independent evaluation stages "use a model that did not author the
 * artifact under review". That sentence is advisory: it is addressed to whoever is reading, and
 * whoever is reading is usually the author. An author checking whether they are allowed to review
 * their own work, under time pressure, with the only other candidate rate-limited, is not a gate —
 * it is a temptation with a paragraph attached.
 *
 * This module turns it into a function. Given who authored something and a roster of candidates, it
 * returns either a named evaluator with the reason it was legal, or a **blocker**. There is no third
 * outcome, and in particular there is no degraded outcome: a roster with no legal evaluator produces
 * a blocker, never permission for same-family review. That is the property the whole gate rests on,
 * because the moment scarcity can soften the rule, the rule only binds when it costs nothing.
 *
 * Two design commitments are worth stating because they are what keep this portable.
 *
 * **Nothing here knows a vendor's name.** `family` is an opaque string that is compared and never
 * interpreted, and "is this an open-weights model" is a boolean the roster carries rather than
 * something inferred from a model id. Model ids and their families slide — they are renamed,
 * deprecated and re-tiered — and a rule that has to be edited whenever a vendor ships is a rule
 * that will be out of date at the moment it matters. The routing layer owns those facts; this
 * module owns the rule about them.
 *
 * **The choice does not depend on the order the roster was written in.** Candidates are ranked by a
 * total order derived from their own fields, so the same roster in a different sequence yields the
 * same evaluator. That is the first half of #71: a decision that is stable under a shuffle is a
 * decision that can be replayed.
 */

/**
 * Which metering regime a run is paid for out of.
 *
 * A closed pair on purpose: the two seams are the architecture (#33 and #34), not vendor trivia.
 * `subscription` runs are already bought and are metered by a **quota window** that can be
 * exhausted; `relay` runs are metered **per token** and cost money at the moment they are made.
 * The distinction is why the selection below prefers to stay on the author's seam.
 */
export type Seam = "subscription" | "relay";

/** Who authored the artifact under review, or who might be asked to review it. */
export interface Actor {
  /**
   * The session or run this actor is. Compared for identity, so it must be the real launch id and
   * not a lane name — two runs of the same lane are two evaluators, and one run is never two.
   */
  readonly id: string;
  readonly seam: Seam;
  /**
   * The vendor family, as an opaque token. Compared for equality and never parsed: `"anthropic"`,
   * `"openai"` and `"open"` are what this repository happens to use, and nothing here depends on
   * that being the list.
   */
  readonly family: string;
  /** The model id, carried for the record and for a stable tie-break. Never interpreted. */
  readonly model: string;
  /** The effort tier, where the seam records one. `null` is an honest "not stated". */
  readonly effort: string | null;
}

export interface Candidate extends Actor {
  /**
   * Whether this candidate runs an open-weights model.
   *
   * Declared by the roster rather than derived, because deriving it means reading a model id, and
   * reading a model id means keeping a vendor table here. The relay seam reaches a public router,
   * which is why the policy below can insist that anything reviewing over it be open-weights.
   */
  readonly openWeights: boolean;
  /**
   * Why this candidate cannot run right now, or `null`. Governance's answer, quoted, not ours —
   * an exhausted quota window, a stopped backend, a host under pressure.
   */
  readonly blockedBy: string | null;
}

/**
 * Why a candidate was not chosen. One id per rule so a caller can count them without parsing prose.
 *
 * `not-preferred` is the odd one and the reason the list is worth keeping: it marks a candidate that
 * was **legal** and simply ranked lower. Without it, a record of a roster with three legal
 * evaluators is indistinguishable from a record of a roster with one, and "there was no alternative"
 * is exactly the claim a reader most needs to be able to check.
 */
export type RuleId =
  | "same-session"
  | "same-family"
  | "same-seam-and-family"
  | "relay-not-open"
  | "unavailable"
  | "not-preferred";

export interface Rejection {
  /** The candidate's `id`, so a rejection can be joined back to the roster it came from. */
  readonly candidate: string;
  readonly rule: RuleId;
  readonly detail: string;
}

export interface IndependencePolicy {
  /** Named so the record says which rule was in force, not merely that some rule was. */
  readonly name: string;
  /**
   * Require a different **family**, not merely a different seam.
   *
   * The weaker form is #72's stated floor — "a different seam or vendor family". The stronger form
   * is what the lane policy actually runs: opposite-family review is never traded away, because two
   * runs of the same family share training, tokenizer and failure modes, and an evaluator that
   * shares the author's blind spot is a rubber stamp with a different session id.
   */
  readonly requireDifferentFamily: boolean;
  /** An evaluator reached over the relay seam must be open-weights. */
  readonly relayMustBeOpen: boolean;
}

/** #72's stated floor: a different seam *or* a different family is enough. */
export const SEAM_OR_FAMILY: IndependencePolicy = {
  name: "seam-or-family",
  requireDifferentFamily: false,
  relayMustBeOpen: true,
};

/** The rule the lane policy runs, and the default here: the family must differ. */
export const OPPOSITE_FAMILY: IndependencePolicy = {
  name: "opposite-family",
  requireDifferentFamily: true,
  relayMustBeOpen: true,
};

export interface SelectedEvaluator {
  readonly kind: "selected";
  readonly policy: string;
  readonly author: Actor;
  readonly evaluator: Candidate;
  /** Why this one, in a sentence a reviewer can check against the roster. */
  readonly because: string;
  readonly rejected: readonly Rejection[];
}

export interface BlockedEvaluator {
  readonly kind: "blocked";
  readonly policy: string;
  readonly author: Actor;
  readonly because: string;
  /**
   * Whether waiting could fix it.
   *
   * `true` means some candidate was structurally legal and merely unavailable — a quota window, a
   * stopped backend. `false` means no candidate could ever have been legal under this policy, which
   * is a roster problem and will still be a roster problem in an hour. Conflating the two produces
   * a coordinator that retries forever against a fleet that can never satisfy it.
   */
  readonly transient: boolean;
  readonly rejected: readonly Rejection[];
}

export type EvaluatorDecision = SelectedEvaluator | BlockedEvaluator;

/**
 * Apply the rules to one candidate, in a fixed order, and stop at the first that rejects it.
 *
 * Structural rules run **before** availability, deliberately. A candidate that is both same-family
 * and rate-limited is not "nearly legal, try later": it is illegal, permanently, and reporting the
 * transient reason would send the coordinator back to wait for a candidate it must never use.
 */
function reject(author: Actor, c: Candidate, policy: IndependencePolicy): Rejection | null {
  if (c.id === author.id) {
    return {
      candidate: c.id,
      rule: "same-session",
      detail: "this is the authoring session — a generator never evaluates itself",
    };
  }
  if (policy.requireDifferentFamily) {
    if (c.family === author.family) {
      return {
        candidate: c.id,
        rule: "same-family",
        detail: `same family as the author (${author.family}) — shares its blind spot`,
      };
    }
  } else if (c.family === author.family && c.seam === author.seam) {
    return {
      candidate: c.id,
      rule: "same-seam-and-family",
      detail: `same seam (${author.seam}) and same family (${author.family}) as the author`,
    };
  }
  if (policy.relayMustBeOpen && c.seam === "relay" && !c.openWeights) {
    return {
      candidate: c.id,
      rule: "relay-not-open",
      detail: "reached over the relay seam but is not open-weights",
    };
  }
  if (c.blockedBy !== null) {
    return { candidate: c.id, rule: "unavailable", detail: c.blockedBy };
  }
  return null;
}

/**
 * The preference order among legal candidates.
 *
 * The author's own seam comes **first**, which looks backwards until you price it. Moving to the
 * other seam to gain independence usually means moving from a subscription window that is already
 * bought to a relay that bills per token — an escalation nobody asked for, made silently, on every
 * review. Family independence is the property that must not be traded away; seam variety is not,
 * and buying it with the owner's money by default is exactly the implicit escalation the harness
 * forbids. Everything after that is lexicographic, so the order is total and the roster's own
 * sequence cannot influence the answer.
 */
function key(author: Actor, c: Candidate): readonly [number, string, string, string] {
  return [c.seam === author.seam ? 0 : 1, c.family, c.model, c.id];
}

function before(a: readonly [number, string, string, string], b: readonly [number, string, string, string]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  if (a[2] !== b[2]) return a[2] < b[2];
  return a[3] < b[3];
}

/**
 * Choose an evaluator for `author` from `candidates`, or say why there is none.
 *
 * Pure, and total: every roster produces a decision, and **every** candidate that was not chosen
 * appears in `rejected` — the ones a rule excluded, and the ones that were legal but ranked lower.
 * That list is the citation, and principle 3 says a claim without a citation is not one.
 *
 * `rejected` is sorted by candidate rather than left in roster order, which makes the whole decision
 * a function of the roster as a *set*. Two callers that assembled the same fleet in a different
 * sequence produce byte-identical records, which is what a replay test can actually compare.
 */
export function selectEvaluator(
  author: Actor,
  candidates: readonly Candidate[],
  policy: IndependencePolicy = OPPOSITE_FAMILY,
): EvaluatorDecision {
  const rejected: Rejection[] = [];
  const legal: Candidate[] = [];
  let best: Candidate | null = null;
  let bestKey: readonly [number, string, string, string] | null = null;
  let blockedButLegal = 0;

  for (const c of candidates) {
    const problem = reject(author, c, policy);
    if (problem !== null) {
      if (problem.rule === "unavailable") blockedButLegal += 1;
      rejected.push(problem);
      continue;
    }
    legal.push(c);
    const k = key(author, c);
    if (bestKey === null || before(k, bestKey)) {
      best = c;
      bestKey = k;
    }
  }

  if (best !== null) {
    const chosen = best;
    for (const c of legal) {
      if (c.id === chosen.id) continue;
      rejected.push({
        candidate: c.id,
        rule: "not-preferred",
        detail:
          c.seam === chosen.seam
            ? `legal, but ${chosen.id} ranks first`
            : `legal, but ${chosen.id} keeps the review on the author's own ${chosen.seam} seam`,
      });
    }
  }

  rejected.sort((a, b) => (a.candidate === b.candidate ? a.rule.localeCompare(b.rule) : a.candidate < b.candidate ? -1 : 1));

  if (best === null) {
    const because =
      candidates.length === 0
        ? "the roster is empty — there is no evaluator to choose from"
        : blockedButLegal > 0
          ? `every legal evaluator is unavailable (${blockedButLegal} of ${candidates.length} were legal but could not run)`
          : `no candidate is independent of the author under ${policy.name} — this is a roster gap, not a wait`;
    return { kind: "blocked", policy: policy.name, author, because, transient: blockedButLegal > 0, rejected };
  }

  const sameSeam = best.seam === author.seam;
  const because = policy.requireDifferentFamily
    ? `${best.family} reviews ${author.family}${sameSeam ? ` on the author's own ${author.seam} seam, so independence costs nothing extra` : `, moving to the ${best.seam} seam because no same-seam candidate was legal`}`
    : `independent of the author by ${best.family === author.family ? "seam" : "family"}${sameSeam ? "" : ` (${best.seam})`}`;

  return { kind: "selected", policy: policy.name, author, evaluator: best, because, rejected };
}
