# I1 receipt checker — draft implementation contract

The first slice validates a receipt and reports whether requested and observed routing agree.
It does not authorize a spawn, select a model, or prove that the dispatcher submitted every
receipt. The existing dispatcher remains the only executor (`ARCHITECTURE.md:148–150`).

## Input

One versioned JSON object per file. The CLI takes explicit file arguments. It does not scan a
private store or infer an empty receipt set means no work occurred. Public examples and tests
must be wholly synthetic; live receipts remain in private operational storage.

| Field | Shape / meaning |
| --- | --- |
| `schemaVersion` | integer 1; any other version is unsupported |
| `resolution.sourceRevision` | immutable source commit, 40 hexadecimal characters |
| `resolution.digest` | SHA-256 of the retained authoritative CLI output, 64 hexadecimal characters |
| `resolution.resolvedAt` | RFC 3339 UTC timestamp, seconds or milliseconds, strict calendar round trip |
| `resolution.selected` | nonblank `logicalModel` and `physicalModel`; mapping asserted by the writer |
| `requested` | object with nonblank `model`, `effort`, `transport`, `role`, `tier` strings |
| `observed` | same five required field names, each an observation object |

`requested.model` is the physical identifier and must agree with
`resolution.selected.physicalModel`; the logical identifier is retained separately. Nonblank
means nonempty after trimming; compare trimmed strings exactly without case folding or Unicode
normalization. Reject control characters and line separators before trimming.

A known observation has `status: known`, nonblank `value`, and nonblank `evidenceRef`, plus
`source: launcher` or `source: control-plane`. An unknown observation has `status: unknown`
and a nonblank `reason`, plus one `reasonCode` from `not-observed`, `prose-only`,
`not-externally-observable`, `observer-unavailable`; no value can masquerade as an observed fact. No input value is echoed
in diagnostics. Evidence references are private references, not content fetched by this checker.
Known role/tier observations require `source: control-plane`; absent external observation
remains unknown and keeps the verdict unproven. No unknown field is excluded to manufacture pass.
Nested and top-level objects reject unexpected fields. Reject duplicate JSON keys semantically,
including escaped equivalents and nested objects; key-looking text inside a value is not a key.
Use strict JSON parsing followed by the already-declared js-yaml parser's duplicate-key check
with JSON_SCHEMA and json:false, rather than writing a new tokenizer. Its broader YAML syntax
is never accepted: JSON.parse must succeed first. Never expose either parser's exceptions.

The schema is deliberately structural. It contains no model inventory, tier ranking, allowed
transport list or compiled fleet mapping. A digest's syntax is not proof of its preimage;
evidence references are assertions until the dispatcher/independent observer verifies them.

## Verdict and exit status

| Condition | Verdict | Exit |
| --- | --- | --- |
| All fields structurally valid; all five observations known and equal requested values | `pass` for receipt agreement only | 0 |
| Malformed JSON, unsupported schema, omitted fields, wrong types, unexpected keys, or known mismatch | `fail` | 1 |
| No input files, file cannot be read, or a structurally valid unknown observation | `unproven` | 2 |

Process every explicitly named file and emit one fixed-shape result by input index; never
print paths, raw input, parse exceptions or evidence values. A mixed set retains per-file
verdicts and reports failure if any fail, otherwise unproven if any are unproven. At least one
successfully read receipt is necessary for aggregate pass. The output includes an explicit
scope string: receipt structure and requested/observed agreement only.

## Tests and CI reachability

Tests invoke both the imported validator and the real CLI process. Cover all five required
fields in both envelopes; null/blank/missing/wrong-type values; extra keys; unknown versions;
malformed and empty JSON; arrays in place of objects; missing arguments/files; known mismatch;
unknown observations; and mixed sets. Include a hostile-looking value and assert stdout/stderr
contain none of it. Give every success fixture a synthetic source/digest and nonempty evidence.

Implement plain `.mjs` with Node specifiers and the existing js-yaml dependency. Add
`check:receipts` immediately after `check:test-scripts` in the root test aggregate, invoking
`node --test`; assert both the aggregate's stage membership and the test command's reachability.
Exercise a prose-only effort fixture as unproven, an applied-effort fixture as known, and a
known effort mismatch as fail. Model these examples on actual command construction; do not
hard-code transport policy in the validator. A missing-file sentinel must appear in neither
output stream. Validate timestamps by strict shape plus parse/reformat round trip, without a
freshness check. Exit 2 composes with the existing inconclusive aggregate. Evidence references
are nonblank private strings, never printed/fetched; their syntax proves no provenance.

Add `check:receipts` to the root pnpm test aggregate so CI executes the CLI/validator suite.
Tests exercise known synthetic receipts, not an empty wildcard over nonexistent production
receipts. Removing the validator call must make the deliberately invalid fixtures fail the
suite. Add the contributor reference from `profiles/README.md` when this slice is implemented.

## Completion boundary

This slice adds the missing schema/verdict instrument. Divybot consumption, fresh resolution
before each spawn, trusted authorization, evaluator independence and receipt completeness are
separate checks in `dispatcher-handoff.md`. This slice must not mark charter step 2 or I1 globally
green. An independently reviewed schema is not independently observed runtime enforcement.
