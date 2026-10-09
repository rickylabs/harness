# Matrix receipt checker

Validate explicit receipt files with Node 24 or later. The checker reports receipt structure
and requested/observed routing agreement. It does not resolve a matrix, authorize a launch,
verify evidence references, or establish that the dispatcher recorded every spawn.

    pnpm exec harness-method receipts receipt.json another-receipt.json

The `@rickylabs/method` package tests run the synthetic validator/CLI tests in CI as part of
`pnpm test`; `pnpm run check:receipts` runs them alone. They do not scan a private runtime store for receipts.

## Receipt shape

| Field | Requirement |
| --- | --- |
| `schemaVersion` | 1 |
| `resolution.sourceRevision` | 40 hexadecimal characters |
| `resolution.digest` | 64 hexadecimal characters; syntax only, no preimage check |
| `resolution.resolvedAt` | valid UTC timestamp such as `2026-01-02T03:04:05Z` or millisecond precision |
| `resolution.selected` | nonblank `logicalModel` and `physicalModel` |
| `requested` | nonblank `model`, `effort`, `transport`, `role`, `tier`; model equals the selected physical model |
| `observed` | all five fields, each containing a known or unknown observation |

Known observations contain `status: known`, `value`, `source`, and `evidenceRef`. Source is
`launcher` or `control-plane`; role and tier require `control-plane`. References are nonblank
private strings. The checker never fetches, authenticates or prints them. Their syntax cannot
prove they are safe to publish.

Unknown observations contain `status: unknown`, a nonblank `reason`, and `reasonCode` from
`not-observed`, `prose-only`, `not-externally-observable`, or `observer-unavailable`. They cannot
also contain a value. A request or prose instruction is not an observation. Keep role/tier
unknown where no control-plane observation exists; keep effort unknown when only prose was
injected. Such receipts return unproven, even though their structure is valid. They must not be
changed to pass by copying requested values. This instrument does not establish global I1 coverage.

Every object is closed: unexpected fields fail. Text cannot contain controls or line separators.
Comparison uses the ECMAScript `String.trim()` whitespace set (including NBSP and U+FEFF),
with no case folding or Unicode normalization. A BOM at the start of a file is invalid JSON.
The logical-to-physical mapping is an assertion from the writer; no fleet inventory is embedded.
Duplicate JSON keys, including escaped equivalents, fail. JSON syntax is checked first; the
existing js-yaml reader supplies duplicate detection without accepting YAML-only input.

## Results

| Verdict | Exit | Meaning |
| --- | --- | --- |
| pass | 0 | at least one explicit receipt, all structurally valid and all five observations known and matching |
| fail | 1 | malformed/unsupported input, invalid shape, or known disagreement |
| unproven | 2 | no files, unreadable file, or any unknown observation, with no failing receipt |

Mixed input retains a result for each zero-based input index; fail takes precedence over
unproven. Diagnostics include only fixed field paths and codes, never file paths, values or
parser exceptions. Exit 2 composes with the repository's inconclusive stage runner.

## Extending and reviewing

The rules are in [route-receipt.ts](../../packages/method/src/domain/receipts/route-receipt.ts) and the
CLI is `harness-method receipts`; the [tests](../../packages/method/tests/matrix-receipts.test.mjs) cover
the real CLI, including a symlinked entry point.
Use synthetic fixtures only; operational receipts and identifiers stay private.

A reviewer should temporarily bypass the `validateReceiptText` call inside `checkReceipts`
([check-receipts.ts](../../packages/method/src/application/check-receipts.ts)), which the
`receipts` subcommand of [main.ts](../../packages/method/src/adapters/cli/main.ts) calls, run
`pnpm run check:receipts`, confirm the negative CLI fixtures fail, then restore the call. A
helper-only green suite is insufficient if the actual CLI has stopped reaching the validator.
