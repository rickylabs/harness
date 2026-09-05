/**
 * The `rickylabs` dsh profile, as a plan.
 *
 * A dsh profile is a directory under `$DSH_HOME/profiles/<name>` holding a manifest that lists the
 * bundles to compose. dsh can create one itself — `dsh plugin --profile <name> add <package>` — but
 * that path seeds `["@deepseek-ai/dsh-base"]` and then requires someone to hand-edit the manifest to
 * add ours, in the right array, in the right order. The repository's own principle settles what to
 * do about that: *anything an agent is asked to do repeatedly and identically is a bug in the
 * harness*. So the profile is generated, from here.
 *
 * ## Pure on purpose
 *
 * Nothing in this module touches the filesystem. It returns the bytes and the paths; `cli.ts` writes
 * them. That is what makes the interesting half testable — the manifest shape has to match what dsh
 * itself writes, and a test that asserts against a string is a test that keeps matching it.
 *
 * ## The link, and why there is no dependency entry
 *
 * `@rickylabs/dsh-app` is `private: true` and unpublished, so it cannot appear in the profile's
 * `dependencies`: a `pnpm install` in that directory would fail to resolve it, and `dsh plugin add`
 * runs exactly that. Instead the installer links `node_modules/@rickylabs/dsh-app` at the package
 * directory. dsh's bundle resolver walks `node_modules` upward from the profile's own
 * `package.json`, so the link is the first candidate it finds; Node resolves the link before
 * resolving the package's own imports, so our workspace dependencies come from the workspace.
 *
 * The consequence is worth stating plainly rather than discovering: **this profile is bound to a
 * checkout.** Move or delete the repository and the profile stops booting. That is the correct
 * trade while the package is unpublished, and it is why `check` reports the link's target.
 */

import { isAbsolute, join } from "node:path";

import { BUNDLE_ROWS, PATCH_FILE } from "./bundle.js";

/** The profile this package installs. */
export const PROFILE_NAME = "rickylabs";

/** Directory under the dsh home that holds profiles. Mirrors dsh's own layout. */
export const PROFILES_DIR = "profiles";

/** Package name of this bundle, as the profile manifest and the link path spell it. */
export const BUNDLE_PACKAGE = "@rickylabs/dsh-app";

/**
 * The app bundle each surface contributes, between `dsh-base` and ours.
 *
 * A dsh profile is `dsh-base` plus *one* app bundle that decides how a person reaches the agent —
 * a terminal, a browser, an ACP client, a one-shot task. dsh ships templates for its own
 * (`web`, `acp`, `headless`, `sdk`); ours has to state the same choice, because a profile that
 * presumed one would have to be rewritten to un-presume it.
 *
 * Two are offered, and the omissions are deliberate:
 *
 * - **`tui`** — no app bundle at all. `dsh-base` carries the terminal surface itself, which is what
 *   dsh's own un-templated `tui` profile is: `["@deepseek-ai/dsh-base"]`. This is the default, and
 *   it is the composition [`dump-config.golden.yml`](../dump-config.golden.yml) records.
 * - **`web`** — `@deepseek-ai/dsh-web-app`, the browser surface E2.3 (#48) deploys on the N5.
 *
 * `headless` is not here because its runner expects a task, so a profile carrying it cannot be
 * started without one; that is a different shape of command line, not a different surface.
 *
 * ### What `web` costs, stated once
 *
 * The web bundle **moves the per-agent tool plane behind agent presets** — it disables `tool-bash`,
 * `tool-fs`, `tool-subagent` and two dozen more at the root and lets each session mount a preset
 * instead. That is the supported shape of that surface, not a regression: the *registries* those
 * tools resolve (`subagents`, `jobs`, `skill`, the token meter) stay host-plane, and `subagents` is
 * exactly the seam `harness-subagents` claims. Our four rows are host-plane services and the web
 * bundle does not address any of them.
 */
export const PROFILE_SURFACES = {
  tui: [],
  web: ["@deepseek-ai/dsh-web-app"],
} as const satisfies Record<string, readonly string[]>;

/** A surface this package can install. */
export type SurfaceName = keyof typeof PROFILE_SURFACES;

/** The surface a profile gets when nobody says. */
export const DEFAULT_SURFACE: SurfaceName = "tui";

/** Surface names, in the order `check` tries them when inferring. Default first. */
export const SURFACE_NAMES: readonly SurfaceName[] = [
  DEFAULT_SURFACE,
  ...(Object.keys(PROFILE_SURFACES) as SurfaceName[]).filter((name) => name !== DEFAULT_SURFACE),
];

/** Narrow an arbitrary string to a surface this package knows. */
export function isSurfaceName(value: string): value is SurfaceName {
  return Object.hasOwn(PROFILE_SURFACES, value);
}

/**
 * Bundles a surface composes, in application order.
 *
 * Ours is always last: a patch layer wins over the layers before it, so a surface bundle that ever
 * did address one of our rows would be overridden rather than silently in charge.
 */
export function bundlesFor(surface: SurfaceName = DEFAULT_SURFACE): readonly string[] {
  return ["@deepseek-ai/dsh-base", ...PROFILE_SURFACES[surface], BUNDLE_PACKAGE];
}

/**
 * Bundles the default (`tui`) profile composes.
 *
 * Kept as a named constant because it is the one the golden snapshot pins.
 */
export const PROFILE_BUNDLES: readonly string[] = bundlesFor(DEFAULT_SURFACE);

/**
 * `startup`, not `live`.
 *
 * `live` watches the patch files and reloads on change, which is the right default for someone
 * editing a profile by hand. This profile is generated; a reload triggered by the generator
 * rewriting a file it is about to rewrite again is a race with no upside.
 */
export const PATCH_RELOAD = "startup";

/** A file the plan writes. */
export interface PlannedFile {
  /** Path relative to the profile directory. */
  readonly path: string;
  readonly contents: string;
  /**
   * Whether this package owns the file.
   *
   * Managed files are rewritten on every install and compared by `check`. Unmanaged files are seeds
   * — written once if absent, never overwritten, never compared — because they are the deployment's
   * to edit. `cordis.patch.yml` in the profile is the layer that overrides ours; owning it would
   * mean this package could silently revert an operator's override.
   */
  readonly managed: boolean;
}

/** The link that makes the bundle resolvable from the profile. */
export interface PlannedLink {
  /** Path relative to the profile directory. */
  readonly path: string;
  /** Absolute path of this package's directory. */
  readonly target: string;
}

/** Everything an install has to put on disk. */
export interface ProfilePlan {
  readonly name: string;
  /** The surface this profile boots. */
  readonly surface: SurfaceName;
  /** Bundles the manifest names, in application order. */
  readonly bundles: readonly string[];
  /** Absolute dsh home the profile lives under. */
  readonly home: string;
  /** Absolute profile directory. */
  readonly dir: string;
  readonly files: readonly PlannedFile[];
  readonly link: PlannedLink;
}

export interface PlanOptions {
  /** Absolute dsh home. Resolve it with `resolveDshHome` before calling; this module is pure. */
  readonly home: string;
  /** Absolute directory of this package, used as the link target. */
  readonly packageDir: string;
  /** Profile name. Defaults to `rickylabs`. */
  readonly name?: string;
  /** Surface to install. Defaults to `tui`. */
  readonly surface?: SurfaceName;
}

/** Names dsh refuses, restated so the failure arrives before anything is written. */
const RESERVED_NAMES = new Set([".", "..", "node_modules"]);

/**
 * Validate a profile name against dsh's rules.
 *
 * @throws {RangeError} for an empty name, a name containing a path separator, or a reserved name.
 */
export function checkProfileName(name: string): void {
  if (name === "") throw new RangeError("profile name is empty");
  if (name.includes("/") || name.includes("\\")) {
    throw new RangeError(`profile name ${JSON.stringify(name)} contains a path separator`);
  }
  if (RESERVED_NAMES.has(name)) {
    throw new RangeError(`profile name ${JSON.stringify(name)} is reserved`);
  }
}

/** The profile manifest, as the object dsh reads. */
export function manifest(
  name: string,
  surface: SurfaceName = DEFAULT_SURFACE,
): Record<string, unknown> {
  return {
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: [...bundlesFor(surface)],
        patchReload: PATCH_RELOAD,
      },
    },
  };
}

/**
 * pnpm's own configuration for the profile directory, byte-identical to what dsh writes.
 *
 * Reproduced rather than imported because dsh does not export it, and a profile whose linker
 * differs from the one dsh assumes resolves bundles from a different place than the resolver looks.
 */
const PNPM_WORKSPACE = "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n";

/** Seed contents of the profile's own patch layer: a valid, empty, explained entry list. */
const PROFILE_PATCH_SEED = [
  "# This deployment's patch layer, applied after every bundle layer — including the",
  "# rickylabs bundle, which is why an override written here wins.",
  "#",
  "# A top-level YAML array of loader patch entries: id-targeted config overrides,",
  "# disables, and insert lists. `!!js` expressions are allowed. The ids our bundle",
  "# adds are listed in packages/dsh-app/cordis.patch.yml.",
  "#",
  "# Seeded once and never rewritten. This file is yours.",
  "[]",
  "",
].join("\n");

/**
 * Build the plan.
 *
 * @throws {RangeError} if the name is one dsh refuses, or a path that should be absolute is not.
 */
export function planProfile(options: PlanOptions): ProfilePlan {
  const name = options.name ?? PROFILE_NAME;
  const surface = options.surface ?? DEFAULT_SURFACE;
  checkProfileName(name);
  if (!isAbsolute(options.home)) {
    throw new RangeError(`dsh home ${JSON.stringify(options.home)} is not absolute`);
  }
  if (!isAbsolute(options.packageDir)) {
    throw new RangeError(`package directory ${JSON.stringify(options.packageDir)} is not absolute`);
  }

  const dir = join(options.home, PROFILES_DIR, name);
  return {
    name,
    surface,
    bundles: bundlesFor(surface),
    home: options.home,
    dir,
    files: [
      {
        path: "package.json",
        contents: `${JSON.stringify(manifest(name, surface), null, 2)}\n`,
        managed: true,
      },
      { path: "pnpm-workspace.yaml", contents: PNPM_WORKSPACE, managed: true },
      { path: PATCH_FILE, contents: PROFILE_PATCH_SEED, managed: false },
    ],
    link: { path: join("node_modules", BUNDLE_PACKAGE), target: options.packageDir },
  };
}

/**
 * The row ids this profile will put on the entry list, for a receipt.
 *
 * Read off `BUNDLE_ROWS` rather than restated, so a row added to the bundle shows up in what the
 * installer prints without anyone remembering to add it twice.
 */
export function plannedRowIds(): readonly string[] {
  return BUNDLE_ROWS.map((row) => row.id);
}
