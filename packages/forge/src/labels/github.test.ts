import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseGitHubRepoSlug } from "./github.js";

describe("parseGitHubRepoSlug", () => {
  const valid: ReadonlyArray<readonly [string, string]> = [
    ["https://github.com/o/r.git", "o/r"],
    ["https://user:token@github.com/o/r.git", "o/r"],
    ["http://github.com/o/r", "o/r"],
    ["ssh://git@github.com/o/r", "o/r"],
    ["ssh://git@github.com:443/o/r.git", "o/r"],
    ["git://github.com/o/r.git", "o/r"],
    ["github.com:o/r.git", "o/r"],
    ["git@github.com:o/r.git", "o/r"],
    ["GIT@GITHUB.COM:Owner/Repo.git/", "Owner/Repo"],
    ["  https://github.com/o/r.git\n", "o/r"],
  ];

  for (const [remote, expected] of valid) {
    it(`parses ${remote.trim()}`, () => {
      assert.equal(parseGitHubRepoSlug(remote), expected);
    });
  }

  const invalid = [
    "",
    "/tmp/github.com/o/r.git",
    "file:///tmp/o/r.git",
    "https://evil.example/github.com/o/r.git",
    "https://github.com.evil.example/o/r.git",
    "https://github.com/o/r/extra.git",
    "https://github.com/o//r.git",
    "https://github.com//o/r.git",
    "https://github.com/o",
    "https://github.com/o/r.git?token=secret",
    "https://github.com/o/r.git#fragment",
    "git@example.com:o/r.git",
    "git@github.com:o/r/extra.git",
    "github.com:o/%2Fr.git",
  ];

  for (const remote of invalid) {
    it(`rejects ${remote || "an empty value"}`, () => {
      assert.equal(parseGitHubRepoSlug(remote), null);
    });
  }
});
