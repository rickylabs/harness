import type { RepositoryRunObservation, RepositoryRunObservationReading } from '@rickylabs/harness-contracts';
import type { RepositoryRunReadOptions } from '../../src/repository-run-observation.js';
export const CANARY: string;
export interface CliResult { code: number | null; stdout: string; stderr: string }
export function runObservationMatrix(options: {
  scratch: string;
  collect: (path: string, options?: RepositoryRunReadOptions) => Promise<RepositoryRunObservation>;
  decode: (input: unknown) => RepositoryRunObservationReading;
  cli: (path: string) => Promise<CliResult>;
  raceCli?: (fixture: unknown, point: string, action: string) => Promise<CliResult>;
}): Promise<string[]>;
