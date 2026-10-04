/**
 * Read-only latest-run-per-name pull-request check rollup.
 *
 * Ported from NetScript's `agentic:pr-checks` so that copy can be deleted: the same
 * classification, the same one-line JSON report and the same `--pretty` text. It is
 * self-contained on purpose — only `node:` built-ins — so `harness-board checks` runs it from
 * the build and Deno can run this file from a pinned URL, the way NetScript already runs the
 * Harness matrix viewer.
 *
 * Reads go through `gh api` with an explicit GET, so this module never sees a token and can
 * never write to the repository it reports on.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const CHECK_CURRENT_PASS = "current-pass" as const;
export const CHECK_CURRENT_FAIL = "current-fail" as const;
export const CHECK_SUPERSEDED = "superseded" as const;
export const CHECK_CANCELLED = "cancelled" as const;
export const CHECK_STALE_POST_MERGE = "stale-post-merge" as const;
export const CHECK_PENDING = "pending" as const;

export type CheckRunClassification =
  | typeof CHECK_CURRENT_PASS
  | typeof CHECK_CURRENT_FAIL
  | typeof CHECK_SUPERSEDED
  | typeof CHECK_CANCELLED
  | typeof CHECK_STALE_POST_MERGE
  | typeof CHECK_PENDING;

export interface CheckRun {
  readonly id: number;
  readonly name: string;
  readonly head_sha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly started_at: string;
  readonly completed_at?: string | null | undefined;
  readonly html_url?: string | undefined;
  readonly latest_attempt?: boolean | undefined;
}

export interface ClassifiedCheckRun extends CheckRun {
  readonly classification: CheckRunClassification;
}

export interface WorkflowJob {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly check_run_url: string;
  readonly html_url?: string | undefined;
  readonly run_id: number;
  readonly run_attempt: number;
  readonly workflow_run_started_at?: string | undefined;
}

export interface PrCheckReport {
  readonly gate: "pr-checks";
  readonly ok: boolean;
  readonly repo: string;
  readonly pr: number;
  readonly headSha: string;
  readonly evaluatedAt: string;
  readonly checks: readonly ClassifiedCheckRun[];
  readonly currentFailures: number;
}

const FAILURE_CONCLUSIONS = new Set(["action_required", "failure", "startup_failure", "timed_out"]);

/** Adds latest-attempt Actions jobs to the commit check-run candidates. */
export function mergeLatestWorkflowJobs(
  checkRuns: readonly CheckRun[],
  jobs: readonly WorkflowJob[],
  headSha: string,
): CheckRun[] {
  const runsById = new Map(checkRuns.map((run) => [run.id, run]));
  for (const job of jobs) {
    const checkRunId = checkRunIdFromUrl(job.check_run_url);
    const existing = runsById.get(checkRunId);
    runsById.set(checkRunId, {
      id: checkRunId,
      name: job.name,
      head_sha: headSha,
      status: job.status,
      conclusion: job.conclusion,
      started_at: job.started_at ?? job.workflow_run_started_at ?? "1970-01-01T00:00:00Z",
      completed_at: job.completed_at,
      html_url: job.html_url ?? existing?.html_url,
      latest_attempt: true,
    });
  }
  return [...runsById.values()];
}

function checkRunIdFromUrl(url: string): number {
  const match = /\/check-runs\/(\d+)$/.exec(url);
  const id = Number(match?.[1]);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(`Invalid Actions job check_run_url: ${url}`);
  }
  return id;
}

/** Classifies check runs without performing I/O. */
export function classifyCheckRuns(
  runs: readonly CheckRun[],
  headSha: string,
  mergedAt?: string,
): ClassifiedCheckRun[] {
  const latestByName = new Map<string, CheckRun>();
  for (const run of runs) {
    const latest = latestByName.get(run.name);
    if (!latest || compareStartedAt(run, latest) > 0) latestByName.set(run.name, run);
  }

  return runs.map((run): ClassifiedCheckRun => {
    let classification: CheckRunClassification;
    if (latestByName.get(run.name)?.id !== run.id) {
      classification = CHECK_SUPERSEDED;
    } else if (isStale(run, headSha, mergedAt)) {
      classification = CHECK_STALE_POST_MERGE;
    } else if (run.status !== "completed") {
      classification = CHECK_PENDING;
    } else if (run.conclusion === "cancelled") {
      classification = CHECK_CANCELLED;
    } else if (FAILURE_CONCLUSIONS.has(run.conclusion ?? "")) {
      classification = CHECK_CURRENT_FAIL;
    } else {
      classification = CHECK_CURRENT_PASS;
    }
    return { ...run, classification };
  });
}

/** Builds the provenance-bearing report used by both output modes and the exit gate. */
export function buildPrCheckReport(
  repo: string,
  pr: number,
  headSha: string,
  evaluatedAt: string,
  checks: readonly ClassifiedCheckRun[],
): PrCheckReport {
  const currentFailures = checks.filter((check) => check.classification === CHECK_CURRENT_FAIL).length;
  return { gate: "pr-checks", ok: currentFailures === 0, repo, pr, headSha, evaluatedAt, checks, currentFailures };
}

/** Returns the CLI exit code for a completed PR-check report. */
export function exitCodeForPrCheckReport(report: PrCheckReport): number {
  return report.ok ? 0 : 1;
}

function compareStartedAt(left: CheckRun, right: CheckRun): number {
  const attemptDifference = Number(left.latest_attempt ?? false) - Number(right.latest_attempt ?? false);
  if (attemptDifference) return attemptDifference;
  const timeDifference = Date.parse(left.started_at) - Date.parse(right.started_at);
  return timeDifference || left.id - right.id;
}

function isStale(run: CheckRun, headSha: string, mergedAt?: string): boolean {
  if (run.head_sha !== headSha) return true;
  return mergedAt !== undefined && Date.parse(run.started_at) > Date.parse(mergedAt);
}

/** The one-line JSON report, or the `--pretty` lines: one per check, then the verdict. */
export function renderPrCheckReport(report: PrCheckReport, pretty: boolean): string {
  if (!pretty) return `${JSON.stringify(report)}\n`;
  const lines = report.checks.map((check) =>
    `${check.classification} ${check.name} status=${check.status} ` +
    `conclusion=${check.conclusion ?? "none"} startedAt=${check.started_at}`
  );
  lines.push(
    `pr-checks ${report.ok ? "PASS" : "FAIL"} ${report.repo}#${report.pr} ` +
      `headSha=${report.headSha} evaluatedAt=${report.evaluatedAt} ` +
      `checks=${report.checks.length} currentFailures=${report.currentFailures}`,
  );
  return `${lines.join("\n")}\n`;
}

/** Only GET reads through `gh api`: the argv this module can build is closed over that shape. */
export type GhApiRead = readonly ["api", "--method", "GET", string, ...string[]];
export type GhApiRunner = (args: GhApiRead) => Promise<string>;

/** `gh` could not answer; never a statement about the pull request. */
export class PrChecksUnavailable extends Error {}

const exec = promisify(execFile);
const ghApi: GhApiRunner = async (args) => {
  try {
    const { stdout } = await exec("gh", [...args], { maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    // NetScript's wording: the exit code and gh's own stderr, not the whole command line again.
    const failure = (typeof error === "object" && error !== null ? error : {}) as { code?: unknown; stderr?: unknown };
    const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
    const detail = stderr !== "" ? stderr : error instanceof Error ? error.message : "the underlying error could not be read";
    throw new PrChecksUnavailable(`gh api ${args[3]} failed (${String(failure.code ?? "unknown")}): ${detail}`);
  }
};

async function read<T>(runner: GhApiRunner, endpoint: string, extra: readonly string[],
  usable: (value: unknown) => boolean): Promise<T> {
  const text = await runner(["api", "--method", "GET", endpoint, ...extra]);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PrChecksUnavailable(`gh api ${endpoint} returned unparseable output`);
  }
  // A payload of the wrong shape is GitHub failing us too; it must never reach the verdict.
  if (!usable(value)) throw new PrChecksUnavailable(`gh api ${endpoint} returned an unexpected shape`);
  return value as T;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const pagesOf = (key: string) => (value: unknown): boolean =>
  Array.isArray(value) && value.every((page) => record(page) && Array.isArray(page[key]));

interface PullRequestResponse { readonly head: { readonly sha: string }; readonly merged_at: string | null }
interface CheckRunsResponse { readonly check_runs: readonly CheckRun[] }
interface WorkflowRun { readonly id: number; readonly head_sha: string; readonly run_started_at: string }
interface WorkflowRunsResponse { readonly workflow_runs: readonly WorkflowRun[] }
interface WorkflowJobsResponse { readonly jobs: readonly WorkflowJob[] }

/** Reads the pull request's head, its check runs and its latest-attempt Actions jobs, then classifies. */
export async function fetchPrCheckReport(
  repo: string,
  pr: number,
  evaluatedAt: string,
  runner: GhApiRunner = ghApi,
): Promise<PrCheckReport> {
  const pull = await read<PullRequestResponse>(runner, `repos/${repo}/pulls/${pr}`, [],
    (value) => record(value) && record(value["head"]) && typeof value["head"]["sha"] === "string" &&
      (value["merged_at"] === null || typeof value["merged_at"] === "string"));
  const headSha = pull.head.sha;
  const [checkPages, runPages] = await Promise.all([
    read<readonly CheckRunsResponse[]>(runner, `repos/${repo}/commits/${headSha}/check-runs?per_page=100`,
      ["--paginate", "--slurp"], pagesOf("check_runs")),
    read<readonly WorkflowRunsResponse[]>(runner, `repos/${repo}/actions/runs?per_page=100`,
      ["-f", `head_sha=${headSha}`, "--paginate", "--slurp"], pagesOf("workflow_runs")),
  ]);
  const jobs: WorkflowJob[] = [];
  for (const run of runPages.flatMap((page) => page.workflow_runs).filter((run) => run.head_sha === headSha)) {
    const pages = await read<readonly WorkflowJobsResponse[]>(runner,
      `repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, ["--paginate", "--slurp"], pagesOf("jobs"));
    jobs.push(...pages.flatMap((page) => page.jobs).map((job) => ({ ...job, workflow_run_started_at: run.run_started_at })));
  }
  let runs: CheckRun[];
  try {
    runs = mergeLatestWorkflowJobs(checkPages.flatMap((page) => page.check_runs), jobs, headSha);
  } catch (error) {
    // A malformed job link is GitHub's payload failing us, never a verdict on the pull request.
    throw new PrChecksUnavailable(error instanceof Error ? error.message : String(error));
  }
  return buildPrCheckReport(repo, pr, headSha, evaluatedAt, classifyCheckRuns(runs, headSha, pull.merged_at ?? undefined));
}

export interface PrChecksOptions { readonly repo: string; readonly pr: number; readonly pretty: boolean }

/** `--repo owner/name --pr <n> [--pretty] [--json]`; a leading `--` from a task runner is dropped. */
export function parsePrChecksArgs(argv: readonly string[], defaultRepo: string | undefined): PrChecksOptions {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let repo = defaultRepo ?? "";
  let pr = 0;
  let pretty = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = (): string => {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      index++;
      return next;
    };
    switch (arg) {
      case "--json":
        break;
      case "--repo":
        repo = value();
        break;
      case "--pr":
        pr = Number(value());
        break;
      case "--pretty":
        pretty = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("--repo must be owner/name");
  if (!Number.isInteger(pr) || pr < 1) throw new Error("--pr must be a positive integer");
  return { repo, pr, pretty };
}

export interface PrChecksDeps {
  readonly runner: GhApiRunner;
  readonly defaultRepo: string | undefined;
  readonly now: () => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Exit 0 when no current check fails, 1 when one does, 2 for a wrong command line, 3 when `gh` cannot give a usable answer. */
export async function runPrChecks(argv: readonly string[], deps: PrChecksDeps): Promise<number> {
  let options: PrChecksOptions;
  try {
    options = parsePrChecksArgs(argv, deps.defaultRepo);
  } catch (error) {
    deps.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  try {
    const report = await fetchPrCheckReport(options.repo, options.pr, deps.now(), deps.runner);
    deps.stdout(renderPrCheckReport(report, options.pretty));
    return exitCodeForPrCheckReport(report);
  } catch (error) {
    if (!(error instanceof PrChecksUnavailable)) throw error;
    deps.stderr(`${error.message}\n`);
    return 3;
  }
}

/** Deno without `--allow-env` throws on reading the environment; that only means no default. */
function readEnv(name: string): string | undefined {
  try {
    return process.env[name];
  } catch {
    return undefined;
  }
}

export const defaultPrChecksDeps = (): PrChecksDeps => ({
  runner: ghApi,
  defaultRepo: readEnv("GITHUB_REPOSITORY"),
  now: () => new Date().toISOString(),
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
});

/* c8 ignore start — run directly (e.g. `deno run <pinned url>`), not when imported */
if ((import.meta as { main?: boolean }).main === true) {
  const argv = process.argv.slice(2);
  void runPrChecks(argv, defaultPrChecksDeps()).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`internal error: ${error instanceof Error ? error.message : String(error)}\n`);
      // Not 1: that means a current check fails, and a crash is not evidence of one.
      process.exitCode = 4;
    },
  );
}
/* c8 ignore stop */
