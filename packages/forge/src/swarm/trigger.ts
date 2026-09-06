/**
 * The `/swarm` comment trigger, and the authority rule that guards it.
 *
 * A `/swarm` block in a comment on a target repository opens an inbox issue, which the ordinary
 * spawn pipeline then picks up. That is a remote-code-execution shape wearing a convenience hat:
 * the repositories are public, anybody can comment on them, and a spawn spends the swarm's metered
 * quota on a machine in the fleet. Upstream states the rule in as many words —
 *
 * > Only comments authored by the bot login are honored — anyone else commenting /swarm on a
 * > public repo must not be able to spend the swarm's quota.
 *
 * — and this module is a transliteration of `commentTick` in `cmd/divybot/overrides.go`
 * (`rickylabs/orchid`, pinned at `d344bd037bcf10150fd12daef8ffa277576cd94a`), gate for gate and in
 * the order the dispatcher applies them. Same house rule as `go-grammar.ts` and `targets/model.ts`:
 * where our judgement differs from what ships, the divergence is named rather than quietly fixed.
 * A checker that reports a decision the dispatcher will not make is worse than no checker.
 *
 * ## What is ours rather than upstream's
 *
 * Upstream logs one refusal — the non-bot author — and drops every other candidate with a bare
 * `continue`. This returns a verdict for *every* comment it looked at, refused ones included, each
 * carrying its author. That is the whole difference, and it is observability rather than behaviour:
 * nothing is admitted here that the dispatcher would refuse, and nothing refused that it would
 * admit. A dispatcher that silently ignores a legitimate trigger and a dispatcher that has not
 * noticed one yet look identical from the outside, which is the visibility problem this repository
 * exists to fix.
 *
 * One consequence deserves stating up front, because it is invisible until somebody looks for it:
 * **a target whose repository is the inbox is skipped entirely.** Upstream's target loop opens with
 * `t.Repo == c.cfg.Inbox → continue`, so for a fleet whose inbox is also its only target — which is
 * this repository's own shape — the comment trigger never fires at all. That is not a bug to route
 * around here; it is the configuration saying something the operator probably did not intend, and
 * `dsh-forge swarm` is where it becomes visible.
 */

import type { SourceIssue } from "@rickylabs/board";
import { goSplitLines, goTrimSpace, parseSwarm } from "@rickylabs/subagents";
import type { ParsedSwarm, SwarmWarning } from "@rickylabs/subagents";

import type { Target, TargetTable } from "./../targets/model.js";
import type { BridgeSource } from "./../targets/reconcile.js";

/** One comment, shaped as `GET /repos/{owner}/{repo}/issues/comments` returns it. */
export interface SwarmComment {
  readonly id: number;
  readonly body: string;
  /** `issue_url`. The issue number is parsed out of its last path segment, as upstream does. */
  readonly issueUrl: string;
  /** `html_url`. Carries `/pull/` for a comment on a pull request conversation. */
  readonly htmlUrl: string;
  /** `user.login`. Empty for a deleted account — which is never the bot, and is refused as such. */
  readonly author: string;
}

/** One repository's comment feed. Upstream fetches these per target repository; so does the CLI. */
export interface SwarmFeed {
  readonly repo: string;
  readonly comments: readonly SwarmComment[];
}

/**
 * Why a comment did not open an inbox issue.
 *
 * In the order the gates run, because the order is a fact about the dispatcher and not a
 * presentation choice: a comment stopped by an early gate never reaches a later one, so the first
 * refusal is the only one an operator can act on.
 */
export const SWARM_REFUSALS = [
  /** `bot_login` is unset, so `commentTick` returns before looking at anything. */
  "no-bot-login",
  /** No row in the table names this repository. Upstream only ever fetches a target's feed. */
  "repo-not-a-target",
  /** The row's repository is the inbox. Upstream skips those targets outright — see the header. */
  "target-is-inbox",
  /** The row has no label, so a mirrored issue would carry nothing for the dispatcher to read. */
  "target-unlabelled",
  /** The trimmed body does not *start* with `/swarm`. A prefix test, not a search — see below. */
  "not-a-trigger",
  /** Refused before the author is even checked, and marked seen for good. */
  "already-seen",
  /** The authority rule. The one refusal upstream also logs. */
  "not-bot-login",
  /** A pull request conversation comment. Those share the issues feed; spawning off one is not. */
  "pull-request-comment",
  /** No issue number in `issue_url`, so there is nothing to mirror. */
  "no-issue-number",
  /** An inbox issue titled `[repo#n]` already exists, from this trigger or from assignment. */
  "already-mirrored",
  /** The issue is closed. Upstream requires `state == "open"`. */
  "issue-not-open",
  /** No projection covers the issue, so its state is unknown — see the note at the gate. */
  "issue-unknown",
] as const;

export type SwarmRefusal = (typeof SWARM_REFUSALS)[number];

/**
 * Refusals decided before the `/swarm` prefix test, so they say nothing about any body.
 *
 * The distinction earns its own list because it separates the two questions an operator has. A
 * comment refused here was never a trigger — on a busy repository that is every comment anybody
 * wrote all day, and printing them individually would bury the handful that matter. A comment
 * refused after it is one asked for a run and did not get it, which is always worth a line.
 */
export const SKIPPED_REFUSALS: readonly SwarmRefusal[] = [
  "no-bot-login",
  "repo-not-a-target",
  "target-is-inbox",
  "target-unlabelled",
  "not-a-trigger",
];

const SKIPPED: ReadonlySet<SwarmRefusal> = new Set(SKIPPED_REFUSALS);

/** Whether a refusal was decided before the body was ever looked at. */
export const isSkippedRefusal = (refusal: SwarmRefusal): boolean => SKIPPED.has(refusal);

/** What one comment did, or the first gate that stopped it. */
export interface SwarmVerdict {
  readonly repo: string;
  readonly commentId: number;
  /** Always reported, refusals included. The acceptance criterion this module exists for. */
  readonly author: string;
  readonly url: string;
  readonly issue: number | null;
  /** `repo#n` — the key both the mirror title and the dedupe store are built from. */
  readonly ref: string | null;
  readonly honoured: boolean;
  readonly refusal: SwarmRefusal | null;
  /** The inbox label the mirrored issue would carry. */
  readonly label: string | null;
  /**
   * What the block would actually run.
   *
   * Decoded for refused comments too, because "refused, and here is the run it wanted" is what
   * makes a refusal worth reading. Parsing is pure — nothing here launches anything — but the text
   * is attacker-controlled on a public repository, so `renderTriggers` prints the decoded fields
   * and never the free-text prompt.
   */
  readonly parsed: ParsedSwarm | null;
  readonly warnings: readonly SwarmWarning[];
  /** Attribution lines in the comment body. See `attributionTrailers`. */
  readonly trailers: readonly string[];
}

export interface SwarmInput {
  readonly feeds: readonly SwarmFeed[];
  /**
   * Board projections, one per repository, including the inbox's own.
   *
   * Two jobs: a target repository's projection supplies the issue state upstream fetches one at a
   * time, and the inbox's supplies `inboxMirrored` — the set of `repo#n` refs already filed, read
   * off titles matching `^\[([^\]]+#\d+)\]`. Upstream lists 1000 inbox issues for this and treats a
   * failure as fatal to the tick rather than risk a duplicate storm. A projection truncated at
   * board's own 500-item cap has the same hazard and no equivalent signal: the missing ref reads as
   * "not mirrored", and the answer to that is a second inbox issue for work already dispatched.
   */
  readonly projections: readonly BridgeSource[];
  /** Refs already decided on an earlier tick — divybot's `state.json` seen-swarm keys. */
  readonly seen?: readonly string[];
}

export interface SwarmAdmission {
  readonly inbox: string;
  readonly botLogin: string;
  readonly verdicts: readonly SwarmVerdict[];
  /** Repositories a feed was supplied for that no row of the table names. */
  readonly unwatched: readonly string[];
  /** Target repositories no feed was supplied for — triggers there are unknown, not absent. */
  readonly unfetched: readonly string[];
}

/** `inboxTitleRef` — the title convention an assignment or an earlier trigger writes. */
const MIRROR_TITLE = /^\[([^\]]+#\d+)\]/;

/**
 * Decide every comment in every feed, in the dispatcher's own order.
 *
 * Deterministic and offline: the gates read the table, the feeds and the projections, and nothing
 * else. No clock — upstream's 24-hour `since` window is a property of the fetch, so it belongs to
 * whoever assembles the feed, and baking a `Date.now()` in here would make the same inputs decide
 * differently on two runs.
 */
export function admitSwarmComments(table: TargetTable, input: SwarmInput): SwarmAdmission {
  const mirrored = mirroredRefs(table, input.projections);
  const seen = new Set<string>(input.seen ?? []);

  // First row wins, matching `resolveTarget`: two rows on one repository is a table problem
  // `checkTargets` already reports, not something to settle differently here.
  const watched = new Map<string, Target>();
  for (const target of table.targets) {
    if (target.repo !== "" && !watched.has(target.repo)) watched.set(target.repo, target);
  }

  const verdicts: SwarmVerdict[] = [];
  for (const feed of input.feeds) {
    const target = watched.get(feed.repo) ?? null;
    for (const comment of feed.comments) {
      verdicts.push(admitOne({ table, comment, repo: feed.repo, target, input, mirrored, seen }));
    }
  }

  const supplied = new Set(input.feeds.map((feed) => feed.repo));
  return {
    inbox: table.inbox,
    botLogin: table.botLogin,
    verdicts,
    unwatched: [...supplied].filter((repo) => !watched.has(repo)),
    unfetched: [...watched.keys()].filter((repo) => !supplied.has(repo)),
  };
}

interface Candidate {
  readonly table: TargetTable;
  readonly comment: SwarmComment;
  readonly repo: string;
  readonly target: Target | null;
  readonly input: SwarmInput;
  readonly mirrored: ReadonlySet<string>;
  /** Mutated: a comment decided here is not reconsidered later in the same tick. */
  readonly seen: Set<string>;
}

function admitOne(candidate: Candidate): SwarmVerdict {
  const { table, comment, repo, target, mirrored, seen } = candidate;

  const base: SwarmVerdict = {
    repo,
    commentId: comment.id,
    author: comment.author,
    url: comment.htmlUrl,
    issue: null,
    ref: null,
    honoured: false,
    refusal: null,
    label: target?.label ?? null,
    parsed: null,
    warnings: [],
    trailers: attributionTrailers(comment.body),
  };
  const refuse = (refusal: SwarmRefusal, over: Partial<SwarmVerdict> = {}): SwarmVerdict => ({
    ...base,
    ...over,
    honoured: false,
    refusal,
  });

  if (table.botLogin === "") return refuse("no-bot-login");
  if (target === null) return refuse("repo-not-a-target");
  if (target.repo === table.inbox) return refuse("target-is-inbox");
  if (target.label === "") return refuse("target-unlabelled");

  // The trigger test is `strings.HasPrefix(strings.TrimSpace(body), "/swarm")` — the block has to
  // *open* the comment. `parseSwarm` finds a `/swarm` line anywhere, because once a comment has
  // been mirrored `parseOverrides` reads the whole mirrored body. So a comment with a sentence of
  // context above the block parses perfectly and never triggers, and the two are not
  // interchangeable however similar they look.
  if (!goTrimSpace(comment.body).startsWith("/swarm")) return refuse("not-a-trigger");

  const parsed = parseSwarm(comment.body);
  const decoded: Partial<SwarmVerdict> = parsed === null ? {} : { parsed, warnings: parsed.warnings };

  // Dedupe happens here, ahead of the author check, and the mark is taken whether or not the rest
  // of the chain admits the comment. That is the right shape for an authority refusal — a non-bot
  // `/swarm` is refused once and never looked at again — and the wrong one for `already-mirrored`:
  // that comment is marked too, so it is not reconsidered once the earlier mirror closes, and a
  // legitimate re-trigger needs a new comment rather than a second look at this one.
  const key = `${repo}#c${String(comment.id)}`;
  if (seen.has(key)) return refuse("already-seen", decoded);
  seen.add(key);

  if (comment.author !== table.botLogin) return refuse("not-bot-login", decoded);
  if (comment.htmlUrl.includes("/pull/")) return refuse("pull-request-comment", decoded);

  const issue = issueOfUrl(comment.issueUrl);
  if (issue === null) return refuse("no-issue-number", decoded);
  const ref = `${repo}#${String(issue)}`;
  const located: Partial<SwarmVerdict> = { ...decoded, issue, ref };

  if (mirrored.has(ref)) return refuse("already-mirrored", located);

  const item = findSourceIssue(candidate.input.projections, repo, issue);
  // Upstream writes `err != nil || is.State != "open"` — one `continue` for two different worlds.
  // A rate-limited fetch and a closed issue are indistinguishable to it, so a throttled tick looks
  // exactly like a repository where everything is already done. Split here: the dispatcher's
  // decision is the same either way, and which of the two happened is not.
  if (item === null) return refuse("issue-unknown", located);
  if (item.state !== "open") return refuse("issue-not-open", located);

  return { ...base, ...located, honoured: true, refusal: null };
}

/**
 * `inboxMirrored` — the `repo#n` refs already filed in the inbox, read off the title convention.
 *
 * Open and closed alike, deliberately: the inbox *is* the dedupe store, so a closed mirror still
 * counts. Upstream lists `--state all` for exactly that reason.
 */
function mirroredRefs(table: TargetTable, projections: readonly BridgeSource[]): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const projection of projections) {
    if (projection.repo !== table.inbox) continue;
    for (const item of projection.items) {
      const match = MIRROR_TITLE.exec(item.title);
      if (match?.[1] !== undefined) refs.add(match[1]);
    }
  }
  return refs;
}

/**
 * The issue a ref points at, or `null` when no supplied projection covers it.
 *
 * Pull requests are not issues here even though GitHub numbers them from one sequence. Upstream
 * fetches `repos/{repo}/issues/{n}`, which answers for a pull request too — but it reached that
 * number from an `issue_url` on a comment it had already refused if the conversation was a pull
 * request's, so it can only ever have an issue in hand. Matching a pull request here would admit one
 * it never would.
 */
export function findSourceIssue(
  projections: readonly BridgeSource[],
  repo: string,
  issue: number,
): SourceIssue | null {
  for (const projection of projections) {
    if (projection.repo !== repo) continue;
    for (const item of projection.items) {
      if (item.number === issue && item.kind === "issue") return item;
    }
  }
  return null;
}

/**
 * The issue number in an `issue_url`, or `null`.
 *
 * `fmt.Sscanf(seg, "%d", &num)` reads a leading run of digits and stops at the first byte that is
 * not one, so `.../issues/12abc` is issue 12 to the dispatcher. Zero means "no number" there, and
 * it means the same here — an issue is never numbered 0.
 */
export function issueOfUrl(url: string): number | null {
  const cut = url.lastIndexOf("/");
  const segment = cut === -1 ? url : url.slice(cut + 1);
  const digits = /^[0-9]+/.exec(segment);
  if (digits === null) return null;
  const issue = Number.parseInt(digits[0], 10);
  return Number.isSafeInteger(issue) && issue > 0 ? issue : null;
}

/**
 * The `owner/name` an `issue_url` belongs to, or `""`.
 *
 * `https://api.github.com/repos/rickylabs/harness/issues/142` → `rickylabs/harness`. Every comment
 * carries this, which is what lets the CLI take a raw `gh api` dump instead of asking the operator
 * to name the repository a second time and then trusting the answer.
 */
export function repoOfIssueUrl(url: string): string {
  const match = /\/repos\/([\w.-]+\/[\w.-]+)\/issues\//.exec(url);
  return match?.[1] ?? "";
}

/** The inbox issue an honoured trigger opens. */
export interface SwarmMirror {
  readonly repo: string;
  readonly label: string;
  readonly title: string;
  readonly body: string;
}

/**
 * Render the inbox issue upstream's `gh issue create` would file.
 *
 * The same template, including both horizontal rules and both truncation limits, because the
 * mirrored body is what `parseOverrides` reads at spawn: a body assembled differently is a
 * different run.
 *
 * **No attribution trailer.** Upstream hard-coded a `Co-Authored-By` line into the work its agents
 * produced; our fork removed it, and it stays removed. Nothing here appends one — and because the
 * comment body is copied verbatim into this body, and from there into the worker's goal preamble,
 * `attributionTrailers` reports one arriving through the text instead, which is the route that is
 * actually still open.
 *
 * **The middle section is empty when the issue came from a board projection.** `SourceIssue.body` is
 * fetched for pull requests and deliberately not for issues — no board rule reads an issue body, and
 * carrying them would multiply every projection's transfer to serve nothing. Upstream fetches the
 * issue itself and does have the body. So a mirror rendered from a snapshot is the real title, the
 * real comment and a blank source section: correct as a preview of what would be filed, and not the
 * bytes a spawn would read. Whoever writes the mirror for real supplies the body.
 */
export function renderMirror(
  verdict: SwarmVerdict,
  issue: SourceIssue,
  comment: SwarmComment,
): SwarmMirror {
  if (verdict.ref === null || verdict.label === null) {
    throw new Error("renderMirror needs an honoured verdict, which carries both a ref and a label");
  }
  return {
    repo: verdict.repo,
    label: verdict.label,
    title: `[${verdict.ref}] ${issue.title}`,
    body:
      `Triggered by a /swarm comment on [${verdict.ref}](${verdict.url}).\n\n---\n\n` +
      `${truncate(issue.body ?? "", 2000)}\n\n---\n\n${truncate(comment.body, 1500)}`,
  };
}

/**
 * Go's `truncate`: trim, then cut to `max` **bytes**, with an ellipsis.
 *
 * Bytes, not characters. `len(s)` counts bytes and `s[:max]` slices them, so a limit landing inside
 * a multi-byte rune splits it and Go emits the broken bytes as they are. JavaScript's `slice`
 * counts UTF-16 code units, which agrees with Go only for ASCII — and the bodies this cuts are
 * prose that routinely is not. The difference decides where the operator's instructions stop.
 */
export function truncate(text: string, max: number): string {
  const trimmed = goTrimSpace(text);
  const bytes = new TextEncoder().encode(trimmed);
  if (bytes.length <= max) return trimmed;
  return `${new TextDecoder().decode(bytes.slice(0, max))}…`;
}

const TRAILER = /^(?:co-authored-by|signed-off-by|assisted-by|generated with)\b/i;

/**
 * Lines in a body that would become an attribution trailer on a dispatched agent's commits.
 *
 * A scanner rather than a promise, because the trailer we removed from the fork can come back
 * without anybody touching the fork. A comment body is copied verbatim into the mirrored inbox
 * issue, which becomes the worker's goal preamble, and an agent handed a `Co-Authored-By` line in
 * its instructions will put one in its commits. Reported, never stripped — editing an operator's
 * text on its way to a run is how a dispatcher stops being a mirror of its inputs, and the point of
 * this whole module is that it is one.
 */
export function attributionTrailers(body: string): readonly string[] {
  const found: string[] = [];
  for (const line of goSplitLines(body)) {
    const trimmed = goTrimSpace(line);
    if (TRAILER.test(trimmed)) found.push(trimmed);
  }
  return found;
}

/** Counts worth a header line. */
export interface SwarmTally {
  readonly examined: number;
  readonly honoured: number;
  readonly refused: number;
  /** Comments that opened with `/swarm` — decided on their merits rather than skipped early. */
  readonly triggers: number;
  /** Refused by the authority rule specifically — the number worth watching on a public repo. */
  readonly unauthorised: number;
}

export function tallySwarm(admission: SwarmAdmission): SwarmTally {
  let honoured = 0;
  let triggers = 0;
  let unauthorised = 0;
  for (const verdict of admission.verdicts) {
    if (verdict.honoured) honoured += 1;
    if (verdict.refusal === "not-bot-login") unauthorised += 1;
    if (verdict.refusal === null || !SKIPPED.has(verdict.refusal)) triggers += 1;
  }
  return {
    examined: admission.verdicts.length,
    honoured,
    refused: admission.verdicts.length - honoured,
    triggers,
    unauthorised,
  };
}

/** One line of English per refusal, for a terminal and for an issue comment. */
export function describeRefusal(refusal: SwarmRefusal): string {
  switch (refusal) {
    case "no-bot-login":
      return "bot_login is unset — the comment trigger is off entirely";
    case "repo-not-a-target":
      return "no target names this repository";
    case "target-is-inbox":
      return "the target's repo is the inbox — divybot skips those targets, so this never triggers";
    case "target-unlabelled":
      return "the target has no label, so a mirrored issue would carry nothing to dispatch on";
    case "not-a-trigger":
      return "the body does not start with /swarm (a block further down parses but never triggers)";
    case "already-seen":
      return "already decided on an earlier tick";
    case "not-bot-login":
      return "not authored by the bot login";
    case "pull-request-comment":
      return "a pull request conversation comment, which is out of scope for spawning";
    case "no-issue-number":
      return "no issue number in issue_url";
    case "already-mirrored":
      return "an inbox issue for this ref already exists";
    case "issue-not-open":
      return "the issue is closed";
    case "issue-unknown":
      return "no projection covers that issue — unknown, which divybot cannot tell from closed";
  }
}
