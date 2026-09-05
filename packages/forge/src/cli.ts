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

import { mkdir, writeFile } from "node:fs/promises";
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
import { CORE_TAXONOMY, type LabelSpec } from "./labels/taxonomy.js";
import { installSkill } from "./skill/install.js";

const USAGE = `dsh-forge — board taxonomy and process skill, installable into any repository

usage
  dsh-forge doctor                 report what this repository and environment support
  dsh-forge labels plan            show what would change (read-only; the default)
  dsh-forge labels apply           create and update labels; never deletes
  dsh-forge labels check           exit non-zero when the repo has drifted (for CI)
  dsh-forge labels eject           write ${LABELS_FILE} — the reviewable source of truth
  dsh-forge skill install          write the board-process skill into this repo's skill dirs
  dsh-forge init                   eject + apply + skill install, in that order

options
  --repo <owner/name>   target repository (default: the origin remote)
  --cwd <path>          repository root (default: the working directory)
  --no-detect           portable core only; derive nothing from this repository
  --force               settle conflicts and overwrite files this tool did not generate
  --dispatch-label <n>  the label that starts an agent run here; teaches the skill to be careful
                        with it (default: none — most repositories have no dispatcher)
  --dry-run             report every change without writing a file or touching the repository
  --json                machine-readable output
  -h, --help            this text

exit codes
  0 ok   1 drift or conflict   2 usage   3 no usable GitHub transport`;

interface Context {
  readonly repoRoot: string;
  readonly repo: string;
  readonly transport: GitHubTransport | null;
  readonly transportNote: string;
  readonly existing: readonly ExistingLabel[];
  readonly lanePrefix: string;
  readonly desired: readonly LabelSpec[];
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

  const lanePrefix = detectLanePrefix(existing);

  // `.github/labels.yml` wins where it overlaps: it is the file a human edits and reviews, so a
  // description changed there must survive the next run. Core fills the gaps, and detection adds
  // only what this repository provides evidence for.
  const fromFile = await loadLabelsFile(join(options.repoRoot, LABELS_FILE), lanePrefix);
  const detected = options.detect
    ? await detectRepoLabels({ repoRoot: options.repoRoot, repo, transport, existing })
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
  planLabels(ctx.desired, ctx.existing, { force });

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
    return 0;
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
  return 0;
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
  return 0;
}

function cmdCheck(ctx: Context, json: boolean): number {
  requireParsableFile(ctx);
  requireTransport(ctx);
  const plan = buildPlan(ctx, false);
  reportPlan(plan, json);
  if (isClean(plan)) return 0;
  if (!json) {
    out();
    out(`drift: ${plan.counts.create} to create, ${plan.counts.update} to update, ${plan.counts.conflict} conflict(s)`);
  }
  return 1;
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
    return plan.counts.conflict > 0 ? 1 : 0;
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
    for (const action of result.applied) out(`${action.kind === "create" ? "created" : "updated"}  ${action.spec.name}`);
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

  if (result.failed) return 1;
  return plan.counts.conflict > 0 ? 1 : 0;
}

async function cmdEject(ctx: Context, dryRun: boolean, json: boolean): Promise<number> {
  requireParsableFile(ctx);
  const path = join(ctx.repoRoot, LABELS_FILE);
  // De-duplicate by name, first wins — the same precedence the planner uses, so the ejected file
  // and the applied taxonomy cannot disagree.
  const seen = new Set<string>();
  const specs = ctx.desired.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!dryRun) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderLabelsFile(specs, ctx.repo), "utf8");
  }
  if (json) out(JSON.stringify({ path: LABELS_FILE, labels: specs.length, written: !dryRun }, null, 2));
  else out(`${dryRun ? "would write" : "wrote"} ${LABELS_FILE} — ${specs.length} label(s)`);
  return 0;
}

async function cmdSkillInstall(
  ctx: Context,
  flags: { force: boolean; dryRun: boolean; dispatchLabel: string | null },
  json: boolean,
): Promise<number> {
  const seen = new Set<string>();
  const specs = ctx.desired.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const reports = await installSkill({
    repoRoot: ctx.repoRoot,
    repo: ctx.repo,
    specs,
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
  return reports.some((r) => r.outcome === "foreign") ? 1 : 0;
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
  const applied = ctx.transport ? await cmdApply(ctx, flags.force, flags.dryRun, json) : 3;
  if (!ctx.transport && !json) {
    out(`skipped apply — ${ctx.transportNote}`);
  }
  if (!json) {
    out();
    out("== skill ==");
  }
  const installed = await cmdSkillInstall(ctx, flags, json);
  return Math.max(ejected, applied === 3 ? 0 : applied, installed);
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
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    out(USAGE);
    out();
    out(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    out(USAGE);
    return values.help ? 0 : 2;
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
      return 2;
    }
    if (error instanceof TransportError) {
      out(error.message);
      return 3;
    }
    if (error instanceof FileError) {
      out(error.message);
      out();
      out(`fix the row(s) above, or delete ${LABELS_FILE} and re-run 'dsh-forge labels eject'.`);
      return 1;
    }
    out(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// Run only when invoked as a program, so the module stays importable by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
