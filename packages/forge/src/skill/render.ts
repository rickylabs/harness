/**
 * The skill that ships with the taxonomy.
 *
 * It is rendered from the labels that were actually resolved for the target repository rather than
 * shipped as a fixed document, because a skill that lists `area:aspire` in a repo with no Aspire
 * teaches an agent to invent labels. Everything repo-shaped in the text below comes from the plan
 * that installed it, so the skill and the repository cannot disagree.
 */

import {
  STATUS_LIFECYCLE,
  STATUS_OVERRIDE,
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
}

/** The phase that gates merge. Named so the skill text cannot drift from the lifecycle array. */
const MERGE_GATE = "status:ready-merge";

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
    `missing status has skipped a gate — \`${MERGE_GATE}\` is a claim that the gates ran, so setting it`,
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
    `\`${STATUS_OVERRIDE}\` sits outside the lifecycle. It is for an audited exception only, and the`,
    "reasoning goes in a comment on the item, not in the label.",
    "",
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
    ...bullet("flag", "", "Cross-cutting; not a namespace."),
    "",
    "`eval:skip` is the only label here that turns a gate off. Applying it without saying, in the PR,",
    "what evidence stands in for the evaluation is how a false green reaches the default branch.",
    "",
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
