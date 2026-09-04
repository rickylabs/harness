/**
 * @rickylabs/coordinator — MASTER agent — milestone → epic → task workflows.
 *
 * Owned by E6 · #36. This file is a deliberately empty, buildable stub: it exists so the
 * workspace graph and project references resolve. Do not add behaviour here before that
 * epic defines the contract.
 */

/** Workspace package identifier; the only export until the owning epic lands. */
export const PACKAGE_NAME = "@rickylabs/coordinator" as const;

export type PackageName = typeof PACKAGE_NAME;
