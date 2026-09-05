# packages/

One pnpm workspace package per Cordis plugin, plus the app that composes them. The layout is
the target layout from #31; every directory is an **empty, buildable stub** until the epic that
owns it lands. Do not add behaviour to a stub before that epic has defined its contract.

| Package | Owner | Attaches to |
|---|---|---|
| `dsh-app` | E2 · #32 | our dsh profile + bundle (`cordis.patch.yml`); depends on every plugin below |
| `subagents` | E3 · #33 | the `ctx.subagents` contract itself: `DispatchRequest`, its `/swarm` wire format, and `SubagentProvider` |
| `provider-claude`, `provider-codex`, `provider-acp`, `provider-opencode` | E3 · #33 | `ctx.subagents` / `SubagentProvider` — autonomous vendor CLIs, metered by quota window |
| `llm-local` | E4 · #34 | `ctx.llm` / `LlmAdapter` — API-key and local models, metered per token |
| `routing` | E4 · #34 | delegation matrix |
| `governance` | E5 · #35 | tri-regime admission control |
| `board`, `coordinator` | E6 · #36 | task DAG, kanban projection, MASTER workflows |
| `forge`, `netscript-bridge` | E7 · #37 | GitHub bridge, polyglot dispatch |
| `contracts` | E8 · #38 | **published** to npm as `@rickylabs/contracts`; the only non-private package |
| `telemetry` | E9 · #39 | `SessionTelemetrySink` |

The provider packages and `llm-local` are separate on purpose: vendor CLIs and API/local models
attach to two *different* dsh seams (#30, "two seams, not one").

`subagents` holds the contract the four provider packages implement, and it is deliberately not
in `contracts`. That package is E8's, published to npm for the two UIs, and #79's acceptance draws
the line: a type that only makes sense for one surface does not belong there. A UI reads a board;
it never dispatches a run. `subagents` depends on nothing in this workspace, so both seams — E6's
projection and E7's forge — can reach it without either depending on the other.

## Conventions every package inherits

- **Name** `@rickylabs/<dir>`; `private: true` for everything except `contracts`.
- **ESM only.** `"type": "module"`, `exports` map pointing at `dist/`, `files: ["dist"]`.
- **One TypeScript base.** `tsconfig.json` is `{ extends: "../../tsconfig.base.json", rootDir: src, outDir: dist }`
  plus a `references` entry for every workspace dependency. The base turns on `composite`,
  `strict`, `NodeNext`, `verbatimModuleSyntax` and `noUncheckedIndexedAccess`; override per
  package only when you can say why in the diff.
- **Workspace deps** are declared as `"workspace:*"` in `package.json` *and* mirrored as a
  project reference in `tsconfig.json`. pnpm orders `pnpm -r` topologically from the former;
  `tsc -b` orders emit from the latter. Keep both in sync.
- **Scripts.** `build` = `tsc -b` (JS + declarations), `typecheck` = `tsc -b --emitDeclarationOnly`
  (full type check; emits only the `.d.ts` files that downstream references need, because
  `--noEmit` is not allowed on a referenced project), `clean` = remove `dist/` and build info.
- `@deepseek-ai/dsh` is a **dependency** (currently only of `dsh-app`), never vendored or forked.
  Its native transitive deps have their build scripts denied in `pnpm-workspace.yaml`; E2 flips
  on the ones the runtime needs.

Adding a package: copy any stub directory, rename, add it to the root `tsconfig.json`
`references` list, and (if the app composes it) to `dsh-app`'s dependencies and references.
