// Every fixture below is assembled at runtime. A literal leak string in this file would make
// `check:leaks` flag the pull request that adds its own test, so no line here holds one whole.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { addedLines } from "./check-leaks.mjs";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "check-leaks.mjs");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const uuid = ["0123abcd", "4567", "89ab", "cdef", "0123456789ab"].join("-");
const url = (host, port) => ["http", "://", host, ":", port, "/"].join("");

/** One entry per DETECTORS row. Each line trips exactly that row, so removing it cannot be masked. */
const FAMILIES = [
  ["home-path", [
    ["", "home", "someone", "x"].join("/"),
    ["", "Users", "someone", "x"].join("/"),
    "C:" + "\\Users\\" + "someone",
    "cd " + ["", "home", "someone"].join("/"),
    "(" + ["", "Users", "someone"].join("/") + ")",
  ]],
  ["data-path", [["", "mnt", "disk", "x"].join("/"), ["", "ephemeral", "work", ""].join("/"), "`" + ["", "data"].join("/") + "`"]],
  ["private-ipv4", [[10, 1, 2, 3], [192, 168, 0, 9], [172, 16, 0, 1], [100, 64, 0, 1]].map(ip => ip.join("."))],
  ["host-port", [
    ["localhost", 8080].join(":"),
    ["localhost", 9].join(":"),
    url(["example", "com"].join("."), 443),
    url("worker", 8080),
    "endpoint " + ["api", "example", "com"].join(".") + ":" + 8443,
    "proxy " + ["worker", 8080].join(":"),
  ]],
  ["tailnet-host", ["node." + "tail" + "1a2b" + ".ts.net"]],
  ["token-shape", [
    "gh" + "p_" + "a".repeat(36),
    "github" + "_pat_" + "b".repeat(30),
    "sk" + "-" + "c".repeat(24),
    "Bear" + "er " + "d".repeat(24),
  ]],
  ["private-key", ["-".repeat(5) + "BEGIN OPENSSH PRIVATE KEY" + "-".repeat(5)]],
  ["session-id", ["session_id = " + uuid, uuid + " is the session", "Session (" + uuid + ")",
    "session `" + uuid + "`", JSON.stringify({ session: { id: uuid } })]],
];

function git(cwd, ...args) {
  const run = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd, env, encoding: "utf8" });
  assert.equal(run.status, 0, `git ${args[0]} failed`);
}

/** A repository with one commit on `main` and `files` committed on top of it on `feature`. */
function repo(t, files, before = {}) {
  const dir = mkdtempSync(join(tmpdir(), "check-leaks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = entries => {
    for (const [path, content] of Object.entries(entries)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
  };
  git(dir, "init", "-q", "-b", "main");
  write({ "README.md": "base\n", ...before });
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "feature");
  write(files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", "change");
  return dir;
}

function scan(cwd, args = ["--base", "main"]) {
  const run = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8" });
  return { status: run.status, out: run.stdout, err: run.stderr, findings: run.stdout.split("\n").filter(Boolean) };
}

for (const [reason, lines] of FAMILIES) {
  test(`${reason}: every fixture line is reported with that reason and never echoed`, t => {
    const result = scan(repo(t, { "leak.txt": lines.join("\n") + "\n" }));
    assert.deepEqual([result.status, result.err], [1, ""]);
    assert.deepEqual(result.findings, lines.map((_, i) => `leak.txt:${i + 1} ${reason}`));
    for (const line of lines) assert.ok(!(result.out + result.err).includes(line), "matched text was printed");
  });
}

test("a clean diff exits 0 with both streams empty, near-misses included", t => {
  const benign = [
    "see src/data/x, ./mnt/ and lib/home/x for details",
    "scripts/x.mjs:42 and README.md:12 and src/a.test.ts:1234",
    "image node:20, redis:7, retries:3, version 10.2, at 21:20",
    "https://example.com/path without a port",
    "the session ended",
    "sk-x",
  ];
  const result = scan(repo(t, { "clean.txt": benign.join("\n") + "\n" }));
  assert.deepEqual([result.status, result.out, result.err], [0, "", ""]);
});

test("owner-controlled run records and the lockfile are not scanned", t => {
  const leak = ["", "home", "someone", ""].join("/") + "\n";
  const result = scan(repo(t, { [join(".llm", "runs", "r", "x.md")]: leak, "pnpm-lock.yaml": leak }));
  assert.deepEqual([result.status, result.findings], [0, []]);
});

test("a renamed file with an added line is reported under its new path", t => {
  const dir = repo(t, {}, { "old.txt": "one\ntwo\nthree\nfour\n" });
  git(dir, "mv", "old.txt", "new.txt");
  writeFileSync(join(dir, "new.txt"), "one\ntwo\n" + ["localhost", 5].join(":") + "\nthree\nfour\n");
  git(dir, "commit", "-q", "-am", "rename");
  assert.deepEqual(scan(dir).findings, ["new.txt:3 host-port"]);
});

test("an added line that starts with ++ is content, not a file header", t => {
  const result = scan(repo(t, { "x.txt": "++ " + ["localhost", 7].join(":") + "\n" }));
  assert.deepEqual(result.findings, ["x.txt:1 host-port"]);
});

test("diff.noprefix and diff.mnemonicPrefix in the repository cannot hide a finding", t => {
  const dir = repo(t, { "x.txt": ["localhost", 8080].join(":") + "\n" });
  git(dir, "config", "diff.noprefix", "true");
  git(dir, "config", "diff.mnemonicPrefix", "true");
  const result = scan(dir);
  assert.deepEqual([result.status, result.findings], [1, ["x.txt:1 host-port"]]);
});

test("a file header without the b/ prefix is refused rather than skipped", () => {
  assert.throws(() => addedLines("+++ x.txt\n@@ -0,0 +1 @@\n+text\n"), /unexpected file header/);
  assert.deepEqual(addedLines("+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n"), []);
});

test("the -- that pnpm forwards is tolerated", t => {
  const result = scan(repo(t, { "x.txt": "fine\n" }), ["--", "--base", "main"]);
  assert.deepEqual([result.status, result.findings], [0, []]);
});

test("an unresolvable base is inconclusive (exit 2) and never echoes the base it was given", t => {
  const base = ["", "home", "someone", "ref"].join("/");
  const result = scan(repo(t, { "x.txt": "fine\n" }), ["--base", base]);
  assert.deepEqual([result.status, result.out], [2, ""]);
  assert.ok(!result.err.includes(base), "the caller's base was printed");
  assert.equal(result.err, "check:leaks inconclusive: git diff failed\n");
});
