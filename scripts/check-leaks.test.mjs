// Fixtures are assembled at runtime: a whole leak string here would make check:leaks flag this file.
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
    ["", "home", "someone", "x"].join("/"), ["", "Users", "someone", "x"].join("/"),
    "cd " + ["", "home", "someone"].join("/"), "(" + ["", "Users", "someone"].join("/") + ")",
    ...["Users", "users"].map(dir => ["C:", dir, "someone"].join("\\")), ["d:", "UsErS", "someone"].join("/"),
  ]],
  ["data-path", [["", "mnt", "disk", "x"].join("/"), ["", "ephemeral", "work", ""].join("/"), "`" + ["", "data"].join("/") + "`"]],
  ["private-ipv4", [[10, 1, 2, 3], [192, 168, 0, 9], [172, 16, 0, 1], [100, 64, 0, 1]].map(ip => ip.join("."))],
  ["host-port", [["localhost", 8080].join(":"), ["localhost", 9].join(":"), url(["example", "com"].join("."), 443),
    url("worker", 8080), "-" + url("worker", 8081), "endpoint " + ["api", "example", "com"].join(".") + ":" + 8443,
    "proxy " + ["worker", 8080].join(":"), "jump " + ["bastion", 22].join(":")]],
  ["tailnet-host", ["node." + "tail" + "1a2b" + ".ts.net"]],
  ["token-shape", ["gh" + "p_" + "a".repeat(36), "github" + "_pat_" + "b".repeat(30), "sk" + "-" + "c".repeat(24),
    "Bear" + "er " + "d".repeat(24)]],
  ["private-key", ["-".repeat(5) + "BEGIN OPENSSH PRIVATE KEY" + "-".repeat(5)]],
  ["session-id", ["session_id = " + uuid, uuid + " is the session", "Session (" + uuid + ")",
    "session `" + uuid + "`", JSON.stringify({ session: { id: uuid } })]],
];

function git(cwd, ...args) {
  const run = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, env });
  assert.equal(run.status, 0, `git ${args[0]} failed`);
}

function repo(t, files, before = {}) { // `before` committed on main, then `files` committed on feature
  const dir = mkdtempSync(join(tmpdir(), "check-leaks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = entries => Object.entries(entries).forEach(([path, content]) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true }), writeFileSync(join(dir, path), content);
  });
  const commit = (entries, message) => (write(entries), git(dir, "add", "-A"), git(dir, "commit", "-q", "--allow-empty", "-m", message));
  git(dir, "init", "-q", "-b", "main"), commit({ "README.md": "base\n", ...before }, "base");
  git(dir, "checkout", "-q", "-b", "feature"), commit(files, "change");
  return dir;
}

function scan(cwd, args = ["--base", "main"], timeout) {
  const run = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8", timeout });
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
  const benign = ["see src/data/x, ./mnt/ and lib/home/x for details", "scripts/x.mjs:42 and README.md:12 and src/a.test.ts:1234",
    "key: 1 with a space, version 10.2, at 21:20, stamped 2026-10-08T21:43:00Z", "https://example.com/path without a port",
    "the session ended", "sk-x"];
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
  git(dir, "mv", "old.txt", "new.txt"), writeFileSync(join(dir, "new.txt"), "one\ntwo\n" + ["localhost", 5].join(":") + "\nthree\nfour\n");
  git(dir, "commit", "-q", "-am", "rename");
  assert.deepEqual(scan(dir).findings, ["new.txt:3 host-port"]);
});

test("an added line that starts with ++ is content, not a file header", t => {
  assert.deepEqual(scan(repo(t, { "x.txt": "++ " + ["localhost", 7].join(":") + "\n" })).findings, ["x.txt:1 host-port"]);
});

test("diff.noprefix and diff.mnemonicPrefix in the repository cannot hide a finding", t => {
  const dir = repo(t, { "x.txt": ["localhost", 8080].join(":") + "\n" });
  git(dir, "config", "diff.noprefix", "true"), git(dir, "config", "diff.mnemonicPrefix", "true");
  const result = scan(dir);
  assert.deepEqual([result.status, result.findings], [1, ["x.txt:1 host-port"]]);
});

test("the parser refuses a header without b/ or a hunk cut short, and counts context lines", () => {
  assert.throws(() => addedLines("+++ x.txt\n@@ -0,0 +1 @@\n+text\n"), /unexpected file header/);
  assert.deepEqual(addedLines("+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n"), []);
  assert.throws(() => addedLines("diff --git a/x b/x\nBinary files /dev/null and b/x differ\n"), /binary record/);
  const fused = addedLines("+++ b/a\n@@ -1,3 +1,3 @@\n-1\n+X\n 2\n-3\n+Y\n+++ b/b\n@@ -0,0 +1 @@\n+Z\n");
  assert.deepEqual(fused.map(({ path, line, text }) => [path, line, text]), [["a", 1, "X"], ["a", 3, "Y"], ["b", 1, "Z"]]);
  assert.throws(() => addedLines("+++ b/a\n@@ -1,2 +1,2 @@\n-1\n+X\ndiff --git a/b b/b\n"), /hunk ended early/);
});

test("diff.interHunkContext in the repository cannot move a finding into the wrong file or line", t => {
  const dir = repo(t, {}, { "a.txt": "1\n2\n3\n4\n5\n", "b.txt": "\n" });
  git(dir, "config", "diff.interHunkContext", "2");
  writeFileSync(join(dir, "a.txt"), "1\nX\n3\n" + ["localhost", 4].join(":") + "\n5\n");
  writeFileSync(join(dir, "b.txt"), ["localhost", 8080].join(":") + "\n");
  git(dir, "commit", "-q", "-am", "edit");
  assert.deepEqual(scan(dir).findings, ["a.txt:4 host-port", "b.txt:1 host-port"]);
});

test("binary attributes, NUL bytes, UTF-16 and a textconv driver cannot hide an added line", t => {
  const token = "gh" + "p_" + "e".repeat(36), home = ["", "home", "someone"].join("/");
  const dir = repo(t, { ".gitattributes": "*.txt -diff\n*.json diff=hide\n", "attr.txt": token + "\n", "conv.json": token + "\n",
    "nul.sh": "\0" + token + "\n", "wide.yml": Buffer.from("x\n" + home + "\n", "utf16le") });
  git(dir, "config", "diff.hide.textconv", "true");
  const result = scan(dir);
  assert.deepEqual([result.status, result.err], [1, ""]);
  assert.deepEqual(result.findings, ["attr.txt:1 token-shape", "conv.json:1 token-shape", "nul.sh:1 token-shape", "wide.yml:2 home-path"]);
  assert.ok(!result.out.includes(token) && !result.out.includes(home), "matched text was printed");
});

test("a long line is scanned in linear time: a clean one stays clean, a leak at its end is still found", t => {
  // The quadratic patterns these replace took minutes on lines this long; the bound is per scan, not a benchmark.
  const dir = repo(t, { "clean.txt": ["a".repeat(400000), "a-".repeat(150000), "a.".repeat(150000)].join(" ") + "\n" });
  const clean = scan(dir, undefined, 5000);
  assert.deepEqual([clean.status, clean.out, clean.err], [0, "", ""]);
  writeFileSync(join(dir, "leak.txt"), "a".repeat(200000) + " " + url("worker", 8080) + "\n"), git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "leak");
  const leak = scan(dir, undefined, 5000);
  assert.deepEqual([leak.status, leak.err, leak.findings], [1, "", ["leak.txt:1 host-port"]]);
});

test("the -- that pnpm forwards is tolerated", t => {
  const result = scan(repo(t, { "x.txt": "fine\n" }), ["--", "--base", "main"]);
  assert.deepEqual([result.status, result.findings], [0, []]);
});

test("an unresolvable base is inconclusive (exit 2) and never echoes the base it was given", t => {
  const base = ["", "home", "someone", "ref"].join("/");
  const result = scan(repo(t, { "x.txt": "fine\n" }), ["--base", base]);
  assert.deepEqual([result.status, result.out], [2, ""]);
  assert.equal(result.err, "check:leaks inconclusive: git diff failed\n", "only the fixed diagnostic, never the caller's base");
});
