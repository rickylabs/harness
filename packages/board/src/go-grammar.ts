/**
 * Orchid's line grammar, in JavaScript, with Go's semantics rather than JavaScript's.
 *
 * `dispatch.ts` claims to report what divybot will execute. That claim was false for three
 * characters, and the way it was false is the point of this module.
 *
 * The `/swarm` reader used a JavaScript regex literal copied character-for-character from Go's
 * `swarmKV`, on the assumption that two identical patterns mean the same thing. They do not:
 *
 * - Go's `.` is any rune except `\n`. JavaScript's `.` also excludes `\r`, U+2028 and U+2029.
 *   So `model: attacker\rpayload` is a *key line* to Go and prose to JavaScript. A prompt whose
 *   first line took that shape passed the writer's guard untouched and then replaced the
 *   matrix-selected model at launch. That is the critical finding from the #107 re-review, and
 *   `.` versus `[^\n]` is the whole of it.
 * - Go's regex `\s` is the ASCII class `[\t\n\f\r ]`. JavaScript's `\s` adds `\v`, NBSP and every
 *   Unicode space separator. `model\v: x` is prose to Go and a key to JavaScript.
 * - Go's `strings.TrimSpace` uses `unicode.IsSpace`, which trims U+0085 and does not trim U+FEFF.
 *   JavaScript's `trim` does the opposite on both. Trimming decides whether a line is `/swarm`,
 *   whether it is blank, and where a value ends, so the disagreement reaches all three.
 * - Go splits the body on `\n` alone. Normalising CRLF first, as the reader used to, changes the
 *   prompt text Orchid would assemble.
 *
 * None of these is exotic input. A brief pasted out of a Windows editor, a model id copied from a
 * rendered web page, a prompt assembled from a file read with the wrong newline mode — each is an
 * ordinary accident that used to produce a run different from its record.
 *
 * So the grammar lives here, once, written against Go's rules and named for them. Every function
 * in this file corresponds to a specific line of `cmd/divybot/overrides.go` in `rickylabs/orchid`
 * and is a deliberate transliteration of it, not an interpretation. When Orchid's parser changes,
 * this file is the one that has to change with it.
 *
 * Pinned at `d344bd037bcf10150fd12daef8ffa277576cd94a`.
 */

/**
 * The runes `unicode.IsSpace` reports as space: the Latin-1 set it lists explicitly, plus the
 * `White_Space` property above it.
 *
 * Written out rather than expressed as `\s` because `\s` is the thing that was wrong. U+0085 is
 * in and U+FEFF is out, which is exactly where JavaScript's own `trim` disagrees.
 */
const GO_SPACE = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

const GO_TRIM = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, "gu");

/** `strings.TrimSpace`. Not `String.prototype.trim`, which trims a different set. */
export function goTrimSpace(value: string): string {
  return value.replace(GO_TRIM, "");
}

/**
 * `strings.Split(text, "\n")`.
 *
 * No CRLF normalisation, deliberately. Orchid does none, so a `\r` survives into the value or the
 * prompt, and a reader that quietly removes it is describing a different run.
 */
export function goSplitLines(text: string): readonly string[] {
  return text.split("\n");
}

/**
 * `swarmKV`, transliterated: `^([a-z][a-z_-]*)\s*:\s*(.+?)\s*$` with Go's `\s` and Go's `.`.
 *
 * The two substitutions are the fix. `[\t\n\f\r ]` is RE2's Perl `\s`; `[^\n]` is RE2's `.`.
 * Neither `\n` is reachable — the line was already split on it — but both are kept so the pattern
 * can be read against the Go source without a mental correction.
 */
const GO_KEY_LINE = /^([a-z][a-z_-]*)[\t\n\f\r ]*:[\t\n\f\r ]*([^\n]+?)[\t\n\f\r ]*$/;

/** A key line as Orchid binds it: `_` normalised to `-`, value cut at the first `#`, then trimmed. */
export interface GoKeyValue {
  readonly key: string;
  readonly value: string;
}

/**
 * Read one already-trimmed line the way `parseOverrides` does, or `null` if it is not a key.
 *
 * `null` is what ends the key run and starts the prompt, so this predicate decides the boundary
 * for both the reader and the writer's guard. There must not be a second implementation of it.
 */
export function goKeyValue(trimmedLine: string): GoKeyValue | null {
  const match = GO_KEY_LINE.exec(trimmedLine);
  if (match === null) return null;
  const key = (match[1] ?? "").replace(/_/g, "-");
  // `strings.SplitN(m[2], "#", 2)[0]` — the first `#` anywhere in the value, not just a trailing
  // comment — then `strings.TrimSpace` on what is left.
  const value = goTrimSpace((match[2] ?? "").split("#", 1)[0] ?? "");
  return { key, value };
}

/** `strings.HasPrefix(t, "```")`, on a line trimmed Go's way. */
export function goIsFence(trimmedLine: string): boolean {
  return trimmedLine.startsWith("```");
}

/**
 * Characters no field value may contain, checked by the writer before a block is emitted.
 *
 * The transliteration above makes the reader agree with Orchid about these characters rather than
 * disagreeing, which is the correctness fix. This set is the separate, blunter one: a value that
 * carries a control character, a line or paragraph separator, or a byte-order mark is refused
 * outright.
 *
 * The justification is not parser divergence — it is that no model id, effort, profile or timeout
 * legitimately contains one. Every character here is invisible in a rendered issue body, so the
 * reviewer of a dispatch cannot see it, and the launch identity they approved is not the one that
 * runs. Refusing costs nothing real and removes the whole class from the writer, so the reader's
 * fidelity never has to be the only thing standing between a prompt and a substituted model.
 *
 * C0 (U+0000–U+001F), DEL and C1 (U+007F–U+009F), U+2028, U+2029, U+FEFF.
 */
const isForbidden = (point: number): boolean =>
  point <= 0x1f || (point >= 0x7f && point <= 0x9f) || point === 0x2028 || point === 0x2029 || point === 0xfeff;

/** The offending code points in a value, as `U+XXXX` labels, or empty when it is clean. */
export function forbiddenCharactersIn(value: string): readonly string[] {
  const found = new Set<string>();
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (!isForbidden(point)) continue;
    found.add(`U+${point.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return [...found].sort();
}
