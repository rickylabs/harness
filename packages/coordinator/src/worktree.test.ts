import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hazards,
  isWithin,
  judge,
  keepFileBody,
  layoutOf,
  misePathFor,
  normalizePath,
  ownerOf,
  parseCensus,
  readCensus,
  sweptByArchiver,
  unprotectedWorktrees,
  unregisteredSessions,
  CENSUS_NOTE_CAP,
  IDLE_LIMIT_HOURS,
  KEEP_FILE,
  PROTECTED_SESSIONS,
  type Census,
  type Judgement,
  type Run,
  type WorktreeFact,
} from "./worktree.js";

const WT = "/home/agent/projects/harness/worktrees/feat-69";

const censusOf = (
  worktrees: readonly WorktreeFact[],
  runs: readonly Run[] = [],
  sessions: readonly string[] = [],
): Census => ({ worktrees, runs, sessions, idleLimitHours: IDLE_LIMIT_HOURS });

const ruleFor = (judged: readonly Judgement[], path: string): string =>
  judged.find((j) => j.path === path)?.rule ?? "missing";

const dispositionFor = (judged: readonly Judgement[], path: string): string =>
  judged.find((j) => j.path === path)?.disposition ?? "missing";

describe("normalizePath", () => {
  it("strips the shapes a cwd actually arrives in", () => {
    assert.equal(normalizePath("/a/b/"), "/a/b");
    assert.equal(normalizePath("/a//b"), "/a/b");
    assert.equal(normalizePath("/a/./b"), "/a/b");
    assert.equal(normalizePath("/a/c/../b"), "/a/b");
    assert.equal(normalizePath("  /a/b  "), "/a/b");
  });

  it("refuses a relative path rather than resolving it against a directory it does not have", () => {
    assert.equal(normalizePath("a/b"), null);
    assert.equal(normalizePath("./a"), null);
    assert.equal(normalizePath(""), null);
  });
});

describe("isWithin", () => {
  it("accepts the directory itself and anything inside it", () => {
    assert.equal(isWithin("/w/feat-69", "/w/feat-69"), true);
    assert.equal(isWithin("/w/feat-69", "/w/feat-69/packages/board"), true);
  });

  it("does not accept a sibling that merely starts with the same characters", () => {
    // The whole reason the separator is in the test. Without it /w/feat-6 "contains" /w/feat-69,
    // and the same rule written the other way round reports a live worktree as unowned.
    assert.equal(isWithin("/w/feat-6", "/w/feat-69"), false);
    assert.equal(isWithin("/w/feat-69", "/w/feat-6"), false);
  });
});

describe("ownerOf", () => {
  it("matches the actual cwd through the shapes it arrives in", () => {
    // This is the case that deletes work. A naive string equality says these two differ, the
    // worktree is judged unowned, and something that removes directories acts on that.
    assert.equal(ownerOf(WT, [{ id: "run-a", cwd: `${WT}/` }])?.id, "run-a");
    assert.equal(ownerOf(WT, [{ id: "run-a", cwd: "/home/agent/projects/harness/./worktrees/feat-69" }])?.id, "run-a");
    assert.equal(ownerOf(WT, [{ id: "run-a", cwd: `${WT}/packages/coordinator` }])?.id, "run-a");
  });

  it("never establishes ownership by name", () => {
    // Same basename, different root. Matching the name would protect the wrong directory and,
    // by the same token, leave the right one looking unclaimed.
    assert.equal(ownerOf(WT, [{ id: "run-a", cwd: "/ephemeral/worktrees/feat-69" }]), null);
  });

  it("never establishes ownership by prefix", () => {
    const sibling = "/home/agent/projects/harness/worktrees/feat-6";
    assert.equal(ownerOf(sibling, [{ id: "run-a", cwd: WT }]), null);
  });

  it("skips a run whose cwd cannot be compared, rather than guessing at it", () => {
    assert.equal(ownerOf(WT, [{ id: "run-a", cwd: null }]), null);
    assert.equal(ownerOf(WT, [{ id: "run-a", cwd: "worktrees/feat-69" }]), null);
  });

  it("returns the first owner when a run and a subprocess are both inside", () => {
    const owner = ownerOf(WT, [
      { id: "run-a", cwd: WT },
      { id: "run-b", cwd: `${WT}/packages` },
    ]);
    assert.equal(owner?.id, "run-a");
  });
});

describe("layoutOf", () => {
  it("reads the project layout the archiver sweeps", () => {
    const layout = layoutOf(WT);
    assert.equal(layout?.kind, "project");
    assert.equal(layout?.project, "harness");
    assert.equal(layout?.name, "feat-69");
    assert.equal(layout?.base, "/home/agent/projects/harness");
  });

  it("reads the nested layout separately, because the archiver's glob does not reach it", () => {
    const layout = layoutOf("/home/agent/projects/harness/repo/worktrees/feat-69");
    assert.equal(layout?.kind, "project-nested");
    assert.equal(layout?.project, "harness");
    assert.equal(layout?.base, "/home/agent/projects/harness");
  });

  it("reads the ephemeral layout", () => {
    const layout = layoutOf("/ephemeral/worktrees/scratch");
    assert.equal(layout?.kind, "ephemeral");
    assert.equal(layout?.project, null);
    assert.equal(layout?.base, null);
  });

  it("returns null for anything it cannot place", () => {
    assert.equal(layoutOf("/home/agent/projects/harness/repo"), null);
    assert.equal(layoutOf("/tmp/scratch"), null);
    assert.equal(layoutOf("projects/harness/worktrees/x"), null);
  });
});

describe("sweptByArchiver", () => {
  it("says yes for the two shapes the globs match and no for the nested one", () => {
    assert.equal(sweptByArchiver(WT), true);
    assert.equal(sweptByArchiver("/ephemeral/worktrees/scratch"), true);
    assert.equal(sweptByArchiver("/home/agent/projects/harness/repo/worktrees/feat-69"), false);
  });
});

describe("misePathFor", () => {
  it("puts the pin at the parent of repo/, outside every checkout", () => {
    assert.equal(misePathFor(WT), "/home/agent/projects/harness/.mise.toml");
  });

  it("has nowhere to put it for an ephemeral worktree", () => {
    assert.equal(misePathFor("/ephemeral/worktrees/scratch"), null);
  });
});

describe("judge", () => {
  it("protects a worktree a run is actually in, however the cwd was written", () => {
    const judged = judge(
      censusOf([{ path: WT, keepFile: false, idleHours: 200 }], [{ id: "run-a", cwd: `${WT}/packages` }]),
    );
    assert.equal(dispositionFor(judged, WT), "protect");
    assert.equal(ruleFor(judged, WT), "owned");
    assert.equal(judged[0]?.owner, "run-a");
  });

  it("honours an existing keep file without re-litigating it", () => {
    const judged = judge(censusOf([{ path: WT, keepFile: true, idleHours: 200 }]));
    assert.equal(ruleFor(judged, WT), "keep-file");
    assert.equal(dispositionFor(judged, WT), "protect");
  });

  it("sweeps nothing at all when any run's cwd could not be read", () => {
    // Not knowing removes the ability to prove a worktree unowned. It does not license a deletion.
    const judged = judge(
      censusOf([{ path: WT, keepFile: false, idleHours: 200 }], [{ id: "run-a", cwd: null }]),
    );
    assert.equal(ruleFor(judged, WT), "unknown-cwd");
    assert.equal(dispositionFor(judged, WT), "protect");
    assert.equal(judged.filter((j) => j.disposition === "sweep").length, 0);
  });

  it("still recognises an owner while another run is unreadable", () => {
    const judged = judge(
      censusOf(
        [{ path: WT, keepFile: false, idleHours: 200 }],
        [
          { id: "run-blind", cwd: null },
          { id: "run-a", cwd: WT },
        ],
      ),
    );
    assert.equal(ruleFor(judged, WT), "owned");
  });

  it("leaves a worktree the archiver cannot see, and asks for no keep file there", () => {
    const nested = "/home/agent/projects/harness/repo/worktrees/feat-69";
    const judged = judge(censusOf([{ path: nested, keepFile: false, idleHours: 500 }]));
    assert.equal(ruleFor(judged, nested), "unswept");
    assert.equal(dispositionFor(judged, nested), "leave");
  });

  it("protects a worktree whose age is unknown", () => {
    const judged = judge(censusOf([{ path: WT, keepFile: false, idleHours: null }]));
    assert.equal(ruleFor(judged, WT), "unknown-age");
    assert.equal(dispositionFor(judged, WT), "protect");
  });

  it("leaves a fresh worktree and sweeps a stale unowned one", () => {
    const judged = judge(
      censusOf([
        { path: `${WT}-fresh`, keepFile: false, idleHours: 47 },
        { path: `${WT}-stale`, keepFile: false, idleHours: 49 },
      ]),
    );
    assert.equal(ruleFor(judged, `${WT}-fresh`), "fresh");
    assert.equal(dispositionFor(judged, `${WT}-stale`), "sweep");
  });

  it("refuses to place a path it does not recognise, instead of falling through to sweep", () => {
    const judged = judge(censusOf([{ path: "/tmp/somewhere", keepFile: false, idleHours: 900 }]));
    assert.equal(ruleFor(judged, "/tmp/somewhere"), "off-layout");
    assert.equal(dispositionFor(judged, "/tmp/somewhere"), "protect");
  });

  it("respects a census that widens the idle window", () => {
    const wide: Census = { ...censusOf([{ path: WT, keepFile: false, idleHours: 60 }]), idleLimitHours: 96 };
    assert.equal(ruleFor(judge(wide), WT), "fresh");
  });

  it("judges every worktree, in the order it was given", () => {
    const paths = [`${WT}-a`, `${WT}-b`, `${WT}-c`];
    const judged = judge(censusOf(paths.map((path) => ({ path, keepFile: false, idleHours: 1 }))));
    assert.deepEqual(
      judged.map((j) => j.path),
      paths,
    );
  });
});

describe("hazards", () => {
  it("reports a live worktree the archiver can reach and that has no keep file", () => {
    const census = censusOf([{ path: WT, keepFile: false, idleHours: 200 }], [{ id: "run-a", cwd: WT }]);
    const found = hazards(census, judge(census));
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "unprotected");
    assert.equal(found[0]?.subject, WT);
    assert.match(found[0]?.detail ?? "", /run-a is working here/);
  });

  it("reports nothing for a live worktree the archiver cannot reach", () => {
    const nested = "/home/agent/projects/harness/repo/worktrees/feat-69";
    const census = censusOf([{ path: nested, keepFile: false, idleHours: 200 }], [{ id: "run-a", cwd: nested }]);
    assert.deepEqual(hazards(census, judge(census)), []);
  });

  it("reports nothing once the keep file is there", () => {
    const census = censusOf([{ path: WT, keepFile: true, idleHours: 200 }], [{ id: "run-a", cwd: WT }]);
    assert.deepEqual(hazards(census, judge(census)), []);
  });

  it("reports a coordinator session the archiver has never been told about", () => {
    const census = censusOf([], [], ["harness-coord", "rc"]);
    const found = hazards(census, judge(census));
    assert.equal(found.length, 1);
    assert.equal(found[0]?.rule, "unregistered-session");
    assert.equal(found[0]?.subject, "harness-coord");
  });

  it("reports an unplaceable path, because a layout nobody can read is not a layout", () => {
    const census = censusOf([{ path: "/tmp/somewhere", keepFile: false, idleHours: 900 }]);
    assert.equal(hazards(census, judge(census))[0]?.rule, "off-layout");
  });
});

describe("unprotectedWorktrees", () => {
  it("names exactly the directories that need a keep file written", () => {
    const census = censusOf(
      [
        { path: `${WT}-a`, keepFile: false, idleHours: 200 },
        { path: `${WT}-b`, keepFile: true, idleHours: 200 },
        { path: `${WT}-c`, keepFile: false, idleHours: 200 },
      ],
      [
        { id: "run-a", cwd: `${WT}-a` },
        { id: "run-b", cwd: `${WT}-b` },
      ],
    );
    assert.deepEqual(unprotectedWorktrees(census, judge(census)), [`${WT}-a`]);
  });
});

describe("unregisteredSessions", () => {
  it("passes the names the archiver already protects", () => {
    assert.deepEqual(unregisteredSessions(PROTECTED_SESSIONS), []);
  });

  it("names the ones it does not", () => {
    assert.deepEqual(unregisteredSessions(["rc", "harness-coord"]), ["harness-coord"]);
  });
});

describe("keepFileBody", () => {
  it("says who wrote it and when, so it is not mistaken for litter", () => {
    const body = keepFileBody("run-a", "2026-09-05T00:00:00Z");
    assert.match(body, /run: run-a/);
    assert.match(body, /at: 2026-09-05T00:00:00Z/);
    assert.match(body, new RegExp(KEEP_FILE));
  });
});

describe("readCensus", () => {
  it("refuses something that is not a census", () => {
    assert.equal(parseCensus("nonsense").census, null);
    assert.equal(readCensus([]).census, null);
    assert.equal(readCensus({ worktrees: [] }).census, null);
    assert.equal(readCensus({ runs: [] }).census, null);
  });

  it("keeps a run it cannot read, because dropping one makes the sweep list longer", () => {
    const parsed = readCensus({ runs: [{ cwd: WT }, { id: "run-b" }], worktrees: [] });
    assert.equal(parsed.census?.runs.length, 2);
    // The unnamed one keeps its cwd: the missing field is the label, not the claim.
    assert.equal(parsed.census?.runs[0]?.id, "run-0");
    assert.equal(parsed.census?.runs[0]?.cwd, WT);
    assert.equal(parsed.census?.runs[1]?.cwd, null);
    assert.match(parsed.notes.join("\n"), /run 0 has no id/);
    assert.match(parsed.notes.join("\n"), /run-b has no readable cwd/);
  });

  it("still lets an unnamed run own a worktree", () => {
    const parsed = readCensus({ runs: [{ cwd: WT }], worktrees: [{ path: WT, idleHours: 200 }] });
    const census = parsed.census;
    assert.ok(census !== null);
    assert.equal(judge(census)[0]?.rule, "owned");
  });

  it("notes a cwd it cannot compare and keeps the run", () => {
    const parsed = readCensus({ runs: [{ id: "run-a", cwd: "worktrees/x" }], worktrees: [] });
    assert.equal(parsed.census?.runs.length, 1);
    assert.match(parsed.notes.join("\n"), /relative cwd/);
  });

  it("drops a worktree with no path and a repeat of one it already has", () => {
    const parsed = readCensus({
      runs: [],
      worktrees: [{ path: WT }, {}, { path: WT, keepFile: true }],
    });
    assert.equal(parsed.census?.worktrees.length, 1);
    assert.equal(parsed.census?.worktrees[0]?.keepFile, false);
    assert.match(parsed.notes.join("\n"), /repeats/);
  });

  it("treats a missing or unusable idleHours as unknown rather than as zero", () => {
    const parsed = readCensus({ runs: [], worktrees: [{ path: WT, idleHours: "old" }] });
    assert.equal(parsed.census?.worktrees[0]?.idleHours, null);
  });

  it("defaults the idle window and accepts a positive override", () => {
    assert.equal(readCensus({ runs: [], worktrees: [] }).census?.idleLimitHours, IDLE_LIMIT_HOURS);
    assert.equal(readCensus({ runs: [], worktrees: [], idleLimitHours: 96 }).census?.idleLimitHours, 96);
    assert.equal(readCensus({ runs: [], worktrees: [], idleLimitHours: -1 }).census?.idleLimitHours, IDLE_LIMIT_HOURS);
  });

  it("reads sessions and ignores entries that are not names", () => {
    const parsed = readCensus({ runs: [], worktrees: [], sessions: ["rc", 7, "", "harness-coord"] });
    assert.deepEqual(parsed.census?.sessions, ["rc", "harness-coord"]);
  });

  it("names the first few problems and stops, so one bad file is not a wall of text", () => {
    const worktrees = Array.from({ length: CENSUS_NOTE_CAP + 4 }, () => ({}));
    const parsed = readCensus({ runs: [], worktrees });
    assert.equal(parsed.notes.length, CENSUS_NOTE_CAP);
  });
});
