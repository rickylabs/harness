/** The bounded protobuf wire reader: each refusal on its own malformed input. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { MAX_BLOB, nested, numeric, protobuf, timestamp } from "../../src/domain/protobuf.js";

const varint = (n: bigint): number[] => { const out: number[] = []; do { const b = Number(n & 127n); n >>= 7n; out.push(b | (n > 0n ? 128 : 0)); } while (n > 0n); return out; };
const tag = (field: bigint, wire: number) => varint((field << 3n) | BigInt(wire));
const read = (...bytes: number[]) => protobuf(new Uint8Array(bytes));
const NOW = 2_000_000_000_000;
const stamp = (seconds: bigint, nanos?: bigint) => new Uint8Array([...tag(1n, 0), ...varint(seconds), ...(nanos === undefined ? [] : [...tag(2n, 0), ...varint(nanos)])]);
const holder = (inner: Uint8Array) => protobuf(new Uint8Array([...tag(7n, 2), ...varint(BigInt(inner.length)), ...inner]));

it("reads a valid message and refuses one over the blob bound", () => {
  assert.equal(numeric(read(...tag(1n, 0), 5), 1), 5);
  assert.throws(() => protobuf(new Uint8Array(MAX_BLOB + 1)));
});
it("refuses a ten-byte varint whose last byte overflows, and a truncated varint", () => {
  assert.throws(() => read(...tag(1n, 0), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x02));
  assert.throws(() => read(...tag(1n, 0), 0x80));
});
it("refuses a varint value above the safe-integer range", () => {
  assert.throws(() => read(...tag(1n, 0), ...varint(2n ** 53n)));
  assert.equal(numeric(read(...tag(1n, 0), ...varint(2n ** 53n - 1n)), 1), Number.MAX_SAFE_INTEGER);
});
it("refuses more than 4096 fields", () => {
  assert.doesNotThrow(() => read(...Array.from({ length: 4096 }, () => [...tag(1n, 0), 0]).flat()));
  assert.throws(() => read(...Array.from({ length: 4097 }, () => [...tag(1n, 0), 0]).flat()));
});
it("refuses field number zero and one above the protobuf maximum", () => {
  assert.throws(() => read(...tag(0n, 0), 1));
  assert.throws(() => read(...tag(536_870_912n, 0), 1));
  assert.doesNotThrow(() => read(...tag(536_870_911n, 0), 1));
});
it("refuses a length-delimited or fixed field that runs past the end", () => {
  assert.throws(() => read(...tag(1n, 2), 5, 1, 2));
  assert.throws(() => read(...tag(1n, 1), 1, 2, 3));
  assert.throws(() => read(...tag(1n, 5), 1, 2));
});
it("refuses the group and unknown wire types", () => {
  for (const wire of [3, 4, 6, 7]) assert.throws(() => read(...tag(1n, wire)), String(wire));
});
it("marks a repeated scalar so that reading it as a number is refused", () => {
  assert.throws(() => numeric(read(...tag(1n, 0), 3, ...tag(1n, 0), 3), 1));
});
it("refuses to read a varint field as a nested message", () => {
  assert.throws(() => nested(read(...tag(20n, 0), 1), 20));
});
it("refuses a non-positive time, nanoseconds above a second, and a time past now", () => {
  assert.equal(timestamp(holder(stamp(1_700_000_000n, 5n)), 7, NOW), new Date(1_700_000_000_000).toISOString());
  assert.throws(() => timestamp(holder(stamp(0n)), 7, NOW));
  assert.throws(() => timestamp(holder(stamp(1_700_000_000n, 1_000_000_000n)), 7, NOW));
  assert.throws(() => timestamp(holder(stamp(2_100_000_000n)), 7, NOW));
});
