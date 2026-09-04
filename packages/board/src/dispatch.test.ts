import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSwarm, renderSwarm, validateDispatch } from "./dispatch.js";
import type { DispatchRequest } from "./dispatch.js";

const full: DispatchRequest = {
  harness: "codex",
  model: "gpt-5.6-sol",
  effort: "xhigh",
  maxTokens: 64000,
  profile: "review",
  timeout: "90m",
  router: "openai",
  prompt: "Adversarial review of PR #98.",
};

describe("renderSwarm", () => {
  it("emits the documented grammar in a fixed field order", () => {
    assert.equal(
      renderSwarm(full),
      [
        "/swarm",
        "harness: codex",
        "model: gpt-5.6-sol",
        "effort: xhigh",
        "max-tokens: 64000",
        "profile: review",
        "timeout: 90m",
        "router: openai",
        "",
        "Adversarial review of PR #98.",
        "",
      ].join("\n"),
    );
  });

  it("omits absent optional fields rather than emitting empty values", () => {
    const rendered = renderSwarm({ harness: "claude", prompt: "go" });
    assert.equal(rendered, "/swarm\nharness: claude\n\ngo\n");
  });

  it("is stable: rendering the same request twice is byte-identical", () => {
    assert.equal(renderSwarm(full), renderSwarm(full));
  });
});

describe("parseSwarm", () => {
  it("round-trips a fully specified request", () => {
    assert.deepEqual(parseSwarm(renderSwarm(full)), full);
  });

  it("returns null when there is no block, which is not an error", () => {
    assert.equal(parseSwarm("just a normal issue body\n\nwith prose"), null);
    assert.equal(parseSwarm(""), null);
  });

  it("finds a block that follows leading prose", () => {
    const parsed = parseSwarm("some preamble\n\n/swarm\nharness: claude\nmodel: opus-5\n\ndo it");
    assert.equal(parsed?.harness, "claude");
    assert.equal(parsed?.model, "opus-5");
    assert.equal(parsed?.prompt, "do it");
  });

  it("tolerates CRLF, which is what a Windows-authored comment arrives as", () => {
    const parsed = parseSwarm("/swarm\r\nharness: codex\r\nmodel: m\r\n\r\nprompt text");
    assert.equal(parsed?.harness, "codex");
    assert.equal(parsed?.model, "m");
    assert.equal(parsed?.prompt, "prompt text");
  });

  it("strips a trailing comment from a value, per the documented router line", () => {
    const parsed = parseSwarm("/swarm\nharness: opencode\nrouter: n5air # the local box\n\nx");
    assert.equal(parsed?.router, "n5air");
  });

  it("preserves prompt content that itself contains colons and blank lines", () => {
    const parsed = parseSwarm("/swarm\nharness: claude\n\nline one: with colon\n\nline two");
    assert.equal(parsed?.prompt, "line one: with colon\n\nline two");
  });

  it("rejects an unknown harness rather than dispatching to nothing", () => {
    assert.throws(() => parseSwarm("/swarm\nharness: gemini\n\nx"), /not one of/);
  });

  it("rejects an unknown router", () => {
    assert.throws(() => parseSwarm("/swarm\nharness: opencode\nrouter: elsewhere\n\nx"), /not one of/);
  });

  it("rejects a missing harness", () => {
    assert.throws(() => parseSwarm("/swarm\nmodel: m\n\nx"), /missing required key harness/);
  });

  it("rejects a duplicate key instead of silently taking one of them", () => {
    assert.throws(
      () => parseSwarm("/swarm\nharness: codex\nmodel: a\nmodel: b\n\nx"),
      /duplicate key/,
    );
  });

  it("rejects a garbage line inside the block", () => {
    assert.throws(() => parseSwarm("/swarm\nharness: codex\nthis is not a field\n\nx"), /malformed/);
  });

  it("rejects a non-numeric max-tokens", () => {
    assert.throws(() => parseSwarm("/swarm\nharness: codex\nmax-tokens: lots\n\nx"), /positive integer/);
  });

  it("does not treat a /swarm mention inside prose as a block header", () => {
    // The word has to be alone on its line. A sentence about /swarm must not dispatch anything.
    assert.equal(parseSwarm("we should use /swarm for this\n\nharness: codex"), null);
  });

  it("is case-insensitive on keys but not on values", () => {
    const parsed = parseSwarm("/swarm\nHarness: codex\nMODEL: Sol-1\n\nx");
    assert.equal(parsed?.harness, "codex");
    assert.equal(parsed?.model, "Sol-1");
  });
});

describe("validateDispatch", () => {
  it("passes a fully specified request", () => {
    assert.deepEqual(validateDispatch(full), []);
  });

  it("rejects a missing model — the run would inherit the provider config", () => {
    const problems = validateDispatch({ harness: "codex", effort: "high", prompt: "x" });
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /no model specified/);
  });

  it("rejects a missing effort, which is half of the lane pairing", () => {
    const problems = validateDispatch({ harness: "codex", model: "m", prompt: "x" });
    assert.match(problems.join(" "), /no effort specified/);
  });

  it("rejects an empty prompt", () => {
    const problems = validateDispatch({ harness: "codex", model: "m", effort: "high", prompt: "   " });
    assert.match(problems.join(" "), /empty prompt/);
  });

  it("requires a router for opencode, where the provider prefix is otherwise ambiguous", () => {
    const problems = validateDispatch({
      harness: "opencode",
      model: "m",
      effort: "high",
      prompt: "x",
    });
    assert.match(problems.join(" "), /router/);
  });

  it("does not require a router for the other seams", () => {
    assert.deepEqual(
      validateDispatch({ harness: "claude", model: "opus-5", effort: "medium", prompt: "x" }),
      [],
    );
  });

  it("rejects a non-positive max-tokens", () => {
    const problems = validateDispatch({
      harness: "codex",
      model: "m",
      effort: "high",
      maxTokens: 0,
      prompt: "x",
    });
    assert.match(problems.join(" "), /max-tokens must be positive/);
  });
});
