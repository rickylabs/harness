/** Synthetic machine names and kernel files only. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { readLocalHostCapacity } from "./host-capacity.js";

const at = "2026-01-01T00:00:01.000Z";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "capacity-fixture-"));
  const meminfoPath = join(root, "meminfo");
  const drmRoot = join(root, "drm");
  const driver = join(root, "amdgpu");
  await mkdir(driver);
  const card = async (index: number, used: string, total: string) => {
    const device = join(drmRoot, `card${index}`, "device");
    await mkdir(device, { recursive: true });
    await rm(join(device, "driver"), { force: true });
    await symlink(driver, join(device, "driver"));
    await writeFile(join(device, "mem_info_vram_used"), used);
    await writeFile(join(device, "mem_info_vram_total"), total);
  };
  await mkdir(drmRoot);
  await writeFile(meminfoPath, "MemTotal: 4096 kB\nMemAvailable: 1024 kB\n");
  const source = { meminfoPath, drmRoot };
  return { root, meminfoPath, drmRoot, card, source, close: () => rm(root, { recursive: true, force: true }) };
}

it("reads all local RAM and AMD card VRAM pairs without inventing a total", async () => {
  const f = await fixture();
  try {
    await f.card(0, "0\n", "2048\n");
    await f.card(1, "512\n", "4096\n");
    const read = await readLocalHostCapacity(at, "fixture-node", f.source);
    assert.equal(read.host, "fixture-node");
    assert.equal(read.cost.availability, "available");
    assert.deepEqual(read.cost.measurement, { host: "fixture-node", ramUsedBytes: 3072 * 1024,
      ramTotalBytes: 4096 * 1024, vramUsedBytes: 512, vramTotalBytes: 6144,
      cards: [{ card: "card0", vramUsedBytes: 0, vramTotalBytes: 2048 },
        { card: "card1", vramUsedBytes: 512, vramTotalBytes: 4096 }] });
    assert.equal(read.cost.validUntil, "2026-01-01T00:00:31.000Z");
    assert.match(read.cost.revision!, /^[a-f0-9]{64}$/);
  } finally { await f.close(); }
});

it("withholds capacity for missing and malformed kernel evidence, never substituting zero", async () => {
  const f = await fixture();
  try {
    const absent = await readLocalHostCapacity(at, "fixture-node", f.source);
    assert.equal(absent.cost.availability, "unavailable");
    assert.equal(absent.cost.reason, "measurement_missing");
    assert.equal(absent.cost.measurement, null);
    await f.card(0, "12\n", "1024\n");
    await mkdir(join(f.drmRoot, "card1", "device"), { recursive: true });
    assert.equal((await readLocalHostCapacity(at, "fixture-node", f.source)).cost.reason, "source_unavailable");
    await f.card(1, "2048\n", "1024\n");
    assert.equal((await readLocalHostCapacity(at, "fixture-node", f.source)).cost.reason, "source_incomplete");
    await f.card(1, "0\n", "1024\n");
    await writeFile(f.meminfoPath, "MemTotal: 4096 kB\n");
    assert.equal((await readLocalHostCapacity(at, "fixture-node", f.source)).cost.reason, "source_incomplete");
    await rm(f.meminfoPath);
    assert.equal((await readLocalHostCapacity(at, "fixture-node", f.source)).cost.reason, "source_unavailable");
    assert.equal((await readLocalHostCapacity(at, "fixture-node", f.source)).cost.measurement, null);
  } finally { await f.close(); }
});

it("requires an amdgpu driver for each counted DRM card", async () => {
  const f = await fixture();
  try {
    await f.card(0, "100\n", "1024\n");
    const driver = join(f.drmRoot, "card0", "device", "driver");
    await rm(driver);
    assert.equal((await readLocalHostCapacity(at, "fixture-node", f.source)).cost.reason, "source_unavailable");
    const other = join(f.root, "fixture-other-driver");
    await mkdir(other);
    await symlink(other, driver);
    assert.equal((await readLocalHostCapacity(at, "fixture-node", f.source)).cost.reason, "source_incomplete");
  } finally { await f.close(); }
});

it("requires an operator-set placement identity before reading machine files", async () => {
  const f = await fixture();
  try {
    await rm(f.meminfoPath);
    for (const identity of [undefined, ""]) {
      const read = await readLocalHostCapacity(at, identity, f.source);
      assert.equal(read.host, null);
      assert.equal(read.cost.reason, "host_identity_unset");
      assert.equal(read.cost.measurement, null);
    }
  } finally { await f.close(); }
});
