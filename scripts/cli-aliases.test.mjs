import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tools = ["board", "coordinator", "forge", "telemetry"];

// These are real OS symlinks to the declared package binaries. Exercise argv[1] as a launcher
// supplies it, rather than calling exported main(), which cannot test entrypoint admission.
for (const tool of tools) {
  test(`${tool}: the canonical command runs its help and propagates usage exits`, () => {
    const directory = mkdtempSync(join(tmpdir(), "harness-cli-aliases-"));
    try {
      const manifest = JSON.parse(readFileSync(join(root, "packages", tool, "package.json"), "utf8"));
      const name = `harness-${tool}`;
      assert.equal(typeof manifest.bin[name], "string", "canonical command is missing");
      const command = join(directory, name);
      symlinkSync(resolve(root, "packages", tool, manifest.bin[name]), command);
      const help = spawnSync(process.execPath, [command, "--help"], { encoding: "utf8", timeout: 15_000 });
      assert.ifError(help.error);
      assert.equal(help.status, 0, `${name} --help: ${help.stderr}`);
      assert.equal(help.stderr, "");
      assert.ok(help.stdout.startsWith(`${name} —`), `${name} did not execute canonical help`);
      const wrong = spawnSync(process.execPath, [command, "--limit"], { encoding: "utf8", timeout: 15_000 });
      assert.ifError(wrong.error);
      assert.equal(wrong.status, 2, `${name} must propagate the usage failure`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("an unrelated cli.js imports every core CLI without launching any command", () => {
  const directory = mkdtempSync(join(tmpdir(), "harness-cli-import-"));
  try {
    // A name-only guard would launch coordinator/telemetry from this unrelated entrypoint.
    const importer = join(directory, "cli.js");
    writeFileSync(join(directory, "package.json"), '{"type":"module"}\n');
    writeFileSync(importer, tools.map(tool => `await import(${JSON.stringify(pathToFileURL(join(root, "packages", tool, "dist", "cli.js")).href)});`).join("\n") + '\nconsole.log("IMPORT_ONLY");\n');
    const result = spawnSync(process.execPath, [importer, "--help"], { encoding: "utf8", timeout: 15_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "IMPORT_ONLY\n", "import unexpectedly launched a command");
    assert.equal(result.stderr, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
