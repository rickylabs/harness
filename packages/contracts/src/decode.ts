/** Internal closed-decoding primitives shared by contract decoders. Not exported from the package root. */

/** Thrown inside a decoder and caught at its boundary; the message never crosses the public result. */
export function fail(): never { throw new Error("invalid contract value"); }
/** Canonical UTC instant with milliseconds, exactly as `Date.prototype.toISOString` writes it. */
export const instant = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** Copy exactly the named own, enumerable data fields of a plain object; anything else refuses. */
export function record(value: unknown, names: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const keys = names.split(" ");
  if (Reflect.ownKeys(value).length !== keys.length) fail();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d) || !d.enumerable) fail();
    out[key] = d.value;
  }
  return out;
}
/** Copy a plain, dense, bounded array of own enumerable data elements; the bound refuses before any element is read. */
export function list(value: unknown, cap: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !count(length.value) || length.value > cap || Reflect.ownKeys(value).length !== length.value + 1) fail();
  return Array.from({ length: length.value }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !("value" in d) || !d.enumerable) fail();
    return d.value as unknown;
  });
}
