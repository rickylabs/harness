/**
 * The board lifecycle: the ordered set of phases an item moves through, and the rules for
 * reading an item's phase off its labels.
 *
 * The lifecycle is *configuration*, not a constant baked into the projector. A projector that
 * hardcodes one repository's columns cannot project any other repository, and this one is meant
 * to be pointed at several. `DEFAULT_LIFECYCLE` matches the taxonomy that `dsh-forge` stamps,
 * so the common case needs no configuration — but it is a default, not a coupling.
 *
 * When `@rickylabs/contracts` is published it should own this shape and both packages should
 * import it from there. Until then the duplication is deliberate and is the reason this package
 * has no dependency on `forge`.
 *
 * Deliberate duplication is still duplication, and it drifted: this list once read `backlog`,
 * `in-progress`, `in-review`, `changes-requested` — a plausible lifecycle that `dsh-forge` has
 * never stamped. The failure was silent in exactly the way that matters. Every item labelled with
 * a real phase came back `no status` and was counted *invisible*, so a board that had just been
 * filled in reported itself empty, and no test caught it because every test that exercised a phase
 * supplied its own lifecycle. `scripts/check-lifecycle.mjs` now compares the two lists at the
 * repository level, which is the only place that can see both without making this package depend
 * on `forge`.
 */

/** A single column of the board, and the label that puts an item in it. */
export interface Phase {
  /** The label that assigns this phase, e.g. `status:impl`. */
  readonly label: string;
  /** Short human name for the column header, e.g. `impl`. */
  readonly name: string;
  /** True for phases that mean the work is finished and should stop drawing attention. */
  readonly terminal: boolean;
  /**
   * True for phases that mean nothing is acting on the item and nothing has started.
   *
   * A property of the phase rather than a list of names held by the counter, because the counter
   * is meant to work on lifecycles it has never seen. A repository whose first column is called
   * `inbox` gets a truthful count by saying so here; it should not have to be recognised by name
   * somewhere else.
   *
   * Distinct from `terminal`, and distinct from being merely unfinished. Work waiting on a human
   * decision is not queued — someone could act on it right now, and the board should say so.
   */
  readonly queued: boolean;
}

/** An ordered lifecycle. Order is column order, left to right. */
export interface Lifecycle {
  readonly prefix: string;
  readonly phases: readonly Phase[];
}

/** What a phase means, beyond its position in the order. Both default to false. */
interface PhaseFlags {
  readonly terminal?: boolean;
  readonly queued?: boolean;
}

const phase = (name: string, flags: PhaseFlags = {}): Phase => ({
  label: `status:${name}`,
  name,
  terminal: flags.terminal === true,
  queued: flags.queued === true,
});

/**
 * The ten phases stamped by `dsh-forge`. `shipped` is the only terminal one: `ci-fail` is a state
 * work can leave, and collapsing it into "done" is how a board starts lying.
 */
export const DEFAULT_LIFECYCLE: Lifecycle = {
  prefix: "status",
  phases: [
    // Filed and nothing more. The board's largest column by far, and counting it as work in
    // progress is what produced "60 running" on a board with two agents actually running.
    phase("triage", { queued: true }),
    phase("research"),
    phase("plan"),
    phase("plan-eval"),
    phase("impl"),
    phase("impl-eval"),
    phase("augment-review"),
    phase("ci-fail"),
    // Deliberately not queued. The work is finished and waiting on a human, which is a different
    // kind of waiting from `triage`: someone can act on it now, so the board should keep nagging
    // rather than park it in a column that reads as "not started".
    phase("ready-merge"),
    phase("shipped", { terminal: true }),
  ],
};

/** Labels that assign a phase in this lifecycle, as a set, for membership tests. */
export const phaseLabels = (lifecycle: Lifecycle): ReadonlySet<string> =>
  new Set(lifecycle.phases.map((p) => p.label));

/**
 * Every label on an item that belongs to the status family.
 *
 * Matching is on the exact `prefix:` boundary. A label named `status-quo` or `statusline` is not
 * a status label, and treating it as one would move an item into a column nobody asked for.
 */
export function statusLabelsOf(
  labels: readonly string[],
  lifecycle: Lifecycle = DEFAULT_LIFECYCLE,
): readonly string[] {
  const marker = `${lifecycle.prefix}:`;
  return labels.filter((l) => l.startsWith(marker));
}

/**
 * The phase an item is in, or `null` if it has none.
 *
 * Deliberately returns the phase for the *first* status label in lifecycle order when an item
 * carries several. That is a rule violation — `projectBoard` reports it as an anomaly — but the
 * item still has to be drawn somewhere, and drawing it in the earliest phase it claims is the
 * reading that under-states progress rather than over-stating it. A board that flatters itself
 * is worse than one that nags.
 */
export function phaseOf(
  labels: readonly string[],
  lifecycle: Lifecycle = DEFAULT_LIFECYCLE,
): Phase | null {
  const present = new Set(statusLabelsOf(labels, lifecycle));
  for (const p of lifecycle.phases) {
    if (present.has(p.label)) return p;
  }
  return null;
}

/**
 * True when an item carries more than one status label.
 *
 * This is the taxonomy's first hard rule. The status label *is* the column, so two of them mean
 * the board is in two places at once and no projection of it can be trusted.
 */
export function violatesSingleStatus(
  labels: readonly string[],
  lifecycle: Lifecycle = DEFAULT_LIFECYCLE,
): boolean {
  return statusLabelsOf(labels, lifecycle).length > 1;
}

/** Status labels present on an item that this lifecycle does not define. */
export function unknownStatusLabels(
  labels: readonly string[],
  lifecycle: Lifecycle = DEFAULT_LIFECYCLE,
): readonly string[] {
  const known = phaseLabels(lifecycle);
  return statusLabelsOf(labels, lifecycle).filter((l) => !known.has(l));
}
