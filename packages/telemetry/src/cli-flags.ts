/** Command-line flags for `harness-telemetry`. */
import { homedir } from "node:os";
import { isAbsolute } from "node:path";

export interface Flags {
  readonly home: string;
  readonly items: string | null;
  readonly observations: string | null;
  readonly observationsFrom: string | null;
  readonly nowExplicit: boolean;
  readonly limit: number;
  readonly since: string | null;
  /** `--since` as an epoch millisecond, which is what actually bounds the readers. */
  readonly sinceMs: number | null;
  readonly now: string;
  readonly json: boolean;
  readonly help: boolean;
  /** `record` only: the run one event belongs to. */
  readonly run: string | null;
  /** `record` only: the kind of that one event. Present means "do not read stdin". */
  readonly kind: string | null;
  readonly rest: readonly string[];
}

/**
 * Parse a timestamp flag, or refuse.
 *
 * `--since not-a-date` used to be accepted and compared as a string, which silently returned zero
 * runs: an operator asking a reasonable question got "nothing is happening" and exit 0.
 */
function timeFlag(raw: string, flag: string): number {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`${flag} needs a time, like 2026-09-05T00:00:00Z`);
  return ms;
}

export function parseFlags(argv: readonly string[]): Flags {
  let home = homedir();
  let items: string | null = null;
  let observations: string | null = null;
  let observationsFrom: string | null = null;
  let nowExplicit = false;
  let limit = 500;
  let since: string | null = null;
  let sinceMs: number | null = null;
  let now = new Date().toISOString();
  let json = false;
  let help = false;
  let run: string | null = null;
  let kind: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${String(arg)} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--home":
        home = next();
        break;
      case "--items":
        items = next();
        break;
      case "--observations":
        observations = next();
        break;
      case "--observations-from":
        observationsFrom = next();
        break;
      case "--limit": {
        // Parsed strictly rather than leniently: `--limit 1.5` under parseInt becomes 1, which is a
        // scan the operator did not ask for and would have no reason to suspect.
        const raw = next();
        const value = Number.parseInt(raw, 10);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
          throw new Error("--limit needs a positive integer");
        }
        limit = value;
        break;
      }
      case "--since": {
        const raw = next();
        sinceMs = timeFlag(raw, "--since");
        since = raw;
        break;
      }
      case "--now": {
        const raw = next();
        timeFlag(raw, "--now");
        now = raw;
        nowExplicit = true;
        break;
      }
      case "--json":
        json = true;
        break;
      case "--run":
        run = next();
        break;
      case "--kind":
        kind = next();
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (arg !== undefined) rest.push(arg);
    }
  }
  if (observations !== null && observationsFrom !== null) throw new Error("observation source flags are mutually exclusive");
  if (observationsFrom !== null) {
    const path = observationsFrom.startsWith("file:") ? observationsFrom.slice(5) : observationsFrom;
    if (!isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw new Error("observation source requires an absolute path");
    if (rest[0] !== "status" && rest[0] !== "tree" && rest[0] !== "governance" && !help) throw new Error("--observations-from requires governance, tree or status");
  }
  return { home, items, observations, observationsFrom, nowExplicit, limit, since, sinceMs, now, json, help, run, kind, rest };
}
