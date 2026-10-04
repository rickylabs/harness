/** Operator aliases share one resolution rule; private binding values are never normalized. */
export const OPERATOR_ENV = {
  directory: "HARNESS_TELEMETRY_DIR",
  archive: "HARNESS_TELEMETRY_ARCHIVE",
  maxBytes: "HARNESS_TELEMETRY_MAX_BYTES",
  generations: "HARNESS_TELEMETRY_GENERATIONS",
  dispatchRoot: "HARNESS_TELEMETRY_DISPATCH_ROOT",
  claudeChildEventRoot: "HARNESS_TELEMETRY_CLAUDE_CHILD_EVENT_ROOT",
  placementHost: "HARNESS_TELEMETRY_PLACEMENT_HOST",
  nativeHome: "HARNESS_TELEMETRY_NATIVE_HOME",
} as const;
export const LEGACY_OPERATOR_ENV = {
  directory: "DSH_TELEMETRY_DIR",
  archive: "DSH_TELEMETRY_ARCHIVE",
  maxBytes: "DSH_TELEMETRY_MAX_BYTES",
  generations: "DSH_TELEMETRY_GENERATIONS",
  dispatchRoot: "DSH_TELEMETRY_DISPATCH_ROOT",
  claudeChildEventRoot: "DSH_TELEMETRY_CLAUDE_CHILD_EVENT_ROOT",
  placementHost: "DSH_TELEMETRY_PLACEMENT_HOST",
  nativeHome: "DSH_TELEMETRY_NATIVE_HOME",
} as const;
export type OperatorSetting = keyof typeof OPERATOR_ENV;
export type OperatorEnvironment = Readonly<Record<string, string | undefined>>;
const trimmedSettings = new Set<OperatorSetting>(["directory", "archive", "maxBytes", "generations"]);

/** Diagnostics identify keys, never their private values. */
export class OperatorConfigurationError extends Error {}

export function resolveOperatorSetting(env: OperatorEnvironment, setting: OperatorSetting): string | undefined {
  const normalize = (value: string | undefined) => trimmedSettings.has(setting) ? value?.trim() || undefined : value;
  const current = normalize(env[OPERATOR_ENV[setting]]);
  const legacy = normalize(env[LEGACY_OPERATOR_ENV[setting]]);
  if (current !== undefined && legacy !== undefined && current !== legacy) {
    throw new OperatorConfigurationError(`conflicting ${OPERATOR_ENV[setting]} and ${LEGACY_OPERATOR_ENV[setting]}`);
  }
  return current ?? legacy;
}

/** Resolve all native bindings before opening a source or a watcher. */
export function resolveNativeOperatorBindings(env: OperatorEnvironment) {
  return {
    dispatchRoot: resolveOperatorSetting(env, "dispatchRoot"),
    claudeChildEventRoot: resolveOperatorSetting(env, "claudeChildEventRoot"),
    placementHost: resolveOperatorSetting(env, "placementHost"),
  };
}
