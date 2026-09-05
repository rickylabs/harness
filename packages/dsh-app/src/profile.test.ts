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
  DEFAULT_SURFACE,
  PROFILE_BUNDLES,
  PROFILE_NAME,
  PROFILE_SURFACES,
  SURFACE_NAMES,
  bundlesFor,
  checkProfileName,
  isSurfaceName,
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

describe("surfaces", () => {
  it("keeps ours last, so a surface bundle can never win over our rows", () => {
    for (const surface of SURFACE_NAMES) {
      const bundles = bundlesFor(surface);
      assert.equal(bundles[0], "@deepseek-ai/dsh-base", `${surface} starts from dsh-base`);
      assert.equal(bundles[bundles.length - 1], BUNDLE_PACKAGE, `${surface} ends with ours`);
    }
  });

  it("defaults to the terminal surface the golden snapshot pins", () => {
    assert.equal(DEFAULT_SURFACE, "tui");
    assert.deepEqual(PROFILE_SURFACES.tui, [], "dsh-base carries the terminal surface itself");
    assert.deepEqual(PROFILE_BUNDLES, ["@deepseek-ai/dsh-base", BUNDLE_PACKAGE]);
    assert.deepEqual(bundlesFor(), [...PROFILE_BUNDLES]);
  });

  it("adds the dsh web bundle for the browser surface", () => {
    assert.deepEqual(bundlesFor("web"), [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      BUNDLE_PACKAGE,
    ]);
  });

  it("names no bundle a profile would have to install, so `dependencies` can stay empty", () => {
    // Both are dependencies of `@deepseek-ai/dsh` itself, which is why the resolver finds them from
    // the installation anchor. A surface naming anything else would need a `dependencies` entry and
    // a `pnpm install` in the profile directory — a different install than the one this plans.
    for (const bundle of Object.values(PROFILE_SURFACES).flat()) {
      assert.match(bundle, /^@deepseek-ai\/dsh-/, `${bundle} is not a bundle dsh ships`);
    }
  });

  it("writes the chosen surface into the manifest dsh reads", () => {
    const dsh = manifest(PROFILE_NAME, "web")["dsh"] as { profile: { bundles: string[] } };
    assert.deepEqual(dsh.profile.bundles, [...bundlesFor("web")]);
  });

  it("reports the surface and its bundles on the plan", () => {
    const web = planProfile({ home, packageDir, surface: "web" });
    assert.equal(web.surface, "web");
    assert.deepEqual(web.bundles, [...bundlesFor("web")]);
    assert.equal(plan().surface, DEFAULT_SURFACE);
  });

  it("tries the default first when inferring, so a plain install stays a plain check", () => {
    assert.equal(SURFACE_NAMES[0], DEFAULT_SURFACE);
    assert.deepEqual([...SURFACE_NAMES].sort(), Object.keys(PROFILE_SURFACES).sort());
  });

  it("narrows only names it knows", () => {
    assert.equal(isSurfaceName("web"), true);
    assert.equal(isSurfaceName("tui"), true);
    assert.equal(isSurfaceName("acp"), false);
    assert.equal(isSurfaceName("toString"), false, "inherited keys are not surfaces");
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
