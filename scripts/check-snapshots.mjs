#!/usr/bin/env node
/**
 * No allowance snapshot is committed. E4.3 (#59), third criterion.
 *
 * A quota percentage, a spend balance and a staged-rollout flag are all true for a few hours. Commit
 * one and it keeps being read long after it stopped being true — and it reads exactly like a
 * measurement, because that is what it was. `packages/routing/src/probe.ts` is the half of this rule
 * that lives in types: a verdict carries its source, and a committed constant may refuse but may
 * never permit. This is the other half, because the mistake it catches is a *file*, not a call, and
 * no type can see a file that nothing imports.
 *
 * ## What counts as a snapshot
 *
 * Two rules, both narrow on purpose, because a check people learn to route around is worse than no
 * check.
 *
 * **Structure, not prose.** Only tracked `.json`, `.yml` and `.yaml` are read. `docs/` and the
 * package READMEs discuss allowances at length and must keep being able to; a paragraph explaining
 * why a quota is not committable is not a committed quota. A snapshot is a data file.
 *
 * **A key that can only mean "as of now".** `resets_at`, `remaining_percent`, `balance_usd` and the
 * rest below name a moment, and there is no version of them that is stable. `observed_at` is in the
 * list because that is the field `probe.ts` puts on an `Observation`: a serialised observation in
 * the tree is the exact artifact this rule exists to keep out, whatever the file is called.
 *
 * A file whose *name* says allowance or quota is refused on that alone. Nobody names a stable table
 * that.
 *
 * Exit codes: 0 nothing committed, 1 at least one snapshot, 2 the check could not run.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Keys that name a moment. Matched as a JSON key (`"x":`) or a YAML key (`x:`), so a word appearing
// in a *value* — a description, a URL, an enum member — does not trip the check.
const TIME_SLIDING_KEYS = [
  "allowance",
  "allowances",
  "balance_usd",
  "balanceUsd",
  "credit_balance",
  "creditBalance",
  "credits_remaining",
  "creditsRemaining",
  "observed_at",
  "observedAt",
  "percent_remaining",
  "percentRemaining",
  "probed_at",
  "probedAt",
  "quota_remaining",
  "quotaRemaining",
  "remaining_percent",
  "remainingPercent",
  "remaining_quota",
  "remaining_spend",
  "reset_at",
  "resetAt",
  "resets_at",
  "resetsAt",
  "spend_remaining",
  "spendRemaining",
  "tokens_remaining",
  "tokensRemaining",
  "window_resets",
  "windowResets",
];

const KEY_PATTERN = new RegExp(`(^|[\\s{,"'])"?(${TIME_SLIDING_KEYS.join("|")})"?\\s*:`, "m");
const NAME_PATTERN = /(allowance|quota)/i;

const DATA_FILE = /\.(json|ya?ml)$/;
const SKIP = [/(^|\/)node_modules\//, /(^|\/)dist\//, /(^|\/)pnpm-lock\.yaml$/];

let tracked;
try {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  tracked = listed.split("\0").filter((path) => path.length > 0);
} catch (error) {
  console.error(`check:snapshots — could not list tracked files: ${error.message}`);
  process.exit(2);
}

const files = tracked.filter(
  (path) => DATA_FILE.test(path) && !SKIP.some((pattern) => pattern.test(path)),
);

if (files.length === 0) {
  console.error("check:snapshots — no tracked data files found. That is a broken check, not a clean one.");
  process.exit(2);
}

const problems = [];

for (const path of files) {
  const full = join(ROOT, path);

  // A tracked path can be a deleted-but-staged entry, or a submodule. Neither is readable.
  try {
    if (!statSync(full).isFile()) continue;
  } catch {
    continue;
  }

  const base = path.slice(path.lastIndexOf("/") + 1);
  if (NAME_PATTERN.test(base)) {
    problems.push(`${path}: a data file named for an allowance or a quota is a snapshot by its name`);
    continue;
  }

  let text;
  try {
    text = readFileSync(full, "utf8");
  } catch (error) {
    console.error(`check:snapshots — could not read ${path}: ${error.message}`);
    process.exit(2);
  }

  const match = KEY_PATTERN.exec(text);
  if (match !== null) {
    const line = text.slice(0, match.index).split("\n").length;
    // The key is named; the value never is. A committed spend figure is still a number nobody
    // outside this repository needs to read in a CI log.
    problems.push(`${path}:${line}: carries \`${match[2]}\`, which is only ever true as of a moment`);
  }
}

for (const problem of problems) console.error(problem);

if (problems.length > 0) {
  console.error(
    `\ncheck:snapshots — ${problems.length} committed snapshot(s). Availability is probed at dispatch ` +
      "(packages/routing/src/probe.ts), never read from the tree.",
  );
  process.exit(1);
}

console.log(
  `check:snapshots — ${files.length} tracked data file(s) carry no allowance snapshot`,
);
