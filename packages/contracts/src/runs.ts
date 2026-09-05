/**
 * An agent run on the wire.
 *
 * ## What is deliberately absent
 *
 * A run record carries far more than this. The internal record holds an `origin` — where the
 * evidence for the run was read from — and every field the transcript scan happened to recover.
 * None of that crosses the wire.
 *
 * The rule producing this shape is the one the telemetry package already lives by: a published
 * surface lists its fields by hand. `JSON.stringify(record)` publishes whatever the record happens
 * to carry *at the moment someone adds a field*, which is exactly when nobody is thinking about the
 * wire. `origin` is the standing example — it is a filesystem path, it is useful internally, and it
 * has no business on a phone.
 *
 * `title` and `cwd` are absent for the same reason and were removed from the internal record too:
 * a run title is operator prose, and a working directory is a path. Neither is needed to render a
 * run and both leak the shape of a machine nobody is holding.
 *
 * ## Runs are attached to work, not to prose
 *
 * `item` is the one issue this run is understood to be acting on, and `linkedIssues` is everything
 * the transcript mentioned with the evidence class that produced it. They are separate because
 * "this run is working on #79" and "this run said the number 79 out loud" are different claims, and
 * a cockpit that shows the second as the first attributes work to issues nobody touched.
 */

/**
 * Which vendor CLI produced the run.
 *
 * Closed: a client renders a source as a badge and a filter, and an unrecognised source silently
 * dropping out of a filtered list is a run that has vanished from the board. Growing this list is a
 * contract change, which is the correct amount of ceremony for adding a harness.
 */
export const RUN_SOURCES = ["claude", "codex", "opencode"] as const;
export type RunSource = (typeof RUN_SOURCES)[number];

/**
 * How a run ended, or that it has not.
 *
 * `unknown` is a real outcome and not a placeholder: a transcript can be truncated, a machine can
 * be rebooted mid-run, and the honest report is that nobody knows. It is kept apart from `failed`
 * because a cockpit that shows unknown as failure invents bad news, and apart from `running`
 * because one that shows it as running invents an agent.
 */
export const RUN_OUTCOMES = ["running", "complete", "failed", "unknown"] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/**
 * What actually launched, as data.
 *
 * Launch identity is data, not prose — a harness invariant, and the reason this is five named
 * fields rather than the command line that produced them. A command line has to be parsed to be
 * checked, and a rule that has to parse prose to decide whether a run was allowed is a rule that
 * can be talked around.
 *
 * Every field is nullable and `null` means "the evidence does not say", never a guess. A run whose
 * model cannot be recovered from its transcript reports `model: null`, and a cockpit renders that
 * as unknown rather than as a default it made up.
 *
 * `harness` is the one field beyond telemetry's four. Telemetry reads identity out of a transcript,
 * which frequently does not name its own driver; the dispatch side always knows, because it chose.
 */
export interface LaunchIdentity {
  /** The CLI driving the run, e.g. `claude`, `codex`, `opencode`, `agy`. */
  readonly harness: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly provider: string | null;
  /** The credential profile the run was bound to. A name, never a secret. */
  readonly profile: string | null;
}

/**
 * Token and cost accounting.
 *
 * Every field is optional because sources report different subsets and an absent field must not be
 * readable as zero. A run with no `costUsd` cost an unknown amount, which is not the same as free,
 * and a spend total that quietly adds absent-as-zero under-reports exactly when it matters.
 */
export interface RunUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costUsd?: number;
}

/**
 * A subscription usage meter as read at a point in time.
 *
 * Carried on the run rather than only in governance state because the question a cockpit asks is
 * "what did this run cost me against the window", and answering it by joining a run against a
 * separately-fetched meter reading is a join across two clocks.
 */
export interface QuotaReading {
  readonly source: RunSource;
  readonly observedAt: string;
  /** Which window this reading is for, e.g. a five-hour or weekly limit. */
  readonly limitId: string | null;
  readonly usedPercent: number | null;
  readonly windowMinutes: number | null;
  readonly resetsAt: string | null;
  readonly planType: string | null;
  readonly creditBalance: number | null;
}

/**
 * How an issue reference was found.
 *
 * `path` means the run demonstrably touched the work — a branch name, a worktree, a commit trailer.
 * `prose` means a transcript said the number. The distinction is the whole value of the field: a
 * cockpit may draw a `path` link as attribution and must draw a `prose` link as a mention.
 */
export const ISSUE_EVIDENCE = ["path", "prose"] as const;
export type IssueEvidence = (typeof ISSUE_EVIDENCE)[number];

export interface IssueLink {
  readonly number: number;
  readonly from: IssueEvidence;
}

/**
 * How recently a run showed a sign of life.
 *
 * Liveness is not progress. A node is green on a growing artifact, a new commit, or a live turn —
 * never on an open socket. An agent that is connected and doing nothing is `quiet`, and a cockpit
 * that renders an open connection as work is the exact false green this vocabulary exists to
 * prevent.
 */
export const LIVENESS_STATES = ["live", "recent", "stalled", "quiet"] as const;
export type LivenessState = (typeof LIVENESS_STATES)[number];

/** What the liveness judgement was made from. `none` means nothing was found, so `state` is `quiet`. */
export const LIVENESS_EVIDENCE = ["turn", "item", "none"] as const;
export type LivenessEvidence = (typeof LIVENESS_EVIDENCE)[number];

export interface Liveness {
  readonly state: LivenessState;
  readonly evidence: LivenessEvidence;
  /** When the evidence was produced, or `null` when there is none. */
  readonly at: string | null;
  /** Age of that evidence at `generatedAt`, so a client can render "4m ago" without a second clock. */
  readonly ageMs: number | null;
}

/**
 * A run as published.
 *
 * Flat and normalized: a run appears once in a snapshot and names its parent by id. A client draws
 * the tree by following `parentId`, which keeps a re-parented or newly-discovered child a
 * single-run delta instead of a rebuilt subtree.
 */
export interface RunView {
  readonly id: string;
  readonly source: RunSource;
  /** The run that spawned this one, or `null` for a root. */
  readonly parentId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly branch: string | null;
  readonly identity: LaunchIdentity;
  readonly usage: RunUsage;
  readonly outcome: RunOutcome;
  /** The issue this run is understood to be acting on, or `null`. */
  readonly item: number | null;
  /** Everything the evidence linked, each with the class of evidence that linked it. */
  readonly linkedIssues: readonly IssueLink[];
  readonly liveness: Liveness;
  /** The meter reading nearest this run, when the source reports one. */
  readonly quota: QuotaReading | null;
}

/**
 * The fields a `RunView` may carry, sorted.
 *
 * The point of writing them out is that a projection can be tested against this list: a server that
 * assembles a run by spreading its internal record adds every future internal field to the wire the
 * day it is introduced, and a key-set assertion is what catches it. Sorted so the assertion reads as
 * a set comparison rather than as a claim about declaration order.
 */
export const RUN_VIEW_FIELDS = [
  "branch",
  "id",
  "identity",
  "item",
  "linkedIssues",
  "liveness",
  "outcome",
  "parentId",
  "quota",
  "source",
  "startedAt",
  "updatedAt",
  "usage",
] as const;
export type RunViewField = (typeof RUN_VIEW_FIELDS)[number];
