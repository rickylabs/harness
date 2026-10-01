#!/usr/bin/env node
/** Gate all committed dispatch profiles before a revision can be pinned. */
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProfileCollection } from "./profile-frontmatter.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = join(root, "profiles");
const files = readdirSync(directory).filter(name => name.endsWith(".md") && name !== "README.md").sort();
const problems = [];
const documents = [];
for (const name of files) {
  const path = join(directory, name);
  if (!lstatSync(path).isFile()) { problems.push(`${name}: profile: regular_file_required`); continue; }
  documents.push({ path: name, markdown: readFileSync(path, "utf8") });
}
for (const problem of validateProfileCollection(documents)) {
  problems.push(`${problem.path}: ${problem.field}: ${problem.code}`);
}
if (problems.length) {
  for (const problem of problems) console.error(`check:profiles — ${problem}`);
  process.exitCode = 1;
} else console.log(`check:profiles — ${files.length} profile Markdown files valid`);
