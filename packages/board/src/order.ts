/**
 * Host-independent ordering.
 *
 * `String.prototype.localeCompare` without an explicit locale reads the host's default, so the
 * same two milestones sort differently under `en_US` and `sv_SE` — and a projection whose byte
 * output depends on an environment variable is not deterministic, whatever its tests say on one
 * machine. Everything ordered in this package uses the comparator below instead.
 *
 * Code-unit order is chosen over any collation, including an explicitly named locale: ICU tables
 * ship with the runtime and change between versions, so "sort as `en-US` does" is still a promise
 * about the host. Code units are a property of the strings alone.
 */

/** Compare two strings by UTF-16 code unit. Total, transitive, and identical on every host. */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Compare two optional strings, sorting `null` last — the "unassigned" bucket is not first. */
export function compareNullableStrings(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareStrings(a, b);
}
