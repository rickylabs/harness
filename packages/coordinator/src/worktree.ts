/**
 * Which worktrees are alive, and which the archiver may take.
 *
 * An auto-archiver runs every 12h on `ai-agents`. It tars-then-removes any worktree untouched for
 * more than 48h under `projects/<name>/worktrees/` and `/ephemeral/worktrees/`, and archives-then-
 * kills tmux sessions idle for more than 48h. Neither of those is a bug — the disk fills otherwise —
 * but
 * both are indifferent to whether a coordinated run is in the middle of using what they delete. A
 * milestone that takes three days is, from the archiver's side, indistinguishable from abandoned
 * scratch.
 *
 * The mitigation is a `.archive-keep` file, and the whole question is therefore *which directories
 * get one*. That question has a wrong answer that is very easy to reach and very expensive to reach:
 * deciding ownership by matching strings. `"/p/x/worktrees/feat-6"` is a prefix of
 * `"/p/x/worktrees/feat-69"`; a worktree named `feat-69` exists under two different roots at once;
 * a `cwd` arrives with a trailing slash, or a `.`, or a doubled separator. Every one of those makes
 * a substring test answer confidently and wrongly, and the direction that matters is the one where
 * a live worktree is judged unowned — because that judgement is acted on by something that deletes.
 *
 * So ownership here is exactly one thing: a run's actual `--cwd`, normalised, is the worktree itself
 * or a directory inside it, compared at segment boundaries. Nothing is matched by name.
 *
 * The second rule is that not knowing is not the same as knowing there is no owner. A run whose cwd
 * could not be read removes our ability to prove any worktree *unowned*; it does not remove our
 * ability to prove one owned. So an unreadable cwd protects everything it cannot rule out, and the
 * sweep list comes back empty rather than plausible.
 */

/** The file the archiver honours. Its presence is a claim; this module decides who may make one. */
export const KEEP_FILE = ".archive-keep";

/** Default idle window, in hours, before the archiver considers a worktree abandoned. */
export const IDLE_LIMIT_HOURS = 48;

/**
 * tmux sessions the archiver will not kill, as of today.
 *
 * Committed as data because the list is a fact about a machine this repository does not control, and
 * a coordinator that needs to be on it needs to be able to say so. Adding a name here does not add
 * it there — `unregisteredSessions` exists precisely to report that gap rather than assume it away.
 */
export const PROTECTED_SESSIONS: readonly string[] = [
  "archiver",
  "autocorner-coord",
  "codex-daemon",
  "herdr",
  "main",
  "maint",
  "netscript-coord",
  "rc",
  "spare-reaper",
];

/** Where a worktree sits, and whether the archiver's globs can see it. */
export type LayoutKind = "project" | "project-nested" | "ephemeral";

export interface Layout {
  readonly kind: LayoutKind;
  /** The `projects/<name>` directory — where `.mise.toml` belongs. `null` for ephemeral worktrees. */
  readonly base: string | null;
  readonly project: string | null;
  readonly name: string;
}

/**
 * Normalise a path for comparison, or refuse it.
 *
 * A relative path is refused rather than resolved. Resolving one requires a working directory, this
 * module has none, and guessing would produce exactly the confident-and-wrong answer the whole file
 * is written to avoid.
 */
export function normalizePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  const out: string[] = [];
  for (const segment of trimmed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `/${out.join("/")}`;
}

/**
 * Is `candidate` the directory `root`, or inside it?
 *
 * Both arguments must already be normalised. The separator in the test is the entire point: without
 * it, `/w/feat-6` contains `/w/feat-69`, and a rule written the other way round then reports a live
 * worktree as having no owner.
 */
export function isWithin(root: string, candidate: string): boolean {
  if (root === candidate) return true;
  if (root === "/") return candidate.startsWith("/");
  return candidate.startsWith(`${root}/`);
}

function segments(normalized: string): readonly string[] {
  return normalized.split("/").filter((segment) => segment.length > 0);
}

/**
 * Recognise a worktree path, or return `null` when it fits no known shape.
 *
 * Two project shapes are recognised, and they are not equivalent. `projects/<name>/worktrees/<wt>`
 * is what the archiver's glob matches; `projects/<name>/repo/worktrees/<wt>` is not, because the
 * glob has no `repo` segment in it. Both are carried rather than one being picked, and
 * `sweptByArchiver` reports the difference, because which one is correct is an owner's decision
 * about a machine's layout and not something this module may settle by preferring its own guess.
 */
export function layoutOf(path: string): Layout | null {
  const normalized = normalizePath(path);
  if (normalized === null) return null;
  const segs = segments(normalized);
  const n = segs.length;
  const name = segs[n - 1];
  if (name === undefined || segs[n - 2] !== "worktrees") return null;

  if (segs[n - 3] === "repo" && segs[n - 5] === "projects") {
    const project = segs[n - 4];
    if (project === undefined) return null;
    return { kind: "project-nested", base: `/${segs.slice(0, n - 3).join("/")}`, project, name };
  }
  if (segs[n - 4] === "projects") {
    const project = segs[n - 3];
    if (project === undefined) return null;
    return { kind: "project", base: `/${segs.slice(0, n - 2).join("/")}`, project, name };
  }
  if (n === 3 && segs[0] === "ephemeral") {
    return { kind: "ephemeral", base: null, project: null, name };
  }
  return null;
}

/** Does the archiver's sweep reach this path? A worktree it cannot see needs no keep file. */
export function sweptByArchiver(path: string): boolean {
  const layout = layoutOf(path);
  return layout !== null && layout.kind !== "project-nested";
}

/** Where `.mise.toml` belongs for a worktree: at the parent of `repo/`, never inside the checkout. */
export function misePathFor(path: string): string | null {
  const layout = layoutOf(path);
  return layout === null || layout.base === null ? null : `${layout.base}/.mise.toml`;
}

/** A run, as far as this module cares: an identity and the directory it was actually given. */
export interface Run {
  readonly id: string;
  /** The literal `--cwd` argument. `null` when it could not be read — which protects, never sweeps. */
  readonly cwd: string | null;
}

/** What is on disk, as observed by whoever took the census. */
export interface WorktreeFact {
  readonly path: string;
  readonly keepFile: boolean;
  /** Hours since the directory was last touched. `null` when unknown, which protects. */
  readonly idleHours: number | null;
}

export interface Census {
  readonly runs: readonly Run[];
  readonly worktrees: readonly WorktreeFact[];
  /** Long-lived coordinator tmux sessions that must survive the archiver. */
  readonly sessions: readonly string[];
  readonly idleLimitHours: number;
}

/**
 * The run that owns a worktree, or `null`.
 *
 * The only ownership rule in this file. A run owns a worktree when its cwd resolves to that
 * directory or to something inside it — never when the two merely share a name, a prefix, or a
 * suffix. Runs with an unreadable cwd are skipped here and accounted for in `judge`, where not
 * knowing has a different consequence from knowing.
 */
export function ownerOf(worktree: string, runs: readonly Run[]): Run | null {
  const root = normalizePath(worktree);
  if (root === null) return null;
  for (const run of runs) {
    if (run.cwd === null) continue;
    const cwd = normalizePath(run.cwd);
    if (cwd !== null && isWithin(root, cwd)) return run;
  }
  return null;
}

export type Disposition = "protect" | "leave" | "sweep";

export type JudgementRule =
  | "owned"
  | "keep-file"
  | "unknown-cwd"
  | "unknown-age"
  | "off-layout"
  | "unswept"
  | "fresh"
  | "stale";

export interface Judgement {
  readonly path: string;
  readonly disposition: Disposition;
  readonly rule: JudgementRule;
  readonly detail: string;
  /** The owning run, when there is one. Named so a reader can go and ask it what it is doing. */
  readonly owner: string | null;
}

/**
 * Every worktree in the census, judged, in the order it was given.
 *
 * The rule order is the argument. Ownership first, because a live worktree's disposition cannot
 * depend on anything else. Then an existing keep file, which is somebody else's claim and is
 * honoured rather than re-litigated. Then the two forms of ignorance — an unreadable cwd anywhere in
 * the census, and an unknown age here — both of which protect. Only after all of those has anything
 * been *shown* to be unowned and stale, which is the only state in which deleting it is a fact
 * rather than a bet.
 */
export function judge(census: Census): readonly Judgement[] {
  const blind = census.runs.filter((run) => run.cwd === null || normalizePath(run.cwd) === null);
  return census.worktrees.map((fact) => {
    const owner = ownerOf(fact.path, census.runs);
    if (owner !== null) {
      return {
        path: fact.path,
        disposition: "protect",
        rule: "owned",
        detail: `${owner.id} is working in it${fact.keepFile ? "" : `, and there is no ${KEEP_FILE}`}`,
        owner: owner.id,
      } as const;
    }
    if (fact.keepFile) {
      return {
        path: fact.path,
        disposition: "protect",
        rule: "keep-file",
        detail: `${KEEP_FILE} is present — somebody claimed it, and no run here says otherwise`,
        owner: null,
      } as const;
    }
    if (blind.length > 0) {
      const first = blind[0];
      return {
        path: fact.path,
        disposition: "protect",
        rule: "unknown-cwd",
        detail: `${first === undefined ? "a run" : first.id} has no readable cwd — nothing can be shown unowned`,
        owner: null,
      } as const;
    }
    if (layoutOf(fact.path) === null) {
      return {
        path: fact.path,
        disposition: "protect",
        rule: "off-layout",
        detail: "not a recognised worktree path — this module will not judge what it cannot place",
        owner: null,
      } as const;
    }
    if (!sweptByArchiver(fact.path)) {
      return {
        path: fact.path,
        disposition: "leave",
        rule: "unswept",
        detail: "outside the archiver's globs — it will not be taken, and needs no keep file",
        owner: null,
      } as const;
    }
    if (fact.idleHours === null) {
      return {
        path: fact.path,
        disposition: "protect",
        rule: "unknown-age",
        detail: "age unknown — an unmeasured worktree is not an abandoned one",
        owner: null,
      } as const;
    }
    if (fact.idleHours < census.idleLimitHours) {
      return {
        path: fact.path,
        disposition: "leave",
        rule: "fresh",
        detail: `touched ${fact.idleHours}h ago, inside the ${census.idleLimitHours}h window`,
        owner: null,
      } as const;
    }
    return {
      path: fact.path,
      disposition: "sweep",
      rule: "stale",
      detail: `no owner, no ${KEEP_FILE}, idle ${fact.idleHours}h`,
      owner: null,
    } as const;
  });
}

export type HazardRule = "unprotected" | "unregistered-session" | "off-layout";

export interface Hazard {
  readonly subject: string;
  readonly rule: HazardRule;
  readonly detail: string;
}

/** Coordinator sessions the archiver has never been told about. */
export function unregisteredSessions(sessions: readonly string[]): readonly string[] {
  return sessions.filter((name) => !PROTECTED_SESSIONS.includes(name.trim()));
}

/**
 * What the archiver will take that it should not, and what it has not been told.
 *
 * A hazard is not "something went wrong" — a stale worktree being swept is the system working. A
 * hazard is the archiver being on course to destroy something live, or a protection that exists in
 * this repository and nowhere else. Both are conditions a person has to act on, which is why they
 * are separated from the judgement list rather than being another column in it.
 */
export function hazards(census: Census, judged: readonly Judgement[]): readonly Hazard[] {
  const found: Hazard[] = [];
  for (const judgement of judged) {
    if (judgement.rule === "owned" && sweptByArchiver(judgement.path)) {
      const fact = census.worktrees.find((w) => w.path === judgement.path);
      if (fact !== undefined && !fact.keepFile) {
        found.push({
          subject: judgement.path,
          rule: "unprotected",
          detail: `${judgement.owner ?? "a run"} is working here and there is no ${KEEP_FILE}`,
        });
      }
    }
    if (judgement.rule === "off-layout") {
      found.push({
        subject: judgement.path,
        rule: "off-layout",
        detail: "sits outside every recognised worktree layout",
      });
    }
  }
  for (const name of unregisteredSessions(census.sessions)) {
    found.push({
      subject: name,
      rule: "unregistered-session",
      detail: "not on the archiver's protected list — it will be archived and killed after 48h idle",
    });
  }
  return found;
}

/** The paths that need a keep file written, in census order. */
export function unprotectedWorktrees(census: Census, judged: readonly Judgement[]): readonly string[] {
  return hazards(census, judged)
    .filter((hazard) => hazard.rule === "unprotected")
    .map((hazard) => hazard.subject);
}

/**
 * What goes inside a keep file.
 *
 * Addressed to whoever finds it in six weeks wondering whether it is safe to delete. A marker with
 * no owner and no date is indistinguishable from litter, and litter gets cleaned up.
 */
export function keepFileBody(run: string, at: string): string {
  return [
    `# ${KEEP_FILE} — written by dsh-coordinator`,
    `run: ${run}`,
    `at: ${at}`,
    "",
    "The archiver skips any directory holding this file. Delete it when the run above is over;",
    "until then, removing it makes a live worktree eligible for tar-and-remove after 48h idle.",
    "",
  ].join("\n");
}

export interface ParsedCensus {
  readonly census: Census | null;
  readonly notes: readonly string[];
}

/** How many malformed entries are named individually before the rest are counted. */
export const CENSUS_NOTE_CAP = 5;

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Read a census document: `{ "runs": [...], "worktrees": [...], "sessions": [...] }`. */
export function parseCensus(source: string): ParsedCensus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return { census: null, notes: [`census is not JSON: ${(error as Error).message}`] };
  }
  return readCensus(parsed);
}

/**
 * The same reader, over an already-parsed value.
 *
 * A run whose `cwd` field is missing or unreadable is **kept**, with a `null` cwd, rather than
 * dropped. Dropping it would delete the evidence that something is running, and this is the one
 * module where a shorter list of runs makes a longer list of deletions.
 */
export function readCensus(parsed: unknown): ParsedCensus {
  const notes: string[] = [];
  const document = object(parsed);
  if (document === null) {
    return { census: null, notes: ['census is not a JSON object — expected { "runs": …, "worktrees": … }'] };
  }

  const rawRuns = document["runs"];
  if (!Array.isArray(rawRuns)) return { census: null, notes: ['census has no "runs" array'] };
  const rawWorktrees = document["worktrees"];
  if (!Array.isArray(rawWorktrees)) return { census: null, notes: ['census has no "worktrees" array'] };

  let named = 0;
  const note = (line: string): void => {
    if (named < CENSUS_NOTE_CAP) {
      named += 1;
      notes.push(line);
    }
  };

  const runs: Run[] = [];
  for (const [index, raw] of rawRuns.entries()) {
    const source = object(raw);
    const cwd = source === null ? null : text(source["cwd"]);
    // Named after its position when it has no name of its own. An anonymous run is still a run, and
    // its cwd still establishes ownership — the missing field is the label, not the claim.
    const label = source === null ? null : text(source["id"]);
    const id = label ?? `run-${index}`;
    if (label === null) note(`run ${index} has no id — kept as ${id}`);
    if (cwd === null) note(`${id} has no readable cwd — nothing will be shown unowned`);
    else if (normalizePath(cwd) === null) note(`${id} has a relative cwd ${cwd} — it cannot be compared`);
    runs.push({ id, cwd });
  }

  const worktrees: WorktreeFact[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rawWorktrees.entries()) {
    const source = object(raw);
    const path = source === null ? null : text(source["path"]);
    if (path === null) {
      note(`worktree ${index} has no path — dropped`);
      continue;
    }
    if (seen.has(path)) {
      note(`worktree ${index} repeats ${path} — the first entry is kept`);
      continue;
    }
    seen.add(path);
    const idle = source?.["idleHours"];
    worktrees.push({
      path,
      keepFile: source?.["keepFile"] === true,
      idleHours: typeof idle === "number" && Number.isFinite(idle) ? idle : null,
    });
  }

  const rawSessions = document["sessions"];
  const sessions = Array.isArray(rawSessions)
    ? rawSessions.map((value) => text(value)).filter((value): value is string => value !== null)
    : [];

  const rawLimit = document["idleLimitHours"];
  const idleLimitHours =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : IDLE_LIMIT_HOURS;

  return { census: { runs, worktrees, sessions, idleLimitHours }, notes };
}
