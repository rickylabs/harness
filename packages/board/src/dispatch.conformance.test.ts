/**
 * Conformance corpus: `parseSwarm` against divybot's `parseOverrides`.
 *
 * `parseSwarm` claims to reproduce `rickylabs/orchid`'s `cmd/divybot/overrides.go` exactly. That is
 * a claim about another program in another language, and the only honest way to hold it is to state
 * the expected `Overrides` struct for each input and say which line of Go produces it.
 *
 * The expectations below are read off the Go source, not off this package's output. A second
 * TypeScript implementation of the same algorithm would agree with the first one about every bug
 * they shared, which is exactly the failure this corpus exists to catch.
 *
 * The Go, elided to the parts that decide behaviour:
 *
 * ```go
 * var swarmKV = regexp.MustCompile(`^([a-z][a-z_-]*)\s*:\s*(.+?)\s*$`)     // (R)
 *
 * for _, l := range lines[start:] {
 *     t := strings.TrimSpace(l)
 *     if strings.HasPrefix(t, "```") { break }                             // (F)
 *     if inKV {
 *         if t == "" { continue }                                          // (B)
 *         if m := swarmKV.FindStringSubmatch(t); m != nil {
 *             key := strings.ReplaceAll(m[1], "_", "-")                    // (U)
 *             val := strings.TrimSpace(strings.SplitN(m[2], "#", 2)[0])    // (H)
 *             switch key { ... }                                           // (K)
 *             continue
 *         }
 *         inKV = false                                                     // (E)
 *     }
 *     prompt = append(prompt, l)                                           // (P)
 * }
 * ```
 *
 * And `buildAgentCmd`, whose `default:` branch is the reason an unknown harness is not an error:
 * `case "codex" | "codex-run" | "opencode" | "opencode-run" | "agy"`, `default:` → claude.  (D)
 *
 * Verified against `rickylabs/orchid@d344bd0`. If divybot's parser changes, this file is the thing
 * that is supposed to go red.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSwarm } from "./dispatch.js";
import type { Harness, SwarmOverrides } from "./dispatch.js";

/** A hand-derived expectation. Every field of the Go struct, stated, not defaulted. */
interface Case {
  /** What the input demonstrates. */
  readonly what: string;
  /** The rule in the Go excerpt above that produces this result. */
  readonly rule: string;
  readonly body: string;
  readonly overrides: SwarmOverrides;
  readonly executes: Harness;
}

const EMPTY: SwarmOverrides = {
  harness: "",
  model: "",
  router: "",
  effort: "",
  maxTokens: "",
  profile: "",
  prompt: "",
  timeoutNs: 0,
};

const CASES: readonly Case[] = [
  {
    what: "the ordinary dispatch the coordinator writes",
    rule: "(K)",
    body: "/swarm\nharness: codex\nmodel: gpt-5.6-sol\neffort: xhigh\n\nReview PR 101.",
    overrides: {
      ...EMPTY,
      harness: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      prompt: "Review PR 101.",
    },
    executes: "codex",
  },
  {
    what: "F-1: a blank line does not end the key block, so prompt text replaces the model",
    // This is the review's own counterexample, verbatim. `model` is bound twice; the second wins,
    // and the line that set it was meant to be the first line of the brief.
    rule: "(B)",
    body: "/swarm\nharness: codex\nmodel: safe\neffort: high\n\nmodel: hostile\nDo the work",
    overrides: {
      ...EMPTY,
      harness: "codex",
      model: "hostile",
      effort: "high",
      prompt: "Do the work",
    },
    executes: "codex",
  },
  {
    what: "several blank lines and several absorbed keys, in order",
    rule: "(B)",
    body: "/swarm\nharness: codex\n\nmodel: a\n\nmodel: b\n\nmodel: c\n\nprose",
    overrides: { ...EMPTY, harness: "codex", model: "c", prompt: "prose" },
    executes: "codex",
  },
  {
    what: "the first non-key line ends the key run permanently",
    rule: "(E)",
    body: "/swarm\nharness: codex\nprose line\nmodel: never-bound\neffort: never-bound",
    overrides: {
      ...EMPTY,
      harness: "codex",
      prompt: "prose line\nmodel: never-bound\neffort: never-bound",
    },
    executes: "codex",
  },
  {
    what: "an uppercase key is not a key: the regex is anchored to [a-z]",
    rule: "(R)",
    body: "/swarm\nHarness: codex\nmodel: m",
    overrides: { ...EMPTY, prompt: "Harness: codex\nmodel: m" },
    executes: "claude",
  },
  {
    what: "a key with an empty value is not a key: (.+?) needs one character",
    rule: "(R)",
    body: "/swarm\nharness: codex\nmodel:\neffort: high",
    overrides: { ...EMPTY, harness: "codex", prompt: "model:\neffort: high" },
    executes: "codex",
  },
  {
    what: "a leading-space key line still parses: the line is trimmed first",
    rule: "(R)",
    body: "/swarm\n   harness: codex\n\tmodel: m",
    overrides: { ...EMPTY, harness: "codex", model: "m" },
    executes: "codex",
  },
  {
    what: "a dotted key is not a key: the class is [a-z_-] only",
    rule: "(R)",
    body: "/swarm\nharness: codex\nmax.tokens: 500k",
    overrides: { ...EMPTY, harness: "codex", prompt: "max.tokens: 500k" },
    executes: "codex",
  },
  {
    what: "underscores in a key are normalised to hyphens",
    rule: "(U)",
    body: "/swarm\nharness: codex\nmax_tokens: 500k",
    overrides: { ...EMPTY, harness: "codex", maxTokens: "500k" },
    executes: "codex",
  },
  {
    what: "a value is cut at the FIRST # anywhere, not only at a trailing comment",
    rule: "(H)",
    body: "/swarm\nharness: codex\nmodel: sol#1#2   # trailing",
    overrides: { ...EMPTY, harness: "codex", model: "sol" },
    executes: "codex",
  },
  {
    what: "a value that is only a comment binds the empty string, not nothing",
    // `val` becomes "", and the switch still assigns it. `harness: ""` then falls to the default.
    rule: "(H)",
    body: "/swarm\nharness: #codex\nmodel: m",
    overrides: { ...EMPTY, model: "m" },
    executes: "claude",
  },
  {
    what: "a # in the prompt is left alone; only values are split",
    rule: "(P)",
    body: "/swarm\nharness: codex\n\nReview PR #101 # not a comment",
    overrides: { ...EMPTY, harness: "codex", prompt: "Review PR #101 # not a comment" },
    executes: "codex",
  },
  {
    what: "agent: and provider: are aliases of harness: and router:",
    rule: "(K)",
    body: "/swarm\nagent: opencode\nprovider: openrouter\nmodel: z-ai/glm-5.3-flash",
    overrides: {
      ...EMPTY,
      harness: "opencode",
      router: "openrouter",
      model: "z-ai/glm-5.3-flash",
    },
    executes: "opencode",
  },
  {
    what: "harness, router and effort are lowercased; model and profile keep their case",
    rule: "(K)",
    body: "/swarm\nharness: CoDeX\nrouter: OpenAI\neffort: XHigh\nmodel: GPT-5.6-Sol\nprofile: Review",
    overrides: {
      ...EMPTY,
      harness: "codex",
      router: "openai",
      effort: "xhigh",
      model: "GPT-5.6-Sol",
      profile: "Review",
    },
    executes: "codex",
  },
  {
    what: "max-tokens keeps its scale suffix; it is a string, not a number",
    rule: "(K)",
    body: "/swarm\nharness: codex\nmax-tokens: 500k",
    overrides: { ...EMPTY, harness: "codex", maxTokens: "500k" },
    executes: "codex",
  },
  {
    what: "a parseable timeout is kept",
    rule: "(K)",
    body: "/swarm\nharness: codex\ntimeout: 90m",
    overrides: { ...EMPTY, harness: "codex", timeoutNs: 5.4e12 },
    executes: "codex",
  },
  {
    what: "an unparseable timeout is discarded in silence",
    // `if d, err := time.ParseDuration(val); err == nil && d > 0` — no else branch.
    rule: "(K)",
    body: "/swarm\nharness: codex\ntimeout: 90 minutes",
    overrides: { ...EMPTY, harness: "codex", timeoutNs: 0 },
    executes: "codex",
  },
  {
    what: "a zero or negative timeout is discarded too",
    rule: "(K)",
    body: "/swarm\nharness: codex\ntimeout: -5m",
    overrides: { ...EMPTY, harness: "codex", timeoutNs: 0 },
    executes: "codex",
  },
  {
    what: "an unknown key is consumed and dropped: it does not reach the prompt",
    rule: "(K)",
    body: "/swarm\nharness: codex\nnote: remember the fence\n\nreal brief",
    overrides: { ...EMPTY, harness: "codex", prompt: "real brief" },
    executes: "codex",
  },
  {
    what: "a code fence ends everything, keys included",
    rule: "(F)",
    body: "/swarm\nharness: codex\n```\nmodel: never-seen\n```\nnor this",
    overrides: { ...EMPTY, harness: "codex" },
    executes: "codex",
  },
  {
    what: "a fenced /swarm block loses nothing: the closing fence has nothing after it",
    rule: "(F)",
    body: "```\n/swarm\nharness: codex\nmodel: m\n\nthe brief\n```\n",
    overrides: { ...EMPTY, harness: "codex", model: "m", prompt: "the brief" },
    executes: "codex",
  },
  {
    what: "an indented fence still truncates: the check is on the trimmed line",
    rule: "(F)",
    body: "/swarm\nharness: codex\n\nbrief\n    ```diff\n- gone\n```\nalso gone",
    overrides: { ...EMPTY, harness: "codex", prompt: "brief" },
    executes: "codex",
  },
  {
    what: "the prompt is joined from raw lines and trimmed only at the ends",
    rule: "(P)",
    body: "/swarm\nharness: codex\n\n  indented\n\n  still indented  \n\n",
    overrides: { ...EMPTY, harness: "codex", prompt: "indented\n\n  still indented" },
    executes: "codex",
  },
  {
    what: "the FIRST /swarm line starts the block; a later one is prompt text",
    rule: "(P)",
    body: "/swarm\nharness: codex\n\nfirst\n/swarm\nmodel: not-a-key",
    overrides: {
      ...EMPTY,
      harness: "codex",
      prompt: "first\n/swarm\nmodel: not-a-key",
    },
    executes: "codex",
  },
  {
    what: "an unknown harness launches claude rather than failing",
    rule: "(D)",
    body: "/swarm\nharness: gemini\nmodel: m\n\nbrief",
    overrides: { ...EMPTY, harness: "gemini", model: "m", prompt: "brief" },
    executes: "claude",
  },
  {
    what: "an absent harness launches claude too",
    rule: "(D)",
    body: "/swarm\nmodel: m\n\nbrief",
    overrides: { ...EMPTY, model: "m", prompt: "brief" },
    executes: "claude",
  },
  {
    what: "every -run seam is recognised",
    rule: "(D)",
    body: "/swarm\nharness: opencode-run\nrouter: n5air\nmodel: m",
    overrides: { ...EMPTY, harness: "opencode-run", router: "n5air", model: "m" },
    executes: "opencode-run",
  },
  {
    what: "agy is a seam of its own",
    rule: "(D)",
    body: "/swarm\nharness: agy\n\nbrief",
    overrides: { ...EMPTY, harness: "agy", prompt: "brief" },
    executes: "agy",
  },
  {
    what: "an empty block binds nothing and launches claude",
    rule: "(D)",
    body: "/swarm\n",
    overrides: EMPTY,
    executes: "claude",
  },
];

describe("conformance with divybot's parseOverrides", () => {
  for (const testCase of CASES) {
    it(`${testCase.rule} ${testCase.what}`, () => {
      const parsed = parseSwarm(testCase.body);
      assert.notEqual(parsed, null, "expected a /swarm block");
      assert.deepEqual(parsed?.overrides, testCase.overrides);
      assert.equal(parsed?.executes, testCase.executes);
    });
  }

  it("finds no block where divybot would find none", () => {
    for (const body of [
      "",
      "no block here",
      "  /swarm is a command we use\nharness: codex",
      "/swarmish\nharness: codex",
      "x/swarm\nharness: codex",
    ]) {
      assert.equal(parseSwarm(body), null, `expected no block in ${JSON.stringify(body)}`);
    }
  });

  it("finds a block on a line padded with whitespace, which divybot trims", () => {
    assert.notEqual(parseSwarm("  /swarm  \nharness: codex"), null);
  });

  it("never throws, whatever the body: divybot has no rejection path", () => {
    for (const body of [
      "/swarm",
      "/swarm\n",
      "/swarm\n:",
      "/swarm\na:",
      "/swarm\n-:-",
      "/swarm\ntimeout: ",
      "/swarm\ntimeout: 99999999999999999999h",
      "/swarm\n```",
      "/swarm\nharness:  ",
      `/swarm\nmodel: ${"x".repeat(10_000)}`,
    ]) {
      assert.doesNotThrow(() => parseSwarm(body), `threw on ${JSON.stringify(body.slice(0, 40))}`);
    }
  });
});
