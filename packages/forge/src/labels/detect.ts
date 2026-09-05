/**
 * Repository detection — the half of the taxonomy that must not be copied.
 *
 * `type:`, `status:` and `priority:` are true of any repository. `area:`, `gate:`, `ci:` and lane
 * ownership are only true of a repository that has packages, workflows and lanes, and they have to
 * be named after the ones it actually has. So this module reads the repo and proposes only what it
 * found evidence for. Everything it returns carries the evidence that produced it, so a plan can
 * explain itself instead of asserting.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  areaLabel,
  ciLabel,
  epicLabel,
  gateLabel,
  type LabelSpec,
  laneLabel,
  slugify,
} from "./taxonomy.js";
import type { ExistingLabel, GitHubTransport } from "./github.js";

export interface Evidence {
  readonly label: string;
  readonly source: string;
}

export interface DetectionResult {
  readonly labels: readonly LabelSpec[];
  readonly evidence: readonly Evidence[];
  /** Things worth telling the operator that are not labels. */
  readonly notes: readonly string[];
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const readIfPresent = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
};

const listDir = async (path: string): Promise<readonly string[]> => {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
};

// ── workspace packages -> area: ──────────────────────────────────────────────

/**
 * Package roots, from whichever workspace manifest the repo uses. Only directory globs of the
 * `dir/*` shape are followed — that covers pnpm, npm and Deno workspaces without pulling in a glob
 * engine, and anything more exotic simply yields no area labels rather than a wrong guess.
 */
async function workspaceRoots(repoRoot: string): Promise<readonly string[]> {
  const roots = new Set<string>();

  const pnpm = await readIfPresent(join(repoRoot, "pnpm-workspace.yaml"));
  if (pnpm) {
    for (const line of pnpm.split("\n")) {
      const m = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line);
      if (m?.[1]?.endsWith("/*")) roots.add(m[1].slice(0, -2));
    }
  }

  for (const manifest of ["package.json", "deno.json", "deno.jsonc"]) {
    const raw = await readIfPresent(join(repoRoot, manifest));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as { workspaces?: unknown; workspace?: unknown };
      const globs = parsed.workspaces ?? parsed.workspace;
      const list = Array.isArray(globs) ? globs : Array.isArray((globs as { packages?: unknown })?.packages) ? (globs as { packages: unknown[] }).packages : [];
      for (const g of list) if (typeof g === "string" && g.endsWith("/*")) roots.add(g.slice(0, -2));
    } catch {
      // A manifest we cannot parse yields no areas. Silence here is correct: the caller gets
      // fewer labels, never wrong ones.
    }
  }

  return [...roots];
}

async function detectAreas(repoRoot: string): Promise<DetectionResult> {
  const labels: LabelSpec[] = [];
  const evidence: Evidence[] = [];
  const notes: string[] = [];

  const roots = await workspaceRoots(repoRoot);
  if (roots.length === 0) {
    notes.push("no workspace manifest with directory globs — no area: labels proposed");
    return { labels, evidence, notes };
  }

  for (const root of roots) {
    for (const entry of await listDir(join(repoRoot, root))) {
      if (entry.startsWith(".")) continue;
      const dir = join(repoRoot, root, entry);
      if (!(await exists(join(dir, "package.json"))) && !(await exists(join(dir, "deno.json")))) continue;
      const slug = slugify(entry);
      if (slug.length === 0) continue;
      labels.push(areaLabel(slug, `${root}/${entry}`));
      evidence.push({ label: `area:${slug}`, source: `${root}/${entry}` });
    }
  }

  if (labels.length === 0) notes.push(`workspace roots ${roots.join(", ")} contain no packages yet`);
  return { labels, evidence, notes };
}

// ── workflows -> gate: / ci: ─────────────────────────────────────────────────

/** Workflows worth an explicit opt-in label: the slow ones nobody wants on every push. */
const EXPENSIVE = /e2e|integration|nightly|publish|release|canary|deploy|matrix|perf|load/i;

async function detectGates(repoRoot: string): Promise<DetectionResult> {
  const labels: LabelSpec[] = [];
  const evidence: Evidence[] = [];
  const notes: string[] = [];

  const dir = join(repoRoot, ".github", "workflows");
  const files = (await listDir(dir)).filter((f) => /\.ya?ml$/.test(f));
  if (files.length === 0) {
    notes.push("no .github/workflows — no gate: or ci: labels proposed");
    return { labels, evidence, notes };
  }

  const expensive: string[] = [];
  for (const file of files) {
    const base = file.replace(/\.ya?ml$/, "");
    const raw = (await readIfPresent(join(dir, file))) ?? "";
    const named = /^name:\s*(.+)$/m.exec(raw)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
    if (!EXPENSIVE.test(base) && !(named && EXPENSIVE.test(named))) continue;
    const slug = slugify(base);
    if (slug.length === 0) continue;
    expensive.push(slug);
    labels.push(gateLabel(slug, `Run the ${named ?? base} workflow on this PR`));
    evidence.push({ label: `gate:${slug}`, source: `.github/workflows/${file}` });
  }

  if (expensive.length === 0) {
    notes.push(`${files.length} workflow(s) found, none matched the expensive-gate heuristic`);
    return { labels, evidence, notes };
  }

  labels.push(ciLabel("full", "Force every expensive job to run; wins over all skip labels"));
  evidence.push({ label: "ci:full", source: `${expensive.length} expensive workflow(s)` });
  for (const slug of expensive) {
    labels.push(ciLabel(`skip-${slug}`, `Skip the ${slug} gate on this PR`));
    evidence.push({ label: `ci:skip-${slug}`, source: `.github/workflows (${slug})` });
  }

  return { labels, evidence, notes };
}

// ── lanes -> topic:/lane:/orchestrator: ──────────────────────────────────────

const LANE_PREFIXES = ["orchestrator", "topic", "lane"] as const;

const bestPrefix = (names: readonly { readonly name: string }[]): string | null => {
  let best: { prefix: string; count: number } | null = null;
  for (const prefix of LANE_PREFIXES) {
    const count = names.filter((l) => l.name.startsWith(`${prefix}:`)).length;
    if (count > 0 && (best === null || count > best.count)) best = { prefix, count };
  }
  return best?.prefix ?? null;
};

/**
 * Adopt the lane prefix the repository already uses rather than introducing a rival one. Two
 * prefixes for the same concept is how a taxonomy stops meaning anything.
 *
 * A repository can end up with more than one — `rickylabs/harness` carries both `topic:` and
 * `lane:` — so the winner is whichever has more labels, not whichever comes first in this file.
 * Ties fall back to the declared order, which is the only tiebreak that is stable across runs.
 *
 * `declared` is `.github/labels.yml`, and it is consulted *first* when it has any lane rows at all.
 * Two reasons, and the second is the one that matters.
 *
 * The doctrinal one: the ejected file is the record a human edited and a reviewer approved, and it
 * already wins over the live repository everywhere else the two overlap. A prefix is a taxonomy
 * decision like any other.
 *
 * The mechanical one: the live labels are reachable only over the network, and the file is not. Read
 * from GitHub alone, this function answered `topic` on a workstation with an authenticated `gh` and
 * `lane` in CI, which made every artifact generated from the taxonomy — the board-process skill
 * above all — depend on who ran the generator. `dsh-forge labels apply` was worse than inconsistent
 * offline: with no live labels to see, it proposed creating four `lane:*` labels duplicating the
 * `topic:*` rows the file itself declares. Reading the committed file first makes the answer the
 * same everywhere, which is what lets CI check the generated skill for drift at all.
 *
 * A repository that has not ejected a file yet still learns the prefix from its live labels, and one
 * with neither gets `lane`.
 */
export function detectLanePrefix(
  existing: readonly ExistingLabel[],
  declared: readonly { readonly name: string }[] = [],
): string {
  return bestPrefix(declared) ?? bestPrefix(existing) ?? "lane";
}

/** Lane ids from a harness milestone cluster state, when the repo runs one. */
async function detectLanes(repoRoot: string, prefix: string): Promise<DetectionResult> {
  const labels: LabelSpec[] = [];
  const evidence: Evidence[] = [];
  const notes: string[] = [];

  const runsDir = join(repoRoot, ".llm", "runs");
  const runs = await listDir(runsDir);
  const seen = new Set<string>();

  for (const run of runs) {
    const raw = await readIfPresent(join(runsDir, run, "milestone-cluster-state.json"));
    if (!raw) continue;
    try {
      const state = JSON.parse(raw) as { lanes?: Array<{ id?: unknown }> };
      for (const lane of state.lanes ?? []) {
        if (typeof lane.id !== "string") continue;
        const slug = slugify(lane.id);
        if (slug.length === 0 || seen.has(slug)) continue;
        seen.add(slug);
        labels.push(laneLabel(slug, prefix, `Owned by the ${lane.id} lane orchestrator`));
        evidence.push({ label: `${prefix}:${slug}`, source: `.llm/runs/${run}/milestone-cluster-state.json` });
      }
    } catch {
      notes.push(`.llm/runs/${run}/milestone-cluster-state.json is not readable JSON — lanes skipped`);
    }
  }

  if (seen.size === 0) notes.push("no milestone cluster state found — no lane labels proposed");
  return { labels, evidence, notes };
}

// ── epics -> epic: ───────────────────────────────────────────────────────────

/**
 * An epic label should be short enough to read in a filter dropdown. Most epic titles already open
 * with the identifier people actually use for them — `E6 · Coordinator workflows` — so prefer that
 * over a slug of the whole sentence, which is both unreadable and unstable under a retitle.
 */
export function epicSlug(title: string): string {
  const cleaned = title.replace(/^\s*(epic|umbrella)\s*[:—–-]\s*/i, "").trim();
  const id = /^([A-Za-z]{1,4}[-_]?\d+)(?![\w-])/.exec(cleaned)?.[1];
  return slugify(id ?? cleaned);
}

async function detectEpics(repo: string, transport: GitHubTransport | null): Promise<DetectionResult> {
  const labels: LabelSpec[] = [];
  const evidence: Evidence[] = [];
  const notes: string[] = [];

  if (!transport) {
    notes.push("no GitHub transport — epic: labels not derived");
    return { labels, evidence, notes };
  }

  let issues: Awaited<ReturnType<GitHubTransport["searchIssues"]>> = [];
  try {
    issues = await transport.searchIssues(repo, "is:issue is:open label:epic,type:umbrella");
  } catch (error) {
    notes.push(`epic search failed (${error instanceof Error ? error.message : String(error)}) — epic: labels skipped`);
    return { labels, evidence, notes };
  }

  // First-wins de-duplication is correct, but it must never be silent: a dropped epic is an epic
  // whose tasks land under someone else's label, and the only signal was an absence.
  const claimed = new Map<string, number>();
  for (const issue of issues.slice(0, 24)) {
    const slug = epicSlug(issue.title);
    if (slug.length === 0) {
      notes.push(`issue #${issue.number}: title yields no label-safe slug — no epic: label proposed`);
      continue;
    }
    const owner = claimed.get(slug);
    if (owner !== undefined) {
      notes.push(
        `issue #${issue.number}: slug \`${slug}\` already claimed by #${owner} — no epic: label proposed; retitle one of them`,
      );
      continue;
    }
    claimed.set(slug, issue.number);
    labels.push(epicLabel(slug, `${issue.title} (#${issue.number})`));
    evidence.push({ label: `epic:${slug}`, source: `issue #${issue.number}` });
  }

  if (labels.length === 0) notes.push("no open epic/umbrella issues — no epic: labels proposed");
  return { labels, evidence, notes };
}

// ── entry point ──────────────────────────────────────────────────────────────

export interface DetectOptions {
  readonly repoRoot: string;
  readonly repo: string;
  readonly transport: GitHubTransport | null;
  readonly existing: readonly ExistingLabel[];
  /** Families to derive. Anything omitted is simply not proposed. */
  readonly families?: readonly ("area" | "gate" | "lane" | "epic")[];
  /**
   * The prefix to give derived lane labels. Passed by a caller that has already resolved it against
   * `.github/labels.yml` — which this function cannot see — so that detection and the taxonomy it
   * feeds cannot disagree about which prefix this repository uses. Omitted, it is read from
   * `existing`, which is right for a caller that has no ejected file to consult.
   */
  readonly lanePrefix?: string;
}

const ALL_FAMILIES = ["area", "gate", "lane", "epic"] as const;

export async function detectRepoLabels(options: DetectOptions): Promise<DetectionResult> {
  const wanted = new Set<string>(options.families ?? ALL_FAMILIES);
  const prefix = options.lanePrefix ?? detectLanePrefix(options.existing);

  const parts: DetectionResult[] = [];
  if (wanted.has("area")) parts.push(await detectAreas(options.repoRoot));
  if (wanted.has("gate")) parts.push(await detectGates(options.repoRoot));
  if (wanted.has("lane")) parts.push(await detectLanes(options.repoRoot, prefix));
  if (wanted.has("epic")) parts.push(await detectEpics(options.repo, options.transport));

  return {
    labels: parts.flatMap((p) => p.labels),
    evidence: parts.flatMap((p) => p.evidence),
    notes: [
      `lane prefix in use: ${prefix}:`,
      ...parts.flatMap((p) => p.notes),
    ],
  };
}

/** Skill directories this repository already uses, in install-preference order. */
export async function detectSkillDirs(repoRoot: string): Promise<readonly string[]> {
  const candidates = [".claude/skills", ".agents/skills"];
  const found: string[] = [];
  for (const dir of candidates) if (await exists(join(repoRoot, dir))) found.push(dir);
  return found;
}
