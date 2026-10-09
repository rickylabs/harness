/** Shape rules shared by every Orchid receipt read. Pure: no I/O and no other package. */
export const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const exact = (row: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(row).sort().join(",") === [...fields].sort().join(",");
/** A receipt time with up to nanosecond precision, normalized to milliseconds; never in the future. */
export const stamp = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= Date.now() ? new Date(ms).toISOString() : null;
};
