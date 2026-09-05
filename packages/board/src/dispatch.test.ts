import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DispatchEncodingError,
  PROMPT_GUARD,
  parseGoDuration,
  parseSwarm,
  renderSwarm,
  toDispatchRequest,
  validateDispatch,
} from "./dispatch.js";
import type { DispatchRequest } from "./dispatch.js";

const full: DispatchRequest = {
  harness: "codex",
  model: "gpt-5.6-sol",
  effort: "xhigh",
  maxTokens: "64000",
  profile: "review",
  timeout: "90m",
  router: "openai",
  prompt: "Adversarial review of PR #98.",
};

/** The parse of `text`, asserted to exist. */
function parsed(text: string) {
  const result = parseSwarm(text);
  assert.notEqual(result, null, "expected a /swarm block");
  return result as NonNullable<ReturnType<typeof parseSwarm>>;
}

const warningKinds = (text: string): readonly string[] =>
  parsed(text).warnings.map((w) => w.kind);

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
    assert.equal(renderSwarm({ harness: "claude", prompt: "go" }), "/swarm\nharness: claude\n\ngo\n");
  });

  it("is stable: rendering the same request twice is byte-identical", () => {
    assert.equal(renderSwarm(full), renderSwarm(full));
  });

  it("leaves a prompt that cannot be mistaken for a key unguarded", () => {
    const rendered = renderSwarm({ harness: "claude", prompt: "Fix the parser.\nmodel: nope" });
    assert.ok(!rendered.includes(PROMPT_GUARD));
    // Only the FIRST line can be absorbed: one non-key line ends key mode for good.
    assert.equal(parsed(rendered).overrides.model, "");
  });

  describe("the injection the executor makes possible", () => {
    // A prompt whose first line is key-shaped is consumed as a key by divybot, because blank lines
    // do not end its key block. Without a guard, prompt text replaces the model the matrix chose.
    const hostile: DispatchRequest = {
      harness: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      prompt: "model: cheap-and-wrong\nDo the work.",
    };

    it("guards a prompt whose first line would be read as a key", () => {
      const rendered = renderSwarm(hostile);
      assert.ok(rendered.includes(`\n${PROMPT_GUARD}\nmodel: cheap-and-wrong`));
    });

    it("and the guard actually works: the model survives a round trip", () => {
      const back = parsed(renderSwarm(hostile));
      assert.equal(back.overrides.model, "gpt-5.6-sol");
      assert.deepEqual(back.warnings, []);
      // The guard line is part of the brief the agent reads. That is the trade the module makes on
      // purpose: one visible line of noise, instead of a model substitution nobody can see.
      assert.equal(back.overrides.prompt, `${PROMPT_GUARD}\nmodel: cheap-and-wrong\nDo the work.`);
    });

    it("without the guard, the same text takes the model over", () => {
      // Exactly what the old writer emitted. Pinned so the regression cannot come back quietly.
      const unguarded = "/swarm\nharness: codex\nmodel: gpt-5.6-sol\n\nmodel: cheap-and-wrong\nDo the work.";
      const back = parsed(unguarded);
      assert.equal(back.overrides.model, "cheap-and-wrong");
      assert.deepEqual(warningKinds(unguarded), ["absorbed-prompt-line", "duplicate-key"]);
    });
  });

  it("refuses a prompt containing a code fence, which the executor would truncate at", () => {
    assert.throws(
      () => renderSwarm({ harness: "claude", model: "m", prompt: "look:\n```ts\nx\n```" }),
      DispatchEncodingError,
    );
  });

  it("refuses a value containing #, which the executor reads as a comment", () => {
    assert.throws(
      () => renderSwarm({ harness: "claude", model: "opus#5", prompt: "x" }),
      /stripped as a comment/,
    );
  });

  it("refuses an uppercase harness, effort or router, which the executor lowercases", () => {
    assert.throws(() => renderSwarm({ ...full, effort: "XHIGH" }), /lowercased/);
  });
});

describe("parseSwarm", () => {
  it("round-trips a fully specified request", () => {
    assert.deepEqual(toDispatchRequest(parsed(renderSwarm(full))), full);
  });

  it("returns null when there is no block, which is not an error", () => {
    assert.equal(parseSwarm("just a normal issue body\n\nwith prose"), null);
    assert.equal(parseSwarm(""), null);
  });

  it("finds a block that follows leading prose", () => {
    const p = parsed("some preamble\n\n/swarm\nharness: claude\nmodel: opus-5\n\ndo it");
    assert.equal(p.overrides.harness, "claude");
    assert.equal(p.overrides.model, "opus-5");
    assert.equal(p.overrides.prompt, "do it");
  });

  it("tolerates CRLF, which is what a Windows-authored comment arrives as", () => {
    const p = parsed("/swarm\r\nharness: codex\r\nmodel: m\r\n\r\nprompt text");
    assert.equal(p.overrides.harness, "codex");
    assert.equal(p.overrides.model, "m");
    assert.equal(p.overrides.prompt, "prompt text");
  });

  it("preserves prompt content that itself contains colons and blank lines", () => {
    const p = parsed("/swarm\nharness: claude\n\nLine one: with colon\n\nline two");
    assert.equal(p.overrides.prompt, "Line one: with colon\n\nline two");
  });

  it("does not treat a /swarm mention inside prose as a block header", () => {
    // The word has to be alone on its line. A sentence about /swarm must not dispatch anything.
    assert.equal(parseSwarm("we should use /swarm for this\n\nharness: codex"), null);
  });

  describe("reporting what will actually run", () => {
    it("says an unknown harness launches claude, because that is what happens", () => {
      const p = parsed("/swarm\nharness: gemini\nmodel: m\n\nx");
      assert.equal(p.overrides.harness, "gemini");
      assert.equal(p.executes, "claude");
      assert.deepEqual(
        p.warnings.map((w) => w.kind),
        ["unknown-harness"],
      );
    });

    it("says a missing harness launches claude too", () => {
      const p = parsed("/swarm\nmodel: m\n\nx");
      assert.equal(p.executes, "claude");
      assert.deepEqual(warningKinds("/swarm\nmodel: m\n\nx"), ["missing-harness"]);
    });

    it("flags an unknown router without pretending the block failed", () => {
      const p = parsed("/swarm\nharness: opencode\nrouter: elsewhere\n\nx");
      assert.equal(p.overrides.router, "elsewhere");
      assert.deepEqual(
        p.warnings.map((w) => w.kind),
        ["unknown-router"],
      );
    });

    it("flags a silently discarded timeout, which leaves the run on the default deadline", () => {
      const p = parsed("/swarm\nharness: codex\ntimeout: soon\n\nx");
      assert.equal(p.overrides.timeoutNs, 0);
      assert.ok(p.warnings.some((w) => w.kind === "discarded-timeout"));
    });

    it("flags an unknown key, which is swallowed rather than passed through as prose", () => {
      const p = parsed("/swarm\nharness: codex\nnote: check the parser\n\nx");
      assert.equal(p.overrides.prompt, "x");
      assert.ok(p.warnings.some((w) => w.kind === "unknown-key"));
    });

    it("flags a fence that truncates the brief", () => {
      const p = parsed("/swarm\nharness: codex\n\nreview this\n```diff\n- a\n```\nand then merge");
      assert.equal(p.overrides.prompt, "review this");
      assert.ok(p.truncated);
      assert.ok(p.warnings.some((w) => w.kind === "truncated-by-fence"));
    });

    it("does not flag the closing fence of a fenced /swarm block, which loses nothing", () => {
      assert.deepEqual(warningKinds("```\n/swarm\nharness: codex\nmodel: m\n\ngo\n```\n"), []);
    });
  });

  describe("the executor's own quirks, reproduced rather than corrected", () => {
    it("takes the last of a duplicated key, and says so", () => {
      const text = "/swarm\nharness: codex\nmodel: a\nmodel: b\n\nx";
      assert.equal(parsed(text).overrides.model, "b");
      assert.deepEqual(warningKinds(text), ["duplicate-key"]);
    });

    it("treats agent: and provider: as aliases", () => {
      const p = parsed("/swarm\nagent: opencode\nprovider: openrouter\nmodel: m\n\nx");
      assert.equal(p.executes, "opencode");
      assert.equal(p.overrides.router, "openrouter");
    });

    it("normalises underscores in keys", () => {
      assert.equal(parsed("/swarm\nharness: codex\nmax_tokens: 500k\n\nx").overrides.maxTokens, "500k");
    });

    it("keeps max-tokens as a string, because 500k is a legal budget", () => {
      assert.equal(parsed("/swarm\nharness: codex\nmax-tokens: 500k\n\nx").overrides.maxTokens, "500k");
    });

    it("lowercases harness, router and effort but not model or profile", () => {
      const p = parsed("/swarm\nharness: CODEX\neffort: XHigh\nmodel: Sol-1\nprofile: Review\n\nx");
      assert.equal(p.overrides.harness, "codex");
      assert.equal(p.overrides.effort, "xhigh");
      assert.equal(p.overrides.model, "Sol-1");
      assert.equal(p.overrides.profile, "Review");
    });

    it("ends the key run at an uppercase key, which its regex does not match", () => {
      // `Model:` is not `^[a-z]`, so it is prompt text — and everything after it is too.
      const p = parsed("/swarm\nharness: codex\nModel: Sol-1\nmodel: absorbed\n\nx");
      assert.equal(p.overrides.model, "");
      assert.equal(p.overrides.prompt, "Model: Sol-1\nmodel: absorbed\n\nx");
    });

    it("ends the key run at a key with an empty value", () => {
      // `(.+?)` needs at least one character, so `model:` alone is not a key line.
      const p = parsed("/swarm\nharness: codex\nmodel:\neffort: high\n\nx");
      assert.equal(p.overrides.effort, "");
      assert.equal(p.overrides.prompt, "model:\neffort: high\n\nx");
    });

    it("splits a value at the first # anywhere, not only a trailing comment", () => {
      assert.equal(parsed("/swarm\nharness: codex\nmodel: a#b\n\nx").overrides.model, "a");
    });

    it("recognises the -run harnesses, which launch the non-interactive forms", () => {
      assert.equal(parsed("/swarm\nharness: codex-run\n\nx").executes, "codex-run");
      assert.equal(parsed("/swarm\nharness: opencode-run\n\nx").executes, "opencode-run");
    });
  });
});

describe("parseGoDuration", () => {
  it("accepts the forms Go accepts", () => {
    assert.equal(parseGoDuration("90m"), 5.4e12);
    assert.equal(parseGoDuration("1h30m"), 5.4e12);
    assert.equal(parseGoDuration("1.5h"), 5.4e12);
    assert.equal(parseGoDuration("500ms"), 5e8);
    assert.equal(parseGoDuration("0"), 0);
  });

  it("rejects what Go rejects, so a timeout we accept is one the executor keeps", () => {
    for (const bad of ["", "soon", "30", "m", "1x", ".", "1h30", "45 m"]) {
      assert.equal(parseGoDuration(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
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
    assert.match(
      validateDispatch({ harness: "codex", model: "m", prompt: "x" }).join(" "),
      /no effort specified/,
    );
  });

  it("rejects an empty prompt", () => {
    assert.match(
      validateDispatch({ harness: "codex", model: "m", effort: "high", prompt: "   " }).join(" "),
      /empty prompt/,
    );
  });

  it("requires a router for opencode, where the provider prefix is otherwise ambiguous", () => {
    assert.match(
      validateDispatch({ harness: "opencode", model: "m", effort: "high", prompt: "x" }).join(" "),
      /router/,
    );
  });

  it("does not require a router for the other seams", () => {
    assert.deepEqual(
      validateDispatch({ harness: "claude", model: "opus-5", effort: "medium", prompt: "x" }),
      [],
    );
  });

  it("rejects a max-tokens that is not a budget, and accepts a scaled one", () => {
    const base = { harness: "codex", model: "m", effort: "high", prompt: "x" } as const;
    assert.match(validateDispatch({ ...base, maxTokens: "lots" }).join(" "), /not a token budget/);
    assert.deepEqual(validateDispatch({ ...base, maxTokens: "500k" }), []);
  });

  it("rejects a timeout the executor would drop on the floor", () => {
    const problems = validateDispatch({
      harness: "codex",
      model: "m",
      effort: "high",
      timeout: "45",
      prompt: "x",
    });
    assert.match(problems.join(" "), /discard it silently/);
  });

  it("reports an unencodable request before renderSwarm throws on it", () => {
    const bad: DispatchRequest = { harness: "claude", model: "m", effort: "low", prompt: "a\n```\nb" };
    assert.match(validateDispatch(bad).join(" "), /code fence/);
    assert.throws(() => renderSwarm(bad), DispatchEncodingError);
  });
});
