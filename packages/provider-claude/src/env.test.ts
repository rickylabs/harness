/**
 * #52's first acceptance criterion, written as tests rather than as a promise.
 *
 * *Isolate `CLAUDE_CONFIG_DIR`; leave `$HOME` untouched so keychain lookup still resolves.* The half
 * that needs guarding is the second one, because it is the counter-intuitive half: the reflex when
 * isolating a CLI's state is to give it a fresh `HOME`, and that reflex breaks authentication
 * silently — the run launches, the credential lookup finds nothing, and the failure surfaces as an
 * agent that cannot start rather than as a configuration mistake. So `homeSurvived` is asserted
 * against an environment carrying both home variables, and the refusals are asserted one by one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  envProblems,
  fatalEnvProblems,
  homeOf,
  homeSurvived,
  isAbsolutePath,
  isolatedEnv,
  sameDir,
  CONFIG_DIR_VAR,
  type BaseEnv,
} from "./env.js";

/** An environment with both spellings of home, as this workstation actually has. */
const BOTH: BaseEnv = {
  HOME: "/home/agent",
  USERPROFILE: "C:\\Users\\agent",
  PATH: "/usr/bin",
  ANTHROPIC_API_KEY: "not-a-real-key",
};

const ISOLATED = "/srv/agents/run-1/.claude";

describe("deciding what is absolute", () => {
  it("answers the same on Linux and on Windows, which is the point", () => {
    // `node:path.isAbsolute` would answer differently for the same string depending on where the
    // suite runs. The deployment is Linux; the composition is this box. One answer, or the tests
    // pass in one place and prove nothing in the other.
    assert.equal(isAbsolutePath("/srv/agents"), true);
    assert.equal(isAbsolutePath("C:\\agents"), true);
    assert.equal(isAbsolutePath("c:/agents"), true);
    assert.equal(isAbsolutePath("\\\\server\\share"), true);
  });

  it("rejects anything that depends on where the daemon was launched from", () => {
    assert.equal(isAbsolutePath("agents/run-1"), false);
    assert.equal(isAbsolutePath("./agents"), false);
    assert.equal(isAbsolutePath("../agents"), false);
    assert.equal(isAbsolutePath(""), false);
    assert.equal(isAbsolutePath("C:agents"), false); // drive-relative, and genuinely is
  });
});

describe("comparing directories", () => {
  it("ignores separator and trailing slash, because operators write both", () => {
    assert.equal(sameDir("/home/agent", "/home/agent/"), true);
    assert.equal(sameDir("C:\\Users\\agent", "C:/Users/agent"), true);
    assert.equal(sameDir("/home/agent///", "/home/agent"), true);
    assert.equal(sameDir("/home/agent", "/home/agent/.claude"), false);
  });

  it("does not erase the root itself", () => {
    assert.equal(sameDir("/", "/"), true);
    assert.equal(sameDir("/", "/home"), false);
  });
});

describe("finding the home directory", () => {
  it("prefers HOME and falls back to USERPROFILE", () => {
    assert.equal(homeOf(BOTH), "/home/agent");
    assert.equal(homeOf({ USERPROFILE: "C:\\Users\\agent" }), "C:\\Users\\agent");
  });

  it("treats an empty value as absent, because an empty HOME names no directory", () => {
    assert.equal(homeOf({ HOME: "", USERPROFILE: "C:\\Users\\agent" }), "C:\\Users\\agent");
    assert.equal(homeOf({ HOME: "" }), null);
    assert.equal(homeOf({}), null);
  });
});

describe("refusing an environment that would eat something", () => {
  it("accepts an isolated directory alongside an untouched home", () => {
    assert.deepEqual(envProblems(ISOLATED, BOTH), []);
  });

  it("refuses an empty config dir, which is not isolation but a fallback to ~/.claude", () => {
    const problems = envProblems("", BOTH);
    assert.deepEqual(
      problems.map((problem) => problem.rule),
      ["empty"],
    );
    assert.equal(problems[0]?.fatal, true);
  });

  it("refuses a relative config dir, whose meaning depends on the daemon's cwd", () => {
    const problems = envProblems("agents/run-1", BOTH);
    assert.equal(problems[0]?.rule, "not-absolute");
    assert.equal(problems[0]?.fatal, true);
  });

  it("refuses pointing the config dir at the home directory itself", () => {
    // The symptom of getting this wrong is an operator's own home filling with projects/ and
    // settings.json, which nobody attributes to a provider config for a long time.
    const problems = envProblems("/home/agent", BOTH);
    assert.deepEqual(
      problems.map((problem) => problem.rule),
      ["is-home"],
    );
    assert.equal(fatalEnvProblems(problems).length, 1);
  });

  it("warns, without refusing, about the operator's own ~/.claude", () => {
    // Not fatal: a single-tenant box where the operator has deliberately pointed runs at their own
    // config is a real deployment. It is just never what someone meant by "isolated".
    const problems = envProblems("/home/agent/.claude", BOTH);
    assert.deepEqual(
      problems.map((problem) => problem.rule),
      ["shared-config"],
    );
    assert.deepEqual(fatalEnvProblems(problems), []);
  });

  it("warns, without refusing, when nothing names a home directory", () => {
    // A run with no home may still authenticate from an environment variable, so this is a warning
    // rather than a refusal — but it is the first thing to look at when a launch cannot log in.
    const problems = envProblems(ISOLATED, { PATH: "/usr/bin" });
    assert.deepEqual(
      problems.map((problem) => problem.rule),
      ["no-home"],
    );
    assert.deepEqual(fatalEnvProblems(problems), []);
  });

  it("reports a relative dir even when the home is missing too", () => {
    const rules = envProblems("agents", {}).map((problem) => problem.rule);
    assert.deepEqual(rules, ["not-absolute", "no-home"]);
  });
});

describe("building the child environment", () => {
  it("changes exactly one key", () => {
    const built = isolatedEnv(BOTH, ISOLATED);
    assert.equal(built[CONFIG_DIR_VAR], ISOLATED);
    assert.deepEqual(
      Object.keys(built).filter((key) => key !== CONFIG_DIR_VAR).sort(),
      Object.keys(BOTH).sort(),
    );
  });

  it("leaves every home variable byte-identical — the acceptance criterion itself", () => {
    const built = isolatedEnv(BOTH, ISOLATED);
    assert.equal(built["HOME"], "/home/agent");
    assert.equal(built["USERPROFILE"], "C:\\Users\\agent");
    assert.equal(homeSurvived(BOTH, built), true);
  });

  it("carries the rest of the environment through untouched", () => {
    const built = isolatedEnv(BOTH, ISOLATED);
    assert.equal(built["PATH"], "/usr/bin");
    assert.equal(built["ANTHROPIC_API_KEY"], "not-a-real-key");
  });

  it("overwrites a config dir the base environment already had", () => {
    const built = isolatedEnv({ ...BOTH, [CONFIG_DIR_VAR]: "/somewhere/else" }, ISOLATED);
    assert.equal(built[CONFIG_DIR_VAR], ISOLATED);
  });

  it("drops absent values rather than passing the string 'undefined' to a child", () => {
    const built = isolatedEnv({ HOME: "/home/agent", EMPTY: undefined }, ISOLATED);
    assert.equal(Object.hasOwn(built, "EMPTY"), false);
  });
});

describe("the invariant, as a predicate anything can call", () => {
  it("fails when a home variable is rewritten", () => {
    const sandboxed = { ...isolatedEnv(BOTH, ISOLATED), HOME: "/srv/agents/run-1" };
    assert.equal(homeSurvived(BOTH, sandboxed), false);
  });

  it("fails when a home variable is dropped", () => {
    const without: Record<string, string> = { ...isolatedEnv(BOTH, ISOLATED) };
    delete without["USERPROFILE"];
    assert.equal(homeSurvived(BOTH, without), false);
  });

  it("fails when a home variable is invented", () => {
    // The mirror of the criterion: a run given a home the operator did not set is just as much a
    // run authenticating as somebody else.
    const base: BaseEnv = { PATH: "/usr/bin" };
    assert.equal(homeSurvived(base, { ...isolatedEnv(base, ISOLATED), HOME: "/tmp/fake" }), false);
  });

  it("holds for an environment that names no home at all", () => {
    const base: BaseEnv = { PATH: "/usr/bin" };
    assert.equal(homeSurvived(base, isolatedEnv(base, ISOLATED)), true);
  });
});
