/**
 * Which issues a pull request body will close on merge.
 *
 * This exists because of a real incident: PR #105 implemented one task of six and its body's
 * closing keyword named the *epic*. GitHub honoured it, the epic closed, and every board
 * projection for the next two hours reported six unstarted children as delivered work. Nothing in
 * this repository looked at a PR body before merge, so nothing could have caught it.
 *
 * ## This models GitHub's parser, not good intentions
 *
 * The reader here is deliberately indifferent to what the prose around a keyword means. A body
 * saying "PR #105 wrongly closed #39" reads, to GitHub, as an instruction to close #39, and it will
 * be carried out. Treating that as a false positive would mean this module disagreed with the thing
 * it exists to predict. So the whole body is scanned, prose and code blocks alike.
 *
 * One deliberate narrowing: a reference qualified with another repository is dropped. Closing an
 * issue in a repository this board does not project is not a board anomaly, and reporting it would
 * put a permanently unresolvable row in a check that has to be able to reach zero.
 *
 * What is *not* modelled: GitHub only performs the close when the pull request merges into the
 * default branch, so a `type:sub-pr` targeting an umbrella branch closes nothing today. That is a
 * property of where the branch points, which changes with one retarget and without touching the
 * body — so a keyword aimed at an umbrella is reported whatever the base is. The mistake is in the
 * text; the base branch only decides when it goes off.
 */

/**
 * The keywords GitHub acts on, exactly as documented — three verbs, each in three tenses.
 *
 * Written as one alternation rather than a list of words because it is embedded in a larger
 * pattern below, and a list that has to be joined at module load is a list that can be joined
 * wrong.
 */
const KEYWORDS = "close[sd]?|fix(?:e[sd])?|resolve[sd]?";

/**
 * A keyword followed by a reference, in the three spellings GitHub accepts.
 *
 * Groups 1–3 are the full-URL form, 4–5 the `owner/repo` qualifier of the short form, 6 its
 * number. The separator is `\s*:?\s+`, which admits both `Closes #1` and `Closes: #1` and rejects
 * `Closes#1` — matching GitHub, which requires the whitespace.
 */
const CLOSING = new RegExp(
  String.raw`\b(?:${KEYWORDS})\b\s*:?\s+` +
    String.raw`(?:https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)` +
    String.raw`|(?:([\w.-]+)\/([\w.-]+))?#(\d+))`,
  "gi",
);

/**
 * Every issue number a body will close on merge, ascending and deduplicated.
 *
 * `repo` is the `owner/name` this board projects. References qualified with a different repository
 * are dropped; unqualified ones are this repository by definition, which is how GitHub reads them
 * too.
 *
 * Returns `[]` for a body that is absent, empty, or carries no keyword — the overwhelmingly common
 * case, and the one that must not cost anything.
 */
export function closingKeywordTargets(
  body: string | undefined,
  repo: string,
): readonly number[] {
  if (body === undefined || body === "") return [];

  const wanted = repo.toLowerCase();
  const found = new Set<number>();

  // `matchAll` on a `g` regex rather than a `while (exec())` loop: the latter carries `lastIndex`
  // between calls on a module-level pattern, which makes the second call over the same body return
  // different results from the first.
  for (const match of body.matchAll(CLOSING)) {
    const [, urlOwner, urlRepo, urlNumber, qualOwner, qualRepo, shortNumber] = match;

    const number = urlNumber ?? shortNumber;
    if (number === undefined) continue;

    const owner = urlOwner ?? qualOwner;
    const name = urlRepo ?? qualRepo;
    if (owner !== undefined && name !== undefined) {
      if (`${owner}/${name}`.toLowerCase() !== wanted) continue;
    }

    const parsed = Number.parseInt(number, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) found.add(parsed);
  }

  return [...found].sort((a, b) => a - b);
}
