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

/** Outside the lifecycle: the audited exception path for a red close gate. */
export const STATUS_OVERRIDE = "status:close-gate-override" as const;

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
  spec(STATUS_OVERRIDE, c.danger, "Audited exception to the closing-keyword acceptance gate", "status"),
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

/** Cross-cutting flags that are not a namespace. */
export const FLAG_LABELS: readonly LabelSpec[] = [
  spec("rfc", c.umbrella, "Request for Comments — substantial or breaking design change", "flag"),
  spec("breaking", c.danger, "Introduces a breaking change", "flag"),
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

/**
 * Normalize a free-text name into a label-safe slug.
 *
 * Long input is cut back to a word boundary rather than at the character limit: `epic:e6-board-`
 * is not a shorter label, it is a broken one, and it sorts confusingly next to its siblings.
 */
export function slugify(input: string): string {
  const full = input
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (full.length <= MAX_SLUG) return full;

  const cut = full.slice(0, MAX_SLUG);
  const boundary = cut.lastIndexOf("-");
  // Only honour a boundary that leaves something recognizable behind.
  return (boundary >= MAX_SLUG / 2 ? cut.slice(0, boundary) : cut).replace(/-+$/, "");
}

/** GitHub accepts colors with or without `#`; everything downstream wants the bare six digits. */
export function normalizeColor(color: string): string {
  return color.replace(/^#/, "").toLowerCase();
}

/**
 * The single-status rule, as a check rather than a paragraph. Returns the offending labels so a
 * caller can report them; an empty array means the item is well-formed.
 */
export function violatesSingleStatus(labelNames: readonly string[]): readonly string[] {
  const statuses = labelNames.filter((n) => n.startsWith("status:"));
  return statuses.length > 1 ? statuses : [];
}
