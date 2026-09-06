/**
 * Taking the credential out of a pane read, before the text becomes one of ours.
 *
 * `herdr pane read` returns whatever is on an agent's terminal, and what is on an agent's terminal
 * includes the `gh` invocations it ran. Those echo the token. #75 states the rule as "output is
 * sed-redacted"; this is that rule, moved off the operator's shell and into a function the suite can
 * hold to it.
 *
 * ## Three properties worth stating, because they are what make it usable
 *
 * **Redaction happens on ingest, not on output.** A pane read has one entrance into this package and
 * several exits — the terminal renderer, `--json`, a steering line quoted back at an agent, a
 * failing test's diff. Redacting at each exit means the exit added last is the one that leaks.
 * `superviseOne` calls this once, on the way in, and every reader downstream is holding text that
 * never carried the token in the first place.
 *
 * **It is idempotent.** Every replacement writes `[redacted]`, and no pattern here matches a `[`, so
 * running this over already-redacted text finds nothing and changes nothing. That matters because
 * the operator's own `sed` may have run first, and a second pass that reported five fresh hits would
 * turn `secret-in-transcript` — a signal that a credential really did reach a terminal, and that
 * somebody should rotate it — into a line nobody reads.
 *
 * **It reports counts, never values.** {@link SecretHit} carries a kind and a number. A field naming
 * what was redacted would be a field carrying the token, which is the whole problem restated one
 * struct further in.
 *
 * ## What this is not
 *
 * A denylist cannot be complete, and this one is not trying to be. The rule that actually keeps a
 * token out of the repository is that pane output is evidence and is never committed. This is the
 * second line, sized to the credentials this fleet is known to carry: GitHub's token families, the
 * `Authorization` header `gh` prints under `--verbose`, the `x-access-token` form that appears in a
 * remote URL, and the `sk-` keys the routers use. A credential in a shape not listed here passes
 * through, so the surrounding discipline is not optional.
 */

/**
 * The credential shapes this recognises, as a closed set.
 *
 * Closed for the usual reason — the suite asserts every one of them is reachable — and for one
 * specific to this file: a kind that stops matching because a vendor changed a prefix looks exactly
 * like a fleet that has stopped leaking, and the two need to be distinguishable by reading the list.
 */
export const SECRET_KINDS = [
  /** `ghp_` (classic PAT), and the `gho_`/`ghu_`/`ghs_`/`ghr_` siblings `gh` mints. */
  "github-token",
  /** `github_pat_` — the fine-grained form, which the `gh*_` shapes do not cover. */
  "github-pat",
  /** The `Authorization: Bearer …` header, as printed by `gh --verbose` and by curl traces. */
  "bearer-header",
  /** `https://x-access-token:…@github.com` — the credential in a remote URL, which `git` echoes. */
  "basic-auth-url",
  /** `sk-…` router keys: OpenRouter's `sk-or-v1-`, and the `sk-ant-`/`sk-proj-` forms beside them. */
  "api-key",
] as const;

export type SecretKind = (typeof SECRET_KINDS)[number];

/** How many of one kind were found. Deliberately without a sample of what matched — see the header. */
export interface SecretHit {
  readonly kind: SecretKind;
  readonly count: number;
}

/** Text safe to print, and the accounting for what came out of it. */
export interface Redacted {
  readonly text: string;
  readonly hits: readonly SecretHit[];
}

/** Nothing read, nothing to redact. Shared so a pull with no pane read has one representation. */
export const NOTHING_REDACTED: Redacted = { text: "", hits: [] };

/** The marker every rule substitutes. Chosen to be un-matchable by all of them. */
export const REDACTION = "[redacted]";

interface Rule {
  readonly kind: SecretKind;
  readonly pattern: RegExp;
  readonly replace: string;
}

/**
 * The rules, each keeping its prefix and spending its body.
 *
 * Keeping the prefix is the point of doing this here rather than blanking the line: `ghp_[redacted]`
 * tells the operator a classic PAT reached a terminal, which is what decides whether anything needs
 * rotating and which credential it is. It tells nobody anything else.
 *
 * No pattern matches a newline, and no replacement contains one, so a redacted transcript has the
 * same number of lines as the one that went in — the tail an operator reads is still the tail they
 * would have seen.
 */
const RULES: readonly Rule[] = [
  { kind: "github-token", pattern: /(gh[pousr]_)[A-Za-z0-9]+/g, replace: `$1${REDACTION}` },
  { kind: "github-pat", pattern: /(github_pat_)[A-Za-z0-9_]+/g, replace: `$1${REDACTION}` },
  { kind: "bearer-header", pattern: /(Bearer )[A-Za-z0-9._~+\/-]+=*/gi, replace: `$1${REDACTION}` },
  { kind: "basic-auth-url", pattern: /(:\/\/[A-Za-z0-9._~-]+:)[^@\s\/\[]+@/g, replace: `$1${REDACTION}@` },
  { kind: "api-key", pattern: /(sk-(?:or-v1-|ant-|proj-)?)[A-Za-z0-9_-]{16,}/g, replace: `$1${REDACTION}` },
];

/**
 * Replace every recognised credential, and say how many of each there were.
 *
 * Two passes per rule — count, then substitute — rather than one pass with a replacer function.
 * A replacer would have to rebuild the substitution from capture groups by hand, and getting that
 * subtly wrong is a bug whose symptom is a token printed with an extra character on the front.
 */
export function redact(text: string): Redacted {
  let out = text;
  const hits: SecretHit[] = [];
  for (const rule of RULES) {
    const found = out.match(rule.pattern);
    if (found === null) continue;
    hits.push({ kind: rule.kind, count: found.length });
    out = out.replace(rule.pattern, rule.replace);
  }
  return { text: out, hits };
}

/** Whether anything at all was found, which is the question `checkSupervision` asks. */
export const leaked = (redacted: Redacted): boolean => redacted.hits.length > 0;

/** Total across kinds, for a count in a summary line. */
export const countSecrets = (redacted: Redacted): number =>
  redacted.hits.reduce((total, hit) => total + hit.count, 0);

const KIND_TEXT: Readonly<Record<SecretKind, string>> = {
  "github-token": "a GitHub token (ghp_/gho_/ghu_/ghs_/ghr_)",
  "github-pat": "a fine-grained GitHub PAT (github_pat_)",
  "bearer-header": "an Authorization: Bearer header",
  "basic-auth-url": "a credential embedded in a URL",
  "api-key": "a router API key (sk-…)",
};

export const describeSecretKind = (kind: SecretKind): string => KIND_TEXT[kind];
