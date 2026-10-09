/**
 * The third acceptance criterion, as code that can fail.
 *
 * #55 asks that this provider *never print* `~/.local/share/opencode/auth.json`. That is easy to
 * satisfy by not writing the string, and impossible to keep satisfied that way: the file's path is
 * not something this package types, it is something the *server* says. An opencode error body, a
 * `fetch` rejection carrying a config path, a stack in a JSON reply — all of them arrive from
 * outside, all of them land in a `detail`, and a `detail` is exactly what telemetry keeps and a PR
 * body eventually quotes.
 *
 * So the criterion is a predicate rather than a promise. Every string this provider emits goes
 * through `scrub` at one boundary, `leaks` names what a string would have exposed, and the suite
 * asserts on both against strings the provider never produces on purpose.
 *
 * ## What this package deliberately cannot do
 *
 * It never reads a credential from disk or from the environment. It has no code path that opens
 * `auth.json`, resolves the opencode data directory, or looks at an API key. Authentication is the
 * server's, already done, on the other side of a socket — and a header a deployment wants added is
 * handed to `createTransport` by the composition root, never discovered here. A leak needs a source,
 * and the design is that this package has none of its own; `scrub` exists for the ones that arrive.
 *
 * The evidence path is the same decision. `provider-claude` reports its config directory, because
 * that is where its transcripts land. This provider reports only a log directory a deployment names
 * explicitly, and refuses one that points at a credential file, because the opencode *data*
 * directory is where `auth.json` lives — an artifact path is published, and publishing the directory
 * that holds the key is a leak with a delay on it.
 */

/**
 * Files whose contents are credentials.
 *
 * One entry, and the one #55 names. A list rather than a constant because the check reads better as
 * membership, and because a second file added later should not need a new function.
 */
export const CREDENTIAL_FILES: readonly string[] = ["auth.json"];

/** The last segment of a path, on either separator. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  const last = parts[parts.length - 1];
  return last ?? "";
}

/** Whether this path names a file whose contents are a credential. */
export function pathIsCredentialFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return CREDENTIAL_FILES.some((file) => file.toLowerCase() === name);
}

interface Rule {
  /** What this rule is protecting against, in two or three words. Appears in `leaks`. */
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * The redaction table.
 *
 * Ordered: the credential-path rule runs first, so a path is replaced whole rather than having a
 * token-shaped fragment picked out of it. Each pattern is anchored on a prefix or a key name rather
 * than on entropy — a "long random-looking string" rule would eat session ids, run ids and commit
 * shas, and a redactor that mangles ordinary output gets turned off.
 */
const RULES: readonly Rule[] = [
  {
    name: "credential file path",
    pattern: /[^\s"']*auth\.json/gi,
    replacement: "<credential file>",
  },
  {
    name: "bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: "Bearer <redacted>",
  },
  {
    name: "api key",
    pattern: /\b(?:sk|sk-or-v1|xoxb|xoxp|xoxa|xoxs)-[A-Za-z0-9._-]{8,}/gi,
    replacement: "<redacted key>",
  },
  {
    name: "github token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g,
    replacement: "<redacted token>",
  },
  {
    name: "google api key",
    pattern: /\bAIza[A-Za-z0-9_-]{16,}/g,
    replacement: "<redacted key>",
  },
  {
    name: "named secret field",
    // `"api_key": "..."`, `token=...`, `secret: '...'` — the shape a config dump has. Angle
    // brackets are excluded from the value so that the replacement cannot match this rule again;
    // `leaks(scrub(x))` being empty is a property the suite pins, and a self-matching replacement
    // would break it silently.
    pattern:
      /(["']?(?:api[_-]?key|apikey|access[_-]?token|token|secret|password|authorization)["']?\s*[:=]\s*)(["']?)([^\s"',}<>]{4,})\2/gi,
    replacement: "$1$2<redacted>$2",
  },
];

/**
 * The one function every outgoing string passes through.
 *
 * Applied at the provider's boundary rather than at each place a string is built, because the leak
 * this guards against comes from strings this package did not write. A redaction that has to be
 * remembered at forty call sites is a redaction that is missing at one of them.
 */
export function scrub(text: string): string {
  let out = text;
  for (const rule of RULES) out = out.replace(rule.pattern, rule.replacement);
  return out;
}

/**
 * What this string would have exposed, by rule name.
 *
 * The half of the criterion a test can assert on directly: `leaks(x)` is empty for everything the
 * provider emits, and non-empty for the strings the fakes feed it. Empty for a scrubbed string, by
 * construction — which is itself a property worth pinning, since a replacement that reintroduced a
 * matching shape would be invisible otherwise.
 */
export function leaks(text: string): readonly string[] {
  const found: string[] = [];
  for (const rule of RULES) {
    if (text.match(rule.pattern) !== null) found.push(rule.name);
  }
  return found;
}
