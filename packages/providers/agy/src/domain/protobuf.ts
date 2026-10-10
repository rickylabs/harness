/**
 * The bounded protobuf wire reader for agy's retained store. Wire definitions measured in installed
 * 1.2.14 and re-checked on 1.3.2: gemini_coder.Step and CortexStepPlannerResponse. Step: type=1,
 * status=4, metadata=5, planner_response=20. Response: response=1, modified_response=8, stop=12;
 * thinking=3/raw_thinking=16 are never selected. sqlite_store.go:781 decomposeStep marshals the whole
 * Step into step_payload. Raw protobuf stays private: only typed fields leave through the decoder.
 */
export type Field = number | Uint8Array;
export type Fields = ReadonlyMap<number, Field>;
export const MAX_BLOB = 1_048_576;

export function protobuf(bytes: Uint8Array): Fields {
  if (bytes.length > MAX_BLOB) throw new Error();
  let cursor = 0;
  const fields = new Map<number, Field>();
  const repeated = new Set<number>();
  const integer = (): number => {
    let value = 0n, shift = 0n;
    for (let i = 0; i < 10; i++) {
      const byte = bytes[cursor++];
      // A tenth byte above 1 overflows 64 bits, which the safe-integer bound below already refuses.
      if (byte === undefined) throw new Error();
      value |= BigInt(byte & 127) << shift;
      if ((byte & 128) === 0) {
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
        return Number(value);
      }
      shift += 7n;
    }
    throw new Error();
  };
  for (let count = 0; cursor < bytes.length; count++) {
    if (count >= 4096) throw new Error();
    const tag = integer(), number = Math.floor(tag / 8), wire = tag % 8;
    if (number === 0 || number > 536_870_911) throw new Error();
    let value: Field;
    if (wire === 0) value = integer();
    else if (wire === 2) {
      const length = integer();
      if (cursor + length > bytes.length) throw new Error();
      value = bytes.subarray(cursor, cursor + length); cursor += length;
    } else if (wire === 1 || wire === 5) {
      const length = wire === 1 ? 8 : 4;
      if (cursor + length > bytes.length) throw new Error();
      cursor += length; value = NaN;
    } else throw new Error();
    // Repeated vendor fields can be skipped, but a repeated scalar we consume
    // must not silently change native type/status/text/time authority.
    if (repeated.has(number)) continue;
    if (fields.has(number)) { fields.set(number, NaN); repeated.add(number); }
    else fields.set(number, value);
  }
  return fields;
}
export const numeric = (fields: Fields, key: number): number | null => {
  const value = fields.get(key);
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error();
  return value;
};
export const nested = (fields: Fields, key: number): Fields | null => {
  const value = fields.get(key);
  if (value === undefined) return null;
  if (!(value instanceof Uint8Array)) throw new Error();
  return protobuf(value);
};
export const text = (fields: Fields, key: number): string | null => {
  const value = fields.get(key);
  if (value === undefined) return null;
  // A non-bytes value (a varint, or NaN for a repeated field) makes the decoder throw.
  return new TextDecoder("utf-8", { fatal: true }).decode(value as Uint8Array);
};
export function timestamp(fields: Fields | null, key: number, nowMs: number): string | null {
  const value = fields === null ? null : nested(fields, key);
  if (value === null) return null;
  const seconds = numeric(value, 1) ?? 0, nanos = numeric(value, 2) ?? 0;
  const ms = seconds * 1000 + Math.floor(nanos / 1_000_000);
  // Varints are non-negative safe integers; any time past `nowMs` (including an unsafe one) is refused.
  if (seconds <= 0 || nanos > 999_999_999 || ms > nowMs) throw new Error();
  return new Date(ms).toISOString();
}
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);
