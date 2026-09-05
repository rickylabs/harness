/**
 * The check that makes `dump-config.golden.yml` a check rather than a file.
 *
 * Installing the profile into a throwaway `DSH_HOME` and running the real `dsh` binary is heavier
 * than a unit test, and it is the only thing that would actually catch what #50 is about: a dsh
 * release that moves a row. Re-reading our own `cordis.patch.yml` would test nothing — those four
 * rows are ours and they are already covered by `bundle.test.ts`. The eighty-five rows underneath
 * them belong to `@deepseek-ai/dsh-base` and arrive through a version range, and this is the only
 * place in the repository that looks at them.
 *
 * The mismatch report is written out rather than left to `assert.equal` on two 346-line strings,
 * because the useful facts about a snapshot failure are three lines long — how many rows moved,
 * which ids appeared and vanished, and the first line that differs — and none of them survive being
 * printed inside a diff of the whole file.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { reasonFrom, UsageError } from "./bless.js";
import { packageDirOf } from "./cli.js";
import {
  captureFromScratch,
  countRows,
  dshPackage,
  GOLDEN_FILE,
  MARKER,
  missingFrom,
  parseGolden,
  renderGolden,
  rowIds,
  type Golden,
} from "./golden.js";

const PACKAGE_DIR = packageDirOf(import.meta.url);

/** The rows this bundle contributes, in bundle order. */
const OUR_ROWS = [
  "harness-subagents",
  "harness-board",
  "harness-coordinator",
  "harness-telemetry",
] as const;

function explain(committed: string, composed: string): string {
  const a = committed.split("\n");
  const b = composed.split("\n");
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;

  const lines = [
    "the committed snapshot no longer matches what dsh composes.",
    "",
    `rows   ${countRows(committed)} committed, ${countRows(composed)} composed`,
  ];
  for (const id of missingFrom(rowIds(composed), rowIds(committed))) lines.push(`  + ${id}`);
  for (const id of missingFrom(rowIds(committed), rowIds(composed))) lines.push(`  - ${id}`);
  lines.push(
    "",
    `first difference at line ${at + 1}`,
    `  committed  ${a[at] ?? "<end of file>"}`,
    `  composed   ${b[at] ?? "<end of file>"}`,
    "",
    "If this change is expected, record why it happened:",
    '  pnpm run golden:bless -- "what moved, and why that is expected"',
  );
  return lines.join("\n");
}

describe("the provenance header", () => {
  const body = "- id: one\n  name: '@x/one'\n- id: two\n  name: '@x/two'\n";

  it("survives a round trip", () => {
    const parsed = parseGolden(renderGolden(body, "9.9.9", "because the upgrade moved it"));
    assert.equal(parsed.body, body);
    assert.equal(parsed.dsh, "9.9.9");
    assert.equal(parsed.rows, 2);
    assert.equal(parsed.reason, "because the upgrade moved it");
  });

  it("re-renders to the same bytes, so no prose line can shadow a field", () => {
    const text = renderGolden(body, "9.9.9", "a reason");
    const parsed = parseGolden(text);
    assert.equal(renderGolden(parsed.body, parsed.dsh, parsed.reason), text);
  });

  it("derives the row count instead of trusting it", () => {
    const text = renderGolden(body, "9.9.9", "a reason").replace("# rows   2", "# rows   99");
    assert.equal(parseGolden(text).rows, 99);
    // The count came back as written, and re-rendering corrects it — which is how a hand edit
    // fails rather than silently redefining what the file claims.
    const fixed = parseGolden(text);
    assert.notEqual(renderGolden(fixed.body, fixed.dsh, fixed.reason), text);
  });

  it("refuses a snapshot with no marker", () => {
    assert.throws(() => parseGolden("# dsh 1\n# rows 0\n# why x\n"), SyntaxError);
  });

  it("refuses a snapshot missing a field", () => {
    assert.throws(() => parseGolden(`# dsh    1\n# rows   0\n${MARKER}\n`), SyntaxError);
  });

  it("refuses a row count that is not a number", () => {
    const text = renderGolden(body, "9.9.9", "a reason").replace("# rows   2", "# rows   many");
    assert.throws(() => parseGolden(text), SyntaxError);
  });

  it("refuses to record an empty or multi-line reason", () => {
    assert.throws(() => renderGolden(body, "9.9.9", "   "), RangeError);
    assert.throws(() => renderGolden(body, "9.9.9", "one\ntwo"), RangeError);
  });
});

describe("reading a dump", () => {
  it("counts entries, not hyphens", () => {
    // A row's own config can hold a list, and the dump indents those. Only column zero is an entry.
    const body = "- id: hmr\n  config:\n    root:\n      - .\n      - src\n- id: llm\n";
    assert.equal(countRows(body), 2);
    assert.deepEqual(rowIds(body), ["hmr", "llm"]);
  });

  it("ignores the group comments dsh writes between layers", () => {
    const body = "# == @a/one\n- id: x\n# == @a/two\n- id: y\n";
    assert.deepEqual(rowIds(body), ["x", "y"]);
    assert.equal(countRows(body), 2);
  });
});

describe("the bless command's argument handling", () => {
  it("joins the positionals, so an unquoted reason still works", () => {
    assert.equal(reasonFrom(["dsh", "0.1.3", "moved", "the", "row"]), "dsh 0.1.3 moved the row");
  });

  it("drops the separator pnpm forwards, so the documented invocation records a clean reason", () => {
    // `pnpm run golden:bless -- "dsh 0.1.3 moved the row"` reaches the script as two positionals.
    assert.equal(reasonFrom(["--", "dsh 0.1.3 moved the row"]), "dsh 0.1.3 moved the row");
  });

  it("refuses to bless without a reason", () => {
    assert.throws(() => reasonFrom([]), UsageError);
    assert.throws(() => reasonFrom(["   "]), UsageError);
    assert.throws(() => reasonFrom(["--"]), UsageError);
  });
});

describe("the committed snapshot", () => {
  let home = "";
  let composed = "";
  let committed = "";
  let parsed: Golden | undefined;

  before(async () => {
    home = await mkdtemp(join(tmpdir(), "dsh-golden-"));
    composed = await captureFromScratch(PACKAGE_DIR, home);
    committed = await readFile(join(PACKAGE_DIR, GOLDEN_FILE), "utf8");
    parsed = parseGolden(committed);
  });

  after(async () => {
    if (home !== "") await rm(home, { recursive: true, force: true });
  });

  it("matches what dsh composes today", () => {
    if (parsed === undefined) throw new Error("the snapshot was not read");
    if (parsed.body !== composed) assert.fail(explain(parsed.body, composed));
  });

  it("records the dsh version and row count it was taken against", () => {
    if (parsed === undefined) throw new Error("the snapshot was not read");
    // Re-rendering the whole file from its own parts covers the header too: a stale version line
    // after an upgrade, or an edited row count, fails here even when every row still matches.
    assert.equal(
      renderGolden(composed, dshPackage().version, parsed.reason),
      committed,
      `the header is stale. Re-take it:\n  pnpm run golden:bless -- "..."`,
    );
  });

  it("carries no trace of the throwaway home it was captured in", () => {
    // The claim that one committed file can be correct on Windows and on CI's Linux runner rests
    // entirely on this. If any absolute path leaked into the dump it would be this one, because the
    // capture had nowhere else to run.
    assert.equal(composed.includes(home), false, "an absolute path reached the snapshot");
  });

  it("leaves `!!js` expressions unevaluated, which is what makes it portable", () => {
    if (parsed === undefined) throw new Error("the snapshot was not read");
    assert.ok(parsed.body.includes("!!js "), "no unevaluated expression survived the dump");
    // Both sides of the platform gate are present as text. Neither branch was taken, so the file
    // says the same thing on every operating system.
    assert.ok(parsed.body.includes("!!js process.platform === 'win32'"));
    assert.ok(parsed.body.includes("!!js process.platform !== 'win32'"));
  });

  it("composes both bundle layers, base first", () => {
    if (parsed === undefined) throw new Error("the snapshot was not read");
    const base = parsed.body.indexOf("# == @deepseek-ai/dsh-base");
    const ours = parsed.body.indexOf("# == @rickylabs/dsh-app");
    assert.ok(base >= 0, "the dsh-base layer is missing");
    assert.ok(ours >= 0, "our layer is missing");
    assert.ok(base < ours, "our rows compose before dsh-base's");
  });

  it("ends with our four rows", () => {
    if (parsed === undefined) throw new Error("the snapshot was not read");
    // A re-blessing that reordered the bundles would still match byte for byte — it regenerated the
    // file — and would still be wrong. This is the assertion a bless cannot launder.
    const ids = rowIds(parsed.body);
    assert.deepEqual(ids.slice(ids.length - OUR_ROWS.length), [...OUR_ROWS]);
  });
});
