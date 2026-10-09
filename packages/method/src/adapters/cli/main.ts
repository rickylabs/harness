#!/usr/bin/env node
/**
 * `harness-method`: the composition root. It parses argv with `node:util` parseArgs, wires the
 * Node filesystem and js-yaml adapters into the application use cases, and maps their verdicts to
 * the three gate states (0 pass, 1 refused, 2 no verdict).
 */
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkReceipts } from "../../application/check-receipts.ts";
import { renderMilestoneRun } from "../../application/render-milestone.ts";
import { unavailableMilestonePrSource, validateMilestoneRun } from "../../application/validate-milestone-cluster.ts";
import { MILESTONE_FILES } from "../../domain/milestone/vocabulary.ts";
import type { MilestonePrSource } from "../../ports/milestone-pr-source.ts";
import { milestonePrSourceFromExport } from "../github-pr-export.ts";
import { jsYamlDuplicateKeys } from "../js-yaml-duplicate-keys.ts";
import { nodeRunDirectory } from "../node-run-directory.ts";

export const EXIT = { ok: 0, failed: 1, unproven: 2 } as const;
export const EXIT_MEANINGS: Record<keyof typeof EXIT, string> = {
  ok: "every check ran and passed; render wrote the page or found it current",
  failed: "a check ran and refused, or an input could not be read",
  unproven: "no verdict: a usage error, or receipts with no input, an unreadable input or an unknown observation",
};
const EXIT_BLOCK = Object.entries(EXIT)
  .map(([name, code]) => `  ${code}  ${EXIT_MEANINGS[name as keyof typeof EXIT]}`)
  .join("\n");

const RENDER_USAGE = "usage: harness-method milestone render <run-dir> [--check]";
const VALIDATE_USAGE = "usage: harness-method milestone validate <run-dir> [--github-prs <export.json>]";
const RECEIPTS_USAGE = "usage: harness-method receipts <receipt.json>...";

export const USAGE = `harness-method — render and validate milestone run records, and check route receipts

usage:
  harness-method milestone render <run-dir> [--check]
      write milestone-status.md from milestone-cluster-state.json; --check compares instead
  harness-method milestone validate <run-dir> [--github-prs <export.json>]
      validate the five cluster artifacts and reconcile leaves against a captured PR export;
      without an export, reconciliation is unavailable and the run does not pass
  harness-method receipts <receipt.json>...
      check route receipts: structure and requested/observed agreement only; prints JSON

options:
  -h, --help   this text; after a subcommand, that subcommand's usage

Run templates live in packages/method/templates/.

exit codes:
${EXIT_BLOCK}
`;

type Write = (text: string) => void;
interface Io { readonly out: Write; readonly err: Write }
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const HELP = { help: { type: "boolean", short: "h" } } as const;

async function render(args: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({ args: [...args], options: { ...HELP, check: { type: "boolean" } }, allowPositionals: true, strict: true });
  if (values.help) { io.out(`${RENDER_USAGE}\n`); return EXIT.ok; }
  if (positionals.length !== 1) return usage(io, positionals.length === 0 ? "missing run directory" : "expected exactly one run directory", RENDER_USAGE);
  const dir = nodeRunDirectory(String(positionals[0]));
  const statusPath = dir.locate(MILESTONE_FILES.status);
  let outcome;
  try {
    outcome = await renderMilestoneRun(dir, values.check === true);
  } catch (error) {
    io.err(`error: unable to render milestone status: ${message(error)}\n`);
    return EXIT.failed;
  }
  if (outcome === "stale") { io.err(`stale or missing generated status: ${statusPath}\n`); return EXIT.failed; }
  io.out(`${outcome}: ${statusPath}\n`);
  return EXIT.ok;
}

async function validate(args: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({ args: [...args], options: { ...HELP, "github-prs": { type: "string" } }, allowPositionals: true, strict: true });
  if (values.help) { io.out(`${VALIDATE_USAGE}\n`); return EXIT.ok; }
  if (positionals.length !== 1) return usage(io, positionals.length === 0 ? "missing run directory" : "expected exactly one run directory", VALIDATE_USAGE);
  const exportPath = values["github-prs"];
  let source: MilestonePrSource = unavailableMilestonePrSource(
    "GitHub PR reconciliation input is unavailable; pass --github-prs <export.json>",
  );
  if (typeof exportPath === "string") {
    try {
      source = milestonePrSourceFromExport(JSON.parse(await readFile(exportPath, "utf8")));
    } catch (error) {
      source = unavailableMilestonePrSource(`GitHub PR reconciliation input is unavailable: ${message(error)}`);
    }
  }
  let result;
  try {
    result = await validateMilestoneRun(nodeRunDirectory(String(positionals[0])), source);
  } catch (error) {
    io.err(`error: unable to validate milestone cluster: ${message(error)}\n`);
    return EXIT.failed;
  }
  io.out(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? EXIT.ok : EXIT.failed;
}

async function receipts(args: readonly string[], io: Io): Promise<number> {
  // Receipt paths are positional; a leading `-` file name is refused by the parser, never guessed.
  const { values, positionals } = parseArgs({ args: [...args], options: HELP, allowPositionals: true, strict: true });
  if (values.help) { io.out(`${RECEIPTS_USAGE}\n`); return EXIT.ok; }
  const report = await checkReceipts(positionals.map(String), (path) => readFile(path, "utf8"), jsYamlDuplicateKeys);
  io.out(`${JSON.stringify(report)}\n`);
  return EXIT[report.verdict === "pass" ? "ok" : report.verdict === "fail" ? "failed" : "unproven"];
}

function usage(io: Io, problem: string, text = USAGE): number {
  io.err(`error: ${problem}\n${text}\n`);
  return EXIT.unproven;
}

export async function main(argv: readonly string[], io: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
}): Promise<number> {
  const [command, sub] = argv;
  try {
    if (command === undefined) return usage(io, "missing command");
    if (command === "-h" || command === "--help") { io.out(USAGE); return EXIT.ok; }
    if (command === "receipts") return await receipts(argv.slice(1), io);
    if (command === "milestone" && sub === "render") return await render(argv.slice(2), io);
    if (command === "milestone" && sub === "validate") return await validate(argv.slice(2), io);
    return usage(io, `unknown command: ${[command, sub].filter(Boolean).join(" ")}`);
  } catch (error) {
    // parseArgs refusals (unknown option, missing option value) are usage errors.
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_")) return usage(io, message(error));
    throw error;
  }
}

/** Resolve entry-point symlinks: a launcher alias must run the CLI, never silently exit zero. */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      process.stderr.write(`harness-method failed: ${message(error)}\n`);
      process.exitCode = EXIT.failed;
    });
}
