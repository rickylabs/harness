/**
 * @rickylabs/contracts — Published route and type definitions for the netscript UIs (public npm, no secrets).
 *
 * Owned by E8 · #38. This file is a deliberately empty, buildable stub: it exists so the
 * workspace graph and project references resolve. Do not add behaviour here before that
 * epic defines the contract.
 */

/** Workspace package identifier; the only export until the owning epic lands. */
export const PACKAGE_NAME = "@rickylabs/contracts" as const;

export type PackageName = typeof PACKAGE_NAME;
