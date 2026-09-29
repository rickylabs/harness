import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { main } from "./cli.js";
import type { CliDeps } from "./cli.js";
import {
  buildPrCheckReport,
  classifyCheckRuns,
  exitCodeForPrCheckReport,
  mergeLatestWorkflowJobs,
  renderPrCheckReport,
  runPrChecks,
} from "./pr-checks.js";
import type { CheckRun, GhApiRead, GhApiRunner, PrChecksDeps, WorkflowJob } from "./pr-checks.js";

interface RecordedCase {
  readonly name: string;
  readonly runs: CheckRun[];
  readonly jobs: WorkflowJob[];
  readonly mergedAt?: string;
  readonly result?: { merged: unknown; checks: unknown; report: unknown; exit: number; json: string };
  readonly error?: string;
}

// Recorded once from NetScript's pr-checks at the recorded SHA. CI replays frozen data and never
// installs, imports or reads NetScript.
const reference = JSON.parse(readFileSync(new URL("../test-fixtures/pr-checks.976ff64.json", import.meta.url), "utf8")) as {
  sourceRevision: string; casesSha256: string; cases: RecordedCase[];
};

describe("parity with the NetScript pr-checks it replaces", () => {
  it("the frozen reference is intact and covers every classification", () => {
    assert.equal(reference.sourceRevision, "976ff64811130f21f7d44cd93dc5a69a4dcfb74e");
    assert.equal(createHash("sha256").update(JSON.stringify(reference.cases)).digest("hex"), reference.casesSha256);
    const seen = new Set(reference.cases.flatMap((c) => ((c.result?.checks ?? []) as { classification: string }[]).map((x) => x.classification)));
    for (const classification of ["current-pass", "current-fail", "superseded", "cancelled", "stale-post-merge", "pending"]) {
      assert.ok(seen.has(classification), classification);
    }
    assert.ok(reference.cases.some((c) => c.error !== undefined));
  });

  it("merge, classify, report and exit code match for every recorded case", () => {
    for (const c of reference.cases) {
      const replay = () => {
        const merged = mergeLatestWorkflowJobs(c.runs, c.jobs, "H");
        const checks = classifyCheckRuns(merged, "H", c.mergedAt);
        const report = buildPrCheckReport("o/n", 7, "H", "2026-08-03T12:30:00.000Z", checks);
        return { merged, checks, report, exit: exitCodeForPrCheckReport(report), json: JSON.stringify(report) };
      };
      if (c.error !== undefined) {
        assert.throws(replay, { message: c.error }, c.name);
        continue;
      }
      // Recorded through JSON, so compare the same way: an absent key and an undefined one read alike.
      assert.deepEqual(JSON.parse(JSON.stringify(replay())), c.result, c.name);
      assert.equal(replay().json, c.result!.json, c.name);
    }
  });
});

const report = buildPrCheckReport("o/n", 7, "H", "2026-08-03T12:30:00.000Z", classifyCheckRuns([
  { id: 1, name: "build", head_sha: "H", status: "completed", conclusion: "failure", started_at: "2026-08-03T10:00:00Z" },
  { id: 2, name: "lint", head_sha: "H", status: "in_progress", conclusion: null, started_at: "2026-08-03T10:01:00Z" },
], "H"));

describe("output", () => {
  it("prints NetScript's one-line JSON by default and its text lines with --pretty", () => {
    assert.equal(renderPrCheckReport(report, false), `${JSON.stringify(report)}\n`);
    assert.equal(renderPrCheckReport(report, true), [
      "current-fail build status=completed conclusion=failure startedAt=2026-08-03T10:00:00Z",
      "pending lint status=in_progress conclusion=none startedAt=2026-08-03T10:01:00Z",
      "pr-checks FAIL o/n#7 headSha=H evaluatedAt=2026-08-03T12:30:00.000Z checks=2 currentFailures=1",
      "",
    ].join("\n"));
  });
});

/** A scripted `gh`: answers by endpoint prefix and records every argv it was asked for. */
function scripted(answers: Record<string, unknown>): { runner: GhApiRunner; calls: GhApiRead[] } {
  const calls: GhApiRead[] = [];
  const runner: GhApiRunner = async (args) => {
    calls.push(args);
    const key = Object.keys(answers).find((prefix) => args[3].startsWith(prefix));
    if (key === undefined) throw new Error(`unscripted ${args[3]}`);
    return JSON.stringify(answers[key]);
  };
  return { runner, calls };
}

const job = { id: 200, name: "build", status: "completed", conclusion: "success", started_at: "2026-08-03T10:02:00Z",
  completed_at: "2026-08-03T10:03:00Z", check_run_url: "https://api.github.com/repos/o/n/check-runs/2", run_id: 10, run_attempt: 2 };
const pullAnswers = (jobs: unknown[] = [job]) => ({
  "repos/o/n/pulls/7": { head: { sha: "H" }, merged_at: null },
  "repos/o/n/commits/H/check-runs": [{ check_runs: [{ id: 1, name: "build", head_sha: "H", status: "completed",
    conclusion: "failure", started_at: "2026-08-03T10:00:00Z" }] }],
  "repos/o/n/actions/runs?": [{ workflow_runs: [{ id: 10, head_sha: "H", run_started_at: "2026-08-03T09:59:00Z" },
    { id: 11, head_sha: "OTHER", run_started_at: "2026-08-03T09:00:00Z" }] }],
  "repos/o/n/actions/runs/10/jobs": [{ jobs }],
});

function deps(runner: GhApiRunner): PrChecksDeps & { out: string[]; err: string[] } {
  const out: string[] = [], err: string[] = [];
  return { runner, defaultRepo: undefined, now: () => "2026-08-03T12:30:00.000Z",
    stdout: (t) => void out.push(t), stderr: (t) => void err.push(t), out, err };
}

describe("reading a pull request", () => {
  it("issues only GET reads, follows the head's own workflow runs, and lets the latest attempt win", async () => {
    const { runner, calls } = scripted(pullAnswers());
    const d = deps(runner);
    assert.equal(await runPrChecks(["--", "--repo", "o/n", "--pr", "7"], d), 0);
    assert.ok(calls.every((args) => args[0] === "api" && args[1] === "--method" && args[2] === "GET"));
    assert.ok(!calls.some((args) => args[3].includes("runs/11/")), "a run for another head is never read");
    const printed = JSON.parse(d.out.join(""));
    assert.deepEqual(printed.checks.map((c: { classification: string }) => c.classification), ["superseded", "current-pass"]);
    assert.equal(printed.ok, true);
  });

  it("exits 1 on a current failure, 2 on a wrong command line, 3 when gh cannot answer", async () => {
    assert.equal(await runPrChecks(["--repo", "o/n", "--pr", "7"],
      deps(scripted(pullAnswers([{ ...job, conclusion: "failure" }])).runner)), 1);
    const usage = deps(scripted({}).runner);
    assert.equal(await runPrChecks(["--repo", "o/n"], usage), 2);
    assert.match(usage.err.join(""), /--pr must be a positive integer/);
    assert.equal(await runPrChecks(["--repo", "o/n", "--pr", "7", "--bogus"], deps(scripted({}).runner)), 2);
    const offline = deps(async () => { throw new (await import("./pr-checks.js")).PrChecksUnavailable("gh api repos/o/n/pulls/7 failed: offline"); });
    assert.equal(await runPrChecks(["--repo", "o/n", "--pr", "7"], offline), 3);
    const garbled = deps(async () => "<html>proxy</html>");
    assert.equal(await runPrChecks(["--repo", "o/n", "--pr", "7"], garbled), 3);
    // A malformed job link is GitHub's payload failing, not a verdict on the pull request.
    const badLink = deps(scripted(pullAnswers([{ ...job, check_run_url: "https://api.github.com/repos/o/n/check-runs/x" }])).runner);
    assert.equal(await runPrChecks(["--repo", "o/n", "--pr", "7"], badLink), 3);
    assert.equal(badLink.out.join(""), "");
  });
});

describe("dsh-board checks", () => {
  const cli = (runner: GhApiRunner, detected: string | null = "o/n") => {
    const out: string[] = [], err: string[] = [];
    const d: CliDeps = { fetchItems: async () => { throw new Error("the board is not read"); }, detectRepoSlug: async () => detected,
      cwd: () => "/somewhere", now: () => "2026-08-03T12:30:00.000Z", stdout: (t) => void out.push(t), stderr: (t) => void err.push(t), ghApi: runner };
    return { d, out, err };
  };

  it("uses the detected repository, never the board fetch, and prints the same report", async () => {
    const saved = process.env["GITHUB_REPOSITORY"];
    delete process.env["GITHUB_REPOSITORY"];
    try {
      const { d, out } = cli(scripted(pullAnswers()).runner);
      assert.equal(await main(["checks", "--pr", "7", "--pretty"], d), 0);
      assert.match(out.join(""), /^pr-checks PASS o\/n#7 headSha=H /m);
      const failing = cli(scripted(pullAnswers([{ ...job, conclusion: "timed_out" }])).runner);
      assert.equal(await main(["checks", "--pr", "7"], failing.d), 1);
      const nowhere = cli(scripted({}).runner, null);
      assert.equal(await main(["checks", "--pr", "7"], nowhere.d), 2);
    } finally {
      if (saved !== undefined) process.env["GITHUB_REPOSITORY"] = saved;
    }
  });
});
