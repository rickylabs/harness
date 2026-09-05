/**
 * What the `status:` label should become when an item ends.
 *
 * The taxonomy has always stated this rule — the generated skill narrates it at close time, and
 * `dsh-board check` reports every item that breaks it. Neither of those *applies* it. On this
 * repository that gap ran to fourteen merged pull requests sitting in no column, each one closed
 * correctly by a human who then had no reason to think about a label again.
 *
 * So this module is the rule as a function: labels in, the mutation out. Nothing here talks to
 * GitHub. A workflow can apply what it returns, a person can read what it returns, and a test can
 * assert on what it returns without a network — and none of the three has to restate the rule,
 * which is the failure mode a hardcoded `status:shipped` in a YAML file would reintroduce.
 */

import { STATUS_TERMINAL, statusLabelsOf } from "./taxonomy.js";

/**
 * How an item ended, in the taxonomy's vocabulary rather than GitHub's.
 *
 * GitHub says `merged` for a pull request and `state_reason` for an issue, and those are two
 * different words for the same board fact. {@link settleEvent} is the one place that translation
 * happens, so these three cases cover both kinds of item and nothing downstream has to know which
 * kind it is holding.
 */
export type Ending = "completed" | "not-planned" | "reopened";

/** Every value {@link Ending} admits, for a CLI that has to validate a string. */
export const ENDINGS: readonly Ending[] = ["completed", "not-planned", "reopened"];

export function isEnding(value: string): value is Ending {
  return (ENDINGS as readonly string[]).includes(value);
}

/**
 * The mutation, as two lists and the sentence explaining them.
 *
 * `add` and `remove` are both empty when the item is already in the right shape, which is the
 * common case on any item an agent labelled properly on its way through. A caller can treat
 * `changed === false` as "do nothing" without comparing lists itself.
 */
export interface Settlement {
  readonly ending: Ending;
  readonly add: readonly string[];
  readonly remove: readonly string[];
  readonly changed: boolean;
  /** One line, addressed to whoever reads the run log and wonders why their label moved. */
  readonly note: string;
}

const isTerminal = (name: string): boolean => name.toLowerCase() === STATUS_TERMINAL;

/**
 * The status label an item should carry once it has ended, given the labels it carries now.
 *
 * Three endings, three shapes:
 *
 * - **completed** — a merged pull request, or an issue closed as completed. The phase label is
 *   replaced by {@link STATUS_TERMINAL}: the work is done, and the column it was in is no longer
 *   where it lives.
 * - **not-planned** — a pull request closed unmerged, or an issue closed as not planned. Every
 *   `status:` label comes off and none goes on. There is no column for abandoned work on purpose;
 *   an item that never shipped must not sit under a heading that says it did.
 * - **reopened** — only {@link STATUS_TERMINAL} comes off. Which phase the work resumes in is a
 *   judgement about the work, and this function cannot see the work. Stripping the terminal label
 *   turns a claim that is now false into a gap `dsh-board check` already reports as `no-status`,
 *   so a person is asked the question rather than answered for.
 *
 * Case is GitHub's: label names are unique case-insensitively there, so a `Status:Shipped` already
 * on the item counts as terminal and is left exactly as it is. Removing it to add the lowercase
 * spelling would be churn that reads, in the timeline, like something happened.
 */
export function settleStatus(labelNames: readonly string[], ending: Ending): Settlement {
  const statuses = statusLabelsOf(labelNames);
  const terminal = statuses.filter(isTerminal);
  const phases = statuses.filter((n) => !isTerminal(n));

  const remove = ending === "completed" ? phases : ending === "not-planned" ? statuses : terminal;
  const add = ending === "completed" && terminal.length === 0 ? [STATUS_TERMINAL] : [];
  const changed = add.length > 0 || remove.length > 0;

  return { ending, add, remove, changed, note: note(ending, add, remove, statuses) };
}

/**
 * What a webhook payload says happened, once the two vocabularies have been reconciled.
 *
 * `kind` is spelled the way `gh` spells its subcommands — `gh pr edit`, `gh issue edit` — because
 * the caller's next move is that command and a second mapping table would be one more place to be
 * wrong. `ending` is `null` when GitHub named no ending this tool is willing to act on.
 */
export interface EventSettlement extends Omit<Settlement, "ending"> {
  readonly kind: "pr" | "issue";
  readonly number: number;
  readonly ending: Ending | null;
}

interface Payload {
  readonly action?: unknown;
  readonly issue?: unknown;
  readonly pull_request?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

/** `labels` is an array of objects on every payload that carries it; anything else is not a label. */
function labelNamesOf(item: Record<string, unknown>): readonly string[] {
  const raw = item["labels"];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => asRecord(entry)?.["name"])
    .filter((name): name is string => typeof name === "string");
}

/**
 * Translate a `pull_request` or `issues` webhook payload into a settlement.
 *
 * This is the only place GitHub's words are read. A pull request says `merged`; an issue says
 * `state_reason`, whose values are `completed`, `not_planned`, `duplicate` and — on older items and
 * some API paths — nothing at all. They describe one board fact in three vocabularies, and keeping
 * the translation here rather than in a workflow's shell means it can be tested against the actual
 * payload shapes instead of reviewed by eye.
 *
 * Anything it cannot classify comes back with `ending: null` and no mutation. That is the same
 * refusal `dsh-board` makes when it maps an unrecognised `stateReason` to null rather than to
 * `not-planned`: a close nobody has classified is a question for a person, and answering it with
 * `status:shipped` would put a claim on the board that no one made.
 *
 * Returns `null` for a payload that is neither an issue nor a pull request, which a correctly
 * configured `on:` block cannot produce — so the caller can treat it as a misconfiguration rather
 * than as a no-op it should keep quiet about.
 */
export function settleEvent(payload: unknown): EventSettlement | null {
  const event: Payload = asRecord(payload) ?? {};
  const pr = asRecord(event.pull_request);
  const issue = pr ? null : asRecord(event.issue);
  const item = pr ?? issue;
  if (!item) return null;

  const kind = pr ? "pr" : "issue";
  const number = typeof item["number"] === "number" ? item["number"] : 0;
  const labels = labelNamesOf(item);
  const ending = endingOf(event.action, pr, issue);

  if (ending === null) {
    return {
      kind,
      number,
      ending,
      add: [],
      remove: [],
      changed: false,
      note: `${kind} #${number}: GitHub named no ending this tool can act on — leaving it to a person`,
    };
  }
  return { ...settleStatus(labels, ending), kind, number, ending };
}

function endingOf(
  action: unknown,
  pr: Record<string, unknown> | null,
  issue: Record<string, unknown> | null,
): Ending | null {
  if (action === "reopened") return "reopened";
  if (action !== "closed") return null;
  if (pr) {
    // Absent rather than false is not the same claim, and only one of them means abandoned. The
    // field is always present on a real payload; treating a missing one as `false` would strip a
    // merged pull request's label on the day GitHub changes the shape.
    return typeof pr["merged"] === "boolean" ? (pr["merged"] ? "completed" : "not-planned") : null;
  }
  switch (issue?.["state_reason"]) {
    case "completed":
      return "completed";
    // A duplicate did not ship. It is the not-planned shape under a different name.
    case "not_planned":
    case "duplicate":
      return "not-planned";
    default:
      return null;
  }
}

function note(
  ending: Ending,
  add: readonly string[],
  remove: readonly string[],
  statuses: readonly string[],
): string {
  if (add.length === 0 && remove.length === 0) {
    if (ending === "completed") return `already ${STATUS_TERMINAL}`;
    if (statuses.length === 0) return "no status label to settle";
    return `nothing to settle — ${statuses.join(", ")} is not a terminal status`;
  }
  const moved = remove.length > 0 ? `removing ${remove.join(", ")}` : "";
  switch (ending) {
    case "completed":
      return remove.length > 0
        ? `completed: ${moved}, adding ${STATUS_TERMINAL}`
        : `completed: adding ${STATUS_TERMINAL}`;
    case "not-planned":
      return `not planned: ${moved} — abandoned work carries no status label`;
    case "reopened":
      return `reopened: ${moved} — name the phase it resumes in`;
  }
}
