# packages/

Twelve core packages implement Harness mechanisms or define explicit partial/stub boundaries.
[ADR 0005](../docs/decisions/0005-harness-framework-identity.md) records the current framework
identity on Orchid and Herdr.

This index describes source implementation, not provider configuration,
activation, credentials or a successful native launch on a particular host.

| Package | Implemented boundary | Owner |
| --- | --- | --- |
| `subagents` | Native task requests, provider contract, selection and UHP adapter; UHP dispatch is parked by [ADR 0004](../docs/decisions/0004-uhp-park-evidence.md) | E3 · #33 |
| `providers/claude` | Claude Agent SDK adapter, injected by a composition root | E3 · #33 |
| `providers/opencode` | Adapter over `@opencode-ai/sdk` to a configured OpenCode server; it does not own that server | E3 · #33 |
| `providers/codex` | Partial: app-server route identity and pre-turn protocol prerequisite, not a composed provider | E3 · #33 |
| `llm-local` | API/local adapter configuration, capability and budget tables | E4 · #34 |
| `routing` | Replaceable routing documents, immutable matrix queries and exact native discovery | E4 · #34, E11 · #271 |
| `governance` | Stub package boundary; live launch admission and meters belong to Orchid's governor | E5 · #35 |
| `board` | GitHub task graph and board projections | E6 · #36 |
| `coordinator` | Workflow decisions, replay, independent selection and durable-effect storage boundary | E6 · #36 |
| `forge` | Explicit GitHub taxonomy/process installation and bridge rules | E7 · #37 |
| `contracts` | Published mechanism vocabulary and strict decoders under `@rickylabs/harness-contracts` | E8 · #38 |
| `telemetry` | Native session observations, screened activity, usage and dispatch evidence | E9 · #39 |

A stub holds a buildable place in the project graph, not a working integration. Its README states
what remains unimplemented. Native dispatch in [Orchid](https://github.com/rickylabs/orchid) and
terminal control in [Herdr](https://github.com/herdrdev/herdr) are separate from these package adapters;
a working CLI transport does not imply that a partial package provider is complete.

Native tasks and API/local calls have different loop and enforcement boundaries; their accounting
must use actual vendor/provider sources. [Two seams](../docs/concepts/02-the-two-seams.md) describes
that distinction.

`subagents` is an internal provider boundary. `contracts` is a public mechanism boundary consumed
by separate product backends and, where required, type-only vocabulary consumers. The product
backend owns authorization and the captured API/client used by its native companion. Legacy
`DispatchCommand` names a lane; verified owner-native dispatch uses its separate authority record
and retains physical checks and accounting. No client-supplied model string grants that authority.

## Conventions every package inherits

- **Name** `@rickylabs/<dir>`; `private: true` for everything except `contracts`.
  - **The one exception is `contracts` itself**, published as `@rickylabs/harness-contracts` (#81).
    The other eleven names are internal and only ever read inside this repository, where `contracts`
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

Adding a package: copy any stub directory, rename, add it to the root `tsconfig.json`
`references` list, and declare only its actual consumers.

`coordinator` has a type-only dependency on published `contracts` for its durable state-store port.
The filesystem reference driver and memory fake live in `coordinator`; neither adds a runtime import
from the published contract back into a private workspace package. See the
[coordinator storage boundary](coordinator/README.md#durable-effect-state) for lifecycle and limits.
