/** Default lifecycle selection: fifteen core packages; optional routers require explicit commands. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_SELECTOR = "--filter=./packages/*";
const ACTIONS = new Set(["build", "typecheck", "test", "clean", "list"]);
const pnpm = (args, options = {}) => spawnSync("pnpm", args, {
  cwd: ROOT, shell: process.platform === "win32", ...options,
});

export function corePackages() {
  const core = readdirSync(join(ROOT, "packages")).filter(dir =>
    existsSync(join(ROOT, "packages", dir, "package.json"))).map(dir => ({
      dir: `packages/${dir}`,
      manifest: JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8")),
    }));
  if (core.length !== 15) throw new Error("expected fifteen core packages; review the core inventory");
  const names = new Set(core.map(row => row.manifest.name));
  if (names.size !== core.length) throw new Error("duplicate core package identity");
  for (const row of core) {
    const dependencies = { ...row.manifest.dependencies, ...row.manifest.devDependencies, ...row.manifest.peerDependencies };
    for (const [name, range] of Object.entries(dependencies)) {
      if (name.startsWith("@deepseek-ai/") || (typeof range === "string" && range.startsWith("workspace:") && !names.has(name))) {
        throw new Error(`${row.dir}: default core dependency reaches an optional host`);
      }
    }
  }
  return core;
}

export function selectedCore() {
  const expected = corePackages();
  // Run the native selector before compiling, so a broadened selection cannot boot/build an
  // optional router and only discover the error afterwards. Empty or unreadable metadata refuses.
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
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error("pnpm selector must include every core package and exclude experiments");
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
    console.log(`core ${argv[0]}: ${selected.length} packages; optional routers not selected (use experiment:dsh:check)`);
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
