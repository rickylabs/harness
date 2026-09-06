/**
 * `@rickylabs/dsh-app` — the profile and the bundle.
 *
 * This is the only package in the repository that knows dsh exists. Every other package is plain
 * TypeScript with no framework dependency, and stays that way: the domain logic is tested by
 * running it, not by booting a container to run it. What lives here is the *binding* — the five
 * plugin modules that put something on a cordis `Context`, the patch layer that names them, and the
 * profile that composes that layer with `dsh-base`.
 *
 * Keeping the coupling in one package is a decision, not an accident. The alternative — every
 * subsystem shipping its own cordis plugin — would put a framework dependency in fifteen packages
 * to serve zero external consumers, since all of them but `contracts` are `private: true`. It would
 * also make ratified decision 2's adapter pattern impossible to hold: netscript is reached as a
 * service behind an adapter precisely so that nothing below this line has to know what is running
 * it.
 *
 * ## The four services
 *
 * | key | seam | owned by |
 * |---|---|---|
 * | `ctx.subagents` | vendor CLIs, metered by quota window | E3 · #33 |
 * | `ctx.harnessBoard` | the configured board projector | E6 · #36 |
 * | `ctx.harnessCoordinator` | workflows and the independence policy | E6 · #36 |
 * | `ctx.harnessTelemetry` | run evidence, resolved once at boot | E9 · #39 |
 *
 * `ctx.subagents` is unprefixed because `@rickylabs/subagents` fixed that name next to the
 * interface it holds. The other three carry a `harness` prefix so that a service dsh adds later
 * cannot collide with one of ours — a collision that cordis reports as
 * `service "x" has been registered at <fiber>`, at boot, with no way to rename either side.
 *
 * There is a fifth plugin module and no fifth key. `ctx.llm` is the other half of the subagent seam
 * — it takes an API key and meters per token, and collapsing the two into one abstraction is the
 * design error the split exists to prevent — but it is `@deepseek-ai/dsh-llm`'s key, not ours, and
 * the composed profile already mounts it. `harness-llm` (E2 · #176) therefore *registers* an
 * adapter for our three token-metered destinations on a seam it does not own, and claims nothing.
 * A row that provided `llm` would be a second claim on a key that already has an owner, which is
 * exactly the boot-time collision the `harness` prefix above exists to avoid.
 *
 * ## Where the two seams are allowed to meet
 *
 * `instrument.ts` is the exception to "this package only binds". It holds the decorator that writes
 * a telemetry event for every subagent verb, and it is here because this is the only package that
 * may depend on both `@rickylabs/subagents` and `@rickylabs/telemetry` — each of which has zero
 * workspace dependencies, deliberately. `harness-subagents` therefore `inject`s
 * `harnessTelemetry`: the seam hands out an instrumented registry or it does not load at all.
 */

export {
  BUNDLE_ROWS,
  PATCH_FILE,
  PATCH_HEADER,
  renderPatch,
  subpathOf,
  type BundleRow,
} from "./bundle.js";

export {
  bundlesFor,
  checkProfileName,
  isSurfaceName,
  manifest,
  planProfile,
  plannedRowIds,
  BUNDLE_PACKAGE,
  DEFAULT_SURFACE,
  PATCH_RELOAD,
  PROFILE_BUNDLES,
  PROFILE_NAME,
  PROFILE_SURFACES,
  PROFILES_DIR,
  SURFACE_NAMES,
  type PlanOptions,
  type PlannedFile,
  type PlannedLink,
  type ProfilePlan,
  type SurfaceName,
} from "./profile.js";

export {
  applyPlan,
  diffPlan,
  nodeFs,
  packageDirOf,
  main as runProfileCli,
  EXIT,
  UsageError,
  WriteError,
  type CliDeps,
  type Difference,
  type ProfileFs,
} from "./cli.js";

export {
  CONTEXT_KEY as BOARD_CONTEXT_KEY,
  createService as createBoardService,
  resolveConfig as resolveBoardConfig,
  DEFAULT_LANE_PREFIX,
  type BoardConfig,
  type BoardService,
  type BoardRefreshInput,
  type BoundProjectOptions,
} from "./plugins/board.js";

export {
  BOARD_PROJECTION_KEY,
  BOARD_WRITE_EVENT,
  boardProjectionSchema,
  toBoardProjection,
  todosFromBoard,
  type BoardProjection,
} from "./plugins/board-projection.js";

export {
  CONTEXT_KEY as COORDINATOR_CONTEXT_KEY,
  createService as createCoordinatorService,
  resolvePolicy,
  DEFAULT_POLICY,
  POLICIES,
  type CoordinatorConfig,
  type CoordinatorService,
} from "./plugins/coordinator.js";

export {
  CONTEXT_KEY as TELEMETRY_CONTEXT_KEY,
  createService as createTelemetryService,
  resolveHome,
  type TelemetryConfig,
  type TelemetryService,
} from "./plugins/telemetry.js";

export { createRegistry as createSubagentRegistry, emptyRegistry } from "./plugins/subagents.js";

// No `CONTEXT_KEY` here, unlike the four above: `harness-llm` registers on `ctx.llm` and claims
// nothing of its own. What it exports instead is the adapter, reachable without booting cordis.
export {
  createAdapter as createLlmAdapter,
  resolveOverrides as resolveLlmOverrides,
  type LlmConfig,
} from "./plugins/llm.js";

export {
  envCredentials,
  LocalLlmAdapter,
  ADAPTER_FAILURE_CODES,
  CREDENTIAL_REF,
  PROVIDER_NAMES,
  type AdapterFailureCode,
  type AdapterOptions,
  type CredentialReader,
} from "./llm/adapter.js";

export {
  fetchTransport,
  type Transport,
  type WireExchange,
  type WireRequest,
} from "./llm/transport.js";

export {
  clipDetail,
  instrumentProvider,
  instrumentRegistry,
  sourceOfHarness,
  DETAIL_CAP,
  EVENT_KIND,
  type EventKind,
  type InstrumentOptions,
} from "./instrument.js";

export {
  captureDump,
  captureFromScratch,
  checkReason,
  countRows,
  dshPackage,
  missingFrom,
  parseGolden,
  renderGolden,
  rowIds,
  GOLDEN_FILE,
  MARKER,
  type CaptureOptions,
  type DshPackage,
  type Golden,
  type Provenance,
} from "./golden.js";

/** Workspace package identifier. */
export const PACKAGE_NAME = "@rickylabs/dsh-app" as const;

export type PackageName = typeof PACKAGE_NAME;
