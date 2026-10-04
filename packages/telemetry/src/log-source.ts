/** Read one selected operator log family, preserving the existing event decoder. */
import { readLiveLog, type LiveLog } from "./live.js";
import { CANONICAL_LOG_NAME, logPaths, type Observability } from "./observability.js";
import { logFamilyRefusal } from "./log-family.js";
export { assertObservabilityWriteTarget, OperatorLogError } from "./log-family.js";
const unavailable = (reason: string): LiveLog => ({ files: [], notes: [`live log: ${reason}`], degraded: true });

/** Inspect both families before and after the existing parser; source/event times are untouched. */
export async function readObservabilityLog(target: Observability, now: string, read: typeof readLiveLog = readLiveLog): Promise<LiveLog> {
  const before = await logFamilyRefusal(target);
  if (before !== null) return unavailable(before);
  const log = await read(logPaths(target), now);
  const after = await logFamilyRefusal(target);
  if (after !== null) return unavailable(after);
  // Missing optional legacy logs retain their established semantics. Explicit canonical selection
  // is a migration assertion: it cannot turn an absent/empty source into a healthy empty fleet.
  if (target.policy.name === CANONICAL_LOG_NAME) {
    if (log.files.length === 0) return unavailable("selected-log-missing");
    if (!log.files.some(file => file.events.length > 0)) return unavailable("selected-log-empty");
  }
  return log;
}

