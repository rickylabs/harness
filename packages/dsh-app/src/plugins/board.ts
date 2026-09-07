/**
 * `ctx.harnessBoard` — the configured board projector.
 *
 * GitHub holds board truth; dsh projects the live view (ratified decision 3). The projection itself
 * is `projectBoard`, a pure function in `@rickylabs/board` that this plugin does not reimplement.
 * What the plugin adds is the half that is deployment-specific and has to be resolved once, at
 * boot, rather than guessed at every call site: **which label families this repository uses**.
 *
 * ## The split, and why it falls here
 *
 * `projectBoard` takes six things. Three describe the repository — the lifecycle, the lane prefix,
 * the priority order — and are the same for every projection a daemon makes. Three describe the
 * request — the issues, the repo slug, the timestamp — and are different every time. A service that
 * owned all six would have to be reconfigured to answer a second question; a service that owned
 * none would be a re-export with extra steps.
 *
 * So the service owns the taxonomy and the caller owns the data and the clock. `generatedAt` in
 * particular stays with the caller because the projection is meant to be deterministic: a snapshot
 * that stamped itself from the wall clock could not be compared with the one before it.
 *
 * ## The lane prefix
 *
 * `dsh-forge` detects `orchestrator`, `topic` or `lane` when it stamps a taxonomy, because those
 * three are all in use across the repositories this harness runs in. A projector cannot detect it —
 * it is handed issues, not a repository — so it is config, defaulting to `lane`.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";
import type {
  ProjectionSnapshot,
  SessionProjectionRegistry,
} from "@deepseek-ai/dsh-session-projection";
import z from "@deepseek-ai/schemastery";
import {
  DEFAULT_LIFECYCLE,
  DEFAULT_PRIORITY_ORDER,
  projectBoard,
  type BoardSnapshot,
  type Lifecycle,
  type ProjectOptions,
  type SourceIssue,
} from "@rickylabs/board";
import {
  buildSnapshot,
  buildTree,
  normaliseItems,
  publicTree,
  type GovernanceView,
  type RunRecord,
} from "@rickylabs/telemetry";
import {
  appendBoardRefresh,
  boardProjectionDefinition,
  toBoardProjection,
  todosFromBoard,
} from "./board-projection.js";

/** Where this service attaches. Prefixed so it cannot collide with a service dsh adds later. */
export const CONTEXT_KEY = "harnessBoard" as const;

/** Row id in `cordis.patch.yml`. */
export const name = "harness-board";

/** Lane family prefix used when the patch row says nothing. */
export const DEFAULT_LANE_PREFIX = "lane";

/** What a deployment may set on the `harness-board` row. */
export interface BoardConfig {
  readonly lanePrefix: string;
  readonly priorityOrder: readonly string[];
}

export const Config = z.object({
  lanePrefix: z
    .string()
    .default(DEFAULT_LANE_PREFIX)
    .description("Prefix of the lane label family — `lane`, `topic` or `orchestrator`."),
  priorityOrder: z
    .array(z.string())
    .default([...DEFAULT_PRIORITY_ORDER])
    .description("Priority label values, most urgent first. Items sort by this within a column."),
});

/**
 * The three options the service supplies, removed. What is left is what a caller must pass, and
 * `Omit` states it that way so adding a knob to `ProjectOptions` is a compile error here rather
 * than a silently unconfigurable option.
 */
export type BoundProjectOptions = Omit<
  ProjectOptions,
  "lifecycle" | "lanePrefix" | "priorityOrder"
>;

/** The configured projector. */
export interface BoardService {
  /**
   * The phase list this deployment projects.
   *
   * Not configurable through the patch row. The lifecycle is checked against
   * `.github/labels.yml` by `check:lifecycle`, and a YAML row that could shorten it would put a
   * second, unchecked copy of the board's shape in a file the check does not read.
   */
  readonly lifecycle: Lifecycle;
  readonly lanePrefix: string;
  readonly priorityOrder: readonly string[];
  /** Project fetched issues into columns, using the configured taxonomy. */
  project(issues: readonly SourceIssue[], options: BoundProjectOptions): BoardSnapshot;
  /** Replace the live session's board and todo projections from one caller-owned evidence cut. */
  refresh(session: Session, input: BoardRefreshInput): ProjectionSnapshot;
}

/** Caller-owned inputs: GitHub issues, telemetry runs, clocks, and completeness evidence. */
export interface BoardRefreshInput {
  readonly issues: readonly SourceIssue[];
  readonly project: BoundProjectOptions;
  readonly runs: readonly RunRecord[];
  readonly notes?: readonly string[];
  readonly telemetryComplete: boolean;
  /** Optional typed governance cut captured with these board inputs. */
  readonly observations?: GovernanceView;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    harnessBoard: BoardService;
  }
}

/** Fill in what the patch row left out. One source of truth for the defaults, shared with `Config`. */
export function resolveConfig(config: Partial<BoardConfig> | undefined): BoardConfig {
  return {
    lanePrefix: config?.lanePrefix ?? DEFAULT_LANE_PREFIX,
    priorityOrder: config?.priorityOrder ?? DEFAULT_PRIORITY_ORDER,
  };
}

/** Build the service without a context, so it can be tested without booting cordis. */
export function createService(
  config: Partial<BoardConfig> | undefined,
  registry: () => SessionProjectionRegistry | undefined = () => undefined,
): BoardService {
  const resolved = resolveConfig(config);
  return {
    lifecycle: DEFAULT_LIFECYCLE,
    lanePrefix: resolved.lanePrefix,
    priorityOrder: resolved.priorityOrder,
    project(issues, options) {
      return projectBoard(issues, {
        ...options,
        lifecycle: DEFAULT_LIFECYCLE,
        lanePrefix: resolved.lanePrefix,
        priorityOrder: resolved.priorityOrder,
      });
    },
    refresh(session, input) {
      const projections = registry();
      if (projections === undefined) {
        throw new Error("board refresh requires ctx.sessionProjections");
      }

      // Materialize first: an absent todo capability must fail before either whole-value write.
      if (!("todos" in projections.snapshot(session, ["todos"]).values)) {
        throw new Error("board refresh requires the registered todos projection");
      }

      const board = projectBoard(input.issues, {
        ...input.project,
        lifecycle: DEFAULT_LIFECYCLE,
        lanePrefix: resolved.lanePrefix,
        priorityOrder: resolved.priorityOrder,
      });
      const loaded = normaliseItems(board, "board projection");
      if (!loaded.ok) {
        throw new Error(`board projection normalization failed: ${loaded.notes.join("; ")}`);
      }
      const telemetry = buildSnapshot({
        generatedAt: board.generatedAt,
        runs: input.runs,
        items: loaded.items,
        notes: [...(input.notes ?? []), ...loaded.notes],
        ...(input.observations === undefined ? {} : { governance: input.observations }),
      });
      const tree = buildTree({
        snapshot: telemetry,
        items: loaded.items,
        now: board.generatedAt,
      });
      const complete =
        input.telemetryComplete &&
        board.completeness !== null &&
        board.completeness.capped.length === 0;
      // `board` satisfies BoardEvidence structurally; the snapshot carries the anomalies and the
      // fetch coverage that the activity tree never sees.
      const projection = toBoardProjection(publicTree(tree, complete), board);
      const todos = todosFromBoard(board);

      // Session.append and the projection drive are synchronous. Keep this method synchronous so
      // no second refresh or listener can interleave between these adjacent replacement events.
      appendBoardRefresh(session, todos, projection);
      return projections.snapshot(session, ["todos", "harnessBoard"]);
    },
  };
}

export function apply(ctx: Context, config?: Partial<BoardConfig>): void {
  let projections: SessionProjectionRegistry | undefined;
  ctx.provide(CONTEXT_KEY, createService(config, () => projections));
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projections = projectionCtx.sessionProjections;
    projectionCtx.sessionProjections.register(boardProjectionDefinition);
    projectionCtx.effect(
      () => () => {
        if (projections === projectionCtx.sessionProjections) projections = undefined;
      },
      "harness-board projection binding",
    );
  });
}

export default { name, Config, apply };
