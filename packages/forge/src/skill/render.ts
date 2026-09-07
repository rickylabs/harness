/**
 * The skill that ships with the taxonomy.
 *
 * It is rendered from the labels that were actually resolved for the target repository rather than
 * shipped as a fixed document, because a skill that lists `area:aspire` in a repo with no Aspire
 * teaches an agent to invent labels. Everything repo-shaped in the text below comes from the plan
 * that installed it, so the skill and the repository cannot disagree.
 */

import {
  CLOSE_GATE_OVERRIDE,
  OWNER_DECISION,
  STATUS_LIFECYCLE,
  STATUS_READY_MERGE,
  STATUS_TERMINAL,
  type LabelFamily,
  type LabelSpec,
} from "../labels/taxonomy.js";

export interface SkillContext {
  readonly repo: string;
  readonly specs: readonly LabelSpec[];
  /** Prefix the repository uses for lane ownership — `topic:`, `orchestrator:` or `lane:`. */
  readonly lanePrefix: string;
  /**
   * The label that starts an agent run in this repository, if one does.
   *
   * Absent by default, and absent renders nothing: most repositories have no dispatcher, and a
   * skill that warns about one teaches an agent to be careful of a thing that does not exist. When
   * it is set, the label stops being a tag and becomes a side effect, which is a fact about the
   * repository an agent cannot find out by looking at the labels.
   */
  readonly dispatchLabel?: string | null;
  /**
   * Labels this repository still has but no longer stamps.
   *
   * Rendered because they remain in the label picker, which is where an agent that has not read
   * this file looks things up. A retired label named nowhere reads as a live one.
   */
  readonly retired?: readonly LabelSpec[];
}

const namesIn = (specs: readonly LabelSpec[], family: LabelFamily): readonly string[] =>
  specs.filter((s) => s.family === family).map((s) => s.name);

/** `type:feat, type:fix` -> "`feat`, `fix`" — the prefix is already in the bullet's label. */
const suffixes = (names: readonly string[], prefix: string): string =>
  names.map((n) => `\`${n.startsWith(prefix) ? n.slice(prefix.length) : n}\``).join(", ");

/**
 * What an agent has to know before it applies the label that starts a run.
 *
 * The body of a dispatched issue is a prompt, and a dispatcher reads it to find one — not to render
 * it. The rules below are written as a house style rather than as claims about any particular
 * parser: costing nothing to follow and surviving every parser, they are worth keeping even where
 * the local one would have tolerated the alternative.
 */
function dispatchSection(label: string | null): readonly string[] {
  if (label === null) return [];
  return [
    "## Dispatching a run",
    "",
    `\`${label}\` is not a tag, it is a trigger: applying it to an issue starts an agent on that`,
    "issue's body. Label deliberately — there is no draft state, and tidying up the board is enough",
    "to spend a run.",
    "",
    "The body is a prompt, so write it for a reader that is looking for one:",
    "",
    "- **No fenced code blocks.** Use four-space indented blocks and single-backtick inline code. A",
    "  dispatcher that stops at a fence takes everything above it and runs, so the failure is a brief",
    "  that is quietly half as long as the one you wrote — no error, and nothing on the issue to say",
    "  the agent read less than what is there.",
    "- **No `#` inside a value** on any `key: value` line the dispatcher reads as an option, where",
    "  it is likely to mean the start of a comment.",
    "",
    "Then read the brief back with `gh issue view` before you apply the label. What that prints is",
    "the whole prompt only if it is the whole of what you wrote.",
    "",
  ];
}

/**
 * How to hand work back to a person without the board reporting it as running.
 *
 * The one section here addressed to an agent that is *stopping*. Every phase in the lifecycle
 * describes a state of agent work, so an agent that hits a decision it cannot make has no true label
 * to move to, leaves the item where it is, and the board keeps counting it as in flight — the
 * failure this flag exists to fix, and it is only fixed if the agent that stops applies the flag.
 *
 * Rendered only where the label is actually installed, per this file's own rule: naming a label a
 * repository does not have teaches an agent to invent one.
 */
function ownerDecisionSection(specs: readonly LabelSpec[]): readonly string[] {
  if (!specs.some((s) => s.name === OWNER_DECISION)) return [];
  return [
    "## When the next move is not yours",
    "",
    `Apply \`${OWNER_DECISION}\` the moment you stop because a **person** has to decide something —`,
    "an authority call, a name that goes in public, a spend, a fork in the design that is not yours to",
    "take. Not for a red build, a dependency, or a review you are waiting on: those have runners",
    "already, and the board can see them.",
    "",
    "Not for a **half**-gated item either. Where the decision blocks one part of the work and leaves",
    "another part buildable, the flag would claim nothing can move while you still can — build the",
    "half that does not depend on the answer, and raise the rest as its own item. This list is worth",
    "reading only while it is short, and flagging everything that merely *touches* a decision is how",
    "it stops being short.",
    "",
    "**Leave the `status:` label exactly where it is.** The phase records how far the work got; the",
    "flag records who is next. They are different facts and the item needs both — a half-shipped item",
    "moved into some holding column loses the half that shipped, and the flag is what keeps you from",
    "having to choose.",
    "",
    "Three parts, one action:",
    "",
    "1. Comment on the item with **the decision, not the situation** — the options you can see, what",
    "   you would do, and what unblocks on each answer. A flag over a comment that only says \"stuck\"",
    "   moves the work from a queue nobody is watching to a list nobody can act on.",
    "2. Apply the flag. It is what takes the item out of the running count and puts it on the short",
    "   list the owner reads first.",
    "3. Stop working the item. That is the claim the flag makes; carry on and it is false.",
    "",
    "Remove the flag in the same action as the answer — whoever acts on the decision drops it. The",
    "list is worth reading only while it is short, so a flag that outlives its question is the same",
    "silence one level up. The board reports one left behind as `stale-owner-decision`.",
    "",
  ];
}

/**
 * The labels that are still in the picker but no longer in the taxonomy.
 *
 * Rendered only when there are some, because a heading over an empty list reads as a warning about
 * a hazard this repository does not have. Where there are, naming them here is the point: an agent
 * that picks a label off the list has no other way to find out one of them is a dead end.
 */
function retiredSection(retired: readonly LabelSpec[]): readonly string[] {
  if (retired.length === 0) return [];
  return [
    "## Retired labels",
    "",
    "Still on the repository, and still on the items that carried them, so the record those items",
    "hold stays readable. Do not apply them to new work — they are listed here precisely because",
    "the label picker cannot say any of this:",
    "",
    ...retired.map((s) => `- \`${s.name}\` — use \`${s.supersededBy ?? "nothing"}\` instead.`),
    "",
  ];
}

export function renderSkill(ctx: SkillContext): string {
  const bullet = (family: LabelFamily, prefix: string, gloss: string): readonly string[] => {
    const names = namesIn(ctx.specs, family);
    if (names.length === 0) return [];
    // `flag` is the one family with no namespace, so it gets a word instead of a prefix.
    const heading = prefix === "" ? "flags" : `\`${prefix}\``;
    return [`- ${heading} — ${suffixes(names, prefix)}. ${gloss}`];
  };

  return [
    "---",
    "name: board-process",
    "description: >-",
    `  Author branches, pull requests, issues and the namespaced label taxonomy for ${ctx.repo}.`,
    "  Use this whenever you are about to open or update a PR or issue, advance a work item's phase,",
    '  split an umbrella into sub-PRs, or apply labels — even when the ask is just "open a PR",',
    '  "push this", or "mark it ready for review". Getting the branch name, body and labels right the',
    "  first time is what keeps the board readable without anyone having to ask for a status update.",
    "---",
    "",
    "# Board process",
    "",
    "Labels are a **view and a trigger**, not the record. The record is the change itself and the",
    "evidence behind it. But the view is what a human reads when they ask \"where is this?\", so a board",
    "that lags the work is the same as no board — and the only thing that keeps it from lagging is",
    "moving the label in the *same action* as the work it describes.",
    "",
    "This file is generated from the taxonomy installed on this repository. If a label you want is not",
    "listed below, it does not exist yet: add it to `.github/labels.yml` and run `dsh-forge labels",
    "apply`. Do not invent one at the point of use — a typo'd label is invisible to every filter.",
    "",
    "## The one rule that carries the rest",
    "",
    "**Exactly one `status:` label on an open issue or PR, at every point in its life.** The `status:`",
    "label *is* the board column. Two of them means the column is a lie; none means the item is",
    "invisible. Every other family here is additive and forgiving. This one is not.",
    "",
    "## Lifecycle",
    "",
    "```",
    STATUS_LIFECYCLE.join(" → "),
    "```",
    "",
    "Move the label in the same action as the phase it records. A PR arriving at merge with a stale or",
    `missing status has skipped a gate — \`${STATUS_READY_MERGE}\` is a claim that the gates ran, so setting it`,
    "early is not optimism, it is a false green.",
    "",
    "On close:",
    "",
    `- **Completed** (merged, or done by hand) — remove the phase label and apply \`${STATUS_TERMINAL}\``,
    "  in the same action.",
    "- **Not planned / wontfix** — remove the phase label and leave no `status:` at all. It did not",
    "  ship, and marking it shipped puts a lie in the one field people trust.",
    "- **Reopened** — restore exactly one non-terminal phase label.",
    "",
    `\`${CLOSE_GATE_OVERRIDE}\` is not a status and does not replace one. It is an audited exception`,
    "to the close gate, carried *alongside* whichever phase the item is actually in, and the",
    "reasoning goes in a comment on the item rather than in the label.",
    "",
    ...ownerDecisionSection(ctx.specs),
    "## Families",
    "",
    ...bullet("type", "type:", "Every open issue and PR carries exactly one."),
    ...bullet("priority", "priority:", "`p0` is a release blocker."),
    ...bullet("area", "area:", "Derived from this repository's packages; additive."),
    ...bullet("lane", `${ctx.lanePrefix}:`, "Which lane owns the item."),
    ...bullet("wave", "wave:", "Which scheduling band the item belongs to."),
    ...bullet("gate", "gate:", "Opt in to an expensive CI gate on this PR."),
    ...bullet("ci", "ci:", "`ci:full` wins over every skip label."),
    ...bullet("epic", "epic:", "Groups everything under one program epic."),
    ...bullet("eval", "eval:", "Evaluator routing, as data on the issue rather than prose in a brief."),
    ...bullet("flag", "", "Cross-cutting and additive; never the board column."),
    "",
    "`eval:skip` is the only label here that turns a gate off. Applying it without saying, in the PR,",
    "what evidence stands in for the evaluation is how a false green reaches the default branch.",
    "",
    ...retiredSection(ctx.retired ?? []),
    "## Branch naming",
    "",
    "`<type>/<slug>` — lowercase, kebab-case, no trailing dates. The type matches the `type:` label. A",
    "sub-branch of an umbrella keeps the umbrella's slug as its prefix, so the relationship is legible",
    "in `git branch` alone: `feat/thing` → `feat/thing-adapter`.",
    "",
    "## Umbrella and sub-PRs",
    "",
    "- **Umbrella** — the coordinating PR for a multi-slice effort. Labelled `type:umbrella`; its body",
    "  carries the slice checklist and links every sub-PR.",
    "- **Sub-PR** — one slice on its own branch, targeting the **umbrella branch**, not the default",
    "  branch. Labelled `type:sub-pr`, linking back with `Part of #<umbrella>`.",
    "- Split only when the slices are genuinely independent. Slices that all edit the same manifest",
    "  will conflict with each other: keep those sequential on one branch, one commit per slice.",
    "",
    "## Closing keywords are not optional",
    "",
    "Every PR that completes an issue carries `Closes #<n>` in its body, so the issue closes on merge",
    "and nobody has to sweep the board by hand. Use `Part of #<n>` for a slice that advances an issue",
    "without finishing it. A merged PR with no closing keyword leaves a finished change and an open",
    "item asserting the opposite — which is exactly the drift this taxonomy exists to prevent.",
    "",
    "**Aim it at the sub-issue you implemented, never at the umbrella.** An umbrella is a container:",
    "it closes when its last child does, and never because one of them did. GitHub does not know the",
    "difference and will honour whatever number you wrote, so a keyword pointing at an epic closes it",
    "over its open children and every board projection after that reports unstarted work as delivered.",
    "The epic number is the one you have in context while working a sub-task, which is exactly why",
    "this is easy to get wrong. `Closes #<task>`, `Part of #<epic>` — both lines, every time.",
    "",
    "## PR body",
    "",
    "```markdown",
    "## Summary",
    "",
    "<1–3 sentences: what changes, and why.>",
    "",
    "## Scope",
    "",
    "Closes #<task>           <!-- the issue this PR finishes -->",
    "Part of #<umbrella>      <!-- the epic it sits under; never Closes -->",
    "",
    "## Validation",
    "",
    "- `<command>` — <the real result, including exit status>",
    "",
    "## Drift / Debt",
    "",
    '- <accepted debt, or "none">',
    "```",
    "",
    "Keep `Validation` honest: paste real results, and if a gate was skipped say which and why. A",
    "ticked box is not evidence of the thing it claims.",
    "",
    ...dispatchSection(ctx.dispatchLabel ?? null),
    "## When you advance a phase",
    "",
    "One action, three parts, in this order: post the phase comment with its evidence, move the",
    "`status:` label, then update the item's checklist. Doing the first without the second is precisely",
    "how a board ends up a week behind the work it claims to describe.",
    "",
  ].join("\n");
}
