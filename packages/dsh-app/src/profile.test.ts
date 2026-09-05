/**
 * The profile plan.
 *
 * Most of what is asserted here is a *shape dsh reads*, which is why the tests are literal rather
 * than structural: `bundles`, `patchReload` and the `dsh-profile-<name>` manifest name are read by
 * code this repository does not own, and a test that re-derived them from the same constants the
 * planner uses would pass whatever the planner did.
 */

import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { PATCH_FILE } from "./bundle.js";
import {
  BUNDLE_PACKAGE,
  PROFILE_NAME,
  checkProfileName,
  manifest,
  plannedRowIds,
  planProfile,
} from "./profile.js";

const home = resolve("/tmp/dsh-home");
const packageDir = resolve("/repo/packages/dsh-app");

const plan = (name?: string) =>
  planProfile(name === undefined ? { home, packageDir } : { home, packageDir, name });

const fileNamed = (path: string) => {
  const found = plan().files.find((file) => file.path === path);
  if (found === undefined) throw new Error(`the plan does not write ${path}`);
  return found;
};

describe("planProfile", () => {
  it("puts the profile where dsh looks for it", () => {
    assert.equal(plan().dir, join(home, "profiles", PROFILE_NAME));
    assert.equal(plan().home, home);
  });

  it("writes exactly the three files a dsh profile directory holds", () => {
    assert.deepEqual(
      plan().files.map((file) => file.path),
      ["package.json", "pnpm-workspace.yaml", PATCH_FILE],
    );
  });

  it("links this package into the profile's node_modules", () => {
    assert.equal(plan().link.path, join("node_modules", BUNDLE_PACKAGE));
    assert.equal(plan().link.target, packageDir);
  });

  it("owns the manifest and the workspace file, and only seeds the patch layer", () => {
    assert.equal(fileNamed("package.json").managed, true);
    assert.equal(fileNamed("pnpm-workspace.yaml").managed, true);
    assert.equal(
      fileNamed(PATCH_FILE).managed,
      false,
      "owning the deployment's own patch layer would let an install revert an operator's override",
    );
  });

  it("takes a profile name for a second deployment on one box", () => {
    assert.equal(plan("staging").dir, join(home, "profiles", "staging"));
    const parsed = JSON.parse(plan("staging").files[0]?.contents ?? "{}") as { name?: string };
    assert.equal(parsed.name, "dsh-profile-staging");
  });

  it("refuses a home that is not absolute", () => {
    assert.throws(() => planProfile({ home: "dsh-home", packageDir }), RangeError);
  });

  it("refuses a package directory that is not absolute", () => {
    assert.throws(() => planProfile({ home, packageDir: "packages/dsh-app" }), RangeError);
  });
});

describe("the manifest", () => {
  it("composes dsh-base and this bundle, in that order", () => {
    const dsh = manifest(PROFILE_NAME)["dsh"] as {
      profile: { bundles: string[]; patchReload: string };
    };
    assert.deepEqual(dsh.profile.bundles, ["@deepseek-ai/dsh-base", "@rickylabs/dsh-app"]);
  });

  it("reloads patches at startup, not live", () => {
    const dsh = manifest(PROFILE_NAME)["dsh"] as { profile: { patchReload: string } };
    assert.equal(dsh.profile.patchReload, "startup");
  });

  it("declares no dependencies, because the bundle is unpublished and reached by link", () => {
    assert.deepEqual(manifest(PROFILE_NAME)["dependencies"], {});
    assert.equal(manifest(PROFILE_NAME)["private"], true);
  });

  it("is written as pretty JSON with a trailing newline", () => {
    const contents = fileNamed("package.json").contents;
    assert.ok(contents.endsWith("}\n"));
    assert.ok(contents.includes('\n  "dsh": {'));
    assert.ok(!contents.includes("\r"));
  });
});

describe("the seeded patch layer", () => {
  it("is a valid, empty entry list", () => {
    const body = fileNamed(PATCH_FILE)
      .contents.split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .join("\n");
    assert.deepEqual(JSON.parse(body), []);
  });

  it("says where the ids it can address are listed", () => {
    assert.match(fileNamed(PATCH_FILE).contents, /packages\/dsh-app\/cordis\.patch\.yml/);
  });
});

describe("checkProfileName", () => {
  it("accepts the profile this package installs", () => {
    assert.doesNotThrow(() => {
      checkProfileName(PROFILE_NAME);
    });
  });

  for (const bad of ["", "a/b", "a\\b", ".", "..", "node_modules"]) {
    it(`refuses ${JSON.stringify(bad)}`, () => {
      assert.throws(() => {
        checkProfileName(bad);
      }, RangeError);
    });
  }
});

describe("plannedRowIds", () => {
  it("reports what the install will put on the entry list", () => {
    assert.deepEqual(plannedRowIds(), [
      "harness-subagents",
      "harness-board",
      "harness-coordinator",
      "harness-telemetry",
    ]);
  });
});
