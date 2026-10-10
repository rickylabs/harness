/** Default lifecycle selection: the fourteen core packages under packages/. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_SELECTOR = "--filter=./packages/**";
const ACTIONS = new Set(["build", "typecheck", "test", "clean", "list"]);
const pnpm = (args, options = {}) => spawnSync("pnpm", args, {
  cwd: ROOT, shell: process.platform === "win32", ...options,
});

/**
 * Core package directories: `packages/<name>`, or `packages/<group>/<name>` when `<group>` has no
 * manifest of its own (as `packages/providers/` and `packages/hosts/` do). One group level, no deeper.
 */
function coreDirectories() {
  const manifestIn = (dir) => existsSync(join(ROOT, dir, "package.json"));
  return readdirSync(join(ROOT, "packages")).map(name => `packages/${name}`).flatMap(dir => {
    if (manifestIn(dir)) return [dir];
    if (!statSync(join(ROOT, dir)).isDirectory()) return [];
    return readdirSync(join(ROOT, dir)).map(name => `${dir}/${name}`).filter(manifestIn);
  });
}

export function corePackages() {
  const core = coreDirectories().map(dir => ({
    dir,
    manifest: JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")),
  }));
  if (core.length !== 15) throw new Error("expected fifteen core packages; review the core inventory");
  const names = new Set(core.map(row => row.manifest.name));
  if (names.size !== core.length) throw new Error("duplicate core package identity");
  return core;
}

export function selectedCore() {
  const expected = corePackages();
  // Run the native selector before compiling, so a selection that disagrees with the inventory
  // refuses before anything builds. Empty or unreadable metadata refuses.
  const result = pnpm(["--recursive", CORE_SELECTOR, "list", "--depth=-1", "--json"], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576,
  });
  if (result.error || result.status !== 0) throw new Error("pnpm core inventory unavailable");
  const rows = JSON.parse(result.stdout);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("pnpm core inventory is empty");
  const actual = rows.map(row => {
    if (typeof row.name !== "string" || typeof row.path !== "string") throw new Error("invalid pnpm core inventory");
    return { name: row.name, dir: relative(ROOT, row.path).replaceAll("\\", "/") };
  }).sort((a, b) => a.dir.localeCompare(b.dir));
  const wanted = expected.map(row => ({ name: row.manifest.name, dir: row.dir })).sort((a, b) => a.dir.localeCompare(b.dir));
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error("pnpm selector must include every core package and nothing else");
  return actual;
}

export function main(argv) {
  if (argv.length !== 1 || !ACTIONS.has(argv[0])) {
    console.error("usage: core-packages.mjs build|typecheck|test|clean|list");
    return 2;
  }
  try {
    const selected = selectedCore();
    if (argv[0] === "list") {
      console.log(JSON.stringify(selected));
      return 0;
    }
    console.log(`core ${argv[0]}: ${selected.length} packages`);
    const result = pnpm(["--recursive", CORE_SELECTOR, "run", argv[0]], { stdio: "inherit" });
    if (result.error || result.status === null) throw new Error("pnpm core lifecycle unavailable");
    return result.status;
  } catch (error) {
    console.error(`core selection failed: ${error instanceof Error ? error.message : "invalid inventory"}`);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
