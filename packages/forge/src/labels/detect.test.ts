import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { detectLanePrefix, detectRepoLabels, detectSkillDirs, epicSlug } from "./detect.js";
import type { GitHubTransport, IssueRef } from "./github.js";

/** A transport that answers from memory, so detection is testable without a network. */
const fakeTransport = (issues: readonly IssueRef[]): GitHubTransport => ({
  kind: "rest",
  authNote: "fake",
  listLabels: async () => [],
  createLabel: async () => {},
  updateLabel: async () => {},
  listMilestones: async () => [],
  searchIssues: async () => issues,
});

const names = (labels: readonly { name: string }[]): string[] => labels.map((l) => l.name).sort();

describe("detectRepoLabels", () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "dsh-forge-"));

    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      ["packages:", "  - packages/*", "  - 'tools/*'"].join("\n"),
      "utf8",
    );

    // Two real packages, one directory that only looks like one.
    for (const pkg of ["forge", "board"]) {
      await mkdir(join(root, "packages", pkg), { recursive: true });
      await writeFile(join(root, "packages", pkg, "package.json"), "{}", "utf8");
    }
    await mkdir(join(root, "packages", "not-a-package"), { recursive: true });
    await mkdir(join(root, "tools", "cli"), { recursive: true });
    await writeFile(join(root, "tools", "cli", "deno.json"), "{}", "utf8");

    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await writeFile(join(root, ".github", "workflows", "ci.yml"), "name: CI\n", "utf8");
    await writeFile(join(root, ".github", "workflows", "e2e.yml"), "name: E2E\n", "utf8");
    await writeFile(join(root, ".github", "workflows", "slow.yml"), "name: Nightly soak\n", "utf8");

    await mkdir(join(root, ".llm", "runs", "m1"), { recursive: true });
    await writeFile(
      join(root, ".llm", "runs", "m1", "milestone-cluster-state.json"),
      JSON.stringify({ lanes: [{ id: "w0-docs" }, { id: "w0-internals" }, { id: "w0-docs" }] }),
      "utf8",
    );

    await mkdir(join(root, ".claude", "skills"), { recursive: true });
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("proposes an area only for directories that are really packages", async () => {
    const result = await detectRepoLabels({
      repoRoot: root,
      repo: "owner/repo",
      transport: null,
      existing: [],
      families: ["area"],
    });
    assert.deepEqual(names(result.labels), ["area:board", "area:cli", "area:forge"]);
  });

  it("points at the evidence for everything it proposes", async () => {
    const result = await detectRepoLabels({
      repoRoot: root,
      repo: "owner/repo",
      transport: null,
      existing: [],
      families: ["area"],
    });
    const forge = result.evidence.find((e) => e.label === "area:forge");
    assert.equal(forge?.source, "packages/forge");
  });

  it("gates only the expensive workflows, and always offers ci:full", async () => {
    const result = await detectRepoLabels({
      repoRoot: root,
      repo: "owner/repo",
      transport: null,
      existing: [],
      families: ["gate"],
    });
    assert.deepEqual(names(result.labels), [
      "ci:full",
      "ci:skip-e2e",
      "ci:skip-slow",
      "gate:e2e",
      "gate:slow",
    ]);
  });

  it("takes lane ids from the cluster state, de-duplicated", async () => {
    const result = await detectRepoLabels({
      repoRoot: root,
      repo: "owner/repo",
      transport: null,
      existing: [],
      families: ["lane"],
    });
    assert.deepEqual(names(result.labels), ["lane:w0-docs", "lane:w0-internals"]);
  });

  it("adopts the lane prefix the repository already uses", async () => {
    const result = await detectRepoLabels({
      repoRoot: root,
      repo: "owner/repo",
      transport: null,
      existing: [{ name: "topic:docs", color: "ffffff", description: "" }],
      families: ["lane"],
    });
    assert.deepEqual(names(result.labels), ["topic:w0-docs", "topic:w0-internals"]);
  });

  it("derives epics from open umbrella issues, stripping the title's prefix", async () => {
    const result = await detectRepoLabels({
      repoRoot: root,
      repo: "owner/repo",
      transport: fakeTransport([
        { number: 36, title: "Epic: Board projection", labels: [] },
        { number: 37, title: "GitHub bridge", labels: [] },
      ]),
      existing: [],
      families: ["epic"],
    });
    assert.deepEqual(names(result.labels), ["epic:board-projection", "epic:github-bridge"]);
  });

  it("names the epic it dropped to a collision instead of letting it vanish", async () => {
    // First-wins de-duplication is right; doing it silently is not. The dropped epic's tasks end
    // up under another epic's label, and the only signal was an absence in a list nobody diffs.
    const shared = "Coordinator workflows and the board projection surface for";
    const result = await detectRepoLabels({
      repoRoot: root,
      repo: "owner/repo",
      transport: fakeTransport([
        { number: 501, title: `${shared} the first team`, labels: [] },
        { number: 502, title: `${shared} the second team`, labels: [] },
      ]),
      existing: [],
      families: ["epic"],
    });

    // The slugs are distinct now, so both survive — which is the fix. Were they to collide, the
    // note below is what tells the operator, and one of the two labels would be absent.
    assert.equal(result.labels.length, 2, "distinct titles collapsed into one epic label");
    assert.notEqual(names(result.labels)[0], names(result.labels)[1]);
  });

  it("reports a genuine collision rather than skipping the second issue", async () => {
    const result = await detectRepoLabels({
      repoRoot: root,
      repo: "owner/repo",
      transport: fakeTransport([
        { number: 601, title: "E6 — Coordinator", labels: [] },
        { number: 602, title: "E6 — something else entirely", labels: [] },
      ]),
      existing: [],
      families: ["epic"],
    });

    assert.deepEqual(names(result.labels), ["epic:e6"]);
    assert.match(result.notes.join("\n"), /#602: slug `e6` already claimed by #601/);
  });

  it("says why, rather than proposing nothing silently, when there is no evidence", async () => {
    const bare = await mkdtemp(join(tmpdir(), "dsh-forge-bare-"));
    try {
      const result = await detectRepoLabels({
        repoRoot: bare,
        repo: "owner/repo",
        transport: null,
        existing: [],
      });
      assert.deepEqual(result.labels, []);
      const notes = result.notes.join("\n");
      assert.match(notes, /no workspace manifest/);
      assert.match(notes, /no \.github\/workflows/);
      assert.match(notes, /no milestone cluster state/);
      assert.match(notes, /no GitHub transport/);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("finds the skill directory the repository already has", async () => {
    assert.deepEqual(await detectSkillDirs(root), [".claude/skills"]);
  });
});

describe("detectLanePrefix", () => {
  const label = (name: string) => ({ name, color: "ffffff", description: "" });

  it("adopts the prefix already in use", () => {
    assert.equal(detectLanePrefix([label("topic:docs")]), "topic");
    assert.equal(detectLanePrefix([label("orchestrator:w0")]), "orchestrator");
  });

  it("picks the prefix with the most labels when a repo carries two", () => {
    const both = [
      label("topic:docs"),
      label("topic:features"),
      label("topic:internals"),
      label("lane:n5"),
      label("lane:joint"),
    ];
    assert.equal(detectLanePrefix(both), "topic");
    assert.equal(detectLanePrefix([...both, label("lane:a"), label("lane:b")]), "lane");
  });

  it("breaks a tie the same way every run", () => {
    const tied = [label("topic:docs"), label("lane:n5")];
    assert.equal(detectLanePrefix(tied), "topic");
    assert.equal(detectLanePrefix([...tied].reverse()), "topic");
  });

  it("falls back to lane: rather than inventing a rival prefix", () => {
    assert.equal(detectLanePrefix([label("type:feat")]), "lane");
    assert.equal(detectLanePrefix([]), "lane");
  });
});

describe("epicSlug", () => {
  it("prefers the identifier the title already carries", () => {
    assert.equal(epicSlug("E6 · Coordinator workflows — task DAG, board projection"), "e6");
    assert.equal(epicSlug("Epic: E10 — Something else entirely"), "e10");
  });

  it("falls back to the title, cut at a word boundary rather than mid-word", () => {
    const slug = epicSlug("Contracts: a published package for the netscript user interfaces");
    assert.ok(slug.length <= 40);
    assert.ok(!slug.endsWith("-"), "left a trailing dash");
    assert.ok(!slug.endsWith("interfac"), "cut a word in half");
  });

  it("does not mistake a word for an identifier", () => {
    assert.equal(epicSlug("Board projection"), "board-projection");
  });
});
