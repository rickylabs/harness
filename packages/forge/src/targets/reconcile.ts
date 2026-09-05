/**
 * The bridge: what the dispatcher will do with each inbox issue, and what came back.
 *
 * Pure arithmetic over a table and one or more board projections. No network, no `gh`, no clock —
 * the same inputs give the same answer, which is what makes this runnable in CI and quotable in an
 * issue. `dsh-board snapshot` produces the projections; this composes them with the table.
 *
 * ## Why it takes several repositories
 *
 * The inbox holds the issues. The work happens in the *target* repositories, and the pull request
 * that answers an inbox issue is a pull request over there. So a bridge computed from the inbox
 * alone can say what will be dispatched and nothing at all about what came back.
 *
 * That asymmetry is also why `coverage` exists rather than being an implementation detail. An
 * operator looking at an item with no deliveries has to be able to tell "the run has produced
 * nothing yet" from "nobody handed me that repository's snapshot" — those want opposite reactions,
 * and a bridge that renders them identically is worse than one that refuses to render at all.
 *
 * ## How a delivery is linked back
 *
 * Two mechanisms, and the order matters:
 *
 * 1. **The branch.** `orch/divybot-142` is the dispatcher's own naming, and it is the only link
 *    that survives a repository boundary. GitHub's closing keywords close nothing across one, so a
 *    PR in `denoland/deno` *cannot* reference an inbox issue in `rickylabs/harness` that way — and
 *    `closingKeywordTargets` correctly drops the attempt. The branch name carries the number.
 * 2. **Closing keywords**, for a PR in the inbox repository itself. This repository is its own
 *    inbox, so that is the ordinary case here, and it is also how a human's PR — pushed to a branch
 *    of their own naming — claims an issue a run was never dispatched for.
 *
 * Branch wins where both fire, because a branch is what the dispatcher itself wrote.
 */

import { closingKeywordTargets, type SourceIssue } from "@rickylabs/board";

import type { Target, TargetProblem, TargetTable } from "./model.js";
import { checkTargets, dispatchBranch, issueOfBranch, resolveTarget } from "./model.js";

/** One repository's projection, as `dsh-board snapshot` emits it. */
export interface BridgeSource {
  readonly repo: string;
  readonly items: readonly SourceIssue[];
}

/** What the dispatcher will do with an inbox issue on its next tick. */
export const BRIDGE_DISPOSITIONS = ["claimed", "held", "settled", "ignored"] as const;
export type BridgeDisposition = (typeof BRIDGE_DISPOSITIONS)[number];

/** A pull request that answers an inbox issue, and how it was tied to one. */
export interface Delivery {
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** The inbox issue this answers. */
  readonly issue: number;
  readonly link: "branch" | "closes";
  readonly state: "open" | "closed";
  readonly draft: boolean;
  readonly merged: boolean;
}

/** One inbox issue, resolved against the table. */
export interface BridgeItem {
  readonly issue: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
  readonly disposition: BridgeDisposition;
  /** The row that wins, or `null` when no target's label is on the issue. */
  readonly target: Target | null;
  /** Rows that also matched and are unreachable, because resolution stops at the first. */
  readonly shadowed: readonly Target[];
  /** The branch a run for this issue pushes to, when there is a target and a prefix. */
  readonly branch: string | null;
  readonly deliveries: readonly Delivery[];
}

/** Whether the repositories a bridge needs were actually supplied. */
export interface BridgeCoverage {
  /** Every distinct repository the table's live targets name. */
  readonly wanted: readonly string[];
  /** Those a projection was supplied for. */
  readonly seen: readonly string[];
  /** Those it was not — items pointing here have unknowable deliveries, not zero. */
  readonly missing: readonly string[];
  /** True when the inbox's own projection was supplied. Nothing is computable without it. */
  readonly inboxSeen: boolean;
}

export interface BridgeSnapshot {
  readonly inbox: string;
  readonly items: readonly BridgeItem[];
  /**
   * Deliveries naming an inbox issue that is not in the inbox projection.
   *
   * Usually a truncated fetch — `dsh-board` caps at 500 items and says so. Occasionally a branch
   * left behind by a run for an issue somebody deleted. Either way it is evidence that was found
   * and could not be attached, which is worth a line rather than a discard.
   */
  readonly orphans: readonly Delivery[];
  readonly coverage: BridgeCoverage;
  /** Everything wrong with the table itself, so one call answers the whole question. */
  readonly problems: readonly TargetProblem[];
}

const isPullRequest = (item: SourceIssue): boolean => item.kind === "pull-request";

/**
 * Resolve every inbox issue against the table and attach whatever came back.
 *
 * Closed issues are kept rather than filtered. "Which issues did this dispatcher work, and did the
 * work land?" is the question the bridge exists for, and dropping the settled ones answers only the
 * uninteresting half of it.
 */
export function reconcileBridge(table: TargetTable, sources: readonly BridgeSource[]): BridgeSnapshot {
  const inboxSource = sources.find((source) => source.repo === table.inbox);
  const deliveries = collectDeliveries(table, sources);

  const items: BridgeItem[] = [];
  const claimed = new Set<number>();
  for (const item of inboxSource?.items ?? []) {
    if (isPullRequest(item)) continue;
    claimed.add(item.number);
    items.push(bridgeItem(table, item, deliveries.get(item.number) ?? []));
  }

  const orphans: Delivery[] = [];
  for (const [issue, found] of deliveries) {
    if (!claimed.has(issue)) orphans.push(...found);
  }
  orphans.sort((a, b) => a.issue - b.issue || a.number - b.number);

  return {
    inbox: table.inbox,
    items,
    orphans,
    coverage: coverageOf(table, sources),
    problems: checkTargets(table),
  };
}

function bridgeItem(table: TargetTable, item: SourceIssue, found: readonly Delivery[]): BridgeItem {
  const match = resolveTarget(table, item.labels);
  const target = match?.target ?? null;
  return {
    issue: item.number,
    title: item.title,
    url: item.url,
    state: item.state,
    labels: item.labels,
    disposition: dispositionOf(item, target),
    target,
    shadowed: match?.shadowed ?? [],
    branch:
      target === null || table.branchPrefix === ""
        ? null
        : dispatchBranch(table.branchPrefix, item.number),
    deliveries: [...found].sort((a, b) => a.number - b.number),
  };
}

/**
 * No target first, then closed.
 *
 * The order is load-bearing, and the wrong one is not obviously wrong until it meets a real inbox.
 * Checking closed first files every finished issue in the repository under `settled` — on this
 * repository's own board that was 67 rows, of which about half had never carried a target label at
 * all. `settled` has to mean "the dispatcher's work here is done", not "this issue is closed",
 * because the second is a fact board already reports and burying the first in it is how a view
 * stops being read.
 *
 * An issue with no target is `ignored` whether it is open or closed: the dispatcher does not touch
 * it in either state.
 */
function dispositionOf(item: SourceIssue, target: Target | null): BridgeDisposition {
  if (target === null) return "ignored";
  if (item.state === "closed") return "settled";
  return target.disabled ? "held" : "claimed";
}

/**
 * Index every pull request in every supplied projection by the inbox issue it answers.
 *
 * A pull request may legitimately answer more than one issue by closing keyword, so this is a
 * one-to-many index in both directions. What it will not do is record the same pull request against
 * the same issue twice: branch and keyword agreeing is the ordinary case, not a finding.
 *
 * Numbers naming a pull request are dropped rather than indexed. GitHub numbers issues and pull
 * requests from one sequence, so `Closes #121` is valid whichever one #121 is — and a re-land pull
 * request naming the pull requests it re-lands is a real, ordinary thing to write. Three of them
 * were sitting in this repository's own history the first time this ran. Indexing them produces an
 * orphan reported as "no such issue", which is true and useless: nothing is missing, the reference
 * was simply never about an issue.
 */
function collectDeliveries(
  table: TargetTable,
  sources: readonly BridgeSource[],
): ReadonlyMap<number, readonly Delivery[]> {
  const byIssue = new Map<number, Delivery[]>();
  const seen = new Set<string>();
  const inboxPullRequests = new Set<number>();
  for (const source of sources) {
    if (source.repo !== table.inbox) continue;
    for (const item of source.items) if (isPullRequest(item)) inboxPullRequests.add(item.number);
  }

  const record = (source: BridgeSource, pr: SourceIssue, issue: number, link: "branch" | "closes"): void => {
    const key = `${source.repo}#${String(pr.number)}->${String(issue)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const delivery: Delivery = {
      repo: source.repo,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      issue,
      link,
      state: pr.state,
      draft: pr.draft === true,
      merged: pr.merged === true,
    };
    const bucket = byIssue.get(issue);
    if (bucket === undefined) byIssue.set(issue, [delivery]);
    else bucket.push(delivery);
  };

  for (const source of sources) {
    for (const pr of source.items) {
      if (!isPullRequest(pr)) continue;
      // Branch first, so the authoritative link is the one recorded when both mechanisms fire.
      const fromBranch = pr.headRef === undefined ? null : issueOfBranch(table.branchPrefix, pr.headRef);
      if (fromBranch !== null) record(source, pr, fromBranch, "branch");
      // Closing keywords only inside the inbox, because that is the only repository where GitHub
      // would honour them against an inbox issue in the first place.
      if (source.repo !== table.inbox || pr.body === undefined) continue;
      for (const issue of closingKeywordTargets(pr.body, source.repo)) {
        if (inboxPullRequests.has(issue)) continue;
        record(source, pr, issue, "closes");
      }
    }
  }
  return byIssue;
}

/**
 * Which repositories the bridge needed and which it got.
 *
 * Disabled targets are still wanted: pausing new spawns does not retire the work already out there,
 * and the deliveries from before the pause are exactly what an operator is looking for when they
 * pause one.
 */
function coverageOf(table: TargetTable, sources: readonly BridgeSource[]): BridgeCoverage {
  const supplied = new Set(sources.map((source) => source.repo));
  const wanted: string[] = [];
  for (const target of table.targets) {
    if (target.repo !== "" && !wanted.includes(target.repo)) wanted.push(target.repo);
  }
  return {
    wanted,
    seen: wanted.filter((repo) => supplied.has(repo)),
    missing: wanted.filter((repo) => !supplied.has(repo)),
    inboxSeen: supplied.has(table.inbox),
  };
}

/** Counts worth a header line: how the inbox splits, and how much of it landed. */
export interface BridgeTally {
  readonly claimed: number;
  readonly held: number;
  readonly settled: number;
  readonly ignored: number;
  /** Targeted, open issues with at least one delivery that is neither draft nor closed. */
  readonly inFlight: number;
  /** Targeted issues with at least one merged delivery. */
  readonly landed: number;
}

/**
 * `inFlight` and `landed` count targeted items only.
 *
 * Deliveries are indexed for every item, because "what closed #142" is worth answering whoever did
 * the work. But these two numbers sit in a header under the dispatcher's own name, and counting a
 * human's merged pull request there reports somebody else's output as the dispatcher's: on this
 * repository the untargeted version read `47 landed` against nine issues the dispatcher had
 * actually been given. An `ignored` item's deliveries still print; they are just not tallied here.
 */
export function tallyBridge(snapshot: BridgeSnapshot): BridgeTally {
  let claimed = 0;
  let held = 0;
  let settled = 0;
  let ignored = 0;
  let inFlight = 0;
  let landed = 0;
  for (const item of snapshot.items) {
    if (item.disposition === "claimed") claimed += 1;
    else if (item.disposition === "held") held += 1;
    else if (item.disposition === "settled") settled += 1;
    else {
      ignored += 1;
      continue;
    }
    if (item.deliveries.some((delivery) => delivery.merged)) landed += 1;
    else if (
      item.state === "open" &&
      item.deliveries.some((delivery) => delivery.state === "open" && !delivery.draft)
    ) {
      inFlight += 1;
    }
  }
  return { claimed, held, settled, ignored, inFlight, landed };
}
