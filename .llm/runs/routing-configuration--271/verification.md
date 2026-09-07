# routing-configuration--271 — verification

Local implementation gates pass: full build, typecheck and all 2,791 workspace tests, with zero
failures or skips. The standard GitHub metadata command was unavailable in a credential-free
environment; a separate unauthenticated public API comparison matched the description. Independent
exact-head implementation evaluation is pending with the coordinator, not inferred from these tests.

Baseline: `7bbc9ba`. Commands ran in the assigned isolated worktree on 2026-09-07. Raw command
output remains in local scratch; this receipt contains no operator locations or private telemetry.

## Commands and actual results

| Command | Result |
| --- | --- |
| `pnpm run clean` | Exit 0; removed emitted output before the full verification pass |
| `pnpm run typecheck` | Exit 0; all 15 packages and graph/lifecycle checks |
| `pnpm run build` | Exit 0; graph, lifecycle, links, forms, snapshots, AST policy check, every package build, publish metadata, label registry, CLI docs, generated skill and tutorial checks |
| `pnpm test` | Exit 0; 2,791 tests passed, zero failed/skipped |
| `pnpm --filter @rickylabs/routing run test` | Exit 0; compatibility behavior plus loader/replacement tests; final workspace sweep includes 199 routing tests |
| `pnpm --filter @rickylabs/llm-local run test` | Exit 0; existing placement/budget/health behavior; final workspace sweep includes 95 tests |
| `pnpm --filter @rickylabs/dsh-app run test` | Initial generation/row-list failures inspected and repaired; final workspace sweep includes 332 passing tests |
| `pnpm --filter @rickylabs/dsh-app run bundle:render` | Exit 0; invokes `renderPatch` to write the generated patch |
| `pnpm run golden:bless -- 'harness-routing joins the bundle with an explicit document selection (#271)'` | Exit 0; dsh 0.1.2-rc.1; composed rows 90 → 91, only added id `harness-routing` |
| `pnpm run check:compiled-policy` | Exit 0; 281 TypeScript sources; fresh property/variable/default/late-assignment mutations detected, comments/test files ignored |
| `pnpm run check:snapshots` | Exit 0; 70 tracked data files, including the new document and fresh implementation matrix |
| `pnpm run check:tutorial` | Exit 0; all four executable output blocks match; three existing explicitly unexecuted claims unchanged |
| `git diff --check` and `git diff --cached --check` | Exit 0 |

The build's publish check reports unchanged `@rickylabs/harness-contracts@0.1.0`, protocol 1,
68 package files and no tests. Its CLI-reference check reports six matching generated pages;
no generated CLI reference was hand-edited. Source: `scripts/check-publish.mjs:1`,
`scripts/cli-reference.mjs:1`; executed 2026-09-07.

Package totals: contracts 121; subagents 227; board 272; provider-codex 44; provider-claude 107;
provider-opencode 151; coordinator 317; forge 513; telemetry 413; routing 199; llm-local 95;
dsh-app 332. Stub packages have no test command.

## Critical proofs

- Actual store source includes `inputRevision` in identity (`packages/coordinator/src/state-store.ts:99`).
  Memory and filesystem intent methods append by that key (`packages/coordinator/src/state-store-memory.ts:67`,
  `packages/coordinator/src/state-store-fs.ts:254`). Their behavior is not retry authorization. No store contract was changed.
- `dry-run.test.ts` and `dry-run-crash.test.ts` seed real pending history, change both document bytes
  and attempts, and assert zero assembly/delivery/new journal entries. The filesystem crash test
  kills its owned synthetic child after the fake attempt, recovers terminal unknown, and proves
  every competing changed-key drive is refused while the old state remains unchanged. Separate
  concurrent-first-call cases prove only one undetermined effect can be admitted on a handle.
  Read refusal/throw also prevents intent and delivery. Sources:
  `packages/dsh-app/src/dry-run.test.ts:175`, `packages/dsh-app/src/dry-run-crash.test.ts:36`.
- Packed-asset tests run `npm pack --dry-run --json --ignore-scripts`, create/extract an actual
  scratch tarball, resolve the exported JSON from an isolated consumer, and load those bytes.
  They also reject a packed layout containing deleted compiled-table modules. Source:
  `packages/routing/src/load.test.ts:72`.
- A `node --input-type=module` comparison transpiled the four baseline model/policy/backend/
  capability modules obtained with `git show 7bbc9ba:<source>` into scratch, imported them and used
  `assert.deepEqual` against the shipped JSON. Result: exact equality for model bindings/approvals,
  family/effort/purpose lists, all lanes/steps, tier pairs, constraints, deep-research membership and
  all 18 placement records. No baseline source or operator state was changed.

## Failures inspected and limitations

Initial compile failures were the expected removed-export/signature call sites and test fixture
optional-property typing. Updated the consumers and fixtures without weakening runtime expectations.
The first full build found two stale tutorial row projections; the first full sweep found the
independent golden row list. Both were synchronized to the rendered six-row bundle, with existing
checks retained (D-018/D-019). All subsequent full local gates passed.

`pnpm run check:metadata`, run with an empty scratch `GH_CONFIG_DIR` and GitHub token variables
unset, returned **exit 3: no usable GitHub transport; nothing compared**. This is not a PASS.
To perform the permitted read without credentials, a Node `fetch` GET of
`https://api.github.com/repos/rickylabs/harness` compared `.description` directly with
`package.json.description` and matched (exit 0). No GitHub metadata was changed.
[source: scripts/check-metadata.mjs:84; topic: transport requirement; inspected 2026-09-07]
[source: https://api.github.com/repos/rickylabs/harness; topic: public repository description; retrieved 2026-09-07]

No known local implementation defect remains. Live dispatch, fleet parity and later E11 semantics
were not tested or claimed. Exact-head independent implementation review remains outstanding.
