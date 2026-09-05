/**
 * One byte sequence per value, so two decisions can be compared instead of described.
 *
 * `JSON.stringify` is not enough for this. It writes object keys in insertion order, so the same
 * decision assembled by two different code paths serialises to two different strings and compares
 * as "changed" when nothing changed. A determinism check built on that reports drift constantly,
 * and a check that cries wolf is switched off within a week.
 *
 * So: keys sorted, `undefined` dropped the way `JSON.stringify` drops it, non-finite numbers written
 * as `null` because JSON has no other spelling for them, `Date` written as its ISO string rather than
 * the `{}` a naive walk produces.
 *
 * **Arrays keep their order.** That is deliberate and it is the one asymmetry worth stating: a list
 * whose order does not matter must be sorted by whoever builds it, not here. `selectEvaluator` sorts
 * its own rejections for exactly this reason. Sorting arrays here would quietly erase real
 * differences — a plan that dispatches B before A is a different plan.
 */

import { createHash } from "node:crypto";

/**
 * How much of the SHA-256 a digest carries. Sixteen hex characters is 64 bits, which is far past
 * accidental collision for the number of decisions a milestone contains, and short enough to sit in
 * a terminal column next to the decision it belongs to. A digest nobody can read gets skipped.
 */
export const DIGEST_LENGTH = 16;

/** Thrown rather than looping forever. Persisted decisions have no cycles; a bug might. */
export class CircularValueError extends Error {
  constructor(path: string) {
    super(`value cannot be canonicalised: it refers to itself at ${path}`);
    this.name = "CircularValueError";
  }
}

function write(value: unknown, seen: Set<object>, path: string): string {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "bigint":
      return JSON.stringify(value.toString());
    case "function":
    case "symbol":
      return "null";
    default:
      break;
  }

  const object = value as object;
  if (seen.has(object)) throw new CircularValueError(path === "" ? "the root" : path);
  seen.add(object);
  try {
    if (object instanceof Date) {
      return JSON.stringify(Number.isFinite(object.getTime()) ? object.toISOString() : null);
    }
    if (Array.isArray(object)) {
      return `[${object.map((item, index) => write(item, seen, `${path}[${index}]`)).join(",")}]`;
    }
    const source = object as Record<string, unknown>;
    const keys = Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort();
    const pairs = keys.map(
      (key) => `${JSON.stringify(key)}:${write(source[key], seen, path === "" ? key : `${path}.${key}`)}`,
    );
    return `{${pairs.join(",")}}`;
  } finally {
    seen.delete(object);
  }
}

/** The value as one canonical JSON string. Equal values produce equal strings. */
export function canonicalJson(value: unknown): string {
  return write(value, new Set<object>(), "");
}

/** `sha256:<16 hex>` over the canonical form. Short enough to read, long enough to trust. */
export function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, DIGEST_LENGTH)}`;
}

/** How many differing paths are named before the rest are counted. */
export const DIFF_PATH_CAP = 12;

/**
 * The paths at which two values differ, named the way somebody would say them out loud —
 * `candidates[1].blockedBy`, not "the input changed".
 *
 * This is acceptance item 3 of #71 in one function: a changed plan has to be explainable by a
 * **named** input that changed. A diff that reports "inputs differ" satisfies nobody, because the
 * question being asked is always *which one*.
 *
 * The list stops at `DIFF_PATH_CAP`. A caller that gets exactly that many paths back should say so
 * rather than imply it has the whole picture: twelve named differences already answer the question,
 * and the thirteenth is not what anybody was waiting for.
 */
export function differences(before: unknown, after: unknown): readonly string[] {
  const found: string[] = [];
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (found.length >= DIFF_PATH_CAP) return;
    if (canonicalJson(a) === canonicalJson(b)) return;

    const bothArrays = Array.isArray(a) && Array.isArray(b);
    const bothObjects =
      !bothArrays &&
      typeof a === "object" &&
      typeof b === "object" &&
      a !== null &&
      b !== null &&
      !Array.isArray(a) &&
      !Array.isArray(b) &&
      !(a instanceof Date) &&
      !(b instanceof Date);

    if (bothArrays) {
      const left = a as readonly unknown[];
      const right = b as readonly unknown[];
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        walk(left[i], right[i], `${path}[${i}]`);
      }
      return;
    }
    if (bothObjects) {
      const left = a as Record<string, unknown>;
      const right = b as Record<string, unknown>;
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        walk(left[key], right[key], path === "" ? key : `${path}.${key}`);
      }
      return;
    }
    found.push(path === "" ? "(the whole value)" : path);
  };

  walk(before, after, "");
  return found;
}
