#!/usr/bin/env node
/**
 * `dsh-forge` — install the board taxonomy, and the skill that explains it, into any repository.
 *
 * The tool is progressive by design. It probes for a GitHub transport instead of assuming `gh`;
 * it derives `area:`, `gate:`, `ci:`, lane and `epic:` labels only from evidence it can point at;
 * and every command that changes something has a read-only form that prints the same decision. If
 * a capability is missing the command says which one and keeps going with what it has, because a
 * taxonomy installer that refuses to run outside one blessed environment does not get run.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { applyPlan } from "./labels/apply.js";
import { detectRepoLabels, detectLanePrefix, detectSkillDirs } from "./labels/detect.js";
import {
  LABELS_FILE,
  loadLabelsFile,
  renderLabelsFile,
  type ParseIssue,
} from "./labels/file.js";
import {
  detectRepoSlug,
  detectTransport,
  isAvailable,
  type ExistingLabel,
  type GitHubTransport,
  type TransportProbe,
} from "./labels/github.js";
import { formatPlan, isClean, planLabels, type LabelPlan } from "./labels/plan.js";
import {
  ENDINGS,
  isEnding,
  settleEvent,
  settleStatus,
  type EventSettlement,
  type Settlement,
} from "./labels/settle.js";
import { CORE_TAXONOMY, RETIRED_LABELS, type LabelSpec } from "./labels/taxonomy.js";
import { installSkill } from "./skill/install.js";
import { CONFIG_FILE, describeIssue, parseTargetsConfig } from "./targets/config.js";
import { checkTargets, describeProblem, type TargetTable } from "./targets/model.js";
import { reconcileBridge, tallyBridge, type BridgeSource } from "./targets/reconcile.js";
import { renderBridge, renderTable } from "./targets/render.js";

/**
 * The command's contract with whatever called it.
 *
 * There is no code for "I crashed" on purpose: this tool is progressive, so the conditions another
 * binary would crash on — no transport, no skill directory, a label it cannot see — are answers it
 * gives rather than failures it suffers.
 */
export const EXIT = {
  ok: 0,
  drift: 1,
  usage: 2,
  unavailable: 3,
} as const;

/**
 * One sentence per code, keyed on `EXIT` — so a code added without a meaning is a type error
 * rather than an undocumented number a CI step has to reverse-engineer.
 *
 * This is the only statement of these meanings. The `exit codes` block in `USAGE` renders from it,
 * and so does `docs/reference/cli/dsh-forge.md`, which `pnpm run check:docs` byte-compares.
 */
export const EXIT_MEANINGS: Readonly<Record<keyof typeof EXIT, string>> = {
  ok: "everything asked for is in place",
  drift: "the repository has drifted from the taxonomy, or a label already means something else",
  usage: "the command line was wrong",
  unavailable: "no usable GitHub transport: gh missing, unauthenticated, or unable to reach GitHub",
};

const EXIT_BLOCK = Object.entries(EXIT)
  .map(([name, code]) => `  ${code}  ${EXIT_MEANINGS[name as keyof typeof EXIT]}`)
  .join("\n");

const USAGE = `dsh-forge — board taxonomy and process skill, installable into any repository

usage
  dsh-forge doctor                 report what this repository and environment support
  dsh-forge labels plan            show what would change (read-only; the default)
  dsh-forge labels apply           create and update labels; never deletes
  dsh-forge labels check           exit non-zero when the repo has drifted (for CI)
  dsh-forge labels eject           write ${LABELS_FILE} — the reviewable source of truth
  dsh-forge skill install          write the board-process skill into this repo's skill dirs
  dsh-forge status settle          print the status: label change an ended item calls for
  dsh-forge targets show           print the dispatch table in resolution order
  dsh-forge targets check          exit non-zero when the table is wrong (for CI)
  dsh-forge targets reconcile      which inbox issues the dispatcher claims, and what came back
  dsh-forge init                   eject + apply + skill install, in that order

options
  --repo <owner/name>   target repository (default: the origin remote)
  --cwd <path>          repository root (default: the working directory)
  --no-detect           portable core only; derive nothing from this repository
  --force               settle conflicts and overwrite files this tool did not generate
  --dispatch-label <n>  the label that starts an agent run here; teaches the skill to be careful
                        with it (default: none — most repositories have no dispatcher)
  --ending <how>        status settle only: ${ENDINGS.join(" | ")}
  --labels <a,b>        status settle only: the labels the item carries now (repeatable)
  --event <path>        status settle only: a GitHub event payload to read all of that from
  --config <path>       targets only: the dispatcher's config (default: ./${CONFIG_FILE})
  --snapshot <path>     targets reconcile only: a 'dsh-board snapshot' JSON file (repeatable —
                        one per repository, including the inbox's own)
  --dry-run             report every change without writing a file or touching the repository
  --json                machine-readable output
  -h, --help            this text

exit codes
${EXIT_BLOCK}`;

interface Context {
  readonly repoRoot: string;
  readonly repo: string;
  readonly transport: GitHubTransport | null;
  readonly transportNote: string;
  readonly existing: readonly ExistingLabel[];
  readonly lanePrefix: string;
  readonly desired: readonly LabelSpec[];
  /** Labels the taxonomy has retired. Never installed; corrected where the repo still has one. */
  readonly retired: readonly LabelSpec[];
  readonly detectionNotes: readonly string[];
  readonly evidence: readonly { label: string; source: string }[];
  readonly skillDirs: readonly string[];
  /** Rows of `.github/labels.yml` the parser could not use. Non-empty blocks every command. */
  readonly fileIssues: readonly ParseIssue[];
}

class UsageError extends Error {}
class TransportError extends Error {}
class FileError extends Error {}

const out = (line = ""): void => {
  process.stdout.write(`${line}\n`);
};

/**
 * Resolve everything a command might need, once. Detection is cheap next to the network round
 * trips, and a single resolve keeps `doctor` and `plan` from disagreeing about what they saw.
 */
async function resolveContext(options: {
  repoRoot: string;
  repo?: string | undefined;
  detect: boolean;
  probe?: (() => Promise<TransportProbe>) | undefined;
}): Promise<Context> {
  const repo = options.repo ?? (await detectRepoSlug(options.repoRoot));
  if (!repo) {
    throw new UsageError(
      "could not determine the target repository — pass --repo owner/name (no github.com origin remote found)",
    );
  }

  const probe = await (options.probe ?? detectTransport)();
  const transport = isAvailable(probe) ? probe : null;
  const transportNote = isAvailable(probe) ? probe.authNote : probe.reasons.join("; ");

  let existing: readonly ExistingLabel[] = [];
  let listNote: string | null = null;
  if (transport) {
    try {
      existing = await transport.listLabels(repo);
    } catch (error) {
      listNote = `could not list labels on ${repo}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Read twice, deliberately. `familyOf` needs the lane prefix to classify a row, and the prefix is
  // itself read off the rows — so the first pass exists only to learn the names. The alternative is
  // asking GitHub, which makes the answer depend on whether the caller had a network.
  const labelsPath = join(options.repoRoot, LABELS_FILE);
  const declared = await loadLabelsFile(labelsPath);
  const lanePrefix = detectLanePrefix(existing, declared?.labels ?? []);

  // `.github/labels.yml` wins where it overlaps: it is the file a human edits and reviews, so a
  // description changed there must survive the next run. Core fills the gaps, and detection adds
  // only what this repository provides evidence for.
  const fromFile = await loadLabelsFile(labelsPath, lanePrefix);
  const detected = options.detect
    ? await detectRepoLabels({ repoRoot: options.repoRoot, repo, transport, existing, lanePrefix })
    : { labels: [], evidence: [], notes: ["detection disabled with --no-detect"] };

  const notes = [...detected.notes];
  if (listNote) notes.unshift(listNote);
  if (fromFile) {
    notes.unshift(`${LABELS_FILE}: ${fromFile.labels.length} label(s) — this file wins on overlap`);
  }

  return {
    fileIssues: fromFile?.issues ?? [],
    repoRoot: options.repoRoot,
    repo,
    transport,
    transportNote,
    existing,
    lanePrefix,
    desired: [...(fromFile?.labels ?? []), ...CORE_TAXONOMY, ...detected.labels],
    // The file first here too. A repository that retired a label of its own keeps that record,
    // and the built-in retirements are appended rather than allowed to overwrite it.
    retired: [...(fromFile?.retired ?? []), ...RETIRED_LABELS],
    detectionNotes: notes,
    evidence: [...detected.evidence],
    skillDirs: await detectSkillDirs(options.repoRoot),
  };
}

/**
 * Refuse to act on a labels file the parser could not fully read.
 *
 * `ParsedLabelsFile.issues` is a gate, not a note. Treating it as advisory means a typo'd row is
 * dropped, the rows around it are applied anyway, and the result is a repository that half-matches
 * a file nobody knows is broken — the drift gate then reports clean, because it compares against
 * the same truncated parse.
 */
const requireParsableFile = (ctx: Context): void => {
  if (ctx.fileIssues.length === 0) return;
  const lines = ctx.fileIssues.map((i) => `  ${LABELS_FILE}:${i.line}  ${i.message}`);
  throw new FileError(
    [`${LABELS_FILE} has ${ctx.fileIssues.length} unusable row(s); refusing to continue:`, ...lines].join("\n"),
  );
};

const requireTransport = (ctx: Context): GitHubTransport => {
  if (!ctx.transport) {
    throw new TransportError(
      `no usable GitHub transport: ${ctx.transportNote}\n` +
        "  install and authenticate gh, or export GITHUB_TOKEN.\n" +
        `  'dsh-forge labels eject' and 'dsh-forge skill install' work without one.`,
    );
  }
  return ctx.transport;
};

const buildPlan = (ctx: Context, force: boolean): LabelPlan =>
  planLabels(ctx.desired, ctx.existing, { force, retired: ctx.retired });

// ── commands ─────────────────────────────────────────────────────────────────

function cmdDoctor(ctx: Context, json: boolean): number {
  if (json) {
    out(
      JSON.stringify(
        {
          repo: ctx.repo,
          transport: ctx.transport?.kind ?? null,
          transportNote: ctx.transportNote,
          lanePrefix: ctx.lanePrefix,
          existingLabels: ctx.existing.length,
          desiredLabels: ctx.desired.length,
          skillDirs: ctx.skillDirs,
          evidence: ctx.evidence,
          notes: ctx.detectionNotes,
        },
        null,
        2,
      ),
    );
    return EXIT.ok;
  }

  out(`repository       ${ctx.repo}`);
  out(`github           ${ctx.transport ? `${ctx.transport.kind} — ${ctx.transportNote}` : `unavailable — ${ctx.transportNote}`}`);
  out(`labels present   ${ctx.transport ? String(ctx.existing.length) : "unknown (no transport)"}`);
  out(`labels proposed  ${ctx.desired.length}`);
  out(`lane prefix      ${ctx.lanePrefix}:`);
  out(`skill dirs       ${ctx.skillDirs.length > 0 ? ctx.skillDirs.join(", ") : "none — would create .claude/skills"}`);
  out();
  out("derived from this repository");
  if (ctx.evidence.length === 0) out("  (nothing — the portable core only)");
  for (const e of ctx.evidence) out(`  ${e.label.padEnd(28)} ${e.source}`);
  out();
  out("notes");
  for (const note of ctx.detectionNotes) out(`  ${note}`);
  return EXIT.ok;
}

function reportPlan(plan: LabelPlan, json: boolean): void {
  if (json) {
    out(
      JSON.stringify(
        {
          counts: plan.counts,
          actions: plan.actions.map((a) => ({
            kind: a.kind,
            name: a.spec.name,
            color: a.spec.color,
            description: a.spec.description,
            reason: a.reason,
          })),
          unmanaged: plan.unmanaged.map((l) => l.name),
        },
        null,
        2,
      ),
    );
    return;
  }
  const text = formatPlan(plan);
  out(text.length > 0 ? text : "nothing to do — the repository already carries this taxonomy");
}

function cmdPlan(ctx: Context, force: boolean, json: boolean): number {
  requireParsableFile(ctx);
  requireTransport(ctx);
  reportPlan(buildPlan(ctx, force), json);
  return EXIT.ok;
}

function cmdCheck(ctx: Context, json: boolean): number {
  requireParsableFile(ctx);
  requireTransport(ctx);
  const plan = buildPlan(ctx, false);
  reportPlan(plan, json);
  if (isClean(plan)) return EXIT.ok;
  if (!json) {
    out();
    out(
      `drift: ${plan.counts.create} to create, ${plan.counts.update} to update, ` +
        `${plan.counts.retire} to retire, ${plan.counts.conflict} conflict(s)`,
    );
  }
  return EXIT.drift;
}

async function cmdApply(
  ctx: Context,
  force: boolean,
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  requireParsableFile(ctx);
  const transport = requireTransport(ctx);
  const plan = buildPlan(ctx, force);

  if (dryRun) {
    reportPlan(plan, json);
    if (!json) out("dry run — nothing was created or updated");
    return plan.counts.conflict > 0 ? EXIT.drift : EXIT.ok;
  }

  const result = await applyPlan(transport, ctx.repo, plan);

  if (json) {
    out(
      JSON.stringify(
        {
          applied: result.applied.map((a) => ({ kind: a.kind, name: a.spec.name })),
          conflicts: plan.actions.filter((a) => a.kind === "conflict").map((a) => a.spec.name),
          failed: result.failed
            ? { name: result.failed.action.spec.name, error: result.failed.error }
            : null,
        },
        null,
        2,
      ),
    );
  } else {
    const verb: Record<string, string> = { create: "created", update: "updated", retire: "retired" };
    for (const action of result.applied) {
      out(`${(verb[action.kind] ?? "changed").padEnd(8)} ${action.spec.name}`);
    }
    if (result.applied.length === 0) out("nothing to do — the repository already carries this taxonomy");
    if (result.failed) {
      out();
      out(`FAILED at ${result.failed.action.spec.name}: ${result.failed.error}`);
      out(`${result.applied.length} label(s) were applied before this; rerun to continue.`);
    }
    const conflicts = plan.actions.filter((a) => a.kind === "conflict");
    if (conflicts.length > 0) {
      out();
      out(`${conflicts.length} conflict(s) left alone — rerun with --force to take the taxonomy's wording:`);
      for (const c of conflicts) out(`  ${c.spec.name.padEnd(28)} ${c.reason}`);
    }
  }

  if (result.failed) return EXIT.drift;
  return plan.counts.conflict > 0 ? EXIT.drift : EXIT.ok;
}

async function cmdEject(ctx: Context, dryRun: boolean, json: boolean): Promise<number> {
  requireParsableFile(ctx);
  const path = join(ctx.repoRoot, LABELS_FILE);
  // De-duplicate by name, first wins — the same precedence the planner uses, so the ejected file
  // and the applied taxonomy cannot disagree.
  // Retired names are claimed first, so a label that is both retired and desired ejects only into
  // the retired block — the same precedence `planLabels` applies, for the same reason.
  const seen = new Set<string>();
  const dedupe = (rows: readonly LabelSpec[]): readonly LabelSpec[] =>
    rows.filter((s) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const retired = dedupe(ctx.retired);
  const specs = dedupe(ctx.desired);

  if (!dryRun) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderLabelsFile(specs, ctx.repo, retired), "utf8");
  }
  if (json) {
    out(
      JSON.stringify(
        { path: LABELS_FILE, labels: specs.length, retired: retired.length, written: !dryRun },
        null,
        2,
      ),
    );
  } else {
    const note = retired.length > 0 ? ` plus ${retired.length} retired` : "";
    out(`${dryRun ? "would write" : "wrote"} ${LABELS_FILE} — ${specs.length} label(s)${note}`);
  }
  return EXIT.ok;
}

async function cmdSkillInstall(
  ctx: Context,
  flags: { force: boolean; dryRun: boolean; dispatchLabel: string | null },
  json: boolean,
): Promise<number> {
  // Retired first, then desired, on one shared `seen` — the planner's precedence again, so the
  // skill cannot teach as live a label the same run is retiring.
  const seen = new Set<string>();
  const dedupe = (rows: readonly LabelSpec[]): readonly LabelSpec[] =>
    rows.filter((s) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const retired = dedupe(ctx.retired);
  const specs = dedupe(ctx.desired);

  const reports = await installSkill({
    repoRoot: ctx.repoRoot,
    repo: ctx.repo,
    specs,
    retired,
    lanePrefix: ctx.lanePrefix,
    dispatchLabel: flags.dispatchLabel,
    skillDirs: ctx.skillDirs,
    force: flags.force,
    dryRun: flags.dryRun,
  });

  if (json) {
    out(JSON.stringify({ reports }, null, 2));
  } else {
    for (const r of reports) out(`${r.outcome.padEnd(10)} ${r.path}${r.note ? ` — ${r.note}` : ""}`);
  }
  return reports.some((r) => r.outcome === "foreign") ? EXIT.drift : EXIT.ok;
}

async function cmdInit(
  ctx: Context,
  flags: { force: boolean; dryRun: boolean; dispatchLabel: string | null },
  json: boolean,
): Promise<number> {
  if (!json) out("== labels ==");
  // Every leg gets the flag. `init --dry-run` that ejects a file and sends 28 label mutations is
  // not a partial implementation of dry-run, it is the opposite of the promise the flag makes.
  const ejected = await cmdEject(ctx, flags.dryRun, json);
  const applied = ctx.transport
    ? await cmdApply(ctx, flags.force, flags.dryRun, json)
    : EXIT.unavailable;
  if (!ctx.transport && !json) {
    out(`skipped apply — ${ctx.transportNote}`);
  }
  if (!json) {
    out();
    out("== skill ==");
  }
  const installed = await cmdSkillInstall(ctx, flags, json);
  return Math.max(ejected, applied === EXIT.unavailable ? EXIT.ok : applied, installed);
}

/**
 * `status settle` — what the `status:` labels should become now that this item has ended.
 *
 * Deliberately offline, and deliberately not a mutation. It reads labels from the command line and
 * prints the change; something else applies it. That keeps the one caller that matters — a workflow
 * running on `pull_request: closed` — from needing a checkout with an origin remote, a token with
 * write scope, or any of `resolveContext`'s detection, none of which the arithmetic depends on.
 *
 * It exits `ok` whether or not there is a change to make. A settlement is an answer, not a verdict:
 * on the close path a change is the expected outcome, so returning `drift` for it would make the
 * normal case look like a failure and push every caller into `|| true`, which is where a real
 * failure goes to hide. Callers that need to branch read `changed` from `--json`.
 */
async function cmdSettle(
  options: { labels: readonly string[]; ending: string | undefined; event: string | undefined },
  json: boolean,
): Promise<number> {
  const settlement: Settlement | EventSettlement = options.event
    ? await settleFromEvent(options.event)
    : settleFromFlags(options.labels, options.ending);

  if (json) {
    out(JSON.stringify(settlement, null, 2));
    return EXIT.ok;
  }
  out(settlement.note);
  for (const name of settlement.remove) out(`  - ${name}`);
  for (const name of settlement.add) out(`  + ${name}`);
  return EXIT.ok;
}

function settleFromFlags(labels: readonly string[], ending: string | undefined): Settlement {
  if (ending === undefined) {
    throw new UsageError(`status settle needs --ending or --event: ${ENDINGS.join(", ")}`);
  }
  if (!isEnding(ending)) {
    throw new UsageError(`--ending must be one of: ${ENDINGS.join(", ")} (got '${ending}')`);
  }
  return settleStatus(labels, ending);
}

/**
 * `--event $GITHUB_EVENT_PATH` — read the item, its labels and its ending straight off the payload.
 *
 * The alternative is a workflow that picks those four things apart in `jq` and passes them back in,
 * which is decision logic living in a YAML string where nothing can test it. Here the same code
 * runs under `node --test` against the payload shapes GitHub actually sends.
 */
async function settleFromEvent(path: string): Promise<EventSettlement> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new UsageError(
      `could not read the event payload at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const settlement = settleEvent(payload);
  if (!settlement) {
    throw new UsageError(
      `${path} is neither an issue nor a pull request event — check the workflow's 'on:' block`,
    );
  }
  return settlement;
}

/**
 * `--labels status:impl,type:fix` and `--labels status:impl --labels type:fix` mean the same thing.
 * The comma form is what a shell pipeline produces; the repeated form is what a workflow produces
 * from a JSON array. Rejecting either would make the caller do string work to satisfy a parser.
 */
function parseLabelList(values: readonly string[]): readonly string[] {
  return values
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

// ── targets ──────────────────────────────────────────────────────────────────

/**
 * Read the dispatcher's config, or say why it could not be read.
 *
 * A file the parser could not use is `EXIT.drift` and not `EXIT.usage`: the command line was fine,
 * the repository's state is not — the same distinction `FileError` draws for `.github/labels.yml`.
 */
async function loadTable(root: string, config: string | undefined): Promise<TargetTable> {
  const path = resolve(root, config ?? CONFIG_FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new UsageError(
      `no dispatcher config at ${path} — pass --config <path> to the file divybot reads`,
    );
  }
  const { table, issues } = parseTargetsConfig(text);
  if (table === null || issues.length > 0) {
    const lines = issues.map((issue) => `  ${describeIssue(issue)}`).join("\n");
    throw new FileError(`${path} has ${String(issues.length)} problem(s):\n${lines}`);
  }
  return table;
}

/**
 * `targets show` — the table, in the order resolution walks it.
 *
 * Printed rather than checked, because the question it answers is "where does this label send work"
 * and an operator asking it is not asking whether the table is also valid.
 */
async function cmdTargetsShow(root: string, config: string | undefined, json: boolean): Promise<number> {
  const table = await loadTable(root, config);
  if (json) {
    out(JSON.stringify({ table, problems: checkTargets(table) }, null, 2));
    return EXIT.ok;
  }
  out(renderTable(table));
  const problems = checkTargets(table);
  if (problems.length > 0) out(`\n${String(problems.length)} problem(s) — run 'dsh-forge targets check'`);
  return EXIT.ok;
}

/** `targets check` — CI's form. Every problem printed, and drift when there is one. */
async function cmdTargetsCheck(root: string, config: string | undefined, json: boolean): Promise<number> {
  const table = await loadTable(root, config);
  const problems = checkTargets(table);
  if (json) {
    out(JSON.stringify({ ok: problems.length === 0, problems }, null, 2));
  } else if (problems.length === 0) {
    out(`${table.inbox}: ${String(table.targets.length)} target(s), no problems`);
  } else {
    for (const problem of problems) out(describeProblem(problem));
  }
  return problems.length === 0 ? EXIT.ok : EXIT.drift;
}

/**
 * `targets reconcile` — the bridge, from a config and one or more board projections.
 *
 * Offline on purpose. `dsh-board snapshot` already owns talking to GitHub, and composing the two
 * commands keeps the write path and the read path in the packages that own them: forge never grows
 * a fetch, and board never grows a table.
 */
async function cmdTargetsReconcile(
  root: string,
  options: { config: string | undefined; snapshots: readonly string[] },
  json: boolean,
): Promise<number> {
  const table = await loadTable(root, options.config);
  if (options.snapshots.length === 0) {
    throw new UsageError(
      "targets reconcile needs at least one --snapshot: run 'dsh-board snapshot --repo <owner/name> > board.json'",
    );
  }
  const sources: BridgeSource[] = [];
  for (const path of options.snapshots) sources.push(await readSnapshot(resolve(root, path)));

  const snapshot = reconcileBridge(table, sources);
  if (json) {
    out(JSON.stringify({ ...snapshot, tally: tallyBridge(snapshot) }, null, 2));
  } else {
    out(renderBridge(snapshot));
  }
  // Drift on a bad table, never on the bridge's own contents: an inbox with unclaimed issues is a
  // day's work, not a misconfiguration, and a check that goes red for it gets muted.
  return snapshot.problems.length === 0 ? EXIT.ok : EXIT.drift;
}

/**
 * Read one `dsh-board snapshot`, which carries the repository it came from.
 *
 * Taking the repo from the file rather than from a flag is what keeps a snapshot from being filed
 * under the wrong repository — which would silently attribute one repo's pull requests to another's
 * issues, the one error in this whole path that produces a confident wrong answer.
 */
async function readSnapshot(path: string): Promise<BridgeSource> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new UsageError(
      `could not read the board snapshot at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof payload !== "object" || payload === null) {
    throw new UsageError(`${path} is not a board snapshot`);
  }
  const { repo, items } = payload as { repo?: unknown; items?: unknown };
  if (typeof repo !== "string" || repo === "" || !Array.isArray(items)) {
    throw new UsageError(`${path} is not a board snapshot — expected 'repo' and 'items' from 'dsh-board snapshot'`);
  }
  return {
    repo,
    items: items.flatMap((item) => {
      const source = (item as { source?: unknown }).source;
      return typeof source === "object" && source !== null ? [source as BridgeSource["items"][number]] : [];
    }),
  };
}

// ── entry ────────────────────────────────────────────────────────────────────

/**
 * Seam for exercising the real entry point against a transport that is not the network.
 *
 * The negative controls this package cares about — `--dry-run` sending nothing, a broken labels
 * file blocking apply — are only worth anything if they run the actual CLI. A test that
 * reimplements the command proves the reimplementation.
 */
export interface CliOverrides {
  readonly probeTransport?: () => Promise<TransportProbe>;
}

export async function main(argv: readonly string[], overrides: CliOverrides = {}): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        repo: { type: "string" },
        cwd: { type: "string" },
        // parseArgs has no `--no-<flag>` negation, so the negative form is its own option.
        "no-detect": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        "dispatch-label": { type: "string" },
        ending: { type: "string" },
        event: { type: "string" },
        labels: { type: "string", multiple: true, default: [] },
        config: { type: "string" },
        snapshot: { type: "string", multiple: true, default: [] },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    out(USAGE);
    out();
    out(error instanceof Error ? error.message : String(error));
    return EXIT.usage;
  }

  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    out(USAGE);
    return values.help ? EXIT.ok : EXIT.usage;
  }

  const json = values.json ?? false;
  const force = values.force ?? false;
  const dryRun = values["dry-run"] ?? false;
  // Absent means no dispatcher, which is the honest default: inventing one would put a warning
  // about a trigger that does not exist into every skill this tool installs.
  const dispatchLabel = values["dispatch-label"] ?? null;
  const repoRoot = resolve(values.cwd ?? process.cwd());

  const [group, sub] = positionals;
  const command = group === "labels" ? `labels:${sub ?? "plan"}` : group;

  try {
    // Ahead of `resolveContext`, because settling a label is arithmetic on the argv. Requiring an
    // origin remote for it would put the one command a CI runner calls behind the one thing a CI
    // runner's checkout is least likely to have.
    if (group === "status") {
      if (sub !== "settle") throw new UsageError(`unknown command: status ${sub ?? ""}`.trimEnd());
      return await cmdSettle(
        { labels: parseLabelList(values.labels ?? []), ending: values.ending, event: values.event },
        json,
      );
    }

    // Also ahead of `resolveContext`, and for the same reason: the whole group is arithmetic on a
    // config file and a board snapshot. Neither needs a transport, an origin remote, or the network
    // — that is the property that makes it runnable in CI and quotable in an issue.
    if (group === "targets") {
      switch (sub) {
        case "show":
        case undefined:
          return await cmdTargetsShow(repoRoot, values.config, json);
        case "check":
          return await cmdTargetsCheck(repoRoot, values.config, json);
        case "reconcile":
          return await cmdTargetsReconcile(
            repoRoot,
            { config: values.config, snapshots: values.snapshot ?? [] },
            json,
          );
        default:
          throw new UsageError(`unknown command: targets ${sub}`);
      }
    }

    const ctx = await resolveContext({
      repoRoot,
      repo: values.repo,
      detect: !(values["no-detect"] ?? false),
      probe: overrides.probeTransport,
    });

    switch (command) {
      case "doctor":
        return cmdDoctor(ctx, json);
      case "labels:plan":
        return cmdPlan(ctx, force, json);
      case "labels:check":
        return cmdCheck(ctx, json);
      case "labels:apply":
        return await cmdApply(ctx, force, dryRun, json);
      case "labels:eject":
        return await cmdEject(ctx, dryRun, json);
      case "skill":
        if (sub !== undefined && sub !== "install") {
          throw new UsageError(`unknown command: skill ${sub}`);
        }
        return await cmdSkillInstall(ctx, { force, dryRun, dispatchLabel }, json);
      case "init":
        return await cmdInit(ctx, { force, dryRun, dispatchLabel }, json);
      default:
        throw new UsageError(`unknown command: ${positionals.join(" ")}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      out(USAGE);
      out();
      out(error.message);
      return EXIT.usage;
    }
    if (error instanceof TransportError) {
      out(error.message);
      return EXIT.unavailable;
    }
    if (error instanceof FileError) {
      out(error.message);
      out();
      out(`fix the row(s) above, or delete ${LABELS_FILE} and re-run 'dsh-forge labels eject'.`);
      return EXIT.drift;
    }
    out(error instanceof Error ? error.message : String(error));
    return EXIT.drift;
  }
}

// Run only when invoked as a program, so the module stays importable by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
