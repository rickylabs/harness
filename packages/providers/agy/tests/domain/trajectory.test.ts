/** The agy trajectory decoder: each coherence refusal on its own, on synthetic rows only. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeAgyConversation } from "../../src/domain/trajectory.js";
import { bytes, captured, childID, conversation, fixture, integer, rootID, seconds, time, trajectoryID } from "../../test-fixtures/agy-store.js";

type Rows = ReturnType<typeof fixture>["rows"];
const decode = (summary: Record<string, unknown>, rows: Rows, nowMs = captured) => decodeAgyConversation(summary, rows, "origin", nowMs, null);
/** The base fixture's native summary with one field replaced (or removed when `value` is null). */
const raw = (fields: Record<number, Buffer | null>, stepCount = 2) => {
  const base: Record<number, Buffer> = { 4: bytes(4, trajectoryID), 2: integer(2, stepCount), 5: integer(5, 1), 16: integer(16, 0), 7: time(7, 0), 3: time(3, 3) };
  return Buffer.concat(Object.entries({ ...base, ...fields }).flatMap(([, v]) => v === null ? [] : [v]));
};
const ok = () => { const f = fixture(); assert.ok(decode(f.summary, f.rows), "fixture: the base conversation decodes"); return f; };

it("refuses an invalid conversation id, an invalid parent and a self-parent", () => {
  const f = ok();
  assert.equal(decode({ ...f.summary, conversation_id: "not-a-uuid" }, f.rows), null);
  assert.equal(decode({ ...f.summary, parent_conversation_id: "not-a-uuid" }, f.rows), null);
  assert.equal(decode({ ...f.summary, parent_conversation_id: rootID }, f.rows), null);
  assert.ok(decode({ ...f.summary, parent_conversation_id: childID }, f.rows), "a valid other parent decodes");
});

it("refuses a step count that disagrees with the rows, no rows, too many rows, and a missing summary", () => {
  const f = ok();
  assert.equal(decode({ ...f.summary, step_count: 3, raw_summary: raw({}, 3) }, f.rows), null);
  assert.equal(decode({ ...f.summary, step_count: 0, raw_summary: raw({}, 0) }, []), null);
  assert.equal(decode({ ...f.summary, raw_summary: null }, f.rows), null);
  const many = conversation({ steps: [{ kind: "user" }, ...Array.from({ length: 4096 }, () => ({ kind: "result" as const }))] });
  assert.equal(decode(many.summary, many.rows, Date.now()), null);
  const max = conversation({ steps: [{ kind: "user" }, ...Array.from({ length: 4095 }, () => ({ kind: "result" as const }))] });
  assert.ok(decode(max.summary, max.rows, Date.now()), "4096 rows decode");
});

it("refuses a trajectory id outside the grammar even when the summary agrees, and a native step count that disagrees", () => {
  const f = ok();
  assert.equal(decode({ ...f.summary, trajectory_id: "abc", raw_summary: raw({ 4: bytes(4, "abc") }) }, f.rows), null);
  assert.equal(decode({ ...f.summary, raw_summary: raw({ 2: integer(2, 5) }) }, f.rows), null);
});

it("refuses a summary without a start time or without a modified time", () => {
  const f = ok();
  assert.equal(decode({ ...f.summary, raw_summary: raw({ 7: null }) }, f.rows), null);
  assert.equal(decode({ ...f.summary, raw_summary: raw({ 3: null }) }, f.rows), null);
});

it("refuses rows out of order and a status outside the native set", () => {
  const f = ok();
  assert.equal(decode(f.summary, [f.rows[0]!, { ...f.rows[1]!, idx: 5 }]), null);
  const bad = fixture({ status: 3 }), row = bad.rows[1]!;
  const payload = Buffer.concat([integer(1, 15), integer(4, 10), bytes(5, row.metadata), row.step_payload.subarray(row.step_payload.indexOf(Buffer.from([20 * 8 + 2])))]);
  assert.equal(decode(bad.summary, [bad.rows[0]!, { ...row, status: 10, step_payload: payload }]), null);
});

it("refuses a payload whose type or status disagrees with its row, and a planner response without its embedded header", () => {
  const c = conversation({ steps: [{ kind: "user" }, { kind: "checkpoint" }, { kind: "planner", message: "Done here now." }] });
  assert.ok(decode(c.summary, c.rows), "fixture decodes");
  const typed = c.rows.map(r => r.idx === 1 ? { ...r, step_type: 101, step_payload: Buffer.concat([integer(1, 23), integer(4, 3)]) } : r);
  assert.equal(decode(c.summary, typed), null, "row type 101, payload type 23");
  const status = c.rows.map(r => r.idx === 1 ? { ...r, step_payload: Buffer.concat([integer(1, 23), integer(4, 7)]) } : r);
  assert.equal(decode(c.summary, status), null, "row status 3, payload status 7");
  const planner = c.rows[2]!, withoutHeader = Buffer.concat([integer(1, 15), integer(4, 3), bytes(20, Buffer.concat([bytes(1, "Done here now."), integer(12, 2)]))]);
  assert.equal(decode(c.summary, [c.rows[0]!, c.rows[1]!, { ...planner, step_payload: withoutHeader }]), null);
});

it("refuses an embedded header whose bytes differ from the row's, even when it decodes to the same times", () => {
  const f = ok(), row = f.rows[1]!, reordered = Buffer.concat([time(8, 2), time(1, 1)]);
  const payload = Buffer.from(row.step_payload.toString("hex").replace(row.metadata.toString("hex"), reordered.toString("hex")), "hex");
  assert.equal(decode(f.summary, [f.rows[0]!, { ...row, step_payload: payload }]), null);
});

it("refuses a step created before the conversation started, and one completed before it was created", () => {
  const f = ok();
  assert.equal(decode({ ...f.summary, raw_summary: raw({ 7: time(7, 1), 3: time(3, 3) }) }, [{ ...f.rows[0]!, metadata: time(1, 0) }, f.rows[1]!].map((r, i) => i === 0 ? r : r)), null);
  const c = conversation({ steps: [{ kind: "user" }, { kind: "checkpoint" }] }), row = c.rows[1]!, header = Buffer.concat([time(1, 5), time(8, 2)]);
  assert.equal(decode(c.summary, [c.rows[0]!, { ...row, metadata: header }]), null);
});

it("takes the step's last-update time into the conversation's update time", () => {
  const c = conversation({ steps: [{ kind: "user" }, { kind: "checkpoint" }] }), row = c.rows[1]!;
  const header = Buffer.concat([time(1, 2), time(8, 2), time(22, 3)]);
  const decoded = decode(c.summary, [c.rows[0]!, { ...row, metadata: header }]);
  assert.equal(decoded?.updatedAt, new Date((seconds + 3) * 1000).toISOString());
});

it("reads an empty error record as no error, and prefers the modified response over the original", () => {
  const f = ok();
  assert.equal(decode(f.summary, [f.rows[0]!, { ...f.rows[1]!, error_details: Buffer.alloc(0) }])?.steps[1]!.hasError, false);
  assert.equal(decode(f.summary, [f.rows[0]!, { ...f.rows[1]!, error_details: Buffer.from([1]) }])?.steps[1]!.hasError, true);
  const row = f.rows[1]!, response = Buffer.concat([bytes(1, "Original text here."), bytes(8, "Modified text here."), integer(12, 2)]);
  const payload = Buffer.concat([integer(1, 15), integer(4, 3), bytes(5, row.metadata), bytes(20, response)]);
  assert.equal(decode(f.summary, [f.rows[0]!, { ...row, step_payload: payload }])?.steps[1]!.responseText, "Modified text here.");
});
