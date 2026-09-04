/**
 * The CLI's negative controls.
 *
 * These exercise `main` itself against a recording transport, because the claims they cover are
 * claims about what the command *does not* do — no writes under `--dry-run`, no apply over a
 * labels file the parser could not read. A test that reimplements the command would prove the
 * reimplementation instead, and every one of these fixes exists because that gap let a real defect
 * through review with a green suite behind it.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { main } from "./cli.js";
import { LABELS_FILE } from "./labels/file.js";
import type { ExistingLabel, TransportProbe } from "./labels/github.js";

interface Recorder {
  readonly mutations: { kind: "create" | "update"; name: string }[];
  labels: ExistingLabel[];
  probe(): Promise<TransportProbe>;
}

function recorder(initial: readonly ExistingLabel[] = []): Recorder {
  const rec: Recorder = {
    mutations: [],
    labels: [...initial],
    probe: async () => ({
      kind: "gh" as const,
      authNote: "in-memory fixture",
      listLabels: async () => rec.labels,
      createLabel: async (_repo: string, label: ExistingLabel) => {
        rec.mutations.push({ kind: "create", name: label.name });
        rec.labels.push(label);
      },
      updateLabel: async (_repo: string, name: string, label: ExistingLabel) => {
        rec.mutations.push({ kind: "update", name });
        rec.labels = rec.labels.map((l) => (l.name === name ? label : l));
      },
      listMilestones: async () => [],
      searchIssues: async () => [],
    }),
  };
  return rec;
}

let root: string;
let silence: () => void;
let restore: () => void;

before(() => {
  const write = process.stdout.write.bind(process.stdout);
  silence = () => {
    process.stdout.write = (() => true) as typeof process.stdout.write;
  };
  restore = () => {
    process.stdout.write = write;
  };
});

after(() => {
  restore();
});

beforeEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = await mkdtemp(join(tmpdir(), "dsh-forge-"));
});

/** Run the real entry point with output suppressed, so a failing assert stays readable. */
async function run(argv: readonly string[], rec: Recorder): Promise<number> {
  silence();
  try {
    return await main(argv, { probeTransport: rec.probe });
  } finally {
    restore();
  }
}

const base = (): readonly string[] => ["--repo", "owner/repo", "--cwd", root, "--no-detect", "--json"];

const exists = async (path: string): Promise<boolean> =>
  readFile(path, "utf8").then(
    () => true,
    () => false,
  );

describe("--dry-run", () => {
  it("makes init write nothing and send nothing", async () => {
    // The flag reached skill installation and nothing else: init ejected a real file and sent 28
    // label mutations against a repository the operator was only inspecting.
    const rec = recorder();
    const code = await run(["init", "--dry-run", ...base()], rec);

    assert.equal(rec.mutations.length, 0, `sent ${rec.mutations.length} mutation(s) under --dry-run`);
    assert.equal(await exists(join(root, LABELS_FILE)), false, `wrote ${LABELS_FILE} under --dry-run`);
    assert.equal(code, 0);
  });

  it("makes labels apply send nothing", async () => {
    const rec = recorder();
    await run(["labels", "apply", "--dry-run", ...base()], rec);
    assert.deepEqual(rec.mutations, []);
  });

  it("makes labels eject write nothing", async () => {
    const rec = recorder();
    await run(["labels", "eject", "--dry-run", ...base()], rec);
    assert.equal(await exists(join(root, LABELS_FILE)), false);
  });

  it("still applies without the flag — the control above is not vacuous", async () => {
    const rec = recorder();
    const code = await run(["init", ...base()], rec);
    assert.ok(rec.mutations.length > 0, "the real run sent nothing, so the dry-run control proves nothing");
    assert.equal(await exists(join(root, LABELS_FILE)), true);
    assert.equal(code, 0);
  });
});

describe("an unusable labels file", () => {
  const broken = ['- name: "custom:ok"', '  color: "not-a-color"', '  description: "desired"', ""].join("\n");

  /** Written per-test rather than in a hook, so the last case can run without it. */
  async function withBrokenFile(): Promise<void> {
    await mkdir(join(root, ".github"), { recursive: true });
    await writeFile(join(root, LABELS_FILE), broken, "utf8");
  }

  it("blocks check even when the repository itself is in sync", async () => {
    // The defect: `labels check` returned 0 for a file its own parser had marked invalid, because
    // the plan compared against the truncated parse and agreed with it. The repository must
    // therefore be *clean* for this control to mean anything — otherwise the 1 is only drift, and
    // the test passes with the gate removed.
    const rec = recorder();
    await run(["init", ...base()], rec);
    assert.equal(await run(["labels", "check", ...base()], rec), 0, "fixture is not in sync");

    await withBrokenFile();
    assert.equal(await run(["labels", "check", ...base()], rec), 1);
  });

  it("blocks apply before a single request goes out", async () => {
    await withBrokenFile();
    const rec = recorder();
    const code = await run(["labels", "apply", ...base()], rec);
    assert.equal(code, 1);
    assert.deepEqual(rec.mutations, [], "apply sent requests over a file it could not parse");
  });

  it("blocks init, so the composite command cannot route around the gate", async () => {
    await withBrokenFile();
    const rec = recorder();
    assert.equal(await run(["init", ...base()], rec), 1);
    assert.deepEqual(rec.mutations, []);
  });

  it("names the file, the line, and the reason", async () => {
    await withBrokenFile();
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await main(["labels", "check", ...base()], { probeTransport: recorder().probe });
    } finally {
      process.stdout.write = write;
    }
    const text = lines.join("");
    assert.match(text, /labels\.yml:1/);
    assert.match(text, /not six hex digits/);
  });

  it("does not block a file it can read", async () => {
    const rec = recorder();
    await run(["labels", "eject", ...base()], rec);
    // Ejected output must round-trip: the file this tool writes is a file it can read back.
    assert.equal(await run(["labels", "check", ...base()], rec), 1); // drift: nothing applied yet
    await run(["labels", "apply", ...base()], rec);
    assert.equal(await run(["labels", "check", ...base()], rec), 0);
  });
});

describe("apply", () => {
  it("is idempotent — a second run sends nothing", async () => {
    const rec = recorder();
    await run(["labels", "apply", ...base()], rec);
    const first = rec.mutations.length;
    assert.ok(first > 0);
    rec.mutations.length = 0;
    await run(["labels", "apply", ...base()], rec);
    assert.deepEqual(rec.mutations, []);
  });

  it("exits 1 once the repository drifts, and 0 once it does not", async () => {
    const rec = recorder();
    await run(["labels", "apply", ...base()], rec);
    assert.equal(await run(["labels", "check", ...base()], rec), 0);

    const dropped = rec.labels.pop();
    assert.ok(dropped, "fixture had no labels to drop");
    assert.equal(await run(["labels", "check", ...base()], rec), 1);
  });

  it("never sends a color GitHub would reject", async () => {
    const rec = recorder();
    await run(["init", ...base()], rec);
    for (const label of rec.labels) {
      assert.match(label.color, /^[0-9a-f]{6}$/, `${label.name} carries ${JSON.stringify(label.color)}`);
    }
  });
});
