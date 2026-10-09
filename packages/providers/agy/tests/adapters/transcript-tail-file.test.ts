import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { transcriptTailFile } from "../../src/adapters/transcript-tail-file.js";

async function store(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "agy-tail-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const tail = transcriptTailFile();

it("reads a whole small file from the start", async () => store(async root => {
  await writeFile(join(root, "log.jsonl"), "a\nb\n");
  const read = await tail.read(root, join(root, "log.jsonl"), 4096);
  assert.ok(read.bytes !== null);
  assert.equal(new TextDecoder().decode(read.bytes), "a\nb\n");
  assert.equal(read.fromStart, true);
}));

it("reads only the bounded tail of a large file", async () => store(async root => {
  await writeFile(join(root, "log.jsonl"), Buffer.alloc(2 * 1_048_576, 0x61));
  const read = await tail.read(root, join(root, "log.jsonl"), 1000);
  assert.ok(read.bytes !== null);
  assert.equal(read.bytes.length, 1000);
  assert.equal(read.fromStart, false);
}));

it("reports a missing file as missing", async () => store(async root => {
  assert.deepEqual(await tail.read(root, join(root, "absent.jsonl"), 4096), { bytes: null, reason: "missing" });
}));

it("refuses a symlink", async () => store(async root => {
  await writeFile(join(root, "real.jsonl"), "a\n");
  await symlink(join(root, "real.jsonl"), join(root, "log.jsonl"));
  assert.deepEqual(await tail.read(root, join(root, "log.jsonl"), 4096), { bytes: null, reason: "refused" });
}));

it("refuses a file owned by another uid", async () => store(async root => {
  await writeFile(join(root, "log.jsonl"), "a\n");
  const foreign = transcriptTailFile((process.getuid?.() ?? 0) + 1);
  assert.deepEqual(await foreign.read(root, join(root, "log.jsonl"), 4096), { bytes: null, reason: "refused" });
}));

it("refuses a hard-linked file", async () => store(async root => {
  await writeFile(join(root, "log.jsonl"), "a\n");
  await link(join(root, "log.jsonl"), join(root, "other.jsonl"));
  assert.deepEqual(await tail.read(root, join(root, "log.jsonl"), 4096), { bytes: null, reason: "refused" });
}));

it("refuses a directory", async () => store(async root => {
  await mkdir(join(root, "log.jsonl"));
  assert.deepEqual(await tail.read(root, join(root, "log.jsonl"), 4096), { bytes: null, reason: "refused" });
}));

it("refuses a path that escapes the root through a symlinked parent, or lies outside it", async () => store(async root => {
  await mkdir(join(root, "elsewhere"));
  await writeFile(join(root, "elsewhere", "log.jsonl"), "a\n");
  await mkdir(join(root, "store"));
  await symlink(join(root, "elsewhere"), join(root, "store", "brain"));
  assert.deepEqual(await tail.read(join(root, "store"), join(root, "store", "brain", "log.jsonl"), 4096), { bytes: null, reason: "refused" });
  assert.deepEqual(await tail.read(join(root, "store"), join(root, "elsewhere", "log.jsonl"), 4096), { bytes: null, reason: "refused" });
}));
