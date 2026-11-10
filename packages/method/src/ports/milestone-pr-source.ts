import type { LiveMilestonePr } from '../domain/milestone/vocabulary.ts';
import type { RepositorySnapshot } from '../domain/milestone/identity.ts';

/** Read-only view of the milestone's live pull requests, used for reconciliation. */
export interface MilestonePrSource {
  readRepository(repo: string): Promise<RepositorySnapshot>;
  listOpenMilestonePrs(repo: string, milestone: string): Promise<readonly LiveMilestonePr[]>;
  readPrHead(repo: string, prNumber: number): Promise<LiveMilestonePr>;
}
