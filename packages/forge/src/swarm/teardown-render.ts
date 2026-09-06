/**
 * Terminal output for the teardown tick.
 *
 * Ordered by what is owed rather than by state name, because the reader's question is never "what
 * states exist" — it is "what is still running that should not be". So `expired` and `settling`
 * lead, `stopped` follows because it is one API call from done, and `running` collapses to a count.
 *
 * Every non-`running` line carries the evidence its state rests on. That is the point of the whole
 * module: a reader who cannot see whether "stopped" was measured or merely reported has exactly the
 * visibility the three agents in #77 exploited by accident.
 */

import {
  TEARDOWN_STATES,
  describeTeardownProblem,
  describeTeardownState,
  span,
  tallyTeardown,
} from "./teardown.js";
import type { Teardown, TeardownProblem, TeardownState, TeardownVerdict } from "./teardown.js";

const truncateInline = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** States printed as a count rather than a list: nothing is owed and nothing is wrong. */
const COLLAPSED: readonly TeardownState[] = ["running", "closed"];

/** In the order they are owed, with the evidence each rests on. */
export function renderTeardown(teardown: Teardown, problems: readonly TeardownProblem[]): string {
  const tally = tallyTeardown(teardown);
  const lines: string[] = [
    `${teardown.inbox} ← ${String(tally.runs)} run(s) · ${String(tally.expired)} expired · ` +
      `${String(tally.settling)} settling · ${String(tally.closable)} to close · ` +
      `${String(tally.orphans)} orphan(s)`,
    `at ${teardown.at} · settle ${span(teardown.settleMs)} · stuck after ${span(teardown.stuckMs)}`,
    "",
  ];

  for (const [state, heading] of SECTIONS) {
    const listed = teardown.verdicts.filter((verdict) => verdict.state === state);
    if (listed.length === 0) continue;
    lines.push(`${state} (${String(listed.length)}) — ${heading}`);
    for (const verdict of listed) lines.push(...renderVerdict(verdict));
    lines.push("");
  }

  const counts = countBy(teardown.verdicts);
  if (counts.length > 0) {
    lines.push("nothing owed");
    for (const [state, count] of counts) {
      lines.push(`  ${String(count).padStart(4)}  ${state} — ${describeTeardownState(state)}`);
    }
    lines.push("");
  }

  if (tally.unverified > 0) {
    // Ahead of the refusals as well as inside them: this count is the difference between a fleet
    // that was observed to stop and one that said it had.
    lines.push(
      `${String(tally.unverified)} run(s) rest on something other than an artefact — nothing here ` +
        "will close their inbox issues",
      "",
    );
  }

  if (problems.length > 0) {
    lines.push(`${String(problems.length)} problem(s)`);
    for (const problem of problems) {
      lines.push(`  ${problem.reason}  ${truncateInline(describeTeardownProblem(problem), 108)}`);
    }
  }

  return lines.join("\n").trimEnd();
}

/** Sections in the order the reader needs them, which is the order work is owed. */
const SECTIONS: readonly (readonly [TeardownState, string])[] = [
  ["expired", "past the deadline and still writing"],
  ["settling", "reported an exit; the files disagree, so the issue stays open"],
  ["stopped", "verified down — the inbox issue is all that is left"],
  ["orphaned", "an open inbox issue with no run; the next poll re-dispatches it"],
];

/** Counts in {@link TEARDOWN_STATES} order, so two runs print the same rows in the same places. */
function countBy(verdicts: readonly TeardownVerdict[]): readonly (readonly [TeardownState, number])[] {
  const counts = new Map<TeardownState, number>();
  for (const verdict of verdicts) {
    if (!COLLAPSED.some((state) => state === verdict.state)) continue;
    counts.set(verdict.state, (counts.get(verdict.state) ?? 0) + 1);
  }
  return TEARDOWN_STATES.flatMap((state) => {
    const count = counts.get(state);
    return count === undefined ? [] : [[state, count] as const];
  });
}

/** One run: what it is, where it is against its deadline, and what the files say. */
function renderVerdict(verdict: TeardownVerdict): readonly string[] {
  const issue = verdict.inboxIssue === null ? "(no inbox issue)" : `inbox#${String(verdict.inboxIssue)}`;
  const harness = verdict.harness === "" ? "" : `  ${verdict.harness}`;
  const lines = [`  ${verdict.ref}${harness}  ${issue}`];

  if (verdict.state !== "orphaned") {
    // Both the moment and where it came from: an operator deciding whether to stop a run wants the
    // wall time, and a `timeout:` that was discarded onto the default is the reason to distrust it.
    const named = verdict.defaulted
      ? `${verdict.timeout === "" ? "none" : verdict.timeout} → default`
      : verdict.timeout;
    lines.push(
      `      deadline  ${verdict.deadline ?? "unreachable"}  timeout ${named}  overdue ${span(verdict.overdueMs)}`,
    );
    const where = verdict.newest === null ? "nothing observed" : `${verdict.newest.path} (${bytes(verdict.newest.bytes)})`;
    lines.push(`      evidence  ${verdict.evidence}  ${where}  quiet ${span(verdict.quietMs)}`);
  }
  if (verdict.steps.length > 0) lines.push(`      owed  ${verdict.steps.join(" → ")}`);
  return lines;
}

/** A size, for reading. Base ten, because that is what the operator's `ls -l` reports. */
function bytes(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "?";
  if (count < 1000) return `${String(Math.round(count))}b`;
  if (count < 1000 * 1000) return `${(count / 1000).toFixed(1)}kb`;
  return `${(count / (1000 * 1000)).toFixed(1)}mb`;
}
