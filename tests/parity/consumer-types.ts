// Consumer parity, type half: the types atelier-cockpit imports from this repository. Compiled only
// by the `typecheck:compile` stage of `pnpm run typecheck` (root tsconfig.json includes tests/parity).
// A removed or renamed type fails that stage; name the consumer that must follow (docs/STRUCTURE.md).
import type {
  AccountUsageDocument,
  AccountUsageEnvelope,
  AgentActivityCoverage,
  AgentActivityGap,
  AgentActivityState,
  AgentObservation,
  AgentObservations,
  AgentObservedValue,
  AgentUnavailableReason,
  IssueAgentTreeAgent,
  IssueAgentTreeSnapshot,
  NativeToolCallDescriptor,
  NativeToolCallRead,
  PaidAccountUsageEnvelope,
  ProviderBudgetDecision,
  ProviderLimitMeterV1,
  ProviderLimitSnapshotV1,
  ProviderOutcomeV1,
  ProviderUsageSnapshot,
  RemoteSnapshot,
  RepositoryRunBinding,
  RepositoryRunObservation,
  RouteIdentityEvidence,
  RoutineRevision,
  RoutineWake,
  SessionRef,
  UsageAccountRef,
  WorkflowRevision,
  WorkflowRevisionBundle,
  WorkflowRevisionBundlePayload,
} from "@rickylabs/harness-contracts";
import type { HubStep } from "@rickylabs/harness-contracts/server";
// cockpit imports these two files by raw GitHub URL (deno.json `@harness/dispatch`, `@harness/cli-discovery`).
import type { DispatchRequest } from "../../packages/subagents/src/dispatch.js";
import type { CliDiscoveryOptions, CliDiscoverySnapshot } from "../../packages/routing/src/discovery.js";

/** cockpit: `@rickylabs/harness-contracts` (npm, also aliased as `@harness/agent-observations`). */
export type CockpitContractTypes = [
  AccountUsageDocument,
  AccountUsageEnvelope,
  AgentActivityCoverage,
  AgentActivityGap,
  AgentActivityState,
  AgentObservation,
  AgentObservations,
  AgentObservedValue<unknown>,
  AgentUnavailableReason,
  IssueAgentTreeAgent,
  IssueAgentTreeSnapshot,
  PaidAccountUsageEnvelope,
  ProviderBudgetDecision,
  ProviderLimitMeterV1,
  ProviderLimitSnapshotV1,
  ProviderOutcomeV1,
  ProviderUsageSnapshot,
  RemoteSnapshot,
  RepositoryRunBinding,
  RepositoryRunObservation,
  RouteIdentityEvidence,
  RoutineRevision,
  RoutineWake,
  SessionRef,
  UsageAccountRef,
  WorkflowRevision,
  WorkflowRevisionBundle,
  WorkflowRevisionBundlePayload,
];
/** In-repo producer seam (a provider adapter → telemetry), exported from the published entry. */
export type ProducerSeamTypes = [NativeToolCallDescriptor, NativeToolCallRead];
/** cockpit: `@rickylabs/harness-contracts/server`. */
export type CockpitServerTypes = [HubStep];
/** cockpit: raw-URL `packages/subagents/src/dispatch.ts` and `packages/routing/src/discovery.ts`. */
export type CockpitRawSourceTypes = [DispatchRequest, CliDiscoveryOptions, CliDiscoverySnapshot];
