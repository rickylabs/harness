#!/usr/bin/env node
/**
 * Every relative link and every anchor in every markdown file, checked against the tree they point
 * into.
 *
 * The failure this exists for is silent. A moved file, a renamed heading, a directory that grew a
 * `README.md` and then lost it — none of these break a build, and none of them are visible in a
 * diff. The page keeps rendering; the link just stops arriving anywhere. In a repository whose
 * documentation is read first by agents, a link that 404s is not a cosmetic problem: it is a fact
 * the next run cannot reach, and the run proceeds without it rather than stopping.
 *
 * Three deliberate limits.
 *
 * **External links are not checked at all.** Not "checked and warned" — not fetched. A checker that
 * makes network calls fails for reasons that have nothing to do with the change under review: a rate
 * limit, a site that blocks datacenter IPs, a domain that is down for an hour. A gate that goes red
 * without the diff being wrong is a gate people learn to re-run until it passes, which is worse than
 * no gate. Their count is printed so the number is visible, and that is all.
 *
 * **`.llm/runs/` is excluded.** Those directories are committed evidence of runs that already
 * happened — roughly half the markdown in the repository. A link inside one describes what was true
 * when the run wrote it. If a later commit moves the file it named, the honest record is the one
 * that still names the old path; "fixing" it would edit the evidence to agree with the present,
 * which is the one thing evidence must never do. `EXCLUDED` holds this and nothing else.
 *
 * **Case is compared explicitly, segment by segment.** `existsSync` on Windows and macOS answers
 * yes for `Docs/README.md` when the file is `docs/README.md`; on the Linux runner it answers no. A
 * link like that passes on the workstation that wrote it and fails only after merge. Every path
 * component is matched against the real directory listing so the answer is the same everywhere.
 *
 * Anchors follow GitHub's slug rules rather than an approximation of them: punctuation is dropped,
 * every remaining whitespace character becomes one hyphen (so an em dash between two words leaves
 * two hyphens, not one), and a repeated heading gets the `-1`, `-2` suffixes GitHub appends. Getting
 * this wrong in the lenient direction makes the check useless; getting it wrong in the strict
 * direction makes it a liar. It is tested against the repository's own headings on every run.
 *
 * Exit codes: 0 every link resolves, 1 at least one does not, 2 no markdown was scanned at all —
 * a broken checker, which must never be able to look like a clean one.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Never descended into. `dist` and `node_modules` are build output; `.llm/runs` is evidence.
 *
 * `scratchpad` is neither, and is skipped for a third reason: it is not in the repository. Every
 * agent working here writes drafts, briefs and half-finished notes into a repo-root `scratchpad/`,
 * and a draft that links to a file it has not written yet is a draft doing its job. Checking those
 * links reports failures nobody can act on, in files that will never be committed — which is how a
 * checker gets ignored, and a checker that is ignored is worse than no checker at all.
 */
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "scratchpad"]);
const EXCLUDED = [".llm/runs/"];

// ── discovery ────────────────────────────────────────────────────────────────

/** Repo-relative, forward-slashed, sorted — so the report reads the same on every platform. */
function markdownFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      markdownFiles(join(dir, entry.name), acc);
      continue;
    }
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    acc.push(relative(ROOT, join(dir, entry.name)).split(sep).join("/"));
  }
  return acc.sort();
}

// ── markdown, minus the parts that are not prose ─────────────────────────────

/**
 * Blank out fenced blocks, keeping line count and line numbers intact.
 *
 * A link inside a fence is displayed literally — it is an example of a link, not a link — and a `#`
 * inside one is a shell comment, not a heading. Checking either produces failures that cannot be
 * fixed without breaking the example, which is how a checker teaches people to add ignore comments.
 *
 * `inline` additionally blanks code spans, and is passed only when looking for links. Headings must
 * be read with it off: blanking preserves length, so a heading ending in a code span would slug to
 * one hyphen per blanked character instead of one per removed backtick — a checker that reports a
 * correct anchor as broken, which is the failure mode that makes people stop believing the check.
 */
function stripCode(text, inline = false) {
  const out = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      out.push("");
      if (open !== null && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      continue;
    }
    if (open !== null) {
      fence = open[1];
      out.push("");
      continue;
    }
    out.push(inline ? line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length)) : line);
  }
  return out;
}

// ── anchors ──────────────────────────────────────────────────────────────────

/**
 * GitHub's heading slug. Link syntax collapses to its text, punctuation is removed, whitespace
 * becomes hyphens one for one, and the result is lowercased.
 */
function slugify(heading) {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\s-]/gu, "")
    .replace(/\s/g, "-");
}

const anchorCache = new Map();

function anchorsOf(absPath) {
  const cached = anchorCache.get(absPath);
  if (cached !== undefined) return cached;

  const anchors = new Set();
  const seen = new Map();
  const raw = readFileSync(absPath, "utf8");

  for (const line of stripCode(raw)) {
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading === null) continue;
    const base = slugify(heading[2]);
    if (base.length === 0) continue;
    // GitHub disambiguates a repeated heading with -1, -2, ... in document order.
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }

  // Explicit targets. Written by hand, so they are taken exactly as spelled.
  for (const m of raw.matchAll(/<a\s+(?:id|name)\s*=\s*["']([^"']+)["']/gi)) anchors.add(m[1]);
  for (const m of raw.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)) anchors.add(m[1]);

  anchorCache.set(absPath, anchors);
  return anchors;
}

// ── paths ────────────────────────────────────────────────────────────────────

const listCache = new Map();

function listing(dir) {
  const cached = listCache.get(dir);
  if (cached !== undefined) return cached;
  let names;
  try {
    names = new Set(readdirSync(dir));
  } catch {
    names = null;
  }
  listCache.set(dir, names);
  return names;
}

/**
 * Does this path exist with exactly this spelling? Walked one component at a time against the real
 * directory listing, because the case-insensitive filesystems this repository is written on will
 * happily answer yes to a path the Linux runner cannot open.
 */
function existsExact(absPath) {
  const rel = relative(ROOT, absPath);
  if (rel.startsWith("..")) return false;
  if (rel.length === 0) return true;
  let dir = ROOT;
  for (const part of rel.split(sep)) {
    const names = listing(dir);
    if (names === null || !names.has(part)) return false;
    dir = join(dir, part);
  }
  return true;
}

// ── link extraction ──────────────────────────────────────────────────────────

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Every href worth resolving, with the line it sits on. */
function linksIn(lines) {
  const found = [];
  const push = (line, href) => {
    if (href.length === 0) return;
    found.push({ line, href });
  };

  for (const [i, line] of lines.entries()) {
    const n = i + 1;
    // [text](target "title") and ![alt](target), with the angle-bracket form GitHub also accepts.
    for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)<>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
      push(n, m[1]);
    }
    // Reference definitions: [label]: target
    const def = /^\s{0,3}\[[^\]^]+\]:\s*<?([^\s<>]+)>?/.exec(line);
    if (def !== null) push(n, def[1]);
    // Raw HTML, which several pages use for images and named targets.
    for (const m of line.matchAll(/<(?:a|img)\s[^>]*?(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
      push(n, m[1]);
    }
  }
  return found;
}

// ── the check ────────────────────────────────────────────────────────────────

const files = markdownFiles(ROOT).filter((f) => !EXCLUDED.some((p) => f.startsWith(p)));

if (files.length === 0) {
  console.error("check:links — no markdown files found. That is a broken check, not a clean one.");
  process.exit(2);
}

const problems = [];
let checked = 0;
let anchored = 0;
let external = 0;

for (const file of files) {
  const abs = join(ROOT, file);
  const lines = stripCode(readFileSync(abs, "utf8"), true);

  for (const { line, href } of linksIn(lines)) {
    const at = `${file}:${line}`;

    if (SCHEME.test(href) || href.startsWith("//")) {
      external += 1;
      continue;
    }

    checked += 1;

    if (href.startsWith("/")) {
      // On GitHub this resolves to github.com/<href>, not to the repository root. It is almost
      // always a repo-relative link that lost its way, so it is reported rather than guessed at.
      problems.push(`${at}  ${href}  — absolute path; on GitHub this leaves the repository`);
      continue;
    }

    const hash = href.indexOf("#");
    const rawTarget = hash === -1 ? href : href.slice(0, hash);
    const anchor = hash === -1 ? null : href.slice(hash + 1);

    let target;
    try {
      target = decodeURIComponent(rawTarget);
    } catch {
      target = rawTarget;
    }

    // A bare "#anchor" points into the page it is written on.
    const targetAbs = target.length === 0 ? abs : resolve(dirname(abs), target);

    if (!existsExact(targetAbs)) {
      problems.push(`${at}  ${href}  — no such file`);
      continue;
    }

    if (anchor === null || anchor.length === 0) continue;

    // A directory link with an anchor means the README GitHub renders in that directory.
    const isDir = statSync(targetAbs).isDirectory();
    const page = isDir ? join(targetAbs, "README.md") : targetAbs;
    if (!page.toLowerCase().endsWith(".md") || !existsExact(page)) {
      problems.push(`${at}  ${href}  — anchor on something with no headings to point at`);
      continue;
    }

    anchored += 1;
    if (!anchorsOf(page).has(anchor)) {
      problems.push(`${at}  ${href}  — no heading with that anchor`);
    }
  }
}

for (const p of problems) console.log(p);

// The anchor count is in the summary on purpose. A slug rule that quietly stopped matching anything
// would leave this at 0 while the check still printed a clean line, and nobody would look again.
const summary =
  `check:links — ${files.length} file(s), ${checked} relative link(s) checked ` +
  `(${anchored} with an anchor), ${external} external link(s) not checked, ` +
  `${problems.length} broken`;

if (problems.length > 0) {
  console.error(`\n${summary}`);
  process.exit(1);
}

console.log(summary);
