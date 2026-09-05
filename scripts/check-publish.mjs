#!/usr/bin/env node
/**
 * Assert that the one publishable package is publishable, and that what it would publish is what it
 * claims to publish.
 *
 * A release is the one operation in this repository that cannot be undone by a revert. An npm
 * version is immutable and a deprecation is a notice, not a removal — so every mistake this file
 * catches is a mistake that would otherwise be permanent and public.
 *
 * The checks are not stylistic. Each one is a specific thing that has a wrong answer nothing else
 * would notice:
 *
 * - **The manifest name and `PACKAGE_NAME` must agree.** They are two copies of one fact, in two
 *   files, and the rename to `@rickylabs/harness-contracts` touched both. A rename that updated one
 *   would ship a package whose own exported constant names a package that does not exist.
 * - **`PROTOCOL_VERSION` and `dsh.protocol` must agree.** This is the compatibility window made
 *   mechanical: the wire version cannot move without editing the manifest, which is the file the
 *   package version lives in, which is where you are standing when you decide whether this is a
 *   major. See the README's compatibility section for what the rule then requires.
 * - **The root entry must not reach the hub.** `server.js` is exported from the `/server` subpath so
 *   a phone bundle following the root entry never pulls in the coordinator's half. A single
 *   re-export from `index.ts` silently undoes that, and nothing about the build would look wrong.
 * - **The tarball must not carry tests.** `files: ["dist"]` published every compiled `*.test.js`
 *   until this check existed. That is not a security problem; it is a package whose contents nobody
 *   was checking, which is how one becomes a security problem.
 *
 * The tarball contents come from `npm pack --dry-run`, not from re-implementing the `files`
 * semantics here. A check that models the rule instead of asking the tool is a check that can be
 * right about a rule npm no longer applies.
 *
 * Exit codes: 0 publishable, 1 not, 2 the check could not run.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(repoRoot, "packages", "contracts");

const problems = [];
const note = (message) => problems.push(message);

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not parseable JSON: ${error.message}`);
  }
};

/** Resolve a relative reference against the file that made it. Tarball paths are always POSIX. */
const posixJoin = (fromFile, relative) => {
  const parts = fromFile.split("/").slice(0, -1);
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
};

/**
 * The file list npm itself would ship, asked of npm rather than modelled here.
 *
 * Returns `null` when npm is not installed. This repository is pnpm's, and a contributor who has
 * never run npm should not have `pnpm run build` fail at them over a tool they do not use — so the
 * tarball half degrades to a warning locally. It does not degrade in CI: `setup-node` always
 * provides npm, so the check that matters is enforced exactly where the release is cut.
 */
const npmRun = (args) =>
  execFileSync(process.platform === "win32" ? "npm" : "npm", args, {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // On Windows npm is a .cmd or a .exe depending on how node was installed; let the shell's
    // PATHEXT resolution decide rather than guessing an extension.
    shell: process.platform === "win32",
  });

const packedFiles = () => {
  try {
    npmRun(["--version"]);
  } catch {
    return null;
  }
  let out;
  try {
    out = npmRun(["pack", "--dry-run", "--json"]);
  } catch (error) {
    throw new Error(`npm pack failed: ${(error.stderr ?? error.message).toString().trim()}`);
  }
  // npm prints notices on stderr and the JSON on stdout, but has been known to prefix it. Find the
  // array rather than assuming the whole stream is JSON.
  const start = out.indexOf("[");
  if (start < 0) throw new Error("npm pack --dry-run --json printed no JSON array");
  const parsed = JSON.parse(out.slice(start));
  const first = parsed[0];
  if (first === undefined || !Array.isArray(first.files)) {
    throw new Error("npm pack --dry-run --json reported no file list");
  }
  return first.files.map((entry) => entry.path);
};

const main = async () => {
  const manifest = readJson(join(pkgDir, "package.json"));

  if (manifest.private === true) note("package.json says private: true, so it can never be published");
  if (manifest.version === "0.0.0") note("version is still the 0.0.0 placeholder");
  if (typeof manifest.license !== "string") note("no license field");
  if (manifest.publishConfig?.access !== "public") note('publishConfig.access is not "public"');
  if (manifest.repository?.directory !== "packages/contracts") {
    note("repository.directory does not point at packages/contracts, so npm links the wrong source");
  }
  if (typeof manifest.dsh?.protocol !== "number") note("dsh.protocol is not declared");

  const declared = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
  for (const [name, range] of Object.entries(declared)) {
    if (typeof range === "string" && range.startsWith("workspace:")) {
      note(`depends on ${name} with the workspace protocol, which is unpublishable`);
    }
  }

  // Every export target has to exist, or the package installs and fails on first import.
  const targets = new Set([manifest.main, manifest.types]);
  for (const entry of Object.values(manifest.exports ?? {})) {
    if (typeof entry === "string") targets.add(entry);
    else for (const value of Object.values(entry)) targets.add(value);
  }
  let built = true;
  for (const target of targets) {
    if (typeof target !== "string" || !target.startsWith("./")) continue;
    if (!existsSync(join(pkgDir, target))) {
      note(`${target} is named in package.json but does not exist — build first`);
      built = false;
    }
  }

  if (built) {
    const index = await import(pathToFileURL(join(pkgDir, "dist", "index.js")).href);
    if (index.PACKAGE_NAME !== manifest.name) {
      note(`PACKAGE_NAME is ${index.PACKAGE_NAME} but package.json says ${manifest.name}`);
    }
    if (index.PROTOCOL_VERSION !== manifest.dsh?.protocol) {
      note(
        `PROTOCOL_VERSION is ${index.PROTOCOL_VERSION} but dsh.protocol is ${manifest.dsh?.protocol} — ` +
          "a wire change is a package major; see the README's compatibility section",
      );
    }
    if (typeof index.openHub === "function") {
      note("the root entry exports the hub; it belongs on the /server subpath");
    }
    const root = readFileSync(join(pkgDir, "dist", "index.js"), "utf8");
    if (/from ["']\.\/server\.js["']/.test(root)) {
      note("dist/index.js imports ./server.js, so a cockpit bundle would pull in the hub");
    }
  }

  const files = packedFiles();
  if (files !== null) {
    const shipped = new Set(files);
    for (const required of [
      "package.json",
      "README.md",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/server.js",
      "src/index.ts",
    ]) {
      if (!shipped.has(required)) note(`the tarball does not contain ${required}`);
    }
    for (const path of files) {
      if (/\.test\./.test(path)) note(`the tarball contains a test artefact: ${path}`);
      if (path.endsWith(".tsbuildinfo")) note(`the tarball contains build state: ${path}`);
    }

    // No map may dangle. A source map naming a file the tarball does not carry is worse than no map
    // at all: every consumer's debugger silently fails to resolve it, and the package looks like it
    // has debug support it does not have. This is why `src` is published — the maps point there.
    for (const path of files) {
      const onDisk = join(pkgDir, path);
      if (/\.(js|d\.ts)$/.test(path)) {
        const link = /\/\/# sourceMappingURL=(.+)\s*$/.exec(readFileSync(onDisk, "utf8"));
        if (link !== null) {
          const target = posixJoin(path, link[1].trim());
          if (!shipped.has(target)) note(`${path} points at ${target}, which the tarball omits`);
        }
      }
      if (path.endsWith(".map")) {
        for (const source of JSON.parse(readFileSync(onDisk, "utf8")).sources ?? []) {
          const target = posixJoin(path, source);
          if (!shipped.has(target)) note(`${path} names source ${target}, which the tarball omits`);
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`publish check failed — ${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }

  const tarball =
    files === null ? "tarball not read (no npm on PATH)" : `${files.length} files, no tests`;
  console.log(
    `publish ok — ${manifest.name}@${manifest.version}, protocol ${manifest.dsh.protocol}, ${tarball}`,
  );
  return 0;
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`publish check could not run: ${error.message}`);
  process.exitCode = 2;
}
