import assert from "node:assert/strict";
import { test } from "node:test";

import { RUN_SOURCES, RUN_OUTCOMES, RUN_VIEW_FIELDS, type RunView, type RunViewField } from "./runs.js";

/** `true` only when the two string unions have exactly the same members. */
export type Mutual<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

export type Assert<T extends true> = T;

/**
 * The allowlist is the wire.
 *
 * A field added to `RunView` and not to `RUN_VIEW_FIELDS` breaks this line, which is the point: the
 * list exists so that a server assembling a run by spreading its internal record can be tested
 * against it, and a list that silently falls behind the type it describes tests nothing.
 */
export type _FieldsCoverRunView = Assert<Mutual<RunViewField, keyof RunView & string>>;

test("run vocabularies are unique", () => {
  assert.equal(new Set(RUN_SOURCES).size, RUN_SOURCES.length);
  assert.equal(new Set(RUN_OUTCOMES).size, RUN_OUTCOMES.length);
  assert.equal(new Set(RUN_VIEW_FIELDS).size, RUN_VIEW_FIELDS.length);
});

test("the published field list is sorted, so it reads as a set", () => {
  const sorted = [...RUN_VIEW_FIELDS].sort();
  assert.deepEqual([...RUN_VIEW_FIELDS], sorted);
});

test("nothing that carries a path or a prompt is on the published field list", () => {
  // `origin` is a filesystem path, `title` is operator prose, `cwd` is a machine's shape. All three
  // were removed from the internal record for this reason; none may come back through the wire.
  for (const forbidden of ["origin", "title", "cwd", "prompt", "transcript", "path"]) {
    assert.ok(
      !(RUN_VIEW_FIELDS as readonly string[]).includes(forbidden),
      `${forbidden} must not be published`,
    );
  }
});

test("unknown is an outcome in its own right", () => {
  // Kept apart from `failed` so a cockpit does not invent bad news, and apart from `running` so it
  // does not invent an agent.
  assert.ok((RUN_OUTCOMES as readonly string[]).includes("unknown"));
  assert.ok((RUN_OUTCOMES as readonly string[]).includes("failed"));
  assert.ok((RUN_OUTCOMES as readonly string[]).includes("running"));
});
