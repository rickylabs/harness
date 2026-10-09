/**
 * The child environment, and the one thing about it that is load-bearing.
 *
 * #52's first acceptance criterion is a sentence with two halves that pull against each other:
 * *isolate `CLAUDE_CONFIG_DIR`; leave `$HOME` untouched so keychain lookup still resolves.* The
 * obvious way to isolate a CLI's state is to give it a fresh `HOME`, and doing that here breaks
 * authentication — the credential lookup follows `$HOME`, not the config dir, so a run under a
 * sandboxed home is a run that cannot log in. The two variables must therefore diverge, on purpose,
 * and the divergence has to survive people refactoring this module.
 *
 * So it is not a comment. `isolatedEnv` copies the base environment and changes exactly one key,
 * `homeSurvived` states the invariant as a predicate anything can call, and the tests assert it
 * against an environment that carries both `HOME` and `USERPROFILE`.
 *
 * ## Why the checks are refusals rather than clamps
 *
 * Every problem here is a way the isolation is written wrong such that it eats something. Pointing
 * the config dir at `$HOME` does not fail — the CLI happily writes `projects/`, `settings.json` and
 * a shell history into the home directory, and the first symptom is an operator's own configuration
 * changing under them. Silently correcting that would hide which deployment asked for it, so the
 * problem is returned and the composition root decides.
 */

/** The variable that moves a Claude CLI's state off the default `~/.claude`. */
export const CONFIG_DIR_VAR = "CLAUDE_CONFIG_DIR";

/**
 * Variables that name the home directory, in the order the CLI would consult them.
 *
 * `USERPROFILE` is here even though the deployment target is Linux: this package is composed and
 * tested on a Windows workstation, and an isolation check that only knows about `HOME` would report
 * a clean environment there while proving nothing.
 */
export const HOME_VARS = ["HOME", "USERPROFILE"] as const;

/** A way the environment for a run is wrong. */
export type EnvRule = "not-absolute" | "empty" | "is-home" | "shared-config" | "no-home";

export interface EnvProblem {
  readonly rule: EnvRule;
  readonly detail: string;
  /** `true` when no run should be launched with this environment. */
  readonly fatal: boolean;
}

/** An environment as this module reads one: values may be absent, as `process.env`'s are. */
export type BaseEnv = Readonly<Record<string, string | undefined>>;

const WINDOWS_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * Whether a path is absolute, decided identically on every platform.
 *
 * `node:path`'s own `isAbsolute` answers differently depending on where it runs — `C:\agents` is
 * absolute on Windows and relative on Linux — which would make this module's tests say different
 * things on the workstation and on CI. The deployment is Linux and the composition is Windows, so
 * the judgement has to be about the string rather than about the host.
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_ROOT.test(path);
}

/** Compare two directory paths without caring which separator or trailing slash they were written with. */
export function sameDir(a: string, b: string): boolean {
  return normalizeDir(a) === normalizeDir(b);
}

function normalizeDir(path: string): string {
  const slashed = path.replaceAll("\\", "/");
  let end = slashed.length;
  while (end > 1 && slashed[end - 1] === "/") end -= 1;
  return slashed.slice(0, end);
}

/** The home directory the base environment names, or `null` if it names none. */
export function homeOf(base: BaseEnv): string | null {
  for (const key of HOME_VARS) {
    const value = base[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

/**
 * Everything wrong with running under this config directory, fatal and otherwise.
 *
 * @param configDir the isolated `CLAUDE_CONFIG_DIR` a deployment asked for.
 * @param base the environment it would be layered onto.
 */
export function envProblems(configDir: string, base: BaseEnv): readonly EnvProblem[] {
  const found: EnvProblem[] = [];

  if (configDir === "") {
    found.push({
      rule: "empty",
      detail: `${CONFIG_DIR_VAR} is empty, which is not isolation — the CLI falls back to ~/.claude`,
      fatal: true,
    });
    return found;
  }

  if (!isAbsolutePath(configDir)) {
    found.push({
      rule: "not-absolute",
      detail:
        `${CONFIG_DIR_VAR} ${JSON.stringify(configDir)} is relative, so which directory it names ` +
        "depends on the working directory of whatever launched the daemon",
      fatal: true,
    });
  }

  const home = homeOf(base);
  if (home === null) {
    found.push({
      rule: "no-home",
      detail:
        `the environment names no ${HOME_VARS.join(" or ")}; credential lookup follows the home ` +
        "directory, so a run launched from here may be unable to authenticate",
      fatal: false,
    });
    return found;
  }

  if (sameDir(configDir, home)) {
    found.push({
      rule: "is-home",
      detail:
        `${CONFIG_DIR_VAR} is the home directory itself; the CLI would write projects/, ` +
        "settings.json and its history straight into it",
      fatal: true,
    });
  } else if (sameDir(configDir, `${normalizeDir(home)}/.claude`)) {
    found.push({
      rule: "shared-config",
      detail:
        "this is the operator's own ~/.claude, not an isolated one; runs will read and rewrite " +
        "the same sessions, settings and history a person is using",
      fatal: false,
    });
  }

  return found;
}

/** Problems that must stop a dispatch. */
export function fatalEnvProblems(problems: readonly EnvProblem[]): readonly EnvProblem[] {
  return problems.filter((problem) => problem.fatal);
}

/**
 * The environment a run's child process gets: the base, with one key changed.
 *
 * Keys whose value is absent are dropped rather than passed through as `undefined`, because that is
 * what the child would need anyway and it is the difference between an unset variable and one set to
 * the four characters `undefined`.
 */
export function isolatedEnv(base: BaseEnv, configDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value;
  }
  env[CONFIG_DIR_VAR] = configDir;
  return env;
}

/**
 * Whether the built environment left every home variable exactly as it found it.
 *
 * The whole acceptance criterion, as one predicate. It is exported rather than kept to the tests so
 * that a composition root can assert it over an environment it built itself, which is where a future
 * "let's sandbox the home too" would otherwise land unnoticed.
 */
export function homeSurvived(base: BaseEnv, built: Readonly<Record<string, string>>): boolean {
  for (const key of HOME_VARS) {
    const before = base[key];
    const after = Object.hasOwn(built, key) ? built[key] : undefined;
    if (before !== after) return false;
  }
  return true;
}
