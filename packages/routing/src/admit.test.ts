import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DispatchRequest } from "@rickylabs/subagents";

import {
  ADMISSION_REFUSALS,
  admitDispatch,
  describeAdmission,
  laneModels,
  relayProfiles,
  routableModels,
  routedModels,
  transportsFor,
} from "./admit.js";
import type { AdmissionRefusal } from "./admit.js";
import { EFFORTS, LOCAL_MODEL_IDS, MODEL_IDS, OPENROUTER_MODEL_IDS } from "./models.js";
import { LANES, ROUTE_POLICY } from "./policy.js";
import { toDispatch } from "./resolve.js";

const PROMPT = "Land the change and open the PR.";

function reasonsOf(dispatch: DispatchRequest, lane?: string): readonly AdmissionRefusal[] {
  const admission = admitDispatch(dispatch, lane === undefined ? {} : { lane });
  return admission.ok ? [] : admission.problems.map((problem) => problem.reason);
}

function expectedFor(
  dispatch: DispatchRequest,
  reason: AdmissionRefusal,
  lane?: string,
): readonly string[] {
  const admission = admitDispatch(dispatch, lane === undefined ? {} : { lane });
  if (admission.ok) throw new Error(`expected a refusal, got an admission`);
  const problem = admission.problems.find((candidate) => candidate.reason === reason);
  if (problem === undefined) {
    throw new Error(`no ${reason} problem; got ${admission.problems.map((p) => p.reason).join(", ")}`);
  }
  return problem.expected ?? [];
}

describe("the matrix admits itself", () => {
  it("admits every step of every lane, under that lane", () => {
    // The totality check. If a route the matrix declares cannot pass the gate that guards it, one
    // of the two is wrong, and it is cheaper to find out here than at a launch.
    for (const policy of ROUTE_POLICY) {
      for (const step of policy.chain) {
        const dispatch: DispatchRequest = { ...toDispatch(step.route), prompt: PROMPT };
        const admission = admitDispatch(dispatch, { lane: policy.lane });
        assert.equal(
          admission.ok,
          true,
          `${policy.lane} / ${step.route.model}: ${describeAdmission(admission)}`,
        );
      }
    }
  });

  it("admits a declared escalation, and only a declared one", () => {
    // `docs_audit` may go to high on a large changeset because the step says so. Nothing else may.
    const base = { harness: "codex", model: MODEL_IDS.codexSol, prompt: PROMPT } as const;
    assert.equal(admitDispatch({ ...base, effort: "high" }, { lane: "docs_audit" }).ok, true);
    assert.equal(admitDispatch({ ...base, effort: "low" }, { lane: "docs_audit" }).ok, false);
    assert.deepEqual(
      expectedFor({ ...base, effort: "low" }, "undeclared-effort", "docs_audit"),
      ["medium", "high"],
    );
  });

  it("admits the non-interactive twin of a harness the matrix names", () => {
    // `codex-run` is `codex` launched without a terminal. Treating it as a different harness would
    // make every supervised run unroutable, which is not what the table means.
    const dispatch: DispatchRequest = {
      harness: "codex-run",
      model: MODEL_IDS.codexSol,
      effort: "high",
      prompt: PROMPT,
    };
    assert.equal(admitDispatch(dispatch).ok, true);
  });
});

describe("three ways a model id is wrong", () => {
  it("refuses an id nothing pins, and names what this harness does take", () => {
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: "gpt-4o",
      effort: "high",
      prompt: PROMPT,
    };
    assert.deepEqual(reasonsOf(dispatch), ["unknown-model"]);
    const expected = expectedFor(dispatch, "unknown-model");
    assert.equal(expected.includes(MODEL_IDS.opus), true);
    assert.equal(expected.includes(MODEL_IDS.agyDocs), false);
  });

  it("refuses a pinned model no lane routes, and says pinning is not routing", () => {
    // The two local seats. `@rickylabs/llm-local` knows where they can physically run; no route
    // sends work to them yet, so there is no step to take a transport or an effort from.
    for (const model of Object.values(LOCAL_MODEL_IDS)) {
      const dispatch: DispatchRequest = { harness: "claude", model, effort: "high", prompt: PROMPT };
      assert.deepEqual(reasonsOf(dispatch), ["unrouted-model"], model);
    }
  });

  it("refuses a real model sent to a harness the matrix never sends it to", () => {
    const dispatch: DispatchRequest = {
      harness: "agy",
      model: MODEL_IDS.opus,
      effort: "low",
      prompt: PROMPT,
    };
    assert.deepEqual(reasonsOf(dispatch), ["unroutable-model"]);
    assert.deepEqual(expectedFor(dispatch, "unroutable-model"), [MODEL_IDS.agyDocs]);
  });
});

describe("the relay is bound by name, never by value", () => {
  it("refuses a relay model with no profile, and names the profiles that exist", () => {
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: OPENROUTER_MODEL_IDS.designGlm,
      effort: "xhigh",
      prompt: PROMPT,
    };
    assert.deepEqual(reasonsOf(dispatch), ["unbound-credential"]);
    assert.deepEqual(expectedFor(dispatch, "unbound-credential"), relayProfiles());
  });

  it("refuses a relay-only model addressed at a router that does not serve it", () => {
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: OPENROUTER_MODEL_IDS.designGlm,
      effort: "xhigh",
      profile: "claude-openrouter",
      router: "n5air",
      prompt: PROMPT,
    };
    assert.deepEqual(reasonsOf(dispatch), ["wrong-router"]);
    assert.deepEqual(expectedFor(dispatch, "wrong-router"), ["openrouter"]);
  });

  it("does not ask an opencode run for a profile, because its router carries the binding", () => {
    const dispatch: DispatchRequest = {
      harness: "opencode",
      model: "moonshotai/kimi-k3",
      effort: "high",
      router: "openrouter",
      prompt: PROMPT,
    };
    assert.equal(admitDispatch(dispatch).ok, true);
  });

  it("names profiles that are identifiers, never credential material", () => {
    for (const profile of relayProfiles()) {
      assert.match(profile, /^[a-z0-9-]+$/);
      for (const shape of ["sk-", "Bearer ", "xox", "AKIA", "-----BEGIN"]) {
        assert.equal(profile.includes(shape), false, `${profile} / ${shape}`);
      }
    }
  });
});

describe("a lane makes the gate stricter", () => {
  it("refuses a lane the matrix does not route, and names the ones it does", () => {
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: MODEL_IDS.opus,
      effort: "low",
      prompt: PROMPT,
    };
    assert.deepEqual(reasonsOf(dispatch, "ship_it_somehow"), ["unknown-lane"]);
    assert.deepEqual(expectedFor(dispatch, "unknown-lane", "ship_it_somehow"), [...LANES]);
  });

  it("refuses a model the lane has no step for", () => {
    const dispatch: DispatchRequest = {
      harness: "codex",
      model: MODEL_IDS.codexSol,
      effort: "low",
      prompt: PROMPT,
    };
    assert.equal(reasonsOf(dispatch, "claude_workflow").includes("lane-model-mismatch"), true);
    assert.deepEqual(expectedFor(dispatch, "lane-model-mismatch", "claude_workflow"), [MODEL_IDS.opus]);
  });

  it("refuses a model the lane routes, but never through this harness", () => {
    // `deep_analysis` seats Fable on claude and falls back to Codex. Fable through codex is neither.
    const dispatch: DispatchRequest = {
      harness: "codex",
      model: MODEL_IDS.fable,
      effort: "medium",
      prompt: PROMPT,
    };
    assert.equal(reasonsOf(dispatch, "deep_analysis").includes("lane-model-mismatch"), true);
    assert.deepEqual(
      expectedFor(dispatch, "lane-model-mismatch", "deep_analysis"),
      [MODEL_IDS.codexSol],
    );
  });

  it("says nothing about lanes when the coordinator did not name one", () => {
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: MODEL_IDS.opus,
      effort: "max",
      prompt: PROMPT,
    };
    // `max` is a rung on the ladder and opus is routed to claude, so with no lane there is nothing
    // to refuse — the pairing only becomes wrong relative to a lane that declares its effort.
    assert.equal(admitDispatch(dispatch).ok, true);
  });
});

describe("effort", () => {
  it("refuses a rung that does not exist, and names the ladder", () => {
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: MODEL_IDS.opus,
      effort: "turbo",
      prompt: PROMPT,
    };
    assert.deepEqual(reasonsOf(dispatch), ["unknown-effort"]);
    assert.deepEqual(expectedFor(dispatch, "unknown-effort"), [...EFFORTS]);
  });
});

describe("credential material never survives the boundary", () => {
  // Shaped like the real thing, and deliberately not the real thing.
  const FAKE_KEY = `sk-or-v1-${"0123456789abcdef".repeat(4)}`;

  it("refuses a prompt carrying a key", () => {
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: MODEL_IDS.opus,
      effort: "low",
      prompt: `Use ${FAKE_KEY} to call the relay.`,
    };
    assert.deepEqual(reasonsOf(dispatch), ["credential-in-payload"]);
  });

  it("refuses a key-block field carrying an assignment", () => {
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: MODEL_IDS.opus,
      effort: "low",
      profile: "api_key=0123456789abcdef",
      prompt: PROMPT,
    };
    assert.deepEqual(reasonsOf(dispatch), ["credential-in-payload"]);
  });

  it("never repeats the value it refused", () => {
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: FAKE_KEY,
      effort: "low",
      prompt: `and again ${FAKE_KEY}`,
    };
    const rendered = describeAdmission(admitDispatch(dispatch));
    assert.equal(rendered.includes(FAKE_KEY), false);
    assert.equal(rendered.includes(FAKE_KEY.slice(0, 24)), false);
    assert.equal(rendered.includes("credential"), true);
  });

  it("reports nothing but the credential, so no other message can echo the field", () => {
    // The model here is also unknown and the effort is also nonsense. Both messages would name the
    // value of a field, and one of those fields is holding the key.
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: FAKE_KEY,
      effort: "turbo",
      prompt: "",
    };
    assert.deepEqual(reasonsOf(dispatch), ["credential-in-payload"]);
  });

  it("describes a value too long to be a name instead of quoting it", () => {
    const overlong = "z".repeat(80);
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: overlong,
      effort: "low",
      prompt: PROMPT,
    };
    const rendered = describeAdmission(admitDispatch(dispatch));
    assert.equal(rendered.includes(overlong), false);
    assert.equal(rendered.includes("80-character value"), true);
  });

  it("does not refuse a brief that merely mentions where the key lives", () => {
    // Naming the mode-600 file is how the launch path is documented. The value is what must not
    // appear, and a gate that refuses the documentation is one operators route around.
    const dispatch: DispatchRequest = {
      harness: "claude",
      model: MODEL_IDS.opus,
      effort: "low",
      prompt: "The relay key is read from openrouter.env at launch; do not print it.",
    };
    assert.equal(admitDispatch(dispatch).ok, true);
  });
});

describe("the refusals as a set", () => {
  it("reaches every one of them", () => {
    const cases: readonly { readonly dispatch: DispatchRequest; readonly lane?: string }[] = [
      { dispatch: { harness: "claude", model: MODEL_IDS.opus, effort: "low", prompt: "" } },
      {
        dispatch: {
          harness: "claude",
          model: `sk-or-v1-${"0123456789abcdef".repeat(4)}`,
          effort: "low",
          prompt: PROMPT,
        },
      },
      { dispatch: { harness: "claude", model: "gpt-4o", effort: "low", prompt: PROMPT } },
      {
        dispatch: {
          harness: "claude",
          model: LOCAL_MODEL_IDS.planEvaluator,
          effort: "low",
          prompt: PROMPT,
        },
      },
      { dispatch: { harness: "agy", model: MODEL_IDS.opus, effort: "low", prompt: PROMPT } },
      {
        dispatch: {
          harness: "claude",
          model: OPENROUTER_MODEL_IDS.designGlm,
          effort: "xhigh",
          profile: "claude-openrouter",
          router: "n5air",
          prompt: PROMPT,
        },
      },
      {
        dispatch: {
          harness: "claude",
          model: OPENROUTER_MODEL_IDS.designGlm,
          effort: "xhigh",
          prompt: PROMPT,
        },
      },
      { dispatch: { harness: "claude", model: MODEL_IDS.opus, effort: "turbo", prompt: PROMPT } },
      {
        dispatch: { harness: "claude", model: MODEL_IDS.opus, effort: "low", prompt: PROMPT },
        lane: "nope",
      },
      {
        dispatch: { harness: "codex", model: MODEL_IDS.codexSol, effort: "low", prompt: PROMPT },
        lane: "claude_workflow",
      },
      {
        dispatch: { harness: "codex", model: MODEL_IDS.codexSol, effort: "low", prompt: PROMPT },
        lane: "docs_audit",
      },
    ];

    const reached = new Set<string>();
    for (const item of cases) {
      for (const reason of reasonsOf(item.dispatch, item.lane)) reached.add(reason);
    }
    assert.deepEqual([...reached].sort(), [...ADMISSION_REFUSALS].sort());
  });

  it("returns a verdict rather than throwing, for anything shaped like a request", () => {
    const nonsense: DispatchRequest = {
      harness: "claude",
      model: " ",
      effort: " ",
      maxTokens: "many",
      timeout: "soon",
      prompt: "```fenced```",
    };
    assert.doesNotThrow(() => admitDispatch(nonsense, { lane: " " }));
    assert.equal(admitDispatch(nonsense).ok, false);
  });
});

describe("the queries a refusal is built from", () => {
  it("lists the models a harness actually gets", () => {
    assert.deepEqual(routableModels("agy"), [MODEL_IDS.agyDocs]);
    assert.deepEqual(routableModels("agy"), routableModels("agy", "openrouter"));
    assert.equal(routableModels("claude").includes(MODEL_IDS.fable), true);
    assert.equal(routableModels("claude").includes(MODEL_IDS.codexSol), false);
  });

  it("narrows an opencode harness by its router", () => {
    assert.deepEqual(routableModels("opencode", "openrouter"), ["moonshotai/kimi-k3"]);
    assert.deepEqual(routableModels("opencode", "n5air"), []);
  });

  it("knows which models exist only behind the relay", () => {
    assert.deepEqual(transportsFor(OPENROUTER_MODEL_IDS.designGlm), ["openrouter"]);
    assert.deepEqual(transportsFor(MODEL_IDS.opus), ["native"]);
    assert.deepEqual(transportsFor(LOCAL_MODEL_IDS.implEvaluator), []);
  });

  it("lists a lane's models in chain order", () => {
    assert.deepEqual(laneModels("docs_polish"), [
      MODEL_IDS.fable,
      MODEL_IDS.opus,
      OPENROUTER_MODEL_IDS.designGlm,
    ]);
    assert.deepEqual(laneModels("nope"), []);
  });

  it("routes a subset of what it pins, and every routed model is pinned", () => {
    const routed = routedModels();
    assert.equal(routed.length > 0, true);
    for (const model of routed) {
      assert.equal(transportsFor(model).length > 0, true, model);
    }
  });
});
