/**
 * Host-independent ordering.
 *
 * `String.prototype.localeCompare` with no explicit locale reads the host's default collation, so
 * the same two epic keys sort differently under `en_US` and `sv_SE`:
 *
 *     LC_ALL=en_US.UTF-8  ->  ["ä", "z"]
 *     LC_ALL=sv_SE.UTF-8  ->  ["z", "ä"]
 *
 * This module's whole claim is that the same inputs produce the same snapshot — that is what makes
 * two people reading the board sure they are reading the same thing, and what makes a snapshot
 * diffable at all. A snapshot whose bytes change with an environment variable does not have that
 * property, whatever the tests say on the machine that wrote them. Finding F-6 on #105.
 *
 * Code-unit order is chosen over any collation, including an explicitly named one: ICU tables ship
 * with the runtime and change between versions, so "sort the way `en-US` does" is still a promise
 * about the host. Code units are a property of the strings alone.
 *
 * `@rickylabs/board` carries the same two functions. That duplication is deliberate: this package
 * depends on nothing in the workspace so that either package can land first and neither can drag
 * the other's transitive weight into a status command that has to work when everything is wedged.
 */

/** Compare two strings by UTF-16 code unit. Total, transitive, and identical on every host. */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Compare two optional strings, sorting `null` last — the "unknown" bucket is not first. */
export function compareNullableStrings(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareStrings(a, b);
}
