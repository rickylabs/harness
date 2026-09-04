# Adversarial review — PR #91

## Verdict

**`FAIL_FIX`.** The green baseline build is real, but the required negative control is not: after
removing `dsh-app`'s `../board` project reference and cleaning every output, `pnpm -r build` still
exited 0. The PR therefore does not enforce its TypeScript reference topology. Two narrower defects
also need correction: `dsh-app` publishes an ordered plugin registry before E2 owns that contract,
and the root clean script collides with pnpm 11's `clean` command.

Reviewed target: PR [#91](https://github.com/rickylabs/harness/pull/91) at immutable head
[`6f348ba`](https://github.com/rickylabs/harness/commit/6f348ba17cf761176633e9f7859c40670c6cfd18),
against base `b7d5e586e32f31ef44cab7b1327ab890f8e23794`.

## Findings

### F-1 — Blocking: a missing project reference does not fail the recursive build

The committed graph is descriptively correct: `dsh-app` declares the same 13 workspace packages
in its manifest and project-reference list
([`package.json:25-39`](https://github.com/rickylabs/harness/blob/6f348ba17cf761176633e9f7859c40670c6cfd18/packages/dsh-app/package.json#L25-L39),
[`tsconfig.json:10-49`](https://github.com/rickylabs/harness/blob/6f348ba17cf761176633e9f7859c40670c6cfd18/packages/dsh-app/tsconfig.json#L10-L49)).
That equality is not guarded. The negative control removed only the `../board` reference, ran an
explicit recursive clean, then reran the acceptance build. pnpm built `board` first from the
manifest dependency graph, TypeScript resolved its emitted declaration through the package export,
and the build exited 0. The imports intended to exercise the graph do not make a missing reference
observable ([`src/index.ts:5-22`](https://github.com/rickylabs/harness/blob/6f348ba17cf761176633e9f7859c40670c6cfd18/packages/dsh-app/src/index.ts#L5-L22)).

Evidence:

```text
node "$PNPM_CLI" -r run clean
# exit 0

# delete { "path": "../board" } from packages/dsh-app/tsconfig.json

node "$PNPM_CLI" -r build
# ... packages/board build: Done
# ... packages/dsh-app build: Done
# exit 0 (expected non-zero)
```

Disposition: add an executable dependency/reference equality gate to the recursive build, or wire
resolution so TypeScript itself reports an imported workspace project with no reference. The gate
must be rerun with the same negative control before this finding can close.

### F-2 — Blocking: `dsh-app` is not an empty stub

Issue #40 permits an exported type or no-op but reserves implementations and contract choices for
later epics ([acceptance and constraints](https://github.com/rickylabs/harness/issues/40)). The 13
leaf packages expose only a package-name sentinel and derived type. `dsh-app` additionally exports
`PLUGIN_PACKAGES`, an ordered 13-entry public value
([`src/index.ts:24-44`](https://github.com/rickylabs/harness/blob/6f348ba17cf761176633e9f7859c40670c6cfd18/packages/dsh-app/src/index.ts#L24-L44)).
Its order and public shape are an app-composition contract owned by E2, not a buildability no-op.

Disposition: keep only the minimum sentinel/type needed for a buildable stub. Exercise topology
through a non-product validation fixture or graph checker rather than a speculative exported value.

### F-3 — Narrow: the root clean script fails under the pinned pnpm

The root delegates clean as `pnpm -r clean`
([`package.json:12-15`](https://github.com/rickylabs/harness/blob/6f348ba17cf761176633e9f7859c40670c6cfd18/package.json#L12-L15)).
With pnpm 11.25.0 this resolves to pnpm's own `clean` command and rejects the recursive option:

```text
node "$PNPM_CLI" -r clean
[ERROR] Unknown option: 'recursive'
# exit 1

node "$PNPM_CLI" -r run clean
# all 14 package clean scripts complete
# exit 0
```

Disposition: make the root script `pnpm -r run clean` and verify it through `pnpm run clean`.

## Required checklist

The host had Node 26.8.1 and no global pnpm or Corepack. The exact committed package-manager version
was installed without scripts into an ephemeral prefix, then invoked as:

```text
npm install --prefix "$TOOL_DIR" --ignore-scripts --no-save pnpm@11.25.0
PNPM_CLI="$TOOL_DIR/node_modules/pnpm/bin/pnpm.cjs"
node "$PNPM_CLI" --version
# 11.25.0
```

### 1. Workspace glob — PASS

Commands:

```text
node "$PNPM_CLI" install --frozen-lockfile
node "$PNPM_CLI" list -r --depth -1 --json
find packages -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
```

Result: frozen installation succeeded and pnpm reported 15 workspace projects: the root plus
exactly the 14 directories named in #31. No package directory was omitted or unexpectedly added.
The configured pattern is `packages/*`
([`pnpm-workspace.yaml:1-2`](https://github.com/rickylabs/harness/blob/6f348ba17cf761176633e9f7859c40670c6cfd18/pnpm-workspace.yaml#L1-L2));
the authoritative required list is in [#31](https://github.com/rickylabs/harness/issues/31).

### 2. Shared TypeScript base — PASS

Command: a Node structural assertion parsed all `packages/*/tsconfig.json` files, required
`extends === "../../tsconfig.base.json"`, and intersected every package `compilerOptions` key with
the base keys.

Result: 14/14 extend the single base, and the intersection was empty. Packages set only `rootDir`
and `outDir`, neither of which is set by the base
([`tsconfig.base.json:3-30`](https://github.com/rickylabs/harness/blob/6f348ba17cf761176633e9f7859c40670c6cfd18/tsconfig.base.json#L3-L30)).

### 3. Topological project references — FAIL

Commands:

```text
node "$PNPM_CLI" -r run clean
node "$PNPM_CLI" -r build
# exit 0

# remove dsh-app's ../board reference, clean again, then:
node "$PNPM_CLI" -r build
# exit 0; expected non-zero
```

Result: the committed reference graph equals the workspace dependency graph, and the clean baseline
build succeeds, but deleting a required reference does not fail the build. See F-1.

### 4. Fourteen empty, buildable stubs — FAIL

Commands:

```text
node "$PNPM_CLI" -r run clean
node "$PNPM_CLI" -r typecheck
node "$PNPM_CLI" -r build
find packages -mindepth 1 -maxdepth 1 -type d # check dist/index.{js,d.ts}
```

Result: all 14 packages are present, typecheck/build exits 0 from clean outputs, and every package
emits `dist/index.js` plus `dist/index.d.ts`. The emptiness requirement fails only for `dsh-app`'s
public ordered registry; see F-2.

### 5. Sensitive or forbidden diff content — PASS

Commands:

```text
git diff --name-only "$BASE...$HEAD" | rg '(^|/)\.llm/|(^|/)\.env($|\.)'
git diff "$BASE...$HEAD" | rg '(AKIA...|gh[pousr]_...|github_pat_...|sk-...|xox...|PRIVATE KEY|credentialed URL)'
git diff --check "$BASE...$HEAD"
```

Result: both forbidden-path and credential-signature scans returned no matches; `git diff --check`
also passed. The diff contains no `.llm/**`, `.env*`, credential signature, or whitespace error.

### 6. pnpm, Node engine, and `allowBuilds` consistency — PASS

Commands:

```text
node "$PNPM_CLI" --version
node "$PNPM_CLI" install --frozen-lockfile
node "$PNPM_CLI" config get allowBuilds --json
node -p 'require("<tool-prefix>/node_modules/pnpm/package.json").engines'
```

Result: the exact `packageManager` pin is pnpm 11.25.0, its package requires Node `>=22.13`, and the
repo declares Node `>=24`
([`package.json:8-10`](https://github.com/rickylabs/harness/blob/6f348ba17cf761176633e9f7859c40670c6cfd18/package.json#L8-L10)).
Frozen install succeeded on Node 26.8.1. pnpm parsed all five false `allowBuilds` entries and emitted
no unreviewed-build failure. This matches pnpm's documented semantics: false entries explicitly deny
scripts, unlisted build scripts fail by default, and `allowBuilds` replaces the removed pnpm 11
settings ([pnpm build settings](https://pnpm.io/settings/build#allowbuilds)); pnpm 11 supports Node
22, 24, and 26 ([pnpm compatibility table](https://pnpm.io/installation#compatibility)).

The separate root-script collision in F-3 must still be fixed.
