import { type MilestoneClusterStateView, renderMilestoneStatus } from "../domain/milestone/status-page.ts";
import { MILESTONE_FILES } from "../domain/milestone/vocabulary.ts";
import type { RunDirectory } from "../ports/run-directory.ts";

export type RenderOutcome = "rendered" | "current" | "stale";

/** Render the status page from the cluster state; with `check`, compare instead of writing. */
export async function renderMilestoneRun(dir: RunDirectory, check: boolean): Promise<RenderOutcome> {
  const state = JSON.parse(await dir.readText(MILESTONE_FILES.state)) as MilestoneClusterStateView;
  const rendered = await renderMilestoneStatus(state);
  if (check) {
    const current = (await dir.readTextIfPresent(MILESTONE_FILES.status)) ?? "";
    return current === rendered ? "current" : "stale";
  }
  await dir.writeText(MILESTONE_FILES.status, rendered);
  return "rendered";
}
