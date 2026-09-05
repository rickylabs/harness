import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectEvaluator, type Actor, type Candidate } from "./independence.js";
import { EVENT_KIND, recordOf, telemetryLine } from "./record.js";

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

const sibling: Candidate = { ...codex, id: "run-sibling", family: "anthropic", model: "fable-5" };

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
