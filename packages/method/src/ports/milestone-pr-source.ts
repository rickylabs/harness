import type { LiveMilestonePr } from '../domain/milestone/vocabulary.ts';

/** Read-only view of the milestone's live pull requests, used for reconciliation. */
export interface MilestonePrSource {
  listOpenMilestonePrs(repo: string, milestone: string): Promise<readonly LiveMilestonePr[]>;
  readPrHead(repo: string, prNumber: number): Promise<LiveMilestonePr>;
}
