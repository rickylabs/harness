# packages/

One pnpm workspace package per Cordis plugin, plus the app that composes them. The layout is the
target layout from #31, and it was created all at once so that the dependency shape was decided
before any of the code was written.

**Twelve carry real code; three are empty stubs waiting on their epic.** A stub is a `package.json`, a
tsconfig and a placeholder export — enough to hold its place in the project graph, and not enough to
pretend it works. Every stub README says so in its first lines, names what the package will own, and
names what is blocking it. Do not add behaviour to a stub before its epic has defined the contract.

| Package | Ships | Owner | Attaches to |
|---|---|---|---|
| `dsh-app` | ✅ | E2 · #32 | our dsh profile + bundle (`cordis.patch.yml`); depends on every plugin below |
| `subagents` | ✅ | E3 · #33 | the `ctx.subagents` contract itself: `DispatchRequest`, its `/swarm` wire format, and `SubagentProvider` |
| `provider-claude`, `provider-opencode` | ✅ | E3 · #33 | `ctx.subagents` / `SubagentProvider` — autonomous vendor CLIs, metered by quota window |
| `provider-codex` | partial | E3 · #33 | app-server route-identity and pre-turn protocol prerequisite; no composed provider (#195/#53) |
| `provider-acp` | — | E3 · #33 | the same seam, over ACP |
| `llm-local` | ✅ | E4 · #34 | `ctx.llm` / `LlmAdapter` — API-key and local models, metered per token |
| `routing` | ✅ | E4 · #34, E11 · #271 | explicit routing document loader and immutable matrix queries |
| `governance` | — | E5 · #35 | tri-regime admission control; stub — sidecar decision answered (#257), implementation pending |
| `board`, `coordinator` | ✅ | E6 · #36 | task DAG, kanban projection, MASTER workflows |
| `forge` | ✅ | E7 · #37 | GitHub bridge: taxonomy and process skill, installable into any repository |
| `netscript-bridge` | — | E7 · #37 | polyglot dispatch — the adapter decision 2 rests on |
| `contracts` | ✅ | E8 · #38 | **published** to npm as `@rickylabs/harness-contracts`; the only non-private package |
| `telemetry` | ✅ | E9 · #39 | `SessionTelemetrySink` |

The provider packages and `llm-local` are separate on purpose: vendor CLIs and API/local models
attach to two *different* dsh seams (#30, "two seams, not one").

`subagents` holds the contract the four provider packages implement, and it is deliberately not
in `contracts`. That package is E8's, published to npm for the two UIs, and #79's acceptance draws
the line: a type that only makes sense for one surface does not belong there.

A cockpit does ask for a dispatch — but what it sends is `contracts`' own `DispatchCommand`, which
names an issue and a **lane**. `subagents`' `DispatchRequest` names a model, a host and a provider,
and it is what the coordinator builds *after* routing resolves the lane. Keeping them apart is what
stops a client from routing around the rule that an evaluator may not be the author. `subagents`
depends on nothing in this workspace, so both seams — E6's projection and E7's forge — can reach it
without either depending on the other.

## Conventions every package inherits

- **Name** `@rickylabs/<dir>`; `private: true` for everything except `contracts`.
  - **The one exception is `contracts` itself**, published as `@rickylabs/harness-contracts` (#81).
    The other fourteen names are internal and only ever read inside this repository, where `contracts`
    is unambiguous. That one is a public npm name that has to say which project it belongs to when it
    appears in someone else's `package.json`. The directory keeps its short name because the name a
    contributor types is a different audience from the name a consumer installs.
- **ESM only.** `"type": "module"`, `exports` map pointing at `dist/`, `files: ["dist"]`. The
  published package additionally ships `src/` so its declaration maps resolve, and excludes every
  test artefact; `pnpm run check:publish` enforces both.
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

`coordinator` has a type-only dependency on published `contracts` for its durable state-store port.
The filesystem reference driver and memory fake live in `coordinator`; neither adds a runtime import
from the published contract back into a private workspace package. See the
[coordinator storage boundary](coordinator/README.md#durable-effect-state) for lifecycle and limits.
