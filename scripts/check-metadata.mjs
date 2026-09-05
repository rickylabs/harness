#!/usr/bin/env node
/**
 * Compare GitHub's own description of this repository against the one the repository states about
 * itself in `package.json`.
 *
 * The description is the first sentence anyone reads — on the repository page, in search results, in
 * every `gh repo list` — and it is the only piece of documentation here that lives outside the tree,
 * which is exactly why it drifted and stayed drifted. Nothing in a diff shows it. At the time this
 * was written it described the previous project and contradicted two ratified decisions from #30.
 *
 * The fix for *that* is not this script's to make: what the repository should say about itself is an
 * owner decision, recorded as a fork on #140. What this script does is make the disagreement
 * something you can see on demand instead of something you have to remember to look at.
 *
 * ## Why this is not in `build`, and not in CI
 *
 * It is the only check here that needs a network and a credential, and neither is the reason. The
 * reason is that a contributor cannot clear it. The description can only be changed by someone with
 * admin on the repository, so wiring this into the job that gates pull requests would paint every
 * unrelated pull request red until the owner acted — and `ci.yml` already states the principle it
 * would violate: a gate that fails for a reason unrelated to the change under review teaches people
 * to skip the gate. A red CI that everyone has learned to ignore is worse than this script.
 *
 * So it is a command, not a gate: `pnpm run check:metadata`. It is listed in CONTRIBUTING with the
 * other checks, and it prints the exact command that fixes what it found.
 *
 * `package.json` is the source of truth on purpose. It is in the tree, it is reviewed like anything
 * else, and it already carries a `description` that is accurate. That makes the GitHub-side string a
 * *generated* artifact in the same sense as everything else in this repository: something that must
 * be re-derived from what owns it rather than edited where it is displayed.
 *
 * Exit codes, matching `dsh-forge`: 0 they agree, 1 they do not, 2 the check itself broke, 3 no
 * usable GitHub transport — unavailable, which is not the same as passing.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const want = manifest.description;

if (typeof want !== "string" || want.trim().length === 0) {
  console.error("check:metadata — package.json has no `description` to compare against.");
  process.exit(2);
}

/** `owner/name` from the origin remote, the same way `dsh-forge` resolves it. */
const slug = await (async () => {
  try {
    const { stdout } = await run("git", ["remote", "get-url", "origin"], { cwd: ROOT, timeout: 15_000 });
    const m = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\s*$/.exec(stdout);
    return m === null ? null : `${m[1]}/${m[2]}`;
  } catch {
    return null;
  }
})();

if (slug === null) {
  console.error("check:metadata — no github.com origin remote, so there is nothing to compare to.");
  process.exit(3);
}

/**
 * `gh` first, then a REST call with a token. Same order and same reasoning as `dsh-forge`: `gh`
 * carries the credential itself, so the token never has to appear in this process at all.
 */
const fetchDescription = async () => {
  try {
    const { stdout } = await run("gh", ["api", `repos/${slug}`, "--jq", ".description"], {
      timeout: 30_000,
    });
    return { via: "gh", value: stdout.trim() };
  } catch {
    // Fall through. A missing or unauthenticated gh is an ordinary state, not an error.
  }

  const token = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  if (!token) return null;

  const res = await fetch(`https://api.github.com/repos/${slug}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "harness-check-metadata",
    },
  });
  // The status line is safe to print; the token lives only in the header.
  if (!res.ok) {
    console.error(`check:metadata — GitHub answered ${res.status} ${res.statusText} for ${slug}.`);
    process.exit(2);
  }
  const body = await res.json();
  return { via: "GITHUB_TOKEN", value: (body.description ?? "").trim() };
};

const live = await fetchDescription();

if (live === null) {
  console.log(
    "check:metadata — no usable GitHub transport (gh missing or unauthenticated, no GITHUB_TOKEN).\n" +
      "  Nothing was compared. This is exit 3, not a pass.",
  );
  process.exit(3);
}

if (live.value === want.trim()) {
  console.log(`check:metadata — ${slug} describes itself the way package.json does (via ${live.via})`);
  process.exit(0);
}

console.error(`check:metadata — ${slug} and package.json disagree about what this repository is.\n`);
console.error(`  package.json  ${JSON.stringify(want)}`);
console.error(`  GitHub        ${JSON.stringify(live.value)}\n`);
console.error("Only an admin can change the GitHub side. The command is:\n");
console.error(`  gh repo edit ${slug} --description ${JSON.stringify(want)}\n`);
console.error("If package.json is the side that is wrong, change it there and this check follows.");
process.exit(1);
