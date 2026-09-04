/**
 * `DispatchRequest` — the one dispatch payload, and its `/swarm` wire format.
 *
 * #36 is explicit that there must be exactly one of these: today it serialises to a `/swarm`
 * block that divybot executes, tomorrow the same struct goes straight to an E3 provider. No
 * second grammar. So this module owns the shape and both the reader and the writer of it.
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

/** The execution seams a run can be dispatched to. */
export const HARNESSES = ["claude", "codex", "opencode", "agy"] as const;
export type Harness = (typeof HARNESSES)[number];

/** OpenCode provider prefixes, which select where an OpenCode run actually executes. */
export const ROUTERS = ["n5air", "n5air-rocm", "openai", "openrouter"] as const;
export type Router = (typeof ROUTERS)[number];

/**
 * A dispatch, fully specified.
 *
 * `model` and `effort` are optional in the *type* because the wire format allows their absence
 * and a parser must be able to represent what it read. They are not optional in practice:
 * `validateDispatch` rejects a request that omits `model`.
 */
export interface DispatchRequest {
  readonly harness: Harness;
  readonly model?: string;
  readonly effort?: string;
  readonly maxTokens?: number;
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
  ["max-tokens", (r: DispatchRequest) => r.maxTokens?.toString()],
  ["profile", (r: DispatchRequest) => r.profile],
  ["timeout", (r: DispatchRequest) => r.timeout],
  ["router", (r: DispatchRequest) => r.router],
] as const;

/** Serialise a request to the `/swarm` block divybot accepts. */
export function renderSwarm(request: DispatchRequest): string {
  const lines = ["/swarm"];
  for (const [key, read] of FIELD_ORDER) {
    const value = read(request);
    if (value !== undefined && value !== "") lines.push(`${key}: ${value}`);
  }
  const prompt = request.prompt.trim();
  return prompt === "" ? `${lines.join("\n")}\n` : `${lines.join("\n")}\n\n${prompt}\n`;
}

const HARNESS_SET: ReadonlySet<string> = new Set(HARNESSES);
const ROUTER_SET: ReadonlySet<string> = new Set(ROUTERS);

/**
 * Parse a `/swarm` block out of an issue or comment body.
 *
 * Returns `null` when the text does not begin a `/swarm` block, which is the common case and is
 * not an error. Throws only on a block that is present but malformed, because a dispatch that
 * half-parses is more dangerous than one that does not parse at all: it would launch, just not
 * the run anyone asked for.
 *
 * Callers must have verified authorship before calling. See the module comment.
 */
export function parseSwarm(body: string): DispatchRequest | null {
  const normalised = body.replace(/\r\n/g, "\n");
  const lines = normalised.split("\n");

  const start = lines.findIndex((line) => line.trim() === "/swarm");
  if (start === -1) return null;

  const fields = new Map<string, string>();
  let index = start + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") break;
    const match = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (match === null) {
      throw new Error(
        `malformed /swarm block at line ${index + 1}: expected "key: value", got ${JSON.stringify(line)}`,
      );
    }
    const key = (match[1] ?? "").toLowerCase();
    if (fields.has(key)) {
      throw new Error(`malformed /swarm block: duplicate key ${JSON.stringify(key)}`);
    }
    // Strip a trailing `# comment`, which the documented grammar shows on the router line.
    fields.set(key, (match[2] ?? "").replace(/\s+#.*$/, "").trim());
  }

  const harness = fields.get("harness");
  if (harness === undefined) throw new Error("malformed /swarm block: missing required key harness");
  if (!HARNESS_SET.has(harness)) {
    throw new Error(
      `malformed /swarm block: harness ${JSON.stringify(harness)} is not one of ${HARNESSES.join(", ")}`,
    );
  }

  const router = fields.get("router");
  if (router !== undefined && router !== "" && !ROUTER_SET.has(router)) {
    throw new Error(
      `malformed /swarm block: router ${JSON.stringify(router)} is not one of ${ROUTERS.join(", ")}`,
    );
  }

  const rawMaxTokens = fields.get("max-tokens");
  let maxTokens: number | undefined;
  if (rawMaxTokens !== undefined && rawMaxTokens !== "") {
    if (!/^\d+$/.test(rawMaxTokens)) {
      throw new Error(
        `malformed /swarm block: max-tokens ${JSON.stringify(rawMaxTokens)} is not a positive integer`,
      );
    }
    maxTokens = Number.parseInt(rawMaxTokens, 10);
  }

  const prompt = lines.slice(index + 1).join("\n").trim();
  const optional = (key: string): string | undefined => {
    const value = fields.get(key);
    return value === undefined || value === "" ? undefined : value;
  };

  return {
    harness: harness as Harness,
    ...(optional("model") !== undefined ? { model: optional("model") as string } : {}),
    ...(optional("effort") !== undefined ? { effort: optional("effort") as string } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(optional("profile") !== undefined ? { profile: optional("profile") as string } : {}),
    ...(optional("timeout") !== undefined ? { timeout: optional("timeout") as string } : {}),
    ...(optional("router") !== undefined ? { router: optional("router") as Router } : {}),
    prompt,
  };
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
  const problems: string[] = [];

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
  if (request.maxTokens !== undefined && request.maxTokens <= 0) {
    problems.push(`max-tokens must be positive, got ${request.maxTokens}`);
  }
  if (request.harness === "opencode" && request.router === undefined) {
    problems.push("opencode runs need a router; without one the provider prefix is ambiguous");
  }

  return problems;
}
