/**
 * What a citation has to look like to count as one.
 *
 * Principle 3 says citations or it is not a claim, and `plan.ts` enforced the letter of that: it
 * checked a citation was present and non-blank. `{ source: "x" }` satisfied it, and so did "see the
 * PR", "obviously", and "TODO". A gate that admits any non-empty string is a gate against typos, not
 * against unevidenced claims (#203).
 *
 * So this module answers the narrower question the gate should have been asking: does this string
 * *refer* to something? A reference is checkable by a later reader — a human, a replay, an auditor —
 * without asking the agent that wrote it what it meant. Prose is not.
 *
 * The set of kinds is closed on purpose, and small on purpose. It is not a guess at what somebody
 * might want to cite; it is the shapes this system's own evidence actually takes, read off
 * `MILESTONE_WORKFLOW`: a commit (`merge-commit`, `diff`), an issue (`task-list`, `decision`), a file
 * on disk (`coverage`, `payload`, `transcript`), a dispatched run (`run-id`), a URL (`issue-urls`,
 * `checks`, `milestone`). Adding a sixth kind should be a deliberate one-line act with a reason,
 * exactly as adding an anomaly kind or a taxonomy row is — not something a caller can do in passing
 * by inventing a format.
 *
 * There is deliberately no escape hatch. The obvious candidate — "the owner said so on a call" — is
 * not a citation that failed to parse, it is a claim with no evidence, and the workflow already has
 * two better words for it: `blocked` and `forked`, both of which take a free-text note. Widening
 * this parser to admit prose would restore the exact hole #203 is about.
 */

/**
 * Ordered by how each kind is recognised, most specific first, because `parseCitation` returns the
 * first match. `url` carries a scheme and `issue` a `#`, so neither can be mistaken for anything
 * else; `run` is prefixed precisely so it cannot be; `file` needs a separator or an extension; `sha`
 * is last because bare hex is the least distinctive shape here and would otherwise swallow a
 * seven-character filename.
 */
export const CITATION_KINDS = ["url", "issue", "run", "file", "sha"] as const;

export type CitationKind = (typeof CITATION_KINDS)[number];

export interface Citation {
  readonly kind: CitationKind;
  /** Normalised: trimmed, and lowercased where the underlying identifier is case-insensitive. */
  readonly value: string;
  /** Exactly what was cited, so a refusal can quote it back. */
  readonly raw: string;
}

/** `https://github.com/rickylabs/harness/pull/232`. Any scheme-bearing http(s) URL. */
const URL_SHAPE = /^https?:\/\/\S+$/i;

/** `#232`, or `rickylabs/harness#232` when the reference leaves this repository. */
const ISSUE_SHAPE = /^(?:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)?#\d+$/;

/**
 * `run:01a07872-49d0-74e3-a8b1-a20a6e091064`. Prefixed because run ids have no shape of their own —
 * a codex thread id, an opencode `ses_...` and a local uuid share nothing a regex could key on, and
 * guessing at one would either reject real ids or accept any word at all.
 */
const RUN_SHAPE = /^run:(\S+)$/;

/** `packages/coordinator/src/plan.ts`, optionally `:190` or `:190-200`. */
const FILE_SHAPE = /^([A-Za-z0-9._\-/]+?)(?::(\d+)(?:-(\d+))?)?$/;

/** Seven to forty hex digits — `git rev-parse --short` through a full object name. */
const SHA_SHAPE = /^[0-9a-fA-F]{7,40}$/;

/**
 * Read a citation, or decide it is not one.
 *
 * Pure, total, and does no I/O: it decides whether a string *is a reference*, never whether the
 * thing referred to exists. That split is deliberate. Existence needs the network, which would make
 * `settle` non-deterministic and unjournallable — the property `plan.ts` is built around — and it
 * would make the gate fail differently on a flaky morning than on a good one. Resolving references
 * is a separate job for a checker that is allowed to be slow and allowed to be wrong twice.
 */
export function parseCitation(raw: string): Citation | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (URL_SHAPE.test(trimmed)) return { kind: "url", value: trimmed, raw };
  if (ISSUE_SHAPE.test(trimmed)) return { kind: "issue", value: trimmed.toLowerCase(), raw };

  const run = RUN_SHAPE.exec(trimmed);
  if (run?.[1] !== undefined) return { kind: "run", value: run[1], raw };

  const file = FILE_SHAPE.exec(trimmed);
  const path = file?.[1];
  if (path !== undefined && (path.includes("/") || /\.[A-Za-z0-9]+$/.test(path))) {
    // Rebuilt rather than echoed so `src/plan.ts:0190` and `src/plan.ts:190` are one value.
    const line = file?.[2];
    const end = file?.[3];
    const span = line === undefined ? "" : `:${Number(line)}${end === undefined ? "" : `-${Number(end)}`}`;
    return { kind: "file", value: `${path}${span}`, raw };
  }

  if (SHA_SHAPE.test(trimmed)) return { kind: "sha", value: trimmed.toLowerCase(), raw };

  return null;
}

/** The forms a citation may take, for a refusal message that tells the reader what to write instead. */
export const CITATION_FORMS =
  "a URL, #123 or owner/repo#123, run:<id>, a path like src/plan.ts:190, or a 7-40 character sha";
