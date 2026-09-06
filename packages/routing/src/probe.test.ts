import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AVAILABILITIES,
  DEFAULT_FRESHNESS,
  FALLBACK_METADATA_MARKER,
  PROBE_REFUSALS,
  SOURCES,
  availabilityOf,
  checkObservation,
  describeAvailability,
  describeProbeProblem,
  describeProbeRefusal,
  describeVerdict,
  fallbackMetadataModels,
  isFresh,
  mayDispatch,
  readsFallbackMetadata,
} from "./probe.js";
import type { Observation, ProbeRefusal, Verdict } from "./probe.js";

const NOW = "2026-09-06T12:00:00.000Z";
const TARGET = "codex";
const MODEL = "gpt-5.5-codex";

function ago(minutes: number): string {
  return new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    target: TARGET,
    model: MODEL,
    observedAt: ago(1),
    reachable: true,
    completed: true,
    output: "ok",
    ...overrides,
  };
}

function reasons(problems: readonly { readonly reason: ProbeRefusal }[]): ProbeRefusal[] {
  return problems.map((problem) => problem.reason);
}

// The line codex-cli actually prints, which is the whole of #59's second criterion.
const WARNING = `Model metadata for '${MODEL}' not found. Defaulting to fallback metadata`;

describe("readsFallbackMetadata", () => {
  it("finds the marker in a line of ordinary CLI noise", () => {
    assert.equal(readsFallbackMetadata(`reading config\n${WARNING}\nstarting run`), true);
  });

  it("finds the marker on its own, without the sentence that usually precedes it", () => {
    assert.equal(readsFallbackMetadata(FALLBACK_METADATA_MARKER), true);
  });

  it("is case-insensitive, because the prefix is what a vendor rewords", () => {
    assert.equal(readsFallbackMetadata("defaulting to FALLBACK METADATA"), true);
  });

  it("is false for output that never mentions it", () => {
    assert.equal(readsFallbackMetadata("model loaded\nrunning\ndone"), false);
  });

  it("is false for empty output", () => {
    assert.equal(readsFallbackMetadata(""), false);
  });
});

describe("fallbackMetadataModels", () => {
  it("names the model in the single-quoted form codex prints", () => {
    assert.deepEqual([...fallbackMetadataModels(WARNING)], [MODEL]);
  });

  it("reads the double-quoted and backtick forms too", () => {
    assert.deepEqual(
      [...fallbackMetadataModels('Model metadata for "a-model" not found.')],
      ["a-model"],
    );
    assert.deepEqual(
      [...fallbackMetadataModels("Model metadata for `b-model` not found.")],
      ["b-model"],
    );
  });

  it("reads the unquoted form", () => {
    assert.deepEqual([...fallbackMetadataModels("Model metadata for c-model not found.")], ["c-model"]);
  });

  it("collects several, in order, without repeating one", () => {
    const output = [
      "Model metadata for 'one' not found. Defaulting to fallback metadata",
      "Model metadata for 'two' not found. Defaulting to fallback metadata",
      "Model metadata for 'one' not found. Defaulting to fallback metadata",
    ].join("\n");
    assert.deepEqual([...fallbackMetadataModels(output)], ["one", "two"]);
  });

  it("is empty for a warning that names nothing", () => {
    assert.deepEqual([...fallbackMetadataModels(FALLBACK_METADATA_MARKER)], []);
  });

  it("does not accumulate state across calls", () => {
    assert.deepEqual([...fallbackMetadataModels(WARNING)], [MODEL]);
    assert.deepEqual([...fallbackMetadataModels(WARNING)], [MODEL]);
  });
});

describe("isFresh", () => {
  it("is true inside the default window", () => {
    assert.equal(isFresh(observation({ observedAt: ago(9) }), NOW), true);
  });

  it("is false outside it", () => {
    assert.equal(isFresh(observation({ observedAt: ago(11) }), NOW), false);
  });

  it("includes the boundary", () => {
    assert.equal(isFresh(observation({ observedAt: ago(10) }), NOW), true);
  });

  it("honours an explicit window", () => {
    assert.equal(isFresh(observation({ observedAt: ago(30) }), NOW, "1h"), true);
    assert.equal(isFresh(observation({ observedAt: ago(30) }), NOW, "5m"), false);
  });

  it("fails closed on an unreadable clock", () => {
    assert.equal(isFresh(observation({ observedAt: "yesterday" }), NOW), false);
    assert.equal(isFresh(observation(), "whenever"), false);
  });

  it("fails closed on an observation stamped in the future", () => {
    assert.equal(isFresh(observation({ observedAt: ago(-5) }), NOW), false);
  });

  it("fails closed on a window that is not a duration, or is negative", () => {
    assert.equal(isFresh(observation(), NOW, "ten minutes"), false);
    assert.equal(isFresh(observation(), NOW, "-5m"), false);
  });
});

describe("checkObservation", () => {
  it("passes a well-formed one", () => {
    assert.deepEqual([...checkObservation(observation(), NOW)], []);
  });

  it("refuses one that names no destination or no model", () => {
    assert.deepEqual(reasons(checkObservation(observation({ target: "  " }), NOW)), ["no-target"]);
    assert.deepEqual(reasons(checkObservation(observation({ model: "" }), NOW)), ["no-model"]);
  });

  it("refuses an unreadable stamp, on either side", () => {
    assert.deepEqual(reasons(checkObservation(observation({ observedAt: "soon" }), NOW)), [
      "clock-unreadable",
    ]);
    assert.deepEqual(reasons(checkObservation(observation(), "soon")), ["clock-unreadable"]);
  });

  it("refuses one stamped after the reference clock", () => {
    assert.deepEqual(reasons(checkObservation(observation({ observedAt: ago(-1) }), NOW)), [
      "observed-in-future",
    ]);
  });

  it("carries the model on the problem, and null when there is none", () => {
    const [named] = checkObservation(observation({ observedAt: "soon" }), NOW);
    assert.equal(named?.model, MODEL);
    const [anonymous] = checkObservation(observation({ model: "" }), NOW);
    assert.equal(anonymous?.model, null);
  });
});

describe("availabilityOf — a probe that establishes something", () => {
  it("admits a fresh, reachable, complete probe with a clean output", () => {
    const verdict = availabilityOf({ target: TARGET, model: MODEL, observation: observation() }, NOW);
    assert.equal(verdict.availability, "available");
    assert.equal(verdict.source, "probe");
    assert.equal(verdict.observedAt, ago(1));
    assert.deepEqual([...verdict.problems], []);
    assert.equal(mayDispatch(verdict), true);
  });

  it("reports a destination that did not answer as unavailable, not unknown", () => {
    const verdict = availabilityOf(
      { target: TARGET, model: MODEL, observation: observation({ reachable: false }) },
      NOW,
    );
    assert.equal(verdict.availability, "unavailable");
    assert.equal(verdict.source, "probe");
    assert.deepEqual(reasons(verdict.problems), ["endpoint-unreachable"]);
    assert.equal(mayDispatch(verdict), false);
  });
});

describe("availabilityOf — the metadata trap (#59, criterion 2)", () => {
  it("refuses a run whose output carries the warning, even though the probe succeeded", () => {
    const verdict = availabilityOf(
      { target: TARGET, model: MODEL, observation: observation({ output: `starting\n${WARNING}` }) },
      NOW,
    );
    assert.equal(verdict.availability, "degraded");
    assert.equal(verdict.source, "probe");
    assert.deepEqual(reasons(verdict.problems), ["fallback-metadata"]);
    assert.equal(mayDispatch(verdict), false);
  });

  it("treats an unattributable warning as being about the model asked for", () => {
    const verdict = availabilityOf(
      {
        target: TARGET,
        model: MODEL,
        observation: observation({ output: FALLBACK_METADATA_MARKER }),
      },
      NOW,
    );
    assert.equal(verdict.availability, "degraded");
  });

  it("does not refuse on a warning that names some other model", () => {
    const output = "Model metadata for 'another-model' not found. Defaulting to fallback metadata";
    const verdict = availabilityOf(
      { target: TARGET, model: MODEL, observation: observation({ output }) },
      NOW,
    );
    assert.equal(verdict.availability, "available");
    assert.deepEqual([...verdict.problems], []);
  });

  it("refuses when a batch warns about ours among others", () => {
    const output = [
      "Model metadata for 'another-model' not found. Defaulting to fallback metadata",
      WARNING,
    ].join("\n");
    const verdict = availabilityOf(
      { target: TARGET, model: MODEL, observation: observation({ output }) },
      NOW,
    );
    assert.equal(verdict.availability, "degraded");
  });

  it("does not read silence as health when the probe stopped early", () => {
    // The whole reason `completed` is a field: this output has no warning either.
    const verdict = availabilityOf(
      {
        target: TARGET,
        model: MODEL,
        observation: observation({ completed: false, output: "401 Unauthorized" }),
      },
      NOW,
    );
    assert.equal(verdict.availability, "unknown");
    assert.equal(verdict.source, "probe");
    assert.deepEqual(reasons(verdict.problems), ["probe-incomplete"]);
    assert.equal(mayDispatch(verdict), false);
  });
});

describe("availabilityOf — the constant (#59, criterion 1)", () => {
  it("answers unknown from nothing, and says the verdict rests on nothing", () => {
    const verdict = availabilityOf({ target: TARGET, model: MODEL }, NOW);
    assert.equal(verdict.availability, "unknown");
    assert.equal(verdict.source, "none");
    assert.equal(verdict.observedAt, null);
    assert.deepEqual(reasons(verdict.problems), ["no-observation"]);
  });

  it("lets a documented constant refuse", () => {
    const verdict = availabilityOf(
      { target: TARGET, model: MODEL, fallback: "unavailable" },
      NOW,
    );
    assert.equal(verdict.availability, "unavailable");
    assert.equal(verdict.source, "fallback");
    assert.equal(verdict.observedAt, null);
  });

  it("refuses to let a constant permit", () => {
    const verdict = availabilityOf({ target: TARGET, model: MODEL, fallback: "available" }, NOW);
    assert.equal(verdict.availability, "unknown");
    assert.equal(verdict.source, "fallback");
    assert.deepEqual(reasons(verdict.problems), ["no-observation", "constant-claims-available"]);
    assert.equal(mayDispatch(verdict), false);
  });

  it("never produces `available` from a fallback, whatever the constant says", () => {
    for (const fallback of AVAILABILITIES) {
      const verdict = availabilityOf({ target: TARGET, model: MODEL, fallback }, NOW);
      assert.notEqual(
        verdict.availability,
        "available",
        `a \`${fallback}\` constant produced \`available\``,
      );
      assert.equal(mayDispatch(verdict), false);
    }
  });
});

describe("availabilityOf — an observation that cannot be trusted falls back", () => {
  it("falls back on a stale probe, and says how stale", () => {
    const verdict = availabilityOf(
      {
        target: TARGET,
        model: MODEL,
        observation: observation({ observedAt: ago(30) }),
        fallback: "unavailable",
      },
      NOW,
    );
    assert.equal(verdict.availability, "unavailable");
    assert.equal(verdict.source, "fallback");
    assert.deepEqual(reasons(verdict.problems), ["stale-observation"]);
    assert.match(describeProbeProblem(verdict.problems[0] ?? fail()), /1800s ago/);
  });

  it("keeps a probe that is stale only under a tighter window", () => {
    const request = { target: TARGET, model: MODEL, observation: observation({ observedAt: ago(8) }) };
    assert.equal(availabilityOf(request, NOW).availability, "available");
    assert.equal(availabilityOf({ ...request, freshness: "5m" }, NOW).availability, "unknown");
  });

  it("falls back when the observation is about another model", () => {
    const verdict = availabilityOf(
      {
        target: TARGET,
        model: MODEL,
        observation: observation({ model: "some-other-model" }),
      },
      NOW,
    );
    assert.equal(verdict.availability, "unknown");
    assert.deepEqual(reasons(verdict.problems), ["observation-mismatch"]);
  });

  it("falls back when the observation is from another destination", () => {
    const verdict = availabilityOf(
      { target: TARGET, model: MODEL, observation: observation({ target: "claude" }) },
      NOW,
    );
    assert.deepEqual(reasons(verdict.problems), ["observation-mismatch"]);
  });

  it("falls back when the freshness window is not a duration", () => {
    const verdict = availabilityOf(
      { target: TARGET, model: MODEL, observation: observation(), freshness: "ten minutes" },
      NOW,
    );
    assert.equal(verdict.availability, "unknown");
    assert.deepEqual(reasons(verdict.problems), ["freshness-not-a-duration"]);
  });

  it("falls back on clock skew rather than guessing an age", () => {
    const verdict = availabilityOf(
      { target: TARGET, model: MODEL, observation: observation({ observedAt: ago(-2) }) },
      NOW,
    );
    assert.equal(verdict.availability, "unknown");
    assert.deepEqual(reasons(verdict.problems), ["observed-in-future"]);
  });

  it("refuses a request that names no destination or no model", () => {
    assert.deepEqual(
      reasons(availabilityOf({ target: " ", model: MODEL, observation: observation() }, NOW).problems),
      ["no-target", "observation-mismatch"],
    );
    assert.deepEqual(
      reasons(availabilityOf({ target: TARGET, model: "", observation: observation() }, NOW).problems),
      ["no-model", "observation-mismatch"],
    );
  });
});

describe("mayDispatch", () => {
  const base: Verdict = {
    target: TARGET,
    model: MODEL,
    availability: "available",
    source: "probe",
    observedAt: ago(1),
    problems: [],
  };

  it("admits only an observed availability", () => {
    assert.equal(mayDispatch(base), true);
  });

  it("refuses a hand-built verdict that sources `available` from a constant", () => {
    assert.equal(mayDispatch({ ...base, source: "fallback" }), false);
    assert.equal(mayDispatch({ ...base, source: "none" }), false);
  });

  it("refuses every availability but `available`", () => {
    for (const availability of AVAILABILITIES) {
      const expected = availability === "available";
      assert.equal(mayDispatch({ ...base, availability }), expected);
    }
  });
});

describe("vocabulary", () => {
  it("keeps every list free of duplicates", () => {
    for (const list of [AVAILABILITIES, SOURCES, PROBE_REFUSALS] as readonly (readonly string[])[]) {
      assert.equal(new Set(list).size, list.length);
    }
  });

  it("describes every availability and every refusal", () => {
    for (const availability of AVAILABILITIES) {
      assert.equal(describeAvailability(availability).length > 0, true);
    }
    for (const reason of PROBE_REFUSALS) {
      assert.equal(describeProbeRefusal(reason).length > 0, true);
    }
  });

  it("prefixes a problem with its model, and does not when there is none", () => {
    assert.equal(
      describeProbeProblem({ reason: "no-observation", message: "nothing", model: MODEL }),
      `${MODEL}: nothing`,
    );
    assert.equal(
      describeProbeProblem({ reason: "no-model", message: "nothing", model: null }),
      "nothing",
    );
  });

  it("summarises a verdict without echoing the probe's output", () => {
    const verdict = availabilityOf(
      { target: TARGET, model: MODEL, observation: observation({ output: `${WARNING} sk-secret` }) },
      NOW,
    );
    const line = describeVerdict(verdict);
    assert.equal(line, `${TARGET}/${MODEL}: degraded (probe, ${ago(1)})`);
    assert.equal(line.includes("sk-secret"), false);
    for (const problem of verdict.problems) {
      assert.equal(problem.message.includes("sk-secret"), false);
    }
  });

  it("summarises a verdict that rests on nothing", () => {
    assert.equal(
      describeVerdict(availabilityOf({ target: TARGET, model: MODEL }, NOW)),
      `${TARGET}/${MODEL}: unknown (none, no observation)`,
    );
  });

  it("keeps the default freshness a duration this package can read", () => {
    assert.equal(isFresh(observation({ observedAt: ago(0) }), NOW, DEFAULT_FRESHNESS), true);
  });
});

function fail(): never {
  throw new Error("expected a problem");
}
