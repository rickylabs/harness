import { nonNegativeInteger, oneOf } from '../json.ts';

export const TOPIC_LANES = ['docs', 'internals', 'fixes', 'features'] as const;
export const INTAKE_SOURCES = ['targetMilestone', 'unmilestoned', 'backlog', 'laterMilestone'] as const;
export const ADMISSION_PREDICATES = [
  'release-critical',
  'dependency-required',
  'high-value-coherent',
] as const;
export const DISPOSITIONS = [
  'active',
  'move',
  'close-fixed',
  'close-duplicate',
  'close-superseded',
] as const;
export const EDGE_KINDS = ['requires', 'rfc-prerequisite', 'cross-epic-order'] as const;
export const LEAF_PHASES = [
  'planned',
  'implementing',
  'gating',
  'evaluating',
  'blocked',
  'ready',
  'merged',
  'moved',
  'closed',
] as const;
export const TERMINAL_LEAF_PHASES = new Set(['merged', 'moved', 'closed']);
export const REPORT_LANE_STATES = ['active', 'queued', 'blocked', 'stalled', 'complete'] as const;
export const CANARY_REPORT_STATES = [
  'not-planned',
  'planned',
  'qualifying',
  'blocked',
  'ready',
  'publishing',
  'complete',
] as const;
export const REPORT_CONFIDENCE = ['low', 'medium', 'high'] as const;
export const BLOCKER_CATEGORIES = [
  'product',
  'test-harness',
  'infrastructure',
  'lifecycle-metadata',
  'evaluator-transport',
] as const;

export interface MilestoneClusterArtifacts {
  readonly intake: unknown;
  readonly inventory: unknown;
  readonly dag: unknown;
  readonly state: unknown;
  readonly status: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly findings: readonly ReconciliationFinding[];
}

export type TopicLane = (typeof TOPIC_LANES)[number];
export type LiveMilestonePrState = 'open' | 'merged' | 'closed';
export type LiveMilestonePrRole = 'leaf' | 'coordinator-artifact';

export interface LiveMilestonePr {
  readonly number: number;
  readonly issueNumbers: readonly number[];
  readonly lane: TopicLane | null;
  readonly baseBranch: string;
  readonly headSha: string;
  readonly state: LiveMilestonePrState;
  readonly role: LiveMilestonePrRole;
}

export interface ReconciliationFinding {
  readonly kind: 'stale-head' | 'missing-leaf' | 'source-unavailable';
  readonly issueNumber: number | null;
  readonly prNumber: number | null;
  readonly lane: TopicLane | null;
  readonly recordedHead: string | null;
  readonly liveHead: string | null;
  readonly detail?: string;
}

export function knownResourceCountOrUnknown(value: unknown): value is number | null {
  return value === null || nonNegativeInteger(value);
}

export function topicLane(value: unknown): value is TopicLane {
  return oneOf(value, TOPIC_LANES);
}

/** The artifact files of one milestone run directory. */
export const MILESTONE_FILES = {
  intake: 'milestone-intake.json',
  inventory: 'milestone-inventory.json',
  dag: 'milestone-dependency-dag.json',
  state: 'milestone-cluster-state.json',
  status: 'milestone-status.md',
} as const;
