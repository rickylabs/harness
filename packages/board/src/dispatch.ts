/**
 * `DispatchRequest` — the one dispatch payload, and its `/swarm` wire format.
 *
 * #36 is explicit that there must be exactly one of these: today it serialises to a `/swarm`
 * block that divybot executes, tomorrow the same struct goes straight to an E3 provider. No
 * second grammar. So this module owns the shape and both the reader and the writer of it.
 *
 * ## One grammar, and it is not ours
 *
 * The `/swarm` grammar is defined by whatever divybot's `parseOverrides` does — `cmd/divybot/
 * overrides.go` in `rickylabs/orchid`. A second, stricter reader here would not make dispatches
 * safer; it would only make this package *wrong about them*, because divybot is what actually
 * launches. So `parseSwarm` reimplements that function's algorithm exactly, quirk for quirk, and
 * reports what will execute rather than what a tidier grammar would have meant. Where the real
 * grammar does something surprising, this module raises a `SwarmWarning` instead of quietly
 * disagreeing. `dispatch.conformance.test.ts` pins each quirk to the Go line that causes it.
 *
 * The quirks that matter, all of them load-bearing:
 *
 * - **Blank lines do not end the key block.** They are skipped. A key-shaped line *after* prose
 *   separation is still consumed as a key, and a later key overwrites an earlier one. This is the
 *   injection: a prompt whose first line reads `model: something-else` silently replaces the model
 *   the coordinator selected. `renderSwarm` therefore never emits a prompt whose first line could
 *   be read as a key — see `PROMPT_GUARD`.
 * - **A code fence truncates everything.** Any line starting with ``` ends the scan, keys and
 *   prompt alike. A brief containing a fenced diff loses the diff and everything after it.
 * - **Unknown keys are consumed, not passed through.** A prose line like `note: check the parser`
 *   vanishes from the brief entirely.
 * - **An unknown harness launches Claude.** `buildAgentCmd` has a `default:` case. `harness: gemini`
 *   does not fail; it starts a Claude run wearing the wrong name.
 * - **An unparseable `timeout:` is discarded in silence,** leaving the run on the default deadline.
 * - **`max-tokens` is a string.** `500k` is legal and is interpolated verbatim into the goal.
 *
 * ## What this module deliberately does not do
 *
 * It does not choose models. The routing matrix is the single source of truth for which model and
 * effort a lane gets, and duplicating any part of it here would create a second answer to a
 * question that must only have one. This module validates that a choice *was made* and refuses a
 * request that leaves it implicit — see `validateDispatch`.
 *
 * ## The authorship rule is a security property
 *
 * A `/swarm` block is only honoured in an inbox issue body, or in a comment **by the bot login**
 * on an open target-repo issue. Comments by anyone else are ignored. `parseSwarm` cannot enforce
 * that — it never sees an author — so callers must check authorship themselves *before* parsing.
 * Parsing attacker-controlled text and acting on the result is the whole vulnerability.
 */

/**
 * The execution seams a run can be dispatched to.
 *
 * These are exactly the cases in divybot's `buildAgentCmd`. The `-run` variants are the
 * non-interactive forms, which are supervised by PR path and deadline only.
 */
export const HARNESSES = [
  "claude",
  "codex",
  "codex-run",
  "opencode",
  "opencode-run",
  "agy",
] as const;
export type Harness = (typeof HARNESSES)[number];

/**
 * What launches when the `harness:` key is absent or unrecognised.
 *
 * Not a convention we chose — it is `buildAgentCmd`'s `default:` branch. Anything this package
 * calls a default has to be the one the executor actually applies, or the record and the run
 * disagree and only the run is real.
 */
export const DEFAULT_HARNESS: Harness = "claude";

/** OpenCode provider prefixes, which select where an OpenCode run actually executes. */
export const ROUTERS = ["n5air", "n5air-rocm", "openai", "openrouter"] as const;
export type Router = (typeof ROUTERS)[number];

/**
 * A dispatch, fully specified — what a coordinator *intends* to launch.
 *
 * `model` and `effort` are optional in the *type* because the wire format allows their absence
 * and a reader must be able to represent what it read. They are not optional in practice:
 * `validateDispatch` rejects a request that omits either.
 */
export interface DispatchRequest {
  readonly harness: Harness;
  readonly model?: string;
  readonly effort?: string;
  /**
   * Token budget, as a string.
   *
   * A string rather than a number because the executor treats it as one: `max-tokens: 500k` is
   * interpolated verbatim into the agent's goal preamble. Parsing it to a number here would mean
   * either rejecting a legal budget or re-rendering it into something the operator did not write.
   */
  readonly maxTokens?: string;
  readonly profile?: string;
  /** Go duration string; also the teardown deadline that closes the inbox issue. */
  readonly timeout?: string;
  readonly router?: Router;
  /** Free-text operator prompt, everything after the key block. */
  readonly prompt: string;
}

/** Field order on the wire. Fixed, so that two equal requests serialise identically. */
const FIELD_ORDER = [
  ["harness", (r: DispatchRequest) => r.harness],
  ["model", (r: DispatchRequest) => r.model],
  ["effort", (r: DispatchRequest) => r.effort],
  ["max-tokens", (r: DispatchRequest) => r.maxTokens],
  ["profile", (r: DispatchRequest) => r.profile],
  ["timeout", (r: DispatchRequest) => r.timeout],
  ["router", (r: DispatchRequest) => r.router],
] as const;

/**
 * The line that separates the key block from the prompt when the prompt would otherwise be read
 * as more keys.
 *
 * There is no invisible terminator available: in `parseOverrides` every line that is not a key is
 * appended to the prompt, and the only line that ends the scan entirely is a code fence. So the
 * separator has to be a visible line that cannot itself parse as a key — it must not start with a
 * lowercase letter, and must not start with a fence. The agent sees it at the top of its brief,
 * which is the correct trade: a slightly noisier brief beats a silently substituted model.
 */
export const PROMPT_GUARD = "--- prompt ---";

/** A line divybot would read as `key: value`. Deliberately identical to `swarmKV` in Go. */
const KEY_LINE = /^([a-z][a-z_-]*)\s*:\s*(.+?)\s*$/;

const isFence = (trimmed: string): boolean => trimmed.startsWith("```");

/** Raised by `renderSwarm` for a request the wire format cannot carry without corrupting it. */
export class DispatchEncodingError extends Error {}

/**
 * Serialise a request to the `/swarm` block divybot accepts.
 *
 * Throws rather than emitting a block the executor would read differently from how it was meant.
 * Every such case is also reported by `validateDispatch`, so a caller can ask before committing;
 * the throw is the backstop for callers that do not.
 */
export function renderSwarm(request: DispatchRequest): string {
  const problems = encodingProblems(request);
  if (problems.length > 0) {
    throw new DispatchEncodingError(`cannot encode dispatch: ${problems.join("; ")}`);
  }

  const lines = ["/swarm"];
  for (const [key, read] of FIELD_ORDER) {
    const value = read(request);
    if (value !== undefined && value !== "") lines.push(`${key}: ${value}`);
  }

  const prompt = request.prompt.trim();
  if (prompt === "") return `${lines.join("\n")}\n`;

  // A prompt whose first line parses as a key would be absorbed into the key block — silently
  // overriding a field, or silently disappearing if the key is one divybot ignores. Guard it.
  const firstLine = (prompt.split("\n")[0] ?? "").trim();
  const guarded = KEY_LINE.test(firstLine) ? `${PROMPT_GUARD}\n${prompt}` : prompt;

  return `${lines.join("\n")}\n\n${guarded}\n`;
}

const HARNESS_SET: ReadonlySet<string> = new Set(HARNESSES);
const ROUTER_SET: ReadonlySet<string> = new Set(ROUTERS);

/** Keys that are spellings of another key. Both map to the same field in `Overrides`. */
const ALIASES: Readonly<Record<string, string>> = { agent: "harness", provider: "router" };

/** Keys divybot binds. Anything else is consumed and dropped. */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "harness",
  "agent",
  "model",
  "router",
  "provider",
  "effort",
  "max-tokens",
  "profile",
  "timeout",
]);

/** Something about a block that will not execute the way it reads. Never fatal, never silent. */
export interface SwarmWarning {
  readonly kind:
    | "unknown-harness"
    | "unknown-router"
    | "duplicate-key"
    | "absorbed-prompt-line"
    | "unknown-key"
    | "discarded-timeout"
    | "truncated-by-fence"
    | "missing-harness";
  readonly detail: string;
}

/**
 * Exactly the fields divybot's `Overrides` struct will hold, as strings, after parsing.
 *
 * Empty string means absent, matching Go's zero value, because that is the distinction the
 * executor actually makes: `if o.Model != ""`. `timeoutNs` is `0` for both "not given" and
 * "given but unparseable", which is also what the executor sees — the warning is where the
 * difference is recorded.
 */
export interface SwarmOverrides {
  readonly harness: string;
  readonly model: string;
  readonly router: string;
  readonly effort: string;
  readonly maxTokens: string;
  readonly profile: string;
  readonly prompt: string;
  readonly timeoutNs: number;
}

/** What a `/swarm` block will actually do, plus every way it will surprise the person who wrote it. */
export interface ParsedSwarm {
  /** The executor's own state after parsing. Verbatim, including values we would not have written. */
  readonly overrides: SwarmOverrides;
  /** The harness that will really launch. Unrecognised names launch `DEFAULT_HARNESS`. */
  readonly executes: Harness;
  /** Whether a code fence cut the block short. What survives above it is all the agent will see. */
  readonly truncated: boolean;
  readonly warnings: readonly SwarmWarning[];
}

/** Go's `time.ParseDuration`, in nanoseconds. `null` for anything Go would reject. */
export function parseGoDuration(text: string): number | null {
  const scales: Readonly<Record<string, number>> = {
    ns: 1,
    us: 1e3,
    "µs": 1e3, // micro sign
    "μs": 1e3, // greek small letter mu
    ms: 1e6,
    s: 1e9,
    m: 6e10,
    h: 3.6e12,
  };

  let rest = text;
  let sign = 1;
  if (rest.startsWith("-")) {
    sign = -1;
    rest = rest.slice(1);
  } else if (rest.startsWith("+")) {
    rest = rest.slice(1);
  }

  // Go accepts a bare "0" with no unit, and nothing else without one.
  if (rest === "0") return 0;
  if (rest === "") return null;

  let total = 0;
  while (rest !== "") {
    const digits = /^\d*(?:\.\d*)?/.exec(rest)?.[0] ?? "";
    if (digits === "" || digits === ".") return null;
    rest = rest.slice(digits.length);
    const unit = /^[^\d.]+/.exec(rest)?.[0];
    if (unit === undefined) return null;
    const scale = scales[unit];
    if (scale === undefined) return null;
    rest = rest.slice(unit.length);
    total += Number.parseFloat(digits) * scale;
  }
  return sign * total;
}

/**
 * Parse a `/swarm` block out of an issue or comment body.
 *
 * Returns `null` when the text contains no `/swarm` line, which is the common case and is not an
 * error. Otherwise it always returns a result, because the executor always produces one: there is
 * no malformed `/swarm` block that divybot refuses, only blocks that launch something other than
 * what they appear to say. Refusing to parse here would describe a world that does not exist.
 * Every such divergence is a `SwarmWarning`.
 *
 * Callers must have verified authorship before calling. See the module comment.
 */
export function parseSwarm(body: string): ParsedSwarm | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === "/swarm");
  if (start === -1) return null;

  const warnings: SwarmWarning[] = [];
  const bound = new Map<string, string>();
  const seen = new Set<string>();
  const promptLines: string[] = [];

  let inKeys = true;
  let sawBlank = false;
  let truncated = false;

  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();

    if (isFence(trimmed)) {
      // Everything from here on is dropped by the executor — keys, prompt, all of it. A fence with
      // nothing after it is the documented ```/swarm``` wrapper closing, and loses nothing.
      const dropped = lines.slice(i + 1).filter((line) => line.trim() !== "").length;
      if (dropped > 0) {
        warnings.push({
          kind: "truncated-by-fence",
          detail:
            `a code fence on line ${i + 1} ends the block; ${dropped} further non-empty line(s) ` +
            "will not reach the agent",
        });
      }
      truncated = true;
      break;
    }

    if (inKeys) {
      if (trimmed === "") {
        // Blank lines are skipped, not terminators. This is what makes absorption possible.
        sawBlank = true;
        continue;
      }
      const match = KEY_LINE.exec(trimmed);
      if (match !== null) {
        const key = (match[1] ?? "").replace(/_/g, "-");
        // The executor splits on the FIRST `#` anywhere in the value, not just a trailing comment.
        const value = (match[2] ?? "").split("#", 1)[0]?.trim() ?? "";

        if (sawBlank) {
          warnings.push({
            kind: "absorbed-prompt-line",
            detail:
              `line ${i + 1} (${JSON.stringify(trimmed)}) reads as prompt text but is consumed as ` +
              `the key ${JSON.stringify(key)}; blank lines do not end the key block`,
          });
        }
        const canonical = ALIASES[key] ?? key;
        if (!KNOWN_KEYS.has(key)) {
          warnings.push({
            kind: "unknown-key",
            detail: `key ${JSON.stringify(key)} on line ${i + 1} is ignored and dropped from the prompt`,
          });
        } else {
          if (seen.has(canonical)) {
            warnings.push({
              kind: "duplicate-key",
              detail: `${canonical} is set more than once; line ${i + 1} wins (${JSON.stringify(value)})`,
            });
          }
          seen.add(canonical);
        }
        bind(bound, key, value, warnings, i + 1);
        continue;
      }
      inKeys = false; // the first line that is not key-shaped ends the key run, permanently
    }

    promptLines.push(raw);
  }

  const get = (key: string): string => bound.get(key) ?? "";
  const harness = get("harness");
  const router = get("router");

  if (harness === "") {
    warnings.push({
      kind: "missing-harness",
      detail: `no harness key; the run launches ${DEFAULT_HARNESS}`,
    });
  } else if (!HARNESS_SET.has(harness)) {
    warnings.push({
      kind: "unknown-harness",
      detail:
        `harness ${JSON.stringify(harness)} is not a known seam; the executor falls through to ` +
        `${DEFAULT_HARNESS}, so the run will not be what the record says it is`,
    });
  }
  if (router !== "" && !ROUTER_SET.has(router)) {
    warnings.push({
      kind: "unknown-router",
      detail: `router ${JSON.stringify(router)} is not one of ${ROUTERS.join(", ")}`,
    });
  }

  const overrides: SwarmOverrides = {
    harness,
    model: get("model"),
    router,
    effort: get("effort"),
    maxTokens: get("max-tokens"),
    profile: get("profile"),
    prompt: promptLines.join("\n").trim(),
    timeoutNs: Number(get("timeout-ns") || "0"),
  };

  return {
    overrides,
    executes: HARNESS_SET.has(harness) ? (harness as Harness) : DEFAULT_HARNESS,
    truncated,
    warnings,
  };
}

/** Apply one key, with the executor's own casing rules. `model` and `profile` keep their case. */
function bind(
  bound: Map<string, string>,
  key: string,
  value: string,
  warnings: SwarmWarning[],
  line: number,
): void {
  switch (key) {
    case "harness":
    case "agent":
      bound.set("harness", value.toLowerCase());
      return;
    case "model":
      bound.set("model", value);
      return;
    case "router":
    case "provider":
      bound.set("router", value.toLowerCase());
      return;
    case "effort":
      bound.set("effort", value.toLowerCase());
      return;
    case "max-tokens":
      bound.set("max-tokens", value);
      return;
    case "profile":
      bound.set("profile", value);
      return;
    case "timeout": {
      const ns = parseGoDuration(value);
      if (ns === null || ns <= 0) {
        warnings.push({
          kind: "discarded-timeout",
          detail:
            `timeout ${JSON.stringify(value)} on line ${line} is not a positive Go duration and is ` +
            "discarded without complaint; the run keeps the default deadline",
        });
        return;
      }
      bound.set("timeout-ns", String(ns));
      return;
    }
    default:
      return; // unknown key: consumed, dropped. Already warned about by the caller.
  }
}

/**
 * The typed request a parsed block corresponds to — the executor's own view, re-typed.
 *
 * Uses `executes`, not the declared harness, because that is what will run. A caller wanting the
 * literal that was written reads `parsed.overrides.harness`.
 */
export function toDispatchRequest(parsed: ParsedSwarm): DispatchRequest {
  const o = parsed.overrides;
  const some = (value: string): string | undefined => (value === "" ? undefined : value);
  return {
    harness: parsed.executes,
    ...(some(o.model) !== undefined ? { model: o.model } : {}),
    ...(some(o.effort) !== undefined ? { effort: o.effort } : {}),
    ...(some(o.maxTokens) !== undefined ? { maxTokens: o.maxTokens } : {}),
    ...(some(o.profile) !== undefined ? { profile: o.profile } : {}),
    ...(o.timeoutNs > 0 ? { timeout: formatGoDuration(o.timeoutNs) } : {}),
    ...(ROUTER_SET.has(o.router) ? { router: o.router as Router } : {}),
    prompt: o.prompt,
  };
}

/** Render nanoseconds back to a Go duration string, for round-tripping a parsed timeout. */
function formatGoDuration(ns: number): string {
  if (ns % 3.6e12 === 0) return `${ns / 3.6e12}h`;
  if (ns % 6e10 === 0) return `${ns / 6e10}m`;
  if (ns % 1e9 === 0) return `${ns / 1e9}s`;
  if (ns % 1e6 === 0) return `${ns / 1e6}ms`;
  return `${ns}ns`;
}

const TOKEN_BUDGET = /^\d+(?:\.\d+)?[kKmM]?$/;

/** Problems that would make the emitted block mean something other than the request. */
function encodingProblems(request: DispatchRequest): readonly string[] {
  const problems: string[] = [];

  for (const [key, read] of FIELD_ORDER) {
    const value = read(request);
    if (value === undefined || value === "") continue;
    if (value.includes("\n")) {
      problems.push(`${key} contains a newline, which would split it into another key`);
    }
    if (value.includes("#")) {
      problems.push(`${key} contains "#", and everything from it on would be stripped as a comment`);
    }
    if (value.trim() !== value) {
      problems.push(`${key} has leading or trailing whitespace, which the executor strips`);
    }
  }

  // The executor lowercases these three. Emitting a capital means the record and the run disagree.
  for (const key of ["harness", "effort", "router"] as const) {
    const value = request[key];
    if (typeof value === "string" && value !== value.toLowerCase()) {
      problems.push(`${key} ${JSON.stringify(value)} will be lowercased by the executor`);
    }
  }

  for (const line of request.prompt.split("\n")) {
    if (isFence(line.trim())) {
      problems.push(
        "prompt contains a code fence; the executor stops reading there, so the fence and " +
          "everything after it would never reach the agent",
      );
      break;
    }
  }

  return problems;
}

/**
 * Problems that should stop a dispatch from being sent.
 *
 * The important one is the missing model. A `/swarm` block with no `model:` does not fail — it
 * launches against whatever the provider's own config file happens to say, which means the run
 * that executes is not the run the matrix selected and nothing in the record shows the
 * substitution. Launch identity is data, not an inherited default, so an unspecified model is an
 * error here rather than a silent fallback.
 */
export function validateDispatch(request: DispatchRequest): readonly string[] {
  const problems: string[] = [...encodingProblems(request)];

  if (request.model === undefined || request.model.trim() === "") {
    problems.push(
      "no model specified — the run would inherit the provider config rather than the matrix selection",
    );
  }
  if (request.effort === undefined || request.effort.trim() === "") {
    problems.push("no effort specified — effort is part of the lane pairing, not a provider default");
  }
  if (request.prompt.trim() === "") {
    problems.push("empty prompt — nothing for the dispatched agent to act on");
  }
  if (request.maxTokens !== undefined && !TOKEN_BUDGET.test(request.maxTokens)) {
    problems.push(
      `max-tokens ${JSON.stringify(request.maxTokens)} is not a token budget (e.g. 64000 or 500k)`,
    );
  }
  // An unparseable timeout is not rejected by the executor, it is dropped by it — so a run that
  // was meant to be bounded quietly gets the default deadline instead. Catch it on this side.
  if (request.timeout !== undefined && request.timeout !== "") {
    const ns = parseGoDuration(request.timeout);
    if (ns === null || ns <= 0) {
      problems.push(
        `timeout ${JSON.stringify(request.timeout)} is not a positive Go duration; the executor ` +
          "would discard it silently and run to the default deadline",
      );
    }
  }
  if (request.harness === "opencode" && request.router === undefined) {
    problems.push("opencode runs need a router; without one the provider prefix is ambiguous");
  }

  return problems;
}
