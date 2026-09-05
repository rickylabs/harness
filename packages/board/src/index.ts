/**
 * @rickylabs/board — task DAG and kanban projection.
 *
 * Owned by E6 · #36. This package implements the projection half of that epic: GitHub issues in,
 * board snapshot and hierarchy out. Workflow definitions, dispatch execution, and gate wiring are
 * the coordinator half and live in `@rickylabs/coordinator`.
 *
 * The whole projection is pure. `projectBoard` and `buildHierarchy` take data and return data,
 * take their timestamp as an argument rather than reading a clock, and never write anything —
 * which is what makes a snapshot reproducible and what keeps decision 3 ("the issue wins") true
 * by construction rather than by discipline.
 */

export {
  DEFAULT_LIFECYCLE,
  phaseLabels,
  phaseOf,
  statusLabelsOf,
  unknownStatusLabels,
  violatesSingleStatus,
} from "./lifecycle.js";
export type { Lifecycle, Phase } from "./lifecycle.js";

export { isAbandoned, isDeliveryUnknown, isShipped, labelValue, labelValues } from "./model.js";
export type {
  Anomaly,
  AnomalyKind,
  BoardColumn,
  BoardItem,
  BoardSnapshot,
  Completeness,
  ItemKind,
  SourceIssue,
} from "./model.js";

export { compareNullableStrings, compareStrings } from "./order.js";

export { DEFAULT_PRIORITY_ORDER, projectBoard, slugOfEpicTitle } from "./project.js";
export type { ProjectOptions } from "./project.js";

export { buildHierarchy, epicSlugOf } from "./hierarchy.js";
export type { EpicNode, Hierarchy, MilestoneNode, Progress } from "./hierarchy.js";

export {
  DEFAULT_HARNESS,
  DispatchEncodingError,
  HARNESSES,
  PROMPT_GUARD,
  ROUTERS,
  parseGoDuration,
  parseSwarm,
  renderSwarm,
  toDispatchRequest,
  validateDispatch,
} from "./dispatch.js";
export type {
  DispatchRequest,
  Harness,
  ParsedSwarm,
  Router,
  SwarmOverrides,
  SwarmWarning,
} from "./dispatch.js";

export {
  renderAnomalies,
  renderBar,
  renderColumns,
  renderCompleteness,
  renderHierarchy,
  renderProgress,
} from "./render.js";

export { detectRepoSlug, fetchItems, transportFailure, TransportUnavailable } from "./github.js";
export type { FetchResult, GhRunner } from "./github.js";

export { main as runBoardCli } from "./cli.js";
export type { CliDeps } from "./cli.js";

/** Workspace package identifier. */
export const PACKAGE_NAME = "@rickylabs/board" as const;

export type PackageName = typeof PACKAGE_NAME;
