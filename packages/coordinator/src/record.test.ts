import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectEvaluator, type Actor, type Candidate } from "./independence.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT, eventFlagProblem, EVENT_COMMANDS } from "./cli.js";
import { planOf, statesOf, admit, type StepState } from "./plan.js";
import { MILESTONE_WORKFLOW as MILESTONE } from "./workflow.js";
import {
  ADMIT_EVENT_KIND,
  admitTelemetryLine,
  EVENT_KIND,
  PLAN_EVENT_KIND,
  planOutcome,
  planTelemetryLine,
  recordOf,
  telemetryLine,
} from "./record.js";

const author: Actor = {
  id: "run-author",
  seam: "subscription",
  family: "anthropic",
  model: "opus-5",
  effort: "medium",
};

const codex: Candidate = {
  id: "run-codex",
  seam: "subscription",
  family: "openai",
  model: "gpt-5.6-sol",
  effort: "xhigh",
  openWeights: false,
  blockedBy: null,
};

const sibling: Candidate = { ...codex, id: "run-sibling", family: "anthropic", model: "fable-5.1" };

const AT = "2026-09-05T09:00:00.000Z";

describe("recordOf", () => {
  it("keeps the choice, the reason and the rejections", () => {
    const record = recordOf("run-42", AT, selectEvaluator(author, [codex, sibling]));
    assert.equal(record.runId, "run-42");
    assert.equal(record.at, AT);
    assert.equal(record.outcome, "selected");
    assert.equal(record.policy, "opposite-family");
    assert.equal(record.evaluator?.id, "run-codex");
    assert.equal(record.rejected.length, 1);
    assert.equal(record.rejected[0]?.candidate, "run-sibling");
  });

  it("is a pure function of its inputs, which is what makes a replay comparable", () => {
    // #71 compares two records for equality. That only works if nothing inside reads a clock.
    const decision = selectEvaluator(author, [codex, sibling]);
    assert.deepEqual(recordOf("run-42", AT, decision), recordOf("run-42", AT, decision));
    assert.deepEqual(
      recordOf("run-42", AT, selectEvaluator(author, [codex, sibling])),
      recordOf("run-42", AT, selectEvaluator(author, [sibling, codex])),
    );
  });

  it("records a blocker as a first-class outcome with no evaluator", () => {
    const record = recordOf("run-42", AT, selectEvaluator(author, [sibling]));
    assert.equal(record.outcome, "blocked");
    assert.equal(record.evaluator, null);
    assert.equal(record.transient, false);
    assert.match(record.because, /roster gap/);
  });

  it("leaves transient null on a selection instead of a misleading false", () => {
    // false would read as "this selection is not transient", which is a claim about nothing.
    assert.equal(recordOf("run-42", AT, selectEvaluator(author, [codex])).transient, null);
  });

  it("carries the launch identity and nothing else about a candidate", () => {
    // openWeights and blockedBy are inputs to the rule, not properties of the run that was chosen;
    // blockedBy in particular is a fact about a moment, and a record that keeps it will be read
    // later as though it were still true.
    const record = recordOf("run-42", AT, selectEvaluator(author, [codex]));
    assert.deepEqual(Object.keys(record.evaluator ?? {}).sort(), ["effort", "family", "id", "model", "seam"]);
  });

  it("takes the run id it was given rather than assuming the author's", () => {
    // A dispatcher decides on behalf of a run it is about to launch, so the author's session id and
    // the run the decision belongs to are routinely different.
    assert.equal(recordOf("run-elsewhere", AT, selectEvaluator(author, [codex])).runId, "run-elsewhere");
  });
});

describe("telemetryLine", () => {
  it("emits exactly the envelope the telemetry writer reads", () => {
    const line = telemetryLine(recordOf("run-42", AT, selectEvaluator(author, [codex, sibling])));
    const parsed: unknown = JSON.parse(line);
    assert.deepEqual(Object.keys(parsed as object).sort(), ["at", "detail", "kind", "runId"]);
    const event = parsed as { runId: string; kind: string; at: string; detail: Record<string, unknown> };
    assert.equal(event.runId, "run-42");
    assert.equal(event.kind, EVENT_KIND);
    assert.equal(event.at, AT);
  });

  it("puts everything else in detail, so the envelope never has to change", () => {
    const event = JSON.parse(telemetryLine(recordOf("run-42", AT, selectEvaluator(author, [codex, sibling])))) as {
      detail: Record<string, unknown>;
    };
    assert.deepEqual(
      Object.keys(event.detail).sort(),
      ["author", "because", "evaluator", "outcome", "policy", "rejected", "transient"],
    );
    assert.equal(event.detail["outcome"], "selected");
  });

  it("is one line, because JSONL is one record per line", () => {
    // A because-sentence with a newline in it would silently split one event into two broken ones.
    const line = telemetryLine(recordOf("run-42", AT, selectEvaluator(author, [sibling])));
    assert.equal(line.includes("\n"), false);
  });

  it("survives a round-trip without losing the rejections", () => {
    const record = recordOf("run-42", AT, selectEvaluator(author, [codex, sibling]));
    const back = JSON.parse(telemetryLine(record)) as { detail: { rejected: unknown } };
    assert.deepEqual(back.detail.rejected, record.rejected);
  });
});


/**
 * `plan --event` and `admit --event` used to accept the flag and change nothing, so a dispatcher
 * piping either into `dsh-telemetry record` recorded no events and exited 0. The decision worth
 * having on disk is the refusal, which is exactly the one that was lost.
 */
describe("plan and admit events", () => {
  const planFor = (steps: readonly StepState[]) => planOf(MILESTONE, statesOf(MILESTONE, steps));
  const detailOf = (line: string): Record<string, unknown> =>
    (JSON.parse(line) as { readonly detail: Record<string, unknown> }).detail;

  it("emits the same envelope as the evaluator line, under its own kind", () => {
    const line = planTelemetryLine("run-42", AT, planFor([]));
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), ["at", "detail", "kind", "runId"]);
    assert.equal(parsed["kind"], PLAN_EVENT_KIND);
    assert.notEqual(parsed["kind"], EVENT_KIND, "a plan is not an evaluator decision");
    assert.equal(parsed["runId"], "run-42");
    assert.equal(parsed["at"], AT);
  });

  it("carries the outcome, so a reader does not have to re-derive it from the arrays", () => {
    const detail = detailOf(planTelemetryLine("r", AT, planFor([])));
    assert.equal(detail["outcome"], "runnable");
    assert.equal(detail["workflow"], MILESTONE.name);
  });

  it("reports the same outcome the exit code is derived from", () => {
    // The two used to be computed separately. A recorded event that disagrees with the status its
    // caller branched on is worse than no event, so both now read planOutcome.
    for (const steps of [[], [{ id: "read-milestone", outcome: "blocked", note: "x", citations: {} } as StepState]]) {
      const plan = planFor(steps);
      const outcome = planOutcome(plan);
      const detail = detailOf(planTelemetryLine("r", AT, plan));
      assert.equal(detail["outcome"], outcome);
    }
  });

  it("names a halt as halted rather than as runnable", () => {
    const plan = planFor([{ id: "read-milestone", outcome: "blocked", note: "upstream", citations: {} }]);
    assert.equal(planOutcome(plan), "halted");
  });

  it("records a refused admission with its rule, which is the event worth keeping", () => {
    const admission = admit(MILESTONE, [], "dispatch-run");
    assert.equal(admission.admitted, false);
    const parsed = JSON.parse(admitTelemetryLine("run-42", AT, admission)) as { readonly kind: string };
    assert.equal(parsed.kind, ADMIT_EVENT_KIND);
    const detail = detailOf(admitTelemetryLine("run-42", AT, admission));
    assert.equal(detail["outcome"], "refused");
    assert.equal(detail["step"], "dispatch-run");
    assert.equal(typeof detail["rule"], "string");
  });

  it("records an admitted step too, so the feed is not only refusals", () => {
    const admission = admit(MILESTONE, [], "read-milestone");
    assert.equal(admission.admitted, true);
    const detail = detailOf(admitTelemetryLine("r", AT, admission));
    assert.equal(detail["outcome"], "admitted");
    assert.equal(detail["rule"], undefined, "an admission has no refusal rule");
  });
});

describe("the --event flag guard", () => {
  it("permits the three commands that reach a decision", () => {
    for (const command of ["evaluator", "plan", "admit"]) {
      assert.equal(eventFlagProblem(command, true, "run-1"), null, `${command} should accept --event`);
      assert.equal(EVENT_COMMANDS.has(command), true);
    }
  });

  it("refuses rather than ignores on a command that cannot produce an event", () => {
    // Silently accepting the flag and changing nothing is the defect. Any answer is fine except none.
    for (const command of ["worktrees", "replay", "diff", "workflow", "policies", "nonsense"]) {
      const problem = eventFlagProblem(command, true, "run-1");
      assert.notEqual(problem, null, `${command} must refuse --event, not ignore it`);
      assert.match(String(problem), /not available/);
      assert.match(String(problem), new RegExp(command));
    }
  });

  it("requires a run, on every command that accepts the flag", () => {
    for (const command of ["evaluator", "plan", "admit"]) {
      assert.match(String(eventFlagProblem(command, true, null)), /needs --run/);
    }
  });

  it("says nothing at all when the flag is absent", () => {
    for (const command of ["plan", "worktrees", "nonsense"]) {
      assert.equal(eventFlagProblem(command, false, null), null);
    }
  });
});

/**
 * The wiring, not the builders.
 *
 * Everything above proves `planTelemetryLine` produces the right string. None of it would notice if
 * `plan` stopped calling it — which is precisely the bug that was reported: the evaluator's line
 * builder worked the whole time and `plan` simply never consulted the flag. So these run the built
 * binary and read what actually reached its stdout.
 *
 * A child process rather than a stdout capture. Replacing `process.stdout.write` in-process races
 * with the test reporter's own writes on this runner, which the first attempt at this proved by
 * producing interleaved binary. `dist/cli.js` is a sibling of this compiled file and the package's
 * test script compiles before it runs, so the binary is always there.
 */
describe("plan and admit honour --event through the real binary", () => {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const STATE = JSON.stringify({ workflow: "milestone", steps: [] });

  function run(argv: readonly string[]): { code: number; out: string } {
    const scratch = mkdtempSync(join(tmpdir(), "coordinator-event-"));
    try {
      const state = join(scratch, "state.json");
      writeFileSync(state, STATE);
      const result = spawnSync(process.execPath, [cli, ...argv, "--state", state], { encoding: "utf8" });
      assert.equal(result.error, undefined, "the coordinator binary must be runnable for this to mean anything");
      return { code: result.status ?? -1, out: result.stdout };
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }

  it("plan --event writes one JSON line and no prose", () => {
    const { code, out } = run(["plan", "--run", "run-42", "--at", AT, "--event"]);
    assert.equal(code, EXIT.ok);
    const lines = out.trimEnd().split("\n");
    assert.equal(lines.length, 1, `expected exactly one line, got ${lines.length}`);
    const event = JSON.parse(lines[0] ?? "") as { kind: string; runId: string; at: string };
    assert.equal(event.kind, PLAN_EVENT_KIND);
    assert.equal(event.runId, "run-42");
    assert.equal(event.at, AT);
  });

  it("plan without --event still writes prose, so the default is unchanged", () => {
    const { out } = run(["plan"]);
    assert.match(out, /plan: /);
    assert.throws(() => JSON.parse(out.split("\n")[0] ?? ""));
  });

  it("admit --event writes one JSON line for the refusal, which is the event worth keeping", () => {
    const { code, out } = run(["admit", "--step", "dispatch-run", "--run", "r", "--at", AT, "--event"]);
    assert.equal(code, EXIT.blocked, "a refused admission is still a refusal");
    const event = JSON.parse(out.trimEnd()) as { kind: string; detail: Record<string, unknown> };
    assert.equal(event.kind, ADMIT_EVENT_KIND);
    assert.equal(event.detail["outcome"], "refused");
  });

  it("a command that cannot produce an event refuses instead of ignoring the flag", () => {
    const { code, out } = run(["diff", "--run", "r", "--event"]);
    assert.equal(code, EXIT.usage);
    assert.match(out, /--event is not available on diff/);
  });

  it("--event without --run is a usage error on plan, as it already was on evaluator", () => {
    const { code, out } = run(["plan", "--event"]);
    assert.equal(code, EXIT.usage);
    assert.match(out, /needs --run/);
  });
});
