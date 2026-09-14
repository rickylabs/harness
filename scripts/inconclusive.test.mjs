// Both directions of every branch. A guard observed only passing is a guard nobody has seen work,
// and this one guards the distinction between "did not run" and "ran and found a problem", which is
// the distinction the whole module exists to preserve.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { INCONCLUSIVE_EXIT, Inconclusive, inconclusiveRecord, requireExecutableDirectory } from "./inconclusive.mjs";

function scratch() { return mkdtempSync(join(tmpdir(), "inconclusive-guard-")); }

test("inconclusive is not zero, because a gate that did not run is never green", () => {
  assert.equal(INCONCLUSIVE_EXIT, 2);
  assert.notEqual(INCONCLUSIVE_EXIT, 0, "a green inconclusive inverts principle 6");
  assert.notEqual(INCONCLUSIVE_EXIT, 1, "an inconclusive indistinguishable from a failure is the defect");
});

test("a spawn that cannot execute produces Inconclusive, not a failure", () => {
  const directory = scratch();
  try {
    const refusing = () => ({ error: Object.assign(new Error("denied"), { code: "EACCES" }) });
    assert.throws(() => requireExecutableDirectory(directory, refusing), error => {
      assert.ok(error instanceof Inconclusive, "an unrunnable host is not a failing check");
      assert.equal(error.reason, "scratch-not-executable");
      assert.match(error.remedy, /TMPDIR/);
      return true;
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a non-zero probe exit also produces Inconclusive, so a silent noexec cannot pass", () => {
  const directory = scratch();
  try {
    const failing = () => ({ status: 126 });
    assert.throws(() => requireExecutableDirectory(directory, failing), Inconclusive);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("an executable directory passes and is not reported as anything", () => {
  const directory = scratch();
  try {
    assert.doesNotThrow(() => requireExecutableDirectory(directory, () => ({ status: 0 })));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the probe leaves nothing behind on either path", () => {
  const directory = scratch();
  try {
    requireExecutableDirectory(directory, () => ({ status: 0 }));
    assert.deepEqual(readdirSync(directory), [], "the passing path left the probe on disk");
    assert.throws(() => requireExecutableDirectory(directory, () => ({ status: 126 })), Inconclusive);
    assert.deepEqual(readdirSync(directory), [], "the failing path left the probe on disk");
    assert.ok(!existsSync(join(directory, "exec-preflight")));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the record says plainly that nothing was established", () => {
  const record = inconclusiveRecord("some-gate", "some stage", new Inconclusive("a-reason", "a remedy"));
  assert.equal(record.status, "INCONCLUSIVE");
  assert.notEqual(record.status, "FAIL");
  assert.notEqual(record.status, "PASS");
  assert.equal(record.reason, "a-reason");
  assert.match(record.established, /nothing/);
});

test("the record carries no path, so a diagnostic cannot leak one", () => {
  const directory = scratch();
  try {
    const record = inconclusiveRecord("some-gate", "some stage", new Inconclusive("a-reason", "a remedy"));
    const serialised = JSON.stringify(record);
    assert.ok(!serialised.includes(directory), "the record embedded a filesystem path");
    assert.ok(!serialised.includes(tmpdir()), "the record embedded the temp root");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the real host is classified, and whichever way it goes the gate is honest about it", () => {
  const directory = scratch();
  try {
    // No injection: this is the actual filesystem answer for the directory the gate will use.
    let verdict = "executable";
    try { requireExecutableDirectory(directory); } catch (error) {
      assert.ok(error instanceof Inconclusive, "a real exec refusal must classify as inconclusive");
      verdict = error.reason;
    }
    assert.ok(verdict === "executable" || verdict === "scratch-not-executable",
      `unexpected classification: ${verdict}`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
