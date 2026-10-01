import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { SourceError } from "../source.js";
import { mapTransportAvailability, readTransportAvailabilityFile } from "./transport-availability.js";

const row = (transport: string, available: boolean, reason: string | null) => ({ transport, available, reason });
const snapshot = (over: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 1,
  observedAt: "2026-09-30T12:00:00.123Z", validUntil: "2026-09-30T12:01:00.123Z",
  transports: [row("claude", false, "5h-ceiling"), row("codex", true, null), row("agy", false, "meter-stale")], ...over });

it("maps divybot's snapshot strictly: every transport in order, a reason exactly when unavailable", () => {
  const leg = mapTransportAvailability(snapshot());
  assert.equal(leg.ok, true);
  if (!leg.ok) return;
  assert.equal(leg.observedAt, "2026-09-30T12:00:00.123Z");
  assert.equal(leg.validUntil, "2026-09-30T12:01:00.123Z");
  assert.deepEqual(leg.value.transports.map(t => [t.transport, t.available, t.reason]),
    [["claude", false, "5h-ceiling"], ["codex", true, null], ["agy", false, "meter-stale"]]);
  // Second precision normalizes to milliseconds.
  const seconds = mapTransportAvailability(snapshot({ observedAt: "2026-09-30T12:00:00Z", validUntil: "2026-09-30T12:01:00Z" }));
  assert.equal(seconds.ok && seconds.observedAt, "2026-09-30T12:00:00.000Z");
  for (const bad of [
    snapshot({ schemaVersion: 2 }), snapshot({ extra: 1 }), snapshot({ observedAt: "2026-09-30T12:00:00.123456789Z" }),
    snapshot({ transports: [row("codex", true, null), row("claude", false, "5h-ceiling"), row("agy", true, null)] }),
    snapshot({ transports: [row("claude", true, null), row("codex", true, null)] }),
    snapshot({ transports: [row("claude", true, "no-capacity"), row("codex", true, null), row("agy", true, null)] }),
    snapshot({ transports: [row("claude", false, null), row("codex", true, null), row("agy", true, null)] }),
    snapshot({ transports: [row("claude", false, "over ceiling"), row("codex", true, null), row("agy", true, null)] }),
    snapshot({ transports: [{ ...row("claude", true, null), host: "x" }, row("codex", true, null), row("agy", true, null)] }),
  ]) assert.deepEqual(mapTransportAvailability(bad), { ok: false, code: "shape-mismatch" }, bad);
  assert.deepEqual(mapTransportAvailability("{"), { ok: false, code: "non-json" });
});

it("reads only an owner-only regular file under the size bound", async () => {
  const dir = await mkdtemp(join(tmpdir(), "transport-availability-"));
  try {
    const file = join(dir, "transport-availability.json");
    await writeFile(file, snapshot(), { mode: 0o600 });
    assert.equal(await readTransportAvailabilityFile(file), snapshot());
    const code = async (path: string) => {
      try { await readTransportAvailabilityFile(path); return "read"; } catch (error) { return error instanceof SourceError ? error.code : "other"; }
    };
    await chmod(file, 0o644);
    assert.equal(await code(file), "file-unreadable");
    await chmod(file, 0o600);
    const link = join(dir, "link.json");
    await symlink(file, link);
    assert.equal(await code(link), "file-unreadable");
    assert.equal(await code(join(dir, "absent.json")), "file-unreadable");
    assert.equal(await code(dir), "file-unreadable");
    const big = join(dir, "big.json");
    await writeFile(big, "x".repeat(4097), { mode: 0o600 });
    assert.equal(await code(big), "oversize");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("maps the fourth OpenCode row as capacity, retains legacy, and refuses incomplete or fabricated headroom", () => {
  const native = JSON.parse(snapshot()).transports;
  for (const available of [true, false]) {
    const transports = [...native, row("opencode", available, available ? null : "no-capacity")];
    const leg = mapTransportAvailability(snapshot({ transports }));
    assert.equal(leg.ok, true);
    if (leg.ok) assert.deepEqual(leg.value.transports, transports);
  }
  const legacy = mapTransportAvailability(snapshot());
  assert.equal(legacy.ok, true);
  if (legacy.ok) assert.deepEqual(legacy.value.transports, native);
  for (const transports of [
    native.slice(0, 2), [...native, row("opencode", true, null), row("opencode", true, null)],
    [...native, row("agy", true, null)], [...native, row("PRIVATE_CANARY", true, null)],
    [...native, row("opencode", true, "no-capacity")], [...native, row("opencode", false, null)],
    [...native, { ...row("opencode", true, null), PRIVATE_CANARY: "private-value" }],
    [...native, { ...row("opencode", true, null), available: "true" }],
    ...["meter-unread", "meter-stale", "window-expired", "5h-ceiling", "weekly-ceiling", "ceiling-misconfigured", "PRIVATE_CANARY"].map(reason =>
      [...native, row("opencode", false, reason)]),
  ]) assert.deepEqual(mapTransportAvailability(snapshot({ transports })), { ok: false, code: "shape-mismatch" });
});
