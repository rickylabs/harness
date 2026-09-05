import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HARNESSES } from "@rickylabs/board";

import {
  TARGET_REFUSALS,
  accountOf,
  agentsOf,
  checkTargets,
  describeProblem,
  dispatchBranch,
  issueOfBranch,
  resolveTarget,
  type Target,
  type TargetRefusal,
  type TargetTable,
} from "./model.js";

const target = (over: Partial<Target> = {}): Target => ({
  label: "harness",
  repo: "rickylabs/harness",
  agents: ["claude"],
  automerge: false,
  priority: 0,
  disabled: false,
  ...over,
});

const table = (over: Partial<TargetTable> = {}): TargetTable => ({
  inbox: "rickylabs/harness",
  botLogin: "divybot",
  branchPrefix: "orch/divybot-",
  pollInterval: "30s",
  targets: [target()],
  memory: { enabled: false, repo: "rickylabs/harness", branch: "main", dir: "memory", interval: "5m" },
  ...over,
});

const reasons = (problems: readonly { reason: TargetRefusal }[]): readonly TargetRefusal[] =>
  problems.map((problem) => problem.reason);

describe("accountOf", () => {
  it("pools the agents the governor meters together", () => {
    assert.equal(accountOf(""), "claude");
    assert.equal(accountOf("claude"), "claude");
    assert.equal(accountOf("codex"), "codex");
    assert.equal(accountOf("codex-run"), "codex");
  });

  it("meters opencode against codex, which is the upstream behaviour and not ours", () => {
    // Transliterated, not corrected. On this fleet OpenCode runs over OpenRouter and spends credit
    // no subscription window meters, so pooling it onto codex is wrong here — but it is what the
    // dispatcher does, and a mirror that quietly disagreed would explain neither the spawn divybot
    // refuses when codex is exhausted nor the one it allows when it is not. Note the divergence
    // from `INTERACTIVE_TWIN` in `@rickylabs/routing`, which maps `opencode-run` to `opencode`.
    assert.equal(accountOf("opencode"), "codex");
    assert.equal(accountOf("opencode-run"), "codex");
  });

  it("passes an unknown agent through rather than guessing an account for it", () => {
    assert.equal(accountOf("gemini"), "gemini");
  });
});

describe("agentsOf", () => {
  it("falls back to the row's single agent when no list is given", () => {
    assert.deepEqual(agentsOf([], "codex"), ["codex"]);
  });

  it("keeps the listed order, because it is an overflow preference", () => {
    assert.deepEqual(agentsOf(["codex", "claude"], "claude"), ["codex", "claude"]);
  });

  it("collapses two agents that share one account into one candidate", () => {
    // The consequence worth seeing: a row asking to prefer OpenCode and fall back to Codex gets a
    // single candidate, because the governor cannot tell those two apart. Not a refusal — the table
    // is not wrong for saying something the dispatcher flattens — but visible in `targets show`.
    assert.deepEqual(agentsOf(["opencode", "codex"], "claude"), ["codex"]);
  });

  it("is never empty", () => {
    assert.deepEqual(agentsOf([], ""), ["claude"]);
  });
});

describe("resolveTarget", () => {
  it("returns null when no target's label is on the issue", () => {
    assert.equal(resolveTarget(table(), ["type:feat", "priority:p1"]), null);
  });

  it("takes the first match in config order", () => {
    const first = target({ label: "harness", repo: "rickylabs/harness" });
    const second = target({ label: "deno", repo: "denoland/deno" });
    const match = resolveTarget(table({ targets: [first, second] }), ["deno", "harness"]);
    assert.equal(match?.target.repo, "rickylabs/harness");
  });

  it("reports the rows the winner hides", () => {
    // The silent misconfiguration this exists for. Two target labels on one issue dispatch to one
    // repository chosen by array position, and nothing upstream logs the fact.
    const first = target({ label: "harness", repo: "rickylabs/harness" });
    const second = target({ label: "deno", repo: "denoland/deno" });
    const match = resolveTarget(table({ targets: [first, second] }), ["harness", "deno"]);
    assert.deepEqual(match?.shadowed.map((t) => t.repo), ["denoland/deno"]);
  });

  it("matches a disabled target, because pausing is not unmapping", () => {
    const match = resolveTarget(table({ targets: [target({ disabled: true })] }), ["harness"]);
    assert.equal(match?.target.repo, "rickylabs/harness");
  });
});

describe("branch naming", () => {
  it("round-trips an issue number", () => {
    assert.equal(dispatchBranch("orch/divybot-", 142), "orch/divybot-142");
    assert.equal(issueOfBranch("orch/divybot-", "orch/divybot-142"), 142);
  });

  it("refuses a branch a person made from a dispatched one", () => {
    // `orch/divybot-142-retry` is somebody's own branch. Reading it as issue 142 would attribute
    // their work to the run, which is the wrong answer in the direction that matters — a supervisor
    // would then believe the dispatched run delivered something it did not.
    assert.equal(issueOfBranch("orch/divybot-", "orch/divybot-142-retry"), null);
    assert.equal(issueOfBranch("orch/divybot-", "orch/divybot-"), null);
    assert.equal(issueOfBranch("orch/divybot-", "feat/142-thing"), null);
  });

  it("refuses everything when there is no prefix to match on", () => {
    assert.equal(issueOfBranch("", "142"), null);
  });

  it("refuses a zero and a non-number", () => {
    assert.equal(issueOfBranch("orch/divybot-", "orch/divybot-0"), null);
    assert.equal(issueOfBranch("orch/divybot-", "orch/divybot-1e3"), null);
  });
});

describe("checkTargets", () => {
  it("passes the shape the live config has", () => {
    assert.deepEqual(checkTargets(table()), []);
  });

  it("refuses a table with no targets, which divybot will not start on", () => {
    assert.deepEqual(reasons(checkTargets(table({ targets: [] }))), ["no-targets"]);
  });

  it("refuses a second row claiming a taken label, naming who has it", () => {
    const problems = checkTargets(
      table({ targets: [target(), target({ repo: "denoland/deno" })] }),
    );
    assert.deepEqual(reasons(problems), ["duplicate-label"]);
    assert.match(problems[0]?.message ?? "", /rickylabs\/harness/);
    assert.equal(problems[0]?.label, "harness");
  });

  it("refuses a malformed repository slug", () => {
    assert.deepEqual(reasons(checkTargets(table({ targets: [target({ repo: "harness" })] }))), [
      "malformed-repo",
    ]);
  });

  it("refuses an agent this fleet has no harness for", () => {
    const problems = checkTargets(table({ targets: [target({ agents: ["gemini"] })] }));
    assert.deepEqual(reasons(problems), ["unknown-agent"]);
    for (const harness of HARNESSES) assert.ok(problems[0]?.message.includes(harness));
  });

  it("refuses automerge, which #37 settles as a human's decision", () => {
    assert.deepEqual(reasons(checkTargets(table({ targets: [target({ automerge: true })] }))), [
      "automerge-enabled",
    ]);
  });

  it("refuses a poll interval Go would not parse", () => {
    assert.deepEqual(reasons(checkTargets(table({ pollInterval: "30 seconds" }))), [
      "malformed-duration",
    ]);
  });

  it("refuses a table with nothing to tell an override comment apart by", () => {
    assert.deepEqual(reasons(checkTargets(table({ botLogin: "", branchPrefix: "" }))), [
      "missing-branch-prefix",
      "missing-bot-login",
    ]);
  });

  it("reports every problem, not the first", () => {
    const problems = checkTargets(
      table({ pollInterval: "soon", targets: [target({ repo: "nope", automerge: true })] }),
    );
    assert.deepEqual(reasons(problems), ["malformed-duration", "malformed-repo", "automerge-enabled"]);
  });
});

describe("the memory boundary (ADR 0001)", () => {
  it("says nothing while the store is off", () => {
    // A rule that fires on a feature nobody enabled teaches operators to ignore it before it ever
    // means anything. The live config ships with the store off.
    assert.deepEqual(checkTargets(table()), []);
  });

  it("refuses a store that resolves to the inbox by omitting the repo", () => {
    // The dangerous spelling, and the reason `config.ts` applies divybot's defaults at the parse:
    // `memory.repo` defaults to the inbox, so a config that simply leaves it out puts an unreviewed
    // agent-driven commit loop on the branch holding the doctrine.
    const problems = checkTargets(
      table({ memory: { enabled: true, repo: "rickylabs/harness", branch: "main", dir: "memory", interval: "5m" } }),
    );
    assert.deepEqual(reasons(problems), ["memory-on-inbox"]);
    assert.match(problems[0]?.message ?? "", /ADR 0001/);
  });

  it("admits a store pointed somewhere else", () => {
    assert.deepEqual(
      checkTargets(
        table({
          memory: { enabled: true, repo: "rickylabs/memory", branch: "main", dir: "memory", interval: "5m" },
        }),
      ),
      [],
    );
  });

  it("refuses a memory interval Go would not parse", () => {
    assert.deepEqual(
      reasons(
        checkTargets(
          table({
            memory: { enabled: true, repo: "rickylabs/memory", branch: "main", dir: "memory", interval: "5" },
          }),
        ),
      ),
      ["malformed-duration"],
    );
  });
});

describe("the refusal set", () => {
  it("has a distinct message for every reason the suite can produce", () => {
    const produced = new Set<string>();
    const cases: readonly TargetTable[] = [
      table({ targets: [] }),
      table({ branchPrefix: "", botLogin: "", pollInterval: "x" }),
      table({ targets: [target({ label: "" }), target(), target()] }),
      table({ targets: [target({ repo: "" })] }),
      table({ targets: [target({ repo: "nope" })] }),
      table({ targets: [target({ agents: ["gemini"] })] }),
      table({ targets: [target({ automerge: true })] }),
      table({ memory: { enabled: true, repo: "rickylabs/harness", branch: "main", dir: "memory", interval: "5m" } }),
    ];
    for (const one of cases) for (const problem of checkTargets(one)) produced.add(problem.reason);
    assert.deepEqual([...TARGET_REFUSALS].filter((reason) => !produced.has(reason)), []);
  });

  it("describes a row-level problem with the row it is about", () => {
    const [problem] = checkTargets(table({ targets: [target({ automerge: true })] }));
    if (problem === undefined) throw new Error("expected a problem");
    assert.match(describeProblem(problem), /^automerge-enabled \[harness]: /);
  });
});
