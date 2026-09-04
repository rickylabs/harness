/**
 * @rickylabs/dsh-app — our dsh profile and bundle (cordis.patch.yml) composing every plugin
 * package.
 *
 * Owned by E2 · #32. This file is a deliberately empty, buildable stub: it exists so the
 * workspace graph and project references resolve. Do not add behaviour here before that
 * epic defines the profile.
 *
 * It briefly exported an ordered `PLUGIN_PACKAGES` registry, on the theory that importing every
 * sibling exercised the reference graph. It did not: the adversarial review of PR #91 deleted a
 * reference and the build still passed, because pnpm ordered the packages from the manifest and
 * TypeScript resolved the declaration through the package export. The imports proved nothing, and
 * the composition order is an E2 contract that this stub had no business publishing first. The
 * graph is now enforced where it can actually fail — `scripts/check-project-graph.mjs`, which the
 * root build runs before delegating to the packages.
 */

/** Workspace package identifier; the only export until the owning epic lands. */
export const PACKAGE_NAME = "@rickylabs/dsh-app" as const;

export type PackageName = typeof PACKAGE_NAME;
