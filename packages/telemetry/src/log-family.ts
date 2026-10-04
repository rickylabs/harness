/** One selected operator log family. Migration never merges old and new copies. */
import { opendir } from "node:fs/promises";
import type { RotationPolicy } from "./rotation.js";
export const CANONICAL_LOG_NAME = "harness-telemetry.jsonl";
export const LEGACY_LOG_NAME = "dsh-telemetry.jsonl";
export const LOG_NAME_ENV = "HARNESS_TELEMETRY_LOG_NAME";
interface LogTarget { readonly directory: string; readonly policy: RotationPolicy }

const family = /^(harness|dsh)-telemetry(?:\.[1-9]\d*)?\.jsonl$/;
const MAX_DIRECTORY_ENTRIES = 4096;
type Inventory = { readonly canonical: boolean; readonly legacy: boolean };
type Refusal = "log-family-conflict" | "log-family-mismatch" | "selected-log-missing" |
  "selected-log-empty" | "inventory-unavailable" | "inventory-limit";
export class OperatorLogError extends Error {}

async function inventory(directory: string): Promise<Inventory | Refusal> {
  let dir;
  try {
    dir = await opendir(directory);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { canonical: false, legacy: false } : "inventory-unavailable";
  }
  let canonical = false, legacy = false, count = 0;
  try {
    for await (const entry of dir) {
      if (++count > MAX_DIRECTORY_ENTRIES) return "inventory-limit";
      const match = family.exec(entry.name);
      if (match?.[1] === "harness") canonical = true;
      if (match?.[1] === "dsh") legacy = true;
    }
  } catch { return "inventory-unavailable"; }
  return { canonical, legacy };
}

function refusal(target: LogTarget, files: Inventory | Refusal): Refusal | null {
  if (typeof files === "string") return files;
  if (files.canonical && files.legacy) return "log-family-conflict";
  const canonical = target.policy.name === CANONICAL_LOG_NAME;
  if (canonical ? files.legacy : files.canonical) return "log-family-mismatch";
  return null;
}

export async function logFamilyRefusal(target: LogTarget): Promise<Refusal | null> {
  return refusal(target, await inventory(target.directory));
}

/** Writers check before each append; stop all writers for the actual migration rename. */
export async function assertObservabilityWriteTarget(target: LogTarget): Promise<void> {
  const reason = await logFamilyRefusal(target);
  if (reason !== null) throw new OperatorLogError(`live log: ${reason}`);
}
