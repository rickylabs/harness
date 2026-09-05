/**
 * `dsh-profile`, against a fake filesystem.
 *
 * The interesting assertions are the exit codes. `check` is only worth having if a drifted profile
 * is a non-zero exit that a pipeline can act on, and the seed/managed split is only real if editing
 * the deployment's own patch layer does *not* trip it — an installer that reported its own seed as
 * drift would teach an operator to ignore the check, which is the same as not having one.
 */

import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { EXIT, applyPlan, main, packageDirOf, type CliDeps, type ProfileFs } from "./cli.js";
import { PATCH_FILE } from "./bundle.js";
import { planProfile } from "./profile.js";

const home = resolve("/tmp/dsh-home");
const packageDir = resolve("/repo/packages/dsh-app");
const profileDir = join(home, "profiles", "rickylabs");

interface Fake extends ProfileFs {
  readonly files: Map<string, string>;
  readonly links: Map<string, string>;
  fail: string | null;
}

function fakeFs(): Fake {
  const files = new Map<string, string>();
  const links = new Map<string, string>();
  const fake: Fake = {
    files,
    links,
    fail: null,
    async mkdirp() {
      if (fake.fail !== null) throw new Error(fake.fail);
    },
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, contents) {
      if (fake.fail !== null) throw new Error(fake.fail);
      files.set(path, contents);
    },
    async linkTarget(path) {
      return links.get(path) ?? null;
    },
    async link(path, target) {
      if (fake.fail !== null) throw new Error(fake.fail);
      links.set(path, target);
    },
  };
  return fake;
}

interface Run {
  readonly code: number;
  readonly text: string;
  readonly fs: Fake;
}

async function run(argv: readonly string[], fs: Fake = fakeFs()): Promise<Run> {
  const lines: string[] = [];
  const deps: CliDeps = {
    out: (line) => lines.push(line ?? ""),
    env: {},
    packageDir,
    fs,
  };
  const code = await main(["--home", home, ...argv], deps);
  return { code, text: lines.join("\n"), fs };
}

describe("install", () => {
  it("writes the three files and the link, and says what will load", async () => {
    const { code, text, fs } = await run(["install"]);
    assert.equal(code, EXIT.ok);
    assert.deepEqual(
      [...fs.files.keys()].sort(),
      [
        join(profileDir, PATCH_FILE),
        join(profileDir, "package.json"),
        join(profileDir, "pnpm-workspace.yaml"),
      ].sort(),
    );
    assert.equal(fs.links.get(join(profileDir, "node_modules", "@rickylabs/dsh-app")), packageDir);
    assert.match(text, /4 rows will be inserted/);
    assert.match(text, /dsh --profile rickylabs --dump-config/);
  });

  it("is idempotent", async () => {
    const fs = fakeFs();
    await run(["install"], fs);
    const second = await run(["install"], fs);
    assert.equal(second.code, EXIT.ok);
    assert.match(second.text, /already installed; nothing changed/);
  });

  it("repairs a managed file someone edited", async () => {
    const fs = fakeFs();
    await run(["install"], fs);
    fs.files.set(join(profileDir, "package.json"), "{}\n");
    const repaired = await run(["install"], fs);
    assert.match(repaired.text, /wrote {2}package\.json/);
    assert.match(fs.files.get(join(profileDir, "package.json")) ?? "", /dsh-profile-rickylabs/);
  });

  it("never overwrites the deployment's own patch layer", async () => {
    const fs = fakeFs();
    await run(["install"], fs);
    const mine = "- id: harness-board\n  config:\n    lanePrefix: topic\n";
    fs.files.set(join(profileDir, PATCH_FILE), mine);
    await run(["install"], fs);
    assert.equal(fs.files.get(join(profileDir, PATCH_FILE)), mine);
  });

  it("re-points a link that goes somewhere else", async () => {
    const fs = fakeFs();
    await run(["install"], fs);
    const linkPath = join(profileDir, "node_modules", "@rickylabs/dsh-app");
    fs.links.set(linkPath, resolve("/old/checkout"));
    const again = await run(["install"], fs);
    assert.match(again.text, /wrote {2}node_modules/);
    assert.equal(fs.links.get(linkPath), packageDir);
  });

  it("--dry-run reports and writes nothing", async () => {
    const { code, text, fs } = await run(["install", "--dry-run"]);
    assert.equal(code, EXIT.ok);
    assert.equal(fs.files.size, 0);
    assert.equal(fs.links.size, 0);
    assert.match(text, /would write {2}package\.json/);
    assert.match(text, /would seed {3}cordis\.patch\.yml {2}\(only if absent\)/);
  });

  it("exits unwritable when the filesystem refuses", async () => {
    const fs = fakeFs();
    fs.fail = "EACCES: permission denied";
    const { code, text } = await run(["install"], fs);
    assert.equal(code, EXIT.unwritable);
    assert.match(text, /cannot write the profile/);
    assert.match(text, /EACCES/);
  });
});

describe("check", () => {
  it("is clean right after an install", async () => {
    const fs = fakeFs();
    await run(["install"], fs);
    const { code, text } = await run(["check"], fs);
    assert.equal(code, EXIT.ok);
    assert.match(text, /installed and matching/);
  });

  it("reports drift when nothing is installed", async () => {
    const { code, text } = await run(["check"]);
    assert.equal(code, EXIT.drift);
    assert.match(text, /drift {2}package\.json: not installed/);
    assert.match(text, /not linked/);
  });

  it("reports a managed file that was edited", async () => {
    const fs = fakeFs();
    await run(["install"], fs);
    fs.files.set(join(profileDir, "pnpm-workspace.yaml"), "nodeLinker: isolated\n");
    const { code, text } = await run(["check"], fs);
    assert.equal(code, EXIT.drift);
    assert.match(text, /pnpm-workspace\.yaml: differs from this package/);
  });

  it("stays quiet about the deployment's own patch layer", async () => {
    const fs = fakeFs();
    await run(["install"], fs);
    fs.files.set(join(profileDir, PATCH_FILE), "- id: harness-board\n");
    const { code } = await run(["check"], fs);
    assert.equal(code, EXIT.ok);
  });

  it("names the target of a link that points at another checkout", async () => {
    const fs = fakeFs();
    await run(["install"], fs);
    fs.links.set(join(profileDir, "node_modules", "@rickylabs/dsh-app"), resolve("/old/checkout"));
    const { code, text } = await run(["check"], fs);
    assert.equal(code, EXIT.drift);
    assert.match(text, /points at/);
  });
});

describe("argv", () => {
  it("path prints the profile directory and nothing else", async () => {
    const { code, text } = await run(["path"]);
    assert.equal(code, EXIT.ok);
    assert.equal(text, profileDir);
  });

  it("--name reaches the plan", async () => {
    const { text } = await run(["path", "--name", "staging"]);
    assert.equal(text, join(home, "profiles", "staging"));
  });

  it("refuses a reserved profile name as usage, not as a crash", async () => {
    const { code, text } = await run(["path", "--name", "node_modules"]);
    assert.equal(code, EXIT.usage);
    assert.match(text, /reserved/);
  });

  it("exits usage with no command", async () => {
    const { code, text } = await run([]);
    assert.equal(code, EXIT.usage);
    assert.match(text, /no command given/);
  });

  it("exits usage for a command it has not got", async () => {
    const { code, text } = await run(["uninstall"]);
    assert.equal(code, EXIT.usage);
    assert.match(text, /unknown command: uninstall/);
  });

  it("--help succeeds and names the three commands", async () => {
    const { code, text } = await run(["--help"]);
    assert.equal(code, EXIT.ok);
    for (const command of ["install", "check", "path"]) {
      assert.ok(text.includes(`dsh-profile ${command}`), `usage does not mention ${command}`);
    }
  });
});

describe("--surface", () => {
  const manifestOf = (fs: Fake) => fs.files.get(join(profileDir, "package.json")) ?? "";

  it("installs the terminal surface by default", async () => {
    const { text, fs } = await run(["install"]);
    assert.match(text, /^surface {3}tui$/m);
    assert.ok(!manifestOf(fs).includes("dsh-web-app"), "a plain install pulled in the web bundle");
  });

  it("puts the web bundle in the manifest when asked", async () => {
    const { code, text, fs } = await run(["install", "--surface", "web"]);
    assert.equal(code, EXIT.ok);
    assert.match(text, /^surface {3}web$/m);
    const bundles = (
      JSON.parse(manifestOf(fs)) as { dsh: { profile: { bundles: string[] } } }
    ).dsh.profile.bundles;
    assert.deepEqual(bundles, [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "@rickylabs/dsh-app",
    ]);
  });

  it("check infers the installed surface rather than reporting the default as drift", async () => {
    const fs = fakeFs();
    await run(["install", "--surface", "web"], fs);
    const { code, text } = await run(["check"], fs);
    assert.equal(code, EXIT.ok);
    assert.match(text, /^surface {3}web \(inferred\)$/m);
    assert.match(text, /installed and matching/);
  });

  it("check --surface asserts one, so the wrong surface is drift", async () => {
    const fs = fakeFs();
    await run(["install", "--surface", "web"], fs);
    const { code, text } = await run(["check", "--surface", "tui"], fs);
    assert.equal(code, EXIT.drift);
    assert.match(text, /package\.json: differs from this package/);
    assert.ok(!text.includes("(inferred)"), "an asserted surface was reported as inferred");
  });

  it("tells an operator which install would repair a non-default surface", async () => {
    const { code, text } = await run(["check", "--surface", "web"]);
    assert.equal(code, EXIT.drift);
    assert.match(text, /dsh-profile install --surface web/);
  });

  it("refuses a surface it has not got as usage, not as a crash", async () => {
    const { code, text } = await run(["install", "--surface", "acp"]);
    assert.equal(code, EXIT.usage);
    assert.match(text, /unknown surface: "acp"/);
    assert.match(text, /known: tui, web/);
  });

  it("--help names the surfaces", async () => {
    const { text } = await run(["--help"]);
    assert.match(text, /^ +--surface <s> +tui \| web \(default: tui\)$/m);
  });
});

describe("applyPlan", () => {
  it("reports only what it actually wrote", async () => {
    const fs = fakeFs();
    const plan = planProfile({ home, packageDir });
    const first = await applyPlan(plan, fs);
    assert.equal(first.length, 4);
    assert.deepEqual(await applyPlan(plan, fs), []);
  });
});

describe("packageDirOf", () => {
  it("resolves a file: URL to a usable path on this platform", () => {
    const dir = packageDirOf(import.meta.url);
    assert.ok(!dir.includes("file:"));
    assert.ok(!/^\/[A-Za-z]:/.test(dir), "a Windows path was left with a leading slash");
  });
});
