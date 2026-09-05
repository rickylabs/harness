/**
 * The committed `cordis.patch.yml` against the module it is rendered from, plus the two facts a
 * YAML string cannot state about itself: that every row names a subpath the manifest publishes,
 * and that no two rows — or two services — collide.
 *
 * The byte comparison is the load-bearing one. Without it `bundle.ts` is documentation of a file
 * someone can edit, and the failure mode of an edited row is a boot-time module-not-found in a
 * daemon, hours after the commit that caused it.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BUNDLE_ROWS, PATCH_FILE, renderPatch, subpathOf, type BundleRow } from "./bundle.js";
import { packageDirOf } from "./cli.js";
import { CONTEXT_KEY as BOARD_KEY, name as boardName } from "./plugins/board.js";
import { CONTEXT_KEY as COORDINATOR_KEY, name as coordinatorName } from "./plugins/coordinator.js";
import { CONTEXT_KEY as SUBAGENTS_KEY, name as subagentsName } from "./plugins/subagents.js";
import { CONTEXT_KEY as TELEMETRY_KEY, name as telemetryName } from "./plugins/telemetry.js";

interface Manifest {
  readonly name: string;
  readonly exports: Record<string, unknown>;
  readonly files: readonly string[];
  readonly dsh: { readonly bundle: { readonly patch: string } };
}

const packageDir = packageDirOf(import.meta.url);

const readManifest = async (): Promise<Manifest> =>
  JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as Manifest;

const row = (over: Partial<BundleRow>): BundleRow => ({
  id: "example",
  name: "@rickylabs/dsh-app/plugins/example",
  why: ["because"],
  ...over,
});

describe("cordis.patch.yml", () => {
  it("is byte-identical to what renderPatch produces", async () => {
    const committed = await readFile(join(packageDir, PATCH_FILE), "utf8");
    assert.equal(
      committed,
      renderPatch(),
      "the committed patch has drifted from bundle.ts — re-render it, do not edit it",
    );
  });

  it("is the file the manifest points dsh at, and is published with the package", async () => {
    const manifest = await readManifest();
    assert.equal(manifest.dsh.bundle.patch, `./${PATCH_FILE}`);
    assert.ok(
      manifest.files.includes(PATCH_FILE),
      "the patch is not in `files`, so a consumer would install a bundle with no layer",
    );
  });

  it("has no CRLF and ends with a newline", async () => {
    const committed = await readFile(join(packageDir, PATCH_FILE), "utf8");
    assert.ok(!committed.includes("\r"), "CRLF would make the byte comparison platform-dependent");
    assert.ok(committed.endsWith("\n"));
  });
});

describe("BUNDLE_ROWS", () => {
  it("names only subpaths this package's exports map publishes", async () => {
    const manifest = await readManifest();
    for (const bundleRow of BUNDLE_ROWS) {
      const subpath = subpathOf(bundleRow.name, manifest.name);
      assert.notEqual(subpath, null, `${bundleRow.name} does not name ${manifest.name}`);
      assert.ok(
        subpath !== null && subpath in manifest.exports,
        `${bundleRow.name} resolves to ${String(subpath)}, which the exports map does not publish`,
      );
    }
  });

  it("carries one row per plugin module, ids matching the plugin names", () => {
    assert.deepEqual(
      BUNDLE_ROWS.map((entry) => entry.id),
      [subagentsName, boardName, coordinatorName, telemetryName],
    );
  });

  it("claims four distinct context keys", () => {
    const keys = [SUBAGENTS_KEY, BOARD_KEY, COORDINATOR_KEY, TELEMETRY_KEY];
    assert.equal(new Set(keys).size, keys.length, "two plugins would claim one service name");
  });

  it("explains every row", () => {
    for (const bundleRow of BUNDLE_ROWS) {
      assert.ok(bundleRow.why.length > 0, `${bundleRow.id} has no comment`);
    }
  });
});

describe("renderPatch", () => {
  it("refuses an id that is not a lowercase slug", () => {
    assert.throws(() => renderPatch([row({ id: "Harness_Board" })]), RangeError);
  });

  it("refuses two rows with one id", () => {
    assert.throws(() => renderPatch([row({}), row({})]), RangeError);
  });

  it("refuses a name YAML would have to escape", () => {
    assert.throws(() => renderPatch([row({ name: "it's/a/module" })]), RangeError);
  });

  it("renders a comment above each row, indented into the insert", () => {
    const text = renderPatch([row({ why: ["one", "", "two"] })]);
    assert.ok(text.includes("\n    # one\n    #\n    # two\n    - id: example\n"));
  });
});

describe("subpathOf", () => {
  it("maps the bare package name to the root export", () => {
    assert.equal(subpathOf("@rickylabs/dsh-app", "@rickylabs/dsh-app"), ".");
  });

  it("maps a subpath to its exports key", () => {
    assert.equal(subpathOf("@rickylabs/dsh-app/plugins/board", "@rickylabs/dsh-app"), "./plugins/board");
  });

  it("returns null for a specifier that names another package", () => {
    assert.equal(subpathOf("@deepseek-ai/dsh-base", "@rickylabs/dsh-app"), null);
  });

  it("does not treat a package with a longer name as a subpath", () => {
    assert.equal(subpathOf("@rickylabs/dsh-application", "@rickylabs/dsh-app"), null);
  });
});
