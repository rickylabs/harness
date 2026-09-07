/**
 * The label vocabulary this projector acts on, declared as data so something outside it can check.
 *
 * `type:epic` sat in `project.ts` for the life of the file, as one of two alternatives in the
 * predicate deciding whether an issue is an epic. It never once evaluated true: the label does not
 * exist and `dsh-forge`'s taxonomy has never created it (#202, fixed in #232). Nothing could have
 * caught it. Types cannot — `labels.includes("type:epic")` is as well-typed as
 * `labels.includes("epic")`. Tests did not, and worse: a fixture manufactured the label, so the
 * dead branch had a passing test standing behind data that cannot occur. `labels plan` could not
 * either — it compares the taxonomy against the *repository*, which gives it no view of what the
 * code reads, so a label the code branches on and neither side has is invisible to it in both
 * directions.
 *
 * The drift nothing measured is a whole direction: the set of labels the code reads against the
 * set the taxonomy creates. {@link LABEL_USES} is this side of that comparison. The other side is
 * `dsh-forge`'s taxonomy, and `scripts/check-label-registry.mjs` is the only place that can see
 * both — `board` must not depend on `forge`, since the projector is meant to be pointed at
 * repositories that were never forged.
 *
 * Every entry is built from the constant the projector actually branches on, never from a copy of
 * it. A registry that restates the code is a second thing to keep in step, and it drifts the first
 * time somebody edits one of the two — which is the bug this file is against, not the fix.
 *
 * The registry answers one more question that previously took grepping and knowing what to grep
 * for: which labels does this system act on at all.
 */

/** The default urgency ordering; unlisted priorities sort after all listed ones. */
export const DEFAULT_PRIORITY_ORDER = ["p0", "p1", "p2", "p3"] as const;

/** Label families where a second value on one item is a contradiction, not extra information. */
export const SINGLE_VALUE_FAMILIES = ["epic", "priority", "type"] as const;

/**
 * The family whose values {@link DEFAULT_PRIORITY_ORDER} enumerates.
 *
 * Typed as a member of {@link SINGLE_VALUE_FAMILIES} rather than as a bare string, so renaming the
 * family in one of the two places stops compiling instead of quietly producing a registry entry
 * for a family nothing reads.
 */
const PRIORITY_FAMILY: (typeof SINGLE_VALUE_FAMILIES)[number] = "priority";

/**
 * The lane family's prefix when the caller does not name one.
 *
 * A default and not a fact: `dsh-forge` detects `orchestrator:`, `topic:` or `lane:` and keeps
 * whichever prefix the repository already uses, so a repo on `topic:` is not in violation of
 * anything. What the check can insist on is that the *default* is a prefix the taxonomy can create.
 */
export const DEFAULT_LANE_PREFIX = "lane";

/**
 * The bare label that marks an issue as an epic.
 *
 * Exported because two packages have to agree on it. `forge` derives the `epic:<slug>` family by
 * searching GitHub for epics, and when the two packages each held their own literal they disagreed:
 * `project.ts` accepted `{epic, type:epic}` and `detect.ts` searched `{epic, type:umbrella}`, so an
 * item labelled one way and not the other was an epic to one package and a child to the other (#202).
 * One exported constant is the whole fix; the alternative is two literals that agree until someone
 * edits one.
 *
 * That it is spelled the same as the `epic:` family is a coincidence of naming and not a shared
 * thing. This is a bare flag; `epic:<slug>` is a family whose values group tasks under a parent.
 * The taxonomy files them apart for the same reason — see the note on `epic` in `FLAG_LABELS`.
 */
export const EPIC_LABEL = "epic";

/** How the projector uses a literal, which decides what the taxonomy has to provide for it. */
export type LabelUseKind =
  /** A whole label name, compared for equality. The taxonomy must create exactly this label. */
  | "name"
  /** A family prefix. The projector reads whatever value follows the `:`. */
  | "family"
  /** One value of a family, named because what the projector does depends on which value it is. */
  | "value";

/** One label literal the projector branches on, and everything a failure needs to say about it. */
export interface LabelUse {
  readonly kind: LabelUseKind;
  /** The literal itself: a label name, a family prefix, or a value within a family. */
  readonly literal: string;
  /** For a `value`, the family it has to appear under. Null for the other two kinds. */
  readonly family: string | null;
  /**
   * The file that branches on it — a path, deliberately without a line number. A line in a message
   * that is only ever read when the check fails is a number nobody notices going stale.
   */
  readonly site: string;
  /** What the projector does with it, in one line. This is the whole context a failure gets. */
  readonly reads: string;
  /**
   * True when a repository may rename this family, so the literal is this package's default rather
   * than a claim about every repository.
   */
  readonly configurable?: boolean;
}

const PROJECT = "packages/board/src/project.ts";

/** Why the projector reads each single-value family. Typed so a new family cannot arrive silently. */
const FAMILY_READS: Readonly<Record<(typeof SINGLE_VALUE_FAMILIES)[number], string>> = {
  epic: "groups a task under the epic that owns it; an unclaimed slug is reported, never guessed",
  priority: "orders items within a column",
  type: "reported on the item; two of them is a contradiction rather than extra information",
};

/**
 * Every label literal the projection decides on.
 *
 * Declaring a `value` is a claim that the family is *enumerated* — that these are all the values
 * this code knows how to act on. The check reads it that way in both directions, so a taxonomy
 * priority nobody listed here is a failure too: it would not fail loudly at runtime, it would sort
 * quietly to the end of every column, which is the same shape of silence as a dead branch.
 */
export const LABEL_USES: readonly LabelUse[] = [
  {
    kind: "name",
    literal: EPIC_LABEL,
    family: null,
    site: PROJECT,
    reads: "the marker that makes an issue an epic, and the only one; nothing else marks a parent",
  },
  ...SINGLE_VALUE_FAMILIES.map(
    (family): LabelUse => ({
      kind: "family",
      literal: family,
      family: null,
      site: PROJECT,
      reads: FAMILY_READS[family],
    }),
  ),
  {
    kind: "family",
    literal: DEFAULT_LANE_PREFIX,
    family: null,
    site: PROJECT,
    reads: "names the lane that owns an item; the prefix is per-repository and this is the default",
    configurable: true,
  },
  ...DEFAULT_PRIORITY_ORDER.map(
    (value): LabelUse => ({
      kind: "value",
      literal: value,
      family: PRIORITY_FAMILY,
      site: PROJECT,
      reads: `rank ${DEFAULT_PRIORITY_ORDER.indexOf(value)} of the urgency ordering items sort by`,
    }),
  ),
];

/** The families {@link LABEL_USES} claims to enumerate — those with at least one `value` entry. */
export const ENUMERATED_FAMILIES: readonly string[] = [
  ...new Set(
    LABEL_USES.filter((use) => use.kind === "value" && use.family !== null).map(
      (use) => use.family as string,
    ),
  ),
];
