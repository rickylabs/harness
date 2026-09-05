/**
 * The telemetry domain.
 *
 * `status ?` is a poll against a conversational source. It costs tokens, it is only as accurate as
 * the agent's own memory, and it is unavailable exactly when things are wedged — which is when you
 * need it. Everything here is therefore a plain data shape produced from files that already exist
 * on disk, so a snapshot can be built with no agent awake and no network reachable.
 *
 * Nothing in this module reads a clock, a filesystem or an environment variable. The adapters do
 * that at the edge and hand values down, which is what makes a snapshot of the same inputs
 * byte-identical across runs.
 */

/**
 * Which store a run was recovered from.
 *
 * `claude` and `codex` are the two subscription seams; `opencode` is the relay seam that reaches
 * OpenRouter and the local models. The distinction matters for governance: only the first two have
 * a subscription window that can be exhausted.
 */
export type RunSource = "claude" | "codex" | "opencode";

/** How a run ended, as far as its transcript can say. */
export type RunOutcome = "running" | "complete" | "failed" | "unknown";

/** Token and money cost. Every field is optional because no vendor reports all of them. */
export interface RunUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  /** USD, when the vendor accounts for it. Subscription seams generally do not. */
  readonly costUsd?: number;
}

/**
 * The launch identity of a run, as data.
 *
 * A harness invariant says launch identity is data, not prose: a run that cannot say which model
 * and effort it actually ran under cannot be audited against the matrix. `null` here is an honest
 * "the transcript does not say", never a guess from the run's name or its branch.
 */
export interface LaunchIdentity {
  readonly model: string | null;
  readonly effort: string | null;
  readonly provider: string | null;
  /**
   * The agent profile a run was launched under, where the seam records one as data.
   *
   * opencode has a lane concept and stores it in a column; the other two seams do not, and report
   * `null` rather than a guess. This exists because the lane information used to travel inside the
   * run title, which is prose from the operator's own prompt — reading a lane out of prose is both
   * a privacy problem and a bad audit, since prose can say anything.
   */
  readonly profile: string | null;
}

/**
 * A subscription window's position, exactly as the vendor reported it.
 *
 * This is the answer to "why is nothing running", which is a status question that today has no
 * answer at all. It is a point-in-time reading carried by a transcript record, so it is only ever
 * as fresh as the run that observed it — `observedAt` is not decoration.
 */
export interface QuotaReading {
  readonly source: RunSource;
  readonly observedAt: string;
  readonly limitId: string | null;
  readonly usedPercent: number | null;
  readonly windowMinutes: number | null;
  /** ISO 8601. The vendor reports a Unix second; the adapter converts at the edge. */
  readonly resetsAt: string | null;
  readonly planType: string | null;
  readonly creditBalance: string | null;
}

/**
 * A pointer at the layer below a run: the log that actually explains it.
 *
 * The general lesson this encodes is that the symptom surfaces one layer above the cause. A run
 * that looks slow, hung, or like "the model is bad" is usually a load failure, a thrashing box, or
 * a silently-dropped boot parameter — so a failed run must link downward, not sideways.
 */
export interface DiagnosticPointer {
  /** What this log is, in the words an operator would use. */
  readonly what: string;
  /** Where it lives. A path, with the host or container it lives in spelled out. */
  readonly where: string;
  /** What to grep for once there. */
  readonly grep: string;
  /** Why this layer, rather than the one the symptom appeared in. */
  readonly why: string;
}

/** Where an issue number was found, which is what lets one piece of evidence beat another. */
export type IssueEvidence = "path" | "prose";

/**
 * One issue number a run points at, together with the evidence that produced it.
 *
 * The two classes are not equally good, and collapsing them to a bare number is what made
 * attribution silently pick the lowest one. See `linkedIssuesOf` and `attributeTo`.
 */
export interface IssueLink {
  readonly number: number;
  readonly from: IssueEvidence;
}

/**
 * One recovered run.
 *
 * `id` is the vendor's own session identifier, so a record can always be traced back to the file it
 * came from. `parentId` is what makes the subagent tree recoverable: opencode records it directly,
 * and the Claude transcript's sidechain flag stands in for it.
 *
 * There is deliberately no `title` and no `cwd`. Both used to be here, and both carried the
 * operator's own words: a Claude or Codex title was the first 120 characters of the first user
 * message, and `cwd` was an absolute path naming a person's home directory and every repository
 * they work on. A snapshot is printed, piped, pasted into issues and published by the projection,
 * so a field that can hold a prompt will eventually publish one (finding F-5 on #105).
 *
 * Prose is still *read* — that is where issue references live — but it is read inside the parser
 * and dropped in the same function. Reading is not retention. What survives is `linkedIssues`,
 * which is a set of numbers, and the board item's own title is what a reader sees instead: it is
 * the better label anyway, since it says what the work is rather than how someone asked for it.
 */
export interface RunRecord {
  readonly id: string;
  readonly source: RunSource;
  /** The parent session, for subagent trees. `null` for a top-level run. */
  readonly parentId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly branch: string | null;
  readonly identity: LaunchIdentity;
  readonly usage: RunUsage;
  readonly outcome: RunOutcome;
  /** Issue and PR numbers this run points at, each carrying the evidence that produced it. */
  readonly linkedIssues: readonly IssueLink[];
  /**
   * The transcript file or database this record was read out of.
   *
   * A path, and therefore local operator detail rather than something to publish. It stays on the
   * record because `why` exists to hand an operator the file to open; it is excluded from every
   * projection meant to leave this machine.
   */
  readonly origin: string;
  /** Quota readings this run observed, oldest first. */
  readonly quota: readonly QuotaReading[];
}

/**
 * The board item a run belongs to, structurally.
 *
 * Telemetry deliberately does not depend on `@rickylabs/board`. GitHub is board truth and the
 * projection is the live view of it; telemetry's job is to say what *ran*, and it joins to the
 * board on an issue number. Keeping the join structural means either package can land first, and
 * a `BoardItem` from the projection satisfies this shape without an adapter.
 */
export interface BoardItemRef {
  readonly number: number;
  readonly title: string;
  readonly epic: string | null;
  readonly milestone: string | null;
  readonly phase: string | null;
}

/** A run, and the item it was working on, if the join found one. */
export interface AttributedRun {
  readonly run: RunRecord;
  readonly item: BoardItemRef | null;
  /** Runs whose `parentId` is this run: the subagents it spawned. */
  readonly children: readonly AttributedRun[];
}

/** One epic's worth of activity: its items, and the runs under them. */
export interface EpicActivity {
  readonly epic: string;
  readonly milestone: string | null;
  readonly runs: readonly AttributedRun[];
}

/**
 * Everything `status ?` used to ask an agent for.
 *
 * `generatedAt` is passed in rather than read from the clock, for the same reason the board
 * projection does it: the same inputs must produce the same snapshot.
 */
export interface TelemetrySnapshot {
  readonly generatedAt: string;
  readonly epics: readonly EpicActivity[];
  /** Runs that joined to no board item at all: real work the board cannot see. */
  readonly unattributed: readonly AttributedRun[];
  /** The most recent quota reading per seam, which is the only one worth acting on. */
  readonly quota: readonly QuotaReading[];
  /** Sources that could not be read, and why. Never an empty absence. */
  readonly notes: readonly string[];
}

/** Total a set of usages, skipping the fields nobody reported. */
export function sumUsage(usages: readonly RunUsage[]): RunUsage {
  const keys = [
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costUsd",
  ] as const;
  const out: Record<string, number> = {};
  for (const key of keys) {
    let total = 0;
    let seen = false;
    for (const usage of usages) {
      const value = usage[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        total += value;
        seen = true;
      }
    }
    // An absent total and a zero total are different claims. Only report the one we can support.
    if (seen) out[key] = total;
  }
  return out as RunUsage;
}

const PATH_ISSUE = /(?:^|[^0-9])(?:issue|orch\/divybot|divybot)[-/]?(\d+)/gi;
const PROSE_ISSUE = /#(\d+)\b/g;

/**
 * Recover the issue numbers a run points at, and where each one came from.
 *
 * `path` is a branch name or a working directory — the dispatcher's own naming. It wrote
 * `orch/divybot-99` because it was dispatching issue #99, so the number is a statement about what
 * the run *is*. `prose` is a title or a first prompt, read only for explicit `#NN` because a bare
 * number there is usually a version; a number found in prose is a statement about what someone
 * *mentioned*, and people mention issues they are not working on.
 *
 * The two used to come back as one flat list, which threw away the difference at the one place it
 * was still known and left attribution guessing (finding F-8 on #105). A number seen in the path is
 * never downgraded by also appearing in the prose.
 */
export function linkedIssuesOf(path: string | null, prose: string | null): readonly IssueLink[] {
  const found = new Map<number, IssueEvidence>();
  for (const [text, pattern, from] of [
    [path, PATH_ISSUE, "path"],
    [prose, PROSE_ISSUE, "prose"],
  ] as const) {
    if (text === null) continue;
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      const raw = m[1];
      if (raw === undefined) continue;
      const n = Number.parseInt(raw, 10);
      // Path is read first, so `has` is what keeps the stronger evidence for a repeated number.
      if (Number.isSafeInteger(n) && n > 0 && !found.has(n)) found.set(n, from);
    }
  }
  return [...found].map(([number, from]) => ({ number, from })).sort((a, b) => a.number - b.number);
}
