/** @rickylabs/method: the only entry. Re-exports the public API; holds no logic. */
export { checkReceipts, validateReceiptText } from './src/application/check-receipts.ts';
export type { IndexedReceiptResult, ReceiptReport } from './src/application/check-receipts.ts';
export { renderMilestoneRun } from './src/application/render-milestone.ts';
export type { RenderOutcome } from './src/application/render-milestone.ts';
export {
  unavailableMilestonePrSource,
  validateMilestoneCluster,
  validateMilestoneRun,
} from './src/application/validate-milestone-cluster.ts';
export { milestonePrSourceFromExport } from './src/adapters/github-pr-export.ts';
export { jsYamlDuplicateKeys } from './src/adapters/js-yaml-duplicate-keys.ts';
export { nodeRunDirectory } from './src/adapters/node-run-directory.ts';
export * from './src/domain/gates/contract.ts';
export { evaluateEvidenceSet } from './src/domain/gates/evidence-set.ts';
export { renderMilestoneStatus, stateDigest, STATUS_PROVENANCE } from './src/domain/milestone/status-page.ts';
export type { MilestoneClusterStateView } from './src/domain/milestone/status-page.ts';
export { MILESTONE_FILES, TOPIC_LANES } from './src/domain/milestone/vocabulary.ts';
export type {
  LiveMilestonePr,
  LiveMilestonePrRole,
  LiveMilestonePrState,
  MilestoneClusterArtifacts,
  ReconciliationFinding,
  TopicLane,
  ValidationResult,
} from './src/domain/milestone/vocabulary.ts';
export { REASON_CODES, ROUTE_FIELDS, SCOPE, validateReceipt } from './src/domain/receipts/route-receipt.ts';
export type { ReceiptFinding, ReceiptResult, ReceiptVerdict } from './src/domain/receipts/route-receipt.ts';
export type { DuplicateKeyCheck, DuplicateKeyVerdict } from './src/ports/duplicate-keys.ts';
export type { MilestonePrSource } from './src/ports/milestone-pr-source.ts';
export type { RunDirectory } from './src/ports/run-directory.ts';
