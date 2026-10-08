// The repository is public, so every line a pull request adds is read by strangers. This scans the
// lines added by `git diff <base>...HEAD` (default base `origin/main`, override with `--base <ref>`)
// for operator material: home and data-volume paths, private addresses, host:port pairs, tailnet
// names, token shapes, private-key headers and session ids.
//
// It prints `file:line reason` and nothing else, never the matched text: a scan that echoed what it
// found would publish the leak in the CI log of the very pull request it is trying to stop.
// Exit 0 clean, 1 on any finding, 2 (inconclusive, see scripts/gates.md) when the diff could not be
// read: a shallow clone or an unknown base is never green.
//
// `.llm/runs/**` is owner-controlled and `pnpm-lock.yaml` is generated, so both are excluded.
// The patterns below are written so that none of them matches its own source line.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { INCONCLUSIVE_EXIT } from "./inconclusive.mjs";

/** One row per detector, one row per line. The reason is a closed code; it is all that is printed. */
export const DETECTORS = [
  ["home-path", /(?<![\w.])(?:\/home\/[a-z_][\w.-]*\/|\/Users\/[\w.-]+\/|\/root\/|[A-Za-z]:[\\/]{1,2}Users[\\/])/],
  ["data-path", /(?<![\w.])\/(?:ephemeral|mnt|data|srv|var\/lib|opt\/data|tank|pool-[\w-]+)\//],
  ["private-ipv4", /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/],
  ["host-port", /[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@]+@)?(?:\[[0-9a-f:.]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*):\d{1,5}\b|\b(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|lan|internal|home|ts\.net)):\d{1,5}\b/i],
  ["tailnet-host", /\b[\w-]+\.[\w-]+\.ts\.net\b|\btail[0-9a-f]{4,}\b/i],
  ["token-shape", /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}|\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~+/-]{16,}/],
  ["private-key", /-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}/],
  ["session-id", /session[\w\s"'()[\]=:,.-]{0,20}[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}[\w\s"'()[\]=:,.-]{0,20}session/i],
];

/** The reasons one line trips, in table order. */
export const reasonsFor = text => DETECTORS.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);

/**
 * Walks a `--unified=0` diff and returns `{ path, line, text }` for every added line. Hunk-aware: a
 * header is only read outside a hunk, so an added line whose content starts with `++` is content.
 */
export function addedLines(diff) {
  const added = [];
  let path = null, line = 0, newLeft = 0, oldLeft = 0;
  for (const raw of diff.split("\n")) {
    if (newLeft > 0 && raw.startsWith("+")) {
      if (path !== null) added.push({ path, line, text: raw.slice(1) });
      line++; newLeft--;
    } else if (oldLeft > 0 && raw.startsWith("-")) {
      oldLeft--;
    } else if (raw.startsWith("@@ ")) {
      const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (hunk === null) continue;
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      line = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    } else if (newLeft === 0 && oldLeft === 0 && raw.startsWith("+++ ")) {
      // A rename with edits names the new path here; a deletion names /dev/null and adds nothing.
      const target = raw.slice(4).replace(/^"(.*)"$/, "$1");
      path = target.startsWith("b/") ? target.slice(2) : null;
    }
  }
  return added;
}

function inconclusive(reason) {
  console.error(`check:leaks inconclusive: ${reason}`);
  process.exit(INCONCLUSIVE_EXIT);
}

function main() {
  let base;
  try {
    // pnpm forwards a literal `--`, which parseArgs would read as the end of the options.
    const args = process.argv.slice(2).filter(arg => arg !== "--");
    base = parseArgs({ args, options: { base: { type: "string", default: "origin/main" } } }).values.base;
  } catch {
    inconclusive("usage (check-leaks.mjs [--base <ref>])");
  }
  const diff = spawnSync("git", [
    "-c", "core.quotePath=false", "diff", "--unified=0", "--no-color", "--no-ext-diff", "--find-renames",
    `${base}...HEAD`, "--", ".", ":(exclude).llm/runs/**", ":(exclude)pnpm-lock.yaml",
  ], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (diff.error || diff.status !== 0) inconclusive(`git-diff-failed (base ${base})`);

  const added = addedLines(diff.stdout);
  let findings = 0;
  for (const { path, line, text } of added) {
    for (const reason of reasonsFor(text)) {
      console.log(`${path}:${line} ${reason}`);
      findings++;
    }
  }
  if (findings > 0) {
    console.error(`check:leaks: ${findings} finding(s) in ${added.length} added line(s) against ${base}`);
    process.exitCode = 1;
  } else {
    console.error(`check:leaks ok: ${added.length} added line(s) scanned against ${base}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
