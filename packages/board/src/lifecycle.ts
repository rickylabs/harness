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
 */

/** A single column of the board, and the label that puts an item in it. */
export interface Phase {
  /** The label that assigns this phase, e.g. `status:in-progress`. */
  readonly label: string;
  /** Short human name for the column header, e.g. `in-progress`. */
  readonly name: string;
  /** True for phases that mean the work is finished and should stop drawing attention. */
  readonly terminal: boolean;
}

/** An ordered lifecycle. Order is column order, left to right. */
export interface Lifecycle {
  readonly prefix: string;
  readonly phases: readonly Phase[];
}

const phase = (name: string, terminal = false): Phase => ({
  label: `status:${name}`,
  name,
  terminal,
});

/**
 * The nine phases stamped by `dsh-forge`. `shipped` is the only terminal phase: `blocked` and
 * `close-gate-override` are states work can leave, and collapsing them into "done" is how a
 * board starts lying.
 */
export const DEFAULT_LIFECYCLE: Lifecycle = {
  prefix: "status",
  phases: [
    phase("backlog"),
    phase("ready"),
    phase("in-progress"),
    phase("blocked"),
    phase("in-review"),
    phase("changes-requested"),
    phase("ready-merge"),
    phase("close-gate-override"),
    phase("shipped", true),
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
