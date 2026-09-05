/**
 * The portable label taxonomy.
 *
 * Ported from the taxonomy proven in `rickylabs/netscript`, split into the part that is true of
 * any repository and the part that has to be derived from the repository in front of you. Only
 * the first half lives here as literal data; the second half is produced by `detect.ts` from
 * evidence, because a copied `area:aspire` in a repo with no Aspire is exactly the kind of dead
 * label that teaches people to ignore labels.
 */

/** Namespace a label belongs to. The prefix before `:` for every family except `flag`. */
export type LabelFamily =
  | "type"
  | "status"
  | "priority"
  | "eval"
  | "gate"
  | "ci"
  | "area"
  | "epic"
  | "lane"
  | "wave"
  | "flag";

/** Where a label came from, which decides whether it is safe to propose everywhere. */
export type LabelOrigin =
  /** True of any repository; installed unconditionally. */
  | "core"
  /** Derived from evidence in the target repository; only proposed when that evidence exists. */
  | "detected";

export interface LabelSpec {
  readonly name: string;
  /** Six hex digits, no leading `#` — GitHub's wire format. */
  readonly color: string;
  readonly description: string;
  readonly family: LabelFamily;
  readonly origin: LabelOrigin;
  /**
   * Set on a label this taxonomy has retired, naming the label that replaced it.
   *
   * Retiring is not deleting, and the difference is the whole point. Deleting a label removes it
   * from every issue that ever carried it, so a label that recorded a decision takes the record
   * with it — the items it marked stop saying what happened to them, and nothing anywhere reports
   * that they used to. A retired label stays on the repository and stays on its items; it is only
   * never proposed for new work and never taught to agents. See {@link RETIRED_LABELS}.
   */
  readonly supersededBy?: string;
}

/**
 * The board phase machine. Exactly one of these may sit on an open issue or PR at a time: the
 * `status:` label *is* the board column, and two of them means the column is a lie.
 */
export const STATUS_LIFECYCLE = [
  "status:triage",
  "status:research",
  "status:plan",
  "status:plan-eval",
  "status:impl",
  "status:impl-eval",
  "status:augment-review",
  "status:ci-fail",
  "status:ready-merge",
] as const;

/** Terminal status. Replaces the phase label on a completed close; never coexists with one. */
export const STATUS_TERMINAL = "status:shipped" as const;

/**
 * The audited exception path for a red close gate.
 *
 * A flag rather than a status, because a status is the board column and this was never a column.
 * As `status:close-gate-override` it had to be either the item's only status — hiding whatever
 * phase the work was actually in — or a second one, which breaks the taxonomy's one hard rule on
 * exactly the items that most need to be readable. As a flag it is additive: the item keeps its
 * real phase and carries the exception alongside it.
 */
export const CLOSE_GATE_OVERRIDE = "flag:close-gate-override" as const;

/** What {@link CLOSE_GATE_OVERRIDE} was called before #100. Declared only so it can be retired. */
export const RETIRED_CLOSE_GATE_STATUS = "status:close-gate-override" as const;

const c = {
  type: "c5def5",
  umbrella: "5319e7",
  subPr: "0e8a16",
  phase: "fbca04",
  ready: "0e8a16",
  shipped: "5319e7",
  danger: "b60205",
  p1: "d93f0b",
  p3: "0e8a16",
  control: "d4c5f9",
  area: "bfdadc",
  wave: "c2e0c6",
  lane: "1d76db",
} as const;

const spec = (
  name: string,
  color: string,
  description: string,
  family: LabelFamily,
  origin: LabelOrigin = "core",
): LabelSpec => ({ name, color, description, family, origin });

/**
 * A label this taxonomy no longer stamps. The description is what the label should say on GitHub
 * *after* retirement — it is the only notice a person browsing the label list will ever get.
 */
const retired = (
  name: string,
  color: string,
  description: string,
  family: LabelFamily,
  supersededBy: string,
): LabelSpec => ({ name, color, description, family, origin: "core", supersededBy });

/** What kind of change this is. Additive, and every open issue and PR should carry one. */
export const TYPE_LABELS: readonly LabelSpec[] = [
  spec("type:feat", c.type, "New feature or capability", "type"),
  spec("type:fix", c.type, "Bug fix", "type"),
  spec("type:docs", c.type, "Documentation change", "type"),
  spec("type:chore", c.type, "Tooling, config, or housekeeping", "type"),
  spec("type:refactor", c.type, "Internal change with no behavior change", "type"),
  spec("type:perf", c.type, "Performance improvement", "type"),
  spec("type:test", c.type, "Tests only", "type"),
  spec("type:umbrella", c.umbrella, "Coordinating PR for a multi-slice effort", "type"),
  spec("type:sub-pr", c.subPr, "Stacked sub-PR (leaf of an umbrella)", "type"),
];

/** The board column. Exactly one at a time; see {@link STATUS_LIFECYCLE}. */
export const STATUS_LABELS: readonly LabelSpec[] = [
  spec("status:triage", c.phase, "Incoming; not yet triaged", "status"),
  spec("status:research", c.phase, "Harness research phase", "status"),
  spec("status:plan", c.phase, "Harness plan phase", "status"),
  spec("status:plan-eval", c.phase, "Awaiting plan evaluation", "status"),
  spec("status:impl", c.phase, "Implementation in progress", "status"),
  spec("status:impl-eval", c.phase, "Awaiting implementation evaluation (merge gate)", "status"),
  spec("status:augment-review", c.phase, "Advisory augment/review pass", "status"),
  spec("status:ci-fail", c.phase, "Blocked on a failing CI gate", "status"),
  spec("status:ready-merge", c.ready, "Green and cleared to merge", "status"),
  spec(STATUS_TERMINAL, c.shipped, "Terminal: replaces the phase label when completed work closes", "status"),
];

export const PRIORITY_LABELS: readonly LabelSpec[] = [
  spec("priority:p0", c.danger, "Critical / release blocker", "priority"),
  spec("priority:p1", c.p1, "High", "priority"),
  spec("priority:p2", c.phase, "Medium", "priority"),
  spec("priority:p3", c.p3, "Low / nice-to-have", "priority"),
];

/**
 * Evaluator controls. These are the labels that make routing decisions *data on the issue* rather
 * than prose in a brief — the surface a dispatcher can actually read.
 */
export const EVAL_LABELS: readonly LabelSpec[] = [
  spec("eval:skip", c.control, "Skip the automatic phase evaluation, with attributed evidence in the PR", "eval"),
  spec("eval:third-opinion", c.control, "Request an extra evaluator beyond the opposite-family default", "eval"),
];

/** Cross-cutting, and additive: a flag never decides which column an item is in. */
export const FLAG_LABELS: readonly LabelSpec[] = [
  spec("rfc", c.umbrella, "Request for Comments — substantial or breaking design change", "flag"),
  spec("breaking", c.danger, "Introduces a breaking change", "flag"),
  spec(CLOSE_GATE_OVERRIDE, c.danger, "Audited exception to the closing-keyword acceptance gate", "flag"),
];

/**
 * The unconditional set: installed into any repository, because none of it names anything
 * repo-specific.
 */
export const CORE_TAXONOMY: readonly LabelSpec[] = [
  ...TYPE_LABELS,
  ...STATUS_LABELS,
  ...PRIORITY_LABELS,
  ...EVAL_LABELS,
  ...FLAG_LABELS,
];

/**
 * Labels this taxonomy used to stamp and has since replaced.
 *
 * Kept as data rather than removed, because "stop proposing it" and "delete it" are different
 * instructions and only one of them is safe. A retired label is never created — installing the
 * taxonomy into a fresh repository must not seed history that repository does not have — and never
 * deleted where it already exists. All the planner does with one it finds is correct its
 * description, so the label list itself carries the redirection to whoever reads it next.
 */
export const RETIRED_LABELS: readonly LabelSpec[] = [
  retired(
    RETIRED_CLOSE_GATE_STATUS,
    c.danger,
    `Retired — use ${CLOSE_GATE_OVERRIDE}. Left in place so the items it audited still say so.`,
    "status",
    CLOSE_GATE_OVERRIDE,
  ),
];

/** True for a spec this taxonomy has retired. Narrows `supersededBy` to a string for callers. */
export const isRetired = (label: LabelSpec): label is LabelSpec & { supersededBy: string } =>
  label.supersededBy !== undefined;

/** Build an `area:` label for a workspace package or top-level source directory. */
export const areaLabel = (slug: string, description: string): LabelSpec =>
  spec(`area:${slug}`, c.area, description, "area", "detected");

/** Build a `gate:` label for a CI workflow that is expensive enough to opt into by hand. */
export const gateLabel = (slug: string, description: string): LabelSpec =>
  spec(`gate:${slug}`, c.control, description, "gate", "detected");

/** Build a `ci:` control label. */
export const ciLabel = (slug: string, description: string): LabelSpec =>
  spec(`ci:${slug}`, c.control, description, "ci", "detected");

/**
 * Build a lane-ownership label under whichever prefix the repository already uses. A repo that
 * has settled on `topic:` keeps `topic:`; one with nothing keeps the default. Introducing a second
 * prefix for the same concept is how a taxonomy starts meaning nothing.
 */
export const laneLabel = (slug: string, prefix: string, description: string): LabelSpec =>
  spec(`${prefix}:${slug}`, c.lane, description, "lane", "detected");

/** Build a `wave:` scheduling band from a milestone title. */
export const waveLabel = (slug: string, description: string): LabelSpec =>
  spec(`wave:${slug}`, c.wave, description, "wave", "detected");

/** Build an `epic:` grouping label from an existing epic issue. */
export const epicLabel = (slug: string, description: string): LabelSpec =>
  spec(`epic:${slug}`, c.umbrella, description, "epic", "detected");

/** Longest slug worth putting in a label. Past this a label stops being readable in a filter. */
const MAX_SLUG = 40;

/** Width of the disambiguating suffix a truncated slug carries, including its separator. */
const SUFFIX = 7;

/**
 * Deterministic short digest (FNV-1a, base36). Pure and dependency-free so that slugify stays a
 * plain function of its input — the same title must produce the same label on every machine.
 */
function digest(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(SUFFIX - 1, "0").slice(0, SUFFIX - 1);
}

/**
 * Normalize a free-text name into a label-safe slug.
 *
 * Long input is cut back to a word boundary rather than at the character limit: `epic:e6-board-`
 * is not a shorter label, it is a broken one, and it sorts confusingly next to its siblings.
 *
 * A truncated slug also carries a digest of the *full* input. Truncation alone is not injective —
 * two epics whose titles share a long prefix collapse to the same slug, and a collision here does
 * not fail loudly, it merges two epics into one label and loses the second. Six base36 characters
 * cost readability that the alternative cannot afford.
 */
export function slugify(input: string): string {
  const full = input
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (full.length <= MAX_SLUG) return full;

  const room = MAX_SLUG - SUFFIX;
  const cut = full.slice(0, room);
  const boundary = cut.lastIndexOf("-");
  // Only honour a boundary that leaves something recognizable behind.
  const head = (boundary >= room / 2 ? cut.slice(0, boundary) : cut).replace(/-+$/, "");
  return `${head}-${digest(full)}`;
}

/** What GitHub will accept, once `#` is gone and case is settled. */
const HEX_COLOR = /^[0-9a-f]{6}$/;

/** GitHub accepts colors with or without `#`; everything downstream wants the bare six digits. */
export function normalizeColor(color: string): string {
  return color.replace(/^#/, "").toLowerCase();
}

/**
 * Whether a color is one this tool may send. The type says six hex digits, but a type cannot
 * inspect a string parsed out of a file — without this check `not-a-color` reaches a POST body and
 * the run fails partway through an apply, having already created labels.
 */
export function isValidColor(color: string): boolean {
  return HEX_COLOR.test(normalizeColor(color));
}

/** The status family's prefix, including its separator, so `statuspage:` cannot match it. */
const STATUS_PREFIX = "status:";

/**
 * The status labels on an item, matched the way GitHub matches label names: case-insensitively.
 * A case-sensitive filter reports `Status:ready` and `status:shipped` as one status, which is the
 * board's most dangerous kind of wrong answer — it looks well-formed.
 */
export function statusLabelsOf(labelNames: readonly string[]): readonly string[] {
  return labelNames.filter((n) => n.toLowerCase().startsWith(STATUS_PREFIX));
}

/**
 * The single-status rule, as a check rather than a paragraph.
 *
 * `missing` is a distinct verdict from `ok`, not an empty list of offenders. An item with no status
 * is not well-formed — it is invisible to the board, which is the failure mode this whole package
 * exists to make visible.
 */
export type StatusVerdict =
  | { readonly kind: "ok"; readonly status: string }
  | { readonly kind: "missing" }
  | { readonly kind: "multiple"; readonly statuses: readonly string[] };

export function classifyStatus(labelNames: readonly string[]): StatusVerdict {
  const statuses = statusLabelsOf(labelNames);
  const [only] = statuses;
  if (only === undefined) return { kind: "missing" };
  if (statuses.length === 1) return { kind: "ok", status: only };
  return { kind: "multiple", statuses };
}
