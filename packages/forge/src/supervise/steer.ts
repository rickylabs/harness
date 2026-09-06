/**
 * What to tell an agent about its own pull request, and — mostly — what not to tell it again.
 *
 * Owned by E7 · #75. A dispatched run opens a PR and then keeps going: reviews land, CI turns red,
 * `main` moves under it. Somebody has to carry those back into the agent's context, because the
 * agent cannot see them. divybot's supervision loop does that by re-reading the PR each tick and
 * forwarding what it finds, which means the same review arrives on every tick until the PR closes.
 * A turn spent re-reading a review the agent already acted on is a turn it does not spend on the
 * next one, and an agent told the same thing four times starts arguing with it.
 *
 * So the whole of this module is one idea: **the tick's output is the difference, not the state.**
 * Everything else here exists to make that difference computable offline and defensible in review.
 *
 * ## The mark is a receipt, not a decision
 *
 * `admitSwarmComments` marks a comment seen the moment it decides about it, admitted or refused,
 * because there the mark is an authority record — an unauthorised `/swarm` should be refused once
 * and never looked at again. Here the mark means the opposite thing: *the agent has been told*. So
 * it is taken on delivery. A note computed while the agent is mid-turn is held, not marked, and is
 * still waiting on the next tick. The two modules look similar and are inverses, and getting this
 * backwards produces the failure that is hardest to see from the outside — steering that was
 * computed, recorded, and never sent.
 *
 * Nothing in this package performs the delivery; that is the execution channel, E5 · #62. This
 * decides, {@link advanceState} folds a delivery back in, and whoever delivers owns the write.
 *
 * ## Merging is not ours
 *
 * #75 states it plainly: **PRs are merged by humans.** There is no `merge` signal in
 * {@link PULL_SIGNALS} and no reason in {@link SUPERVISION_REASONS} that leads to one, and a target
 * row with `automerge: true` is not supervised at all — `automerge-on`. That refusal is not repeated
 * as a {@link SupervisionProblem}: `checkTargets` already refuses the row as `automerge-enabled`,
 * and a second refusal here would print one misconfigured row as two unrelated red lines.
 *
 * ## Three judgements that are ours rather than the dispatcher's
 *
 * - **A cancelled check is not a failure.** `failure`, `timed_out`, `action_required` and
 *   `startup_failure` steer; `cancelled` does not. Nearly every cancelled run on an agent's PR was
 *   superseded by that agent's own next push, and steering it to fix a run its next commit killed
 *   spends the turn this module exists to save.
 * - **An absent pane read is not a busy signal.** Holding on silence would mean this command does
 *   nothing at all on a fleet that has not wired `herdr` in yet, and a supervisor whose default is
 *   to do nothing is one nobody notices has stopped working. Only a pane that says `busy` holds.
 * - **A disabled row is still supervised.** `Target.disabled` pauses new spawns and says so in its
 *   own doc — "Live jobs keep running and keep being supervised." The flag that reads like it should
 *   stop us is the one flag that must not.
 */

import type { Target, TargetTable } from "../targets/model.js";
import { NOTHING_REDACTED, redact } from "./redact.js";
import type { Redacted, SecretHit } from "./redact.js";

/** One review, as `gh pr view --json reviews` returns it. */
export interface PullReview {
  /** Stable across ticks — this is what "already forwarded" is keyed on. */
  readonly id: string;
  readonly author: string;
  /** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`, `PENDING`. Free text, matched loosely. */
  readonly state: string;
  readonly submittedAt: string;
  readonly body: string;
}

/**
 * One check run, as `gh pr checks --json` returns it.
 *
 * `id` rather than `name` is the seen key, because a re-run mints a new id. That is the behaviour we
 * want on both sides: a flake re-run that fails again is a new thing to say, and polling the same
 * failed run four times in a row is not.
 */
export interface PullCheck {
  readonly id: string;
  readonly name: string;
  /** `success`, `failure`, `timed_out`, `cancelled`, `neutral`, `skipped`, or `""` while running. */
  readonly conclusion: string;
  readonly url: string;
}

/** A pull request under supervision, assembled by whoever ran `gh`. */
export interface SupervisedPull {
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  /** The commit the checks ran on. Also the identity of a merge conflict — see {@link ConflictState}. */
  readonly headSha: string;
  /** GitHub's `mergeable`: `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` while it computes. */
  readonly mergeable: string;
  readonly draft: boolean;
  readonly reviews: readonly PullReview[];
  readonly checks: readonly PullCheck[];
}

/**
 * What `herdr pane read` returned for the agent working this pull.
 *
 * `busy` is supplied rather than inferred. Whether an agent is mid-turn is `herdr`'s question to
 * answer; guessing it from a screenful of terminal text would mean this module's most consequential
 * decision rested on a prompt-shape heuristic that differs per harness. What we do with `text` is
 * redact it and hand back the same tail the operator would have read.
 */
export interface PaneRead {
  readonly repo: string;
  readonly number: number;
  readonly busy: boolean;
  /** Raw pane output. Redacted on ingest — never stored or printed as it arrives. */
  readonly text: string;
}

/** What one pull has already been told, keyed by {@link pullKey}. */
export interface SeenPull {
  readonly reviews: readonly string[];
  readonly checks: readonly string[];
  /** The head the conflict was last reported at, or `""`. A conflict at a new head is a new thing. */
  readonly conflictSha: string;
}

/** The supervision ledger: every pull we have said something about. */
export interface SupervisionState {
  readonly pulls: ReadonlyMap<string, SeenPull>;
}

export const EMPTY_SEEN: SeenPull = { reviews: [], checks: [], conflictSha: "" };
export const EMPTY_STATE: SupervisionState = { pulls: new Map() };

/** `owner/name#123`. The one spelling, so the file and the feed cannot key differently. */
export const pullKey = (repo: string, number: number): string => `${repo}#${String(number)}`;

export interface SupervisionInput {
  readonly pulls: readonly SupervisedPull[];
  readonly panes: readonly PaneRead[];
  readonly state: SupervisionState;
}

/**
 * Review states worth a turn.
 *
 * `APPROVED` is left out deliberately: it is good news, the human merges either way, and forwarding
 * it asks the agent to respond to a message with no request in it. `DISMISSED` was withdrawn and
 * `PENDING` was never submitted.
 */
export const STEERING_REVIEW_STATES = ["CHANGES_REQUESTED", "COMMENTED"] as const;

/** Conclusions that mean the check failed rather than merely did not pass. See the header on `cancelled`. */
export const FAILING_CONCLUSIONS = ["failure", "timed_out", "action_required", "startup_failure"] as const;

/** The three things an agent can be told about its own PR. Notably not four — see the header. */
export const PULL_SIGNALS = ["review", "check", "conflict"] as const;
export type PullSignal = (typeof PULL_SIGNALS)[number];

/** One line of steering, with the id that will mark it delivered. */
export interface SteeringNote {
  readonly signal: PullSignal;
  /** Review id, check-run id, or head sha — whatever {@link SeenPull} records for that signal. */
  readonly id: string;
  readonly line: string;
}

/**
 * Where the pull stands against `main`, folded with what we already said about it.
 *
 * Split four ways rather than two so the two interesting cases have names. `restated` is a conflict
 * we forwarded at this very head and that is still there: the agent was told and has pushed nothing
 * since, which is the shape of a stuck run. `unknown` is GitHub still computing the merge commit —
 * reading that as "no conflict" would report all-clear at exactly the moment there is no answer.
 */
export const CONFLICT_STATES = ["none", "new", "restated", "unknown"] as const;
export type ConflictState = (typeof CONFLICT_STATES)[number];

/** Why a pull got the steering it got, as a closed set. */
export const SUPERVISION_REASONS = [
  /** New material, and nothing says to wait. */
  "steering",
  /** New material, and the pane says the agent is mid-turn. Held, not marked. */
  "held-mid-turn",
  /** There was material; every piece of it was forwarded on an earlier tick. */
  "nothing-new",
  /** No reviews worth a turn, no failing checks, no conflict. */
  "quiet",
  /** The pull's repository is in no row, so there is no agent to steer. */
  "untargeted",
  /** The row merges its own PRs. Not supervised — see the header. */
  "automerge-on",
  /** A draft: red CI is the expected reading and the reviews are the author's own solicitation. */
  "draft",
] as const;

export type SupervisionReason = (typeof SUPERVISION_REASONS)[number];

export interface SupervisionVerdict {
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  /** The row that owns this repository, or `null`. */
  readonly target: Target | null;
  /** `null` when no pane was read for this pull — which is not the same as "idle". */
  readonly busy: boolean | null;
  readonly reason: SupervisionReason;
  /** Whether {@link advanceState} should record {@link seen}. False for every reason but `steering`. */
  readonly deliver: boolean;
  /** New since the last tick, in signal order. Populated when held, so the operator can see the queue. */
  readonly steering: readonly SteeringNote[];
  readonly conflict: ConflictState;
  /** The redacted pane tail, or `""`. Never the raw text — see `redact.ts`. */
  readonly transcript: string;
  readonly secrets: readonly SecretHit[];
  /** The mark to record once these notes have actually been delivered. */
  readonly seen: SeenPull;
}

export interface Supervision {
  readonly inbox: string;
  readonly verdicts: readonly SupervisionVerdict[];
  /** Repositories that supplied pulls and that no row names. */
  readonly unwatched: readonly string[];
  /** Pane reads for pulls that are not in the feed — a busy signal nothing consulted. */
  readonly orphanPanes: readonly string[];
  /** Pulls the feed listed more than once. The first won; the rest were dropped. */
  readonly duplicates: readonly string[];
}

const upper = (text: string): string => text.trim().toUpperCase();
const lower = (text: string): string => text.trim().toLowerCase();

const steersOn = (state: string): boolean => STEERING_REVIEW_STATES.some((known) => known === upper(state));
const failed = (conclusion: string): boolean => FAILING_CONCLUSIONS.some((known) => known === lower(conclusion));

const firstLine = (text: string, max: number): string => {
  const line = (text.split("\n").find((candidate) => candidate.trim() !== "") ?? "").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
};

/**
 * Decide every pull in the feed.
 *
 * Offline and clock-free, like every other decision in this package: `gh` does the fetching, `herdr`
 * does the reading, and this composes what they produced. Two runs over the same inputs decide the
 * same way, which is what makes a verdict quotable in an issue rather than true when somebody ran it.
 */
export function supervisePulls(table: TargetTable, input: SupervisionInput): Supervision {
  // First row wins, matching `resolveTarget` and `admitSwarmComments`: two rows on one repository is
  // a table problem `checkTargets` already reports, not something to settle differently here.
  const watched = new Map<string, Target>();
  for (const target of table.targets) {
    if (target.repo !== "" && !watched.has(target.repo)) watched.set(target.repo, target);
  }

  const panes = new Map<string, PaneRead>();
  for (const pane of input.panes) {
    const key = pullKey(pane.repo, pane.number);
    if (!panes.has(key)) panes.set(key, pane);
  }

  const verdicts: SupervisionVerdict[] = [];
  const duplicates: string[] = [];
  const unwatched = new Set<string>();
  const decided = new Set<string>();

  for (const pull of input.pulls) {
    const key = pullKey(pull.repo, pull.number);
    if (decided.has(key)) {
      duplicates.push(key);
      continue;
    }
    decided.add(key);
    const target = watched.get(pull.repo) ?? null;
    if (target === null) unwatched.add(pull.repo);
    verdicts.push(
      superviseOne({
        pull,
        target,
        pane: panes.get(key) ?? null,
        seen: input.state.pulls.get(key) ?? EMPTY_SEEN,
        botLogin: table.botLogin,
      }),
    );
  }

  const orphanPanes = [...panes.keys()].filter((key) => !decided.has(key));

  return { inbox: table.inbox, verdicts, unwatched: [...unwatched], orphanPanes, duplicates };
}

interface Candidate {
  readonly pull: SupervisedPull;
  readonly target: Target | null;
  readonly pane: PaneRead | null;
  readonly seen: SeenPull;
  readonly botLogin: string;
}

function superviseOne(candidate: Candidate): SupervisionVerdict {
  const { pull, target, pane, seen, botLogin } = candidate;

  const read: Redacted = pane === null ? NOTHING_REDACTED : redact(pane.text);
  const conflict = conflictState(pull, seen);

  const base = {
    repo: pull.repo,
    number: pull.number,
    url: pull.url,
    target,
    busy: pane === null ? null : pane.busy,
    conflict,
    transcript: read.text,
    secrets: read.hits,
  } as const;

  // The three reasons that settle a pull before any of its material is looked at. Ordered: a pull in
  // an unwatched repository has no row to read `automerge` off, and `automerge` decides whether the
  // draft question is even ours to ask.
  const noSteering = (reason: SupervisionReason): SupervisionVerdict => ({
    ...base,
    reason,
    deliver: false,
    steering: [],
    seen,
  });
  if (target === null) return noSteering("untargeted");
  if (target.automerge) return noSteering("automerge-on");
  if (pull.draft) return noSteering("draft");

  const seenReviews = new Set(seen.reviews);
  const seenChecks = new Set(seen.checks);

  // A review by the bot is the agent's own account writing on the agent's own PR. Forwarding it
  // hands the agent its own words back and asks it to respond to them.
  const reviews = pull.reviews.filter(
    (review) => steersOn(review.state) && (botLogin === "" || review.author !== botLogin),
  );
  const checks = pull.checks.filter((check) => failed(check.conclusion));
  const candidates = reviews.length + checks.length + (conflict === "none" || conflict === "unknown" ? 0 : 1);

  const steering: SteeringNote[] = [];
  for (const review of reviews) {
    if (seenReviews.has(review.id)) continue;
    const body = firstLine(review.body, 160);
    steering.push({
      signal: "review",
      id: review.id,
      line:
        `review from @${review.author || "(deleted)"} (${upper(review.state)}) on ${pull.repo}#${String(pull.number)}` +
        (body === "" ? "" : `: ${body}`),
    });
  }
  for (const check of checks) {
    if (seenChecks.has(check.id)) continue;
    steering.push({
      signal: "check",
      id: check.id,
      line: `check failed: ${check.name} (${lower(check.conclusion)})${check.url === "" ? "" : ` — ${check.url}`}`,
    });
  }
  if (conflict === "new") {
    steering.push({
      signal: "conflict",
      id: pull.headSha,
      line: `merge conflict at ${pull.headSha} — rebase before the next push`,
    });
  }

  if (candidates === 0) return noSteering("quiet");
  if (steering.length === 0) return noSteering("nothing-new");
  if (pane?.busy === true) return { ...base, reason: "held-mid-turn", deliver: false, steering, seen };

  return { ...base, reason: "steering", deliver: true, steering, seen: mark(seen, steering, pull.headSha) };
}

/**
 * Where the pull stands, folded with what we already said.
 *
 * `restated` needs both halves: the pull conflicts *and* the sha we recorded is this one. A conflict
 * at a head we have not spoken about is `new` even when an older conflict is on file, because a push
 * happened in between and the agent's last word on the subject is stale.
 */
function conflictState(pull: SupervisedPull, seen: SeenPull): ConflictState {
  const mergeable = upper(pull.mergeable);
  if (mergeable === "UNKNOWN" || mergeable === "") return "unknown";
  if (mergeable !== "CONFLICTING") return "none";
  return seen.conflictSha !== "" && seen.conflictSha === pull.headSha ? "restated" : "new";
}

/** The mark a delivered tick leaves behind. Only ever called on `deliver: true` — see the header. */
function mark(seen: SeenPull, steering: readonly SteeringNote[], headSha: string): SeenPull {
  const reviews = new Set(seen.reviews);
  const checks = new Set(seen.checks);
  let conflictSha = seen.conflictSha;
  for (const note of steering) {
    if (note.signal === "review") reviews.add(note.id);
    if (note.signal === "check") checks.add(note.id);
    if (note.signal === "conflict") conflictSha = headSha;
  }
  return { reviews: [...reviews], checks: [...checks], conflictSha };
}

/**
 * The state after a tick whose `steering` verdicts were actually delivered.
 *
 * Pulls absent from this tick's feed keep their marks. The feed is a window — `gh pr list` returns
 * what is open now — and dropping a pull's marks because it fell out of one page would re-forward
 * every review on it the moment it came back.
 */
export function advanceState(state: SupervisionState, supervision: Supervision): SupervisionState {
  const pulls = new Map(state.pulls);
  for (const verdict of supervision.verdicts) {
    if (!verdict.deliver) continue;
    pulls.set(pullKey(verdict.repo, verdict.number), verdict.seen);
  }
  return { pulls };
}

export interface SupervisionTally {
  readonly pulls: number;
  /** Pulls with something to say and nothing stopping it. */
  readonly steering: number;
  /** Lines actually forwarded — held notes are not counted, because they were not sent. */
  readonly notes: number;
  readonly held: number;
  /** Everything the tick had nothing to say about, whatever the reason. `untargeted` is its own line. */
  readonly quiet: number;
  readonly untargeted: number;
  /** Pulls conflicting with the base, whether or not this tick was the one that said so. */
  readonly conflicts: number;
  readonly redactions: number;
}

export function tallySupervision(supervision: Supervision): SupervisionTally {
  const by = (reason: SupervisionReason): number =>
    supervision.verdicts.filter((verdict) => verdict.reason === reason).length;
  return {
    pulls: supervision.verdicts.length,
    steering: by("steering"),
    notes: supervision.verdicts.reduce((total, verdict) => total + (verdict.deliver ? verdict.steering.length : 0), 0),
    held: by("held-mid-turn"),
    quiet: by("quiet") + by("nothing-new") + by("draft") + by("automerge-on"),
    untargeted: by("untargeted"),
    conflicts: supervision.verdicts.filter((verdict) => verdict.conflict === "new" || verdict.conflict === "restated")
      .length,
    redactions: supervision.verdicts.reduce(
      (total, verdict) => total + verdict.secrets.reduce((sum, hit) => sum + hit.count, 0),
      0,
    ),
  };
}

/**
 * Every way a supervision tick can be wrong, as a closed set.
 *
 * Nothing here fires for a pull that is simply quiet, or held, or already up to date. Those are the
 * fleet's normal states, and a check that goes red for the normal state is a check somebody mutes,
 * taking the real problems with it.
 */
export const SUPERVISION_REFUSALS = [
  /** A pane read carried something shaped like a credential. The one signal that means rotate. */
  "secret-in-transcript",
  /** GitHub had not computed mergeability, so "no conflict" was not observed, only assumed. */
  "mergeable-unknown",
  /** We forwarded this conflict at this very head and the head has not moved. */
  "conflict-not-cleared",
  /** A pull in a repository no row names — fetched, decided, and steering nobody. */
  "pull-untargeted",
  /** The same pull twice in the feed: two dumps concatenated, and the second silently dropped. */
  "duplicate-pull",
  /** A pane read for a pull the feed does not carry — a busy signal nothing consulted. */
  "pane-without-pull",
] as const;

export type SupervisionRefusal = (typeof SUPERVISION_REFUSALS)[number];

export interface SupervisionProblem {
  readonly reason: SupervisionRefusal;
  readonly message: string;
  /** The pull it is about, as {@link pullKey} spells it, or `null` for a whole-tick problem. */
  readonly pull: string | null;
}

export function checkSupervision(supervision: Supervision): readonly SupervisionProblem[] {
  const problems: SupervisionProblem[] = [];
  const say = (reason: SupervisionRefusal, pull: string | null, message: string): void => {
    problems.push({ reason, message, pull });
  };

  for (const verdict of supervision.verdicts) {
    const key = pullKey(verdict.repo, verdict.number);
    if (verdict.secrets.length > 0) {
      const kinds = verdict.secrets.map((hit) => `${hit.kind}×${String(hit.count)}`).join(", ");
      say(
        "secret-in-transcript",
        key,
        `the pane read carried ${kinds} — redacted here, but it reached a terminal, so rotate it`,
      );
    }
    if (verdict.conflict === "unknown") {
      say(
        "mergeable-unknown",
        key,
        "GitHub had not computed mergeability yet — this tick did not observe the absence of a conflict, " +
          "it assumed it; re-run once the merge commit settles",
      );
    }
    if (verdict.conflict === "restated") {
      say(
        "conflict-not-cleared",
        key,
        "the conflict was forwarded at this same head on an earlier tick and nothing has been pushed since — " +
          "the agent has been told and is not acting",
      );
    }
    if (verdict.reason === "untargeted") {
      say("pull-untargeted", key, `no target row names ${verdict.repo}, so there is no agent to steer`);
    }
  }
  for (const key of supervision.duplicates) {
    say("duplicate-pull", key, "listed more than once in the feed — the first won and the rest were dropped");
  }
  for (const key of supervision.orphanPanes) {
    say(
      "pane-without-pull",
      key,
      "a pane was read for a pull the feed does not carry, so its busy signal decided nothing",
    );
  }
  return problems;
}

const REASON_TEXT: Readonly<Record<SupervisionReason, string>> = {
  steering: "new since the last tick, and the agent is not mid-turn",
  "held-mid-turn": "new, but the pane says the agent is working — held for the next tick, not marked",
  "nothing-new": "everything on this pull was forwarded on an earlier tick",
  quiet: "no review worth a turn, no failing check, no conflict",
  untargeted: "no target row names this repository",
  "automerge-on": "the row merges its own PRs — not supervised; see 'dsh-forge targets check'",
  draft: "a draft, where red CI is the expected reading",
};

export const describeSupervisionReason = (reason: SupervisionReason): string => REASON_TEXT[reason];

export const describeSupervisionProblem = (problem: SupervisionProblem): string =>
  problem.pull === null ? problem.message : `${problem.pull}: ${problem.message}`;
