import { isRecord, type JsonRecord, nonEmpty } from '../domain/json.ts';
import { validateDag } from '../domain/milestone/dag.ts';
import { requireSharedIdentity, validateIntake, validateIntakeInventoryCrossing, validateInventory } from '../domain/milestone/intake.ts';
import { validateState } from '../domain/milestone/state.ts';
import { renderMilestoneStatus } from '../domain/milestone/status-page.ts';
import {
  type MilestoneClusterArtifacts,
  MILESTONE_FILES,
  type ReconciliationFinding,
  type ValidationResult,
} from '../domain/milestone/vocabulary.ts';
import type { MilestonePrSource } from '../ports/milestone-pr-source.ts';
import type { RunDirectory } from '../ports/run-directory.ts';
import { reconcileMilestonePrs } from './reconcile-milestone-prs.ts';

export function unavailableMilestonePrSource(detail: string): MilestonePrSource {
  const unavailable = () => Promise.reject<never>(new Error(detail));
  return {
    listOpenMilestonePrs: unavailable,
    readPrHead: unavailable,
  };
}

export async function validateMilestoneCluster(
  artifacts: MilestoneClusterArtifacts,
  source: MilestonePrSource = unavailableMilestonePrSource(
    'GitHub PR reconciliation source was not provided',
  ),
): Promise<ValidationResult> {
  const errors: string[] = [];
  const findings: ReconciliationFinding[] = [];
  if (!isRecord(artifacts.intake)) errors.push('milestone-intake.json must be an object');
  if (!isRecord(artifacts.inventory)) errors.push('milestone-inventory.json must be an object');
  if (!isRecord(artifacts.dag)) errors.push('milestone-dependency-dag.json must be an object');
  if (!isRecord(artifacts.state)) errors.push('milestone-cluster-state.json must be an object');
  if (errors.length > 0) return { ok: false, errors, findings };

  const intake = artifacts.intake as JsonRecord;
  const inventory = artifacts.inventory as JsonRecord;
  const dag = artifacts.dag as JsonRecord;
  const state = artifacts.state as JsonRecord;
  requireSharedIdentity(errors, intake, inventory, dag, state);
  const candidates = validateIntake(errors, intake);
  const inventoryIssues = validateInventory(errors, inventory);
  validateIntakeInventoryCrossing(errors, intake, candidates, inventoryIssues);
  const activeIssues = inventoryIssues.filter((issue) => issue.disposition === 'active');
  validateDag(errors, dag, activeIssues);
  validateState(errors, state, activeIssues);

  if (nonEmpty(intake.repo) && nonEmpty(state.milestone)) {
    findings.push(...await reconcileMilestonePrs(state, intake.repo, state.milestone, source));
  } else {
    findings.push({
      kind: 'source-unavailable',
      issueNumber: null,
      prNumber: null,
      lane: null,
      recordedHead: null,
      liveHead: null,
      detail: 'cluster artifacts do not provide a repository and milestone for reconciliation',
    });
  }

  const rendered = await renderMilestoneStatus(state);
  if (artifacts.status !== rendered) {
    errors.push('milestone-status.md is stale; regenerate it from milestone-cluster-state.json');
  }
  return { ok: errors.length === 0 && findings.length === 0, errors, findings };
}

/** Validate one run directory: read its five artifacts, then validate them against `source`. */
export async function validateMilestoneRun(
  dir: RunDirectory,
  source: MilestonePrSource,
): Promise<ValidationResult> {
  const json = async (name: string): Promise<unknown> => JSON.parse(await dir.readText(name));
  return await validateMilestoneCluster({
    intake: await json(MILESTONE_FILES.intake),
    inventory: await json(MILESTONE_FILES.inventory),
    dag: await json(MILESTONE_FILES.dag),
    state: await json(MILESTONE_FILES.state),
    status: await dir.readText(MILESTONE_FILES.status),
  }, source);
}
