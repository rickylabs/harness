/**
 * The pinned console manifest: our closed `Harness` vocabulary reconciled to HarnessRouter's
 * `chrn_` harness object ids, and the drift check that refuses a dispatch when the console has
 * moved underneath it.
 *
 * Issue #286, fail-closed requirement F1. Run artifacts: `.llm/runs/provider-uhp--e37/`.
 *
 * ## Why a file and not a lookup
 *
 * UHP selects the configured harness with `metadata.harness_id`, Tasks §1.2, retrieved 2026-09-12
 * against UHP `2026-08-11` (https://unifiedharnessprotocol.org/spec/2026-08-11/tasks):
 *
 *   > The configured harness is selected by `metadata.harness_id` […] If `harness_id` is absent, the
 *   > server MUST use a default harness and MUST report which one it used in the response `metadata`.
 *
 * Letting the server pick is the one option this provider does not have. A dispatch that omits the id
 * runs on whatever the deployment currently calls its default, which is a console setting no
 * repository artifact records — so the run's own evidence could not say what executed it. The id is
 * therefore pinned in a checked-in file, and the file is the artifact a reviewer reads.
 *
 * ## Why the file is not trusted either
 *
 * A pinned id is a claim about a console, and a console is edited by people through a web UI. Three
 * edits are cheap there and expensive here:
 *
 * - the harness is deleted or recreated, so the id resolves to nothing (`404 harness_not_found`,
 *   Errors §3.1);
 * - the harness is pointed at a different `base`, which the specification forbids for an existing
 *   object — Harnesses §5.2, "A server MUST NOT change `id`, `base`, or `createdAt` […] Changing the
 *   base of an existing harness would silently change the behaviour of every session already attached
 *   to it" — so observing it changed means either a non-conformant server or a different object
 *   wearing a familiar id;
 * - `defaultModel` is changed, which silently re-routes every task that omits `model`.
 *
 * None of the three announces itself on the task endpoint. `detectHarnessDrift` compares the pinned
 * entries against `GET /v1/harnesses` (Harnesses §1) before a task is sent. Drift on the harness a
 * dispatch selected refuses it. Not warns: refuses. A drifted harness is a run executing under a
 * configuration nobody declared, which is the whole failure this repository exists to make impossible.
 *
 * ## Which drift refuses which dispatch — owner decision of 2026-09-12
 *
 * The first cut refused a dispatch on drift anywhere in the manifest. That was the safe default and it
 * was wrong in a way only operations would have found: one edited row in a console halts every lane.
 * The owner narrowed it, and recorded the reasoning so it is not re-litigated — the property being
 * protected is never sending an identifier nobody verified, and that needs only the identifier about to
 * be sent. Whole-manifest refusal buys the dispatch in hand no additional protection.
 *
 * So the split is: `detectHarnessDrift` still reports **everything**, because a reconciliation or audit
 * path wants everything; `selectHarnessDrift` says which of it blocks **this** dispatch. Two properties of
 * that function are load-bearing and neither is polish:
 *
 * - **`listing-unreadable` blocks everything.** It carries `harness: null` because the fault is the
 *   listing, not a row, and an unreadable console cannot clear the selected id either. An unreadable
 *   console is not an unchanged console. Narrowing that away would turn "no answer" into "no drift",
 *   which is the one thing this vocabulary exists to prevent.
 * - **Unrelated drift stays visible.** It comes back as `unrelated` and the provider reports it on a
 *   dispatch that proceeded. A narrowing that made it silent would trade one failure for the failure this
 *   repository has spent the most effort cataloguing: absence reported as normality. It is half the
 *   decision, not a nicety attached to it.
 *
 * `name` is deliberately **not** compared. The harness object's own field table calls it a
 * "Human-readable label; not an identifier" (Harnesses §2), so renaming one is a legitimate console
 * edit and refusing on it would train an operator to ignore drift refusals.
 *
 * ## What this module proves, and what it does not
 *
 * It proves what this repository does with a given manifest and a given listing. The checked-in
 * `config/harnesses.v1.json` has `reconciledAt: null` — no console has been read into it, because
 * there is no reachable HarnessRouter on this host and no container runtime to start one. Its ids are
 * obvious placeholders, and the first live listing will report every one of them absent, which refuses
 * the dispatch. That is the intended behaviour of an unreconciled manifest, not a bug to route around.
 * Issue #294 owns the live reconciliation.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { HARNESSES, type Harness } from "./dispatch.js";
import { UHP_VERSION, type UhpHarness } from "./uhp-wire.js";

/* -------------------------------------------------------------------------------------------------
 * The manifest
 * ---------------------------------------------------------------------------------------------- */

/** One pinned console object: which of our words it serves, and what we believe it is configured as. */
export interface PinnedHarness {
  /** The word from this repository's closed vocabulary (`dispatch.ts`). */
  readonly harness: Harness;
  /** The console's own id, `chrn_`-prefixed (Harnesses §2; `openapi.yaml` `Harness.id` pattern). */
  readonly id: string;
  /** `Harness.base` — opaque by specification, compared for equality and never interpreted. */
  readonly base: string;
  /** `Harness.defaultModel`, or `null` when this manifest does not pin one. Never a guess. */
  readonly defaultModel: string | null;
}

/**
 * The checked-in manifest, parsed.
 *
 * `reconciledAt` is the only field that makes a claim about a server: the instant a console listing
 * was read back into the file. `null` means never, and every consumer of this type is expected to say
 * so out loud in whatever it reports.
 */
export interface HarnessManifest {
  readonly version: 1;
  /** The UHP version the pinned ids were reconciled under. Must equal `UHP_VERSION`. */
  readonly protocol: string;
  readonly reconciledAt: string | null;
  /** Free-form note naming the deployment, or `null`. Never a URL with credentials in it. */
  readonly reconciledAgainst: string | null;
  readonly harnesses: readonly PinnedHarness[];
}

/** Why a manifest cannot be used. Every member is a way a hand-edited file goes wrong. */
export type ManifestProblem =
  | "unreadable"
  | "unsupported-version"
  | "protocol-mismatch"
  | "no-harnesses"
  | "unknown-harness"
  | "duplicate-harness"
  | "unpinned-id"
  | "duplicate-id"
  | "blank-base"
  | "blank-default-model"
  | "unreadable-reconciled-at";

export interface ManifestFault {
  readonly problem: ManifestProblem;
  /** Safe to print anywhere: it names fields and vocabulary, never a credential or a path. */
  readonly detail: string;
}

export type ManifestResult =
  | { readonly ok: true; readonly manifest: HarnessManifest }
  | { readonly ok: false; readonly faults: readonly ManifestFault[] };

const ID_PREFIX = "chrn_";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonblank(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function fault(problem: ManifestProblem, detail: string): ManifestFault {
  return { problem, detail };
}

/**
 * Parse and validate a manifest, collecting every fault rather than throwing on the first.
 *
 * Every fault is fatal — there is no partially usable manifest, because a half-pinned vocabulary
 * dispatches some harnesses to a verified id and the rest to whatever the server defaults to. The list
 * is complete so one edit can fix the whole file instead of one round trip per mistake.
 */
export function parseHarnessManifest(raw: unknown): ManifestResult {
  if (!isObject(raw)) {
    return { ok: false, faults: [fault("unreadable", "the manifest is not a JSON object")] };
  }
  const faults: ManifestFault[] = [];

  if (raw["version"] !== 1) {
    faults.push(fault(
      "unsupported-version",
      "the manifest does not declare version 1; a file this reader cannot version is a file it cannot check",
    ));
  }
  const protocol = nonblank(raw["protocol"]);
  if (protocol !== UHP_VERSION) {
    faults.push(fault(
      "protocol-mismatch",
      `the manifest pins ids under protocol ${protocol ?? "(absent)"} and this adapter speaks ${UHP_VERSION}; a harness id reconciled under another version is not evidence about this one`,
    ));
  }
  const reconciledAt = raw["reconciledAt"];
  if (reconciledAt !== null && reconciledAt !== undefined) {
    const stamp = nonblank(reconciledAt);
    if (stamp === null || Number.isNaN(Date.parse(stamp))) {
      faults.push(fault(
        "unreadable-reconciled-at",
        "reconciledAt is neither null nor a readable instant; it is the only field in the manifest that claims a console was read, so an unreadable one is refused rather than ignored",
      ));
    }
  }
  const reconciledAgainst = nonblank(raw["reconciledAgainst"]);

  const entries = raw["harnesses"];
  if (!Array.isArray(entries) || entries.length === 0) {
    faults.push(fault("no-harnesses", "the manifest pins no harnesses, so nothing can be dispatched through it"));
    return { ok: false, faults };
  }

  const pinned: PinnedHarness[] = [];
  const seenHarness = new Set<string>();
  const seenId = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const at = `harnesses[${index}]`;
    if (!isObject(entry)) {
      faults.push(fault("unreadable", `${at} is not an object`));
      continue;
    }
    const word = nonblank(entry["harness"]);
    if (word === null || !(HARNESSES as readonly string[]).includes(word)) {
      faults.push(fault(
        "unknown-harness",
        `${at} names ${word ?? "(absent)"}, which is not in this repository's harness vocabulary (${HARNESSES.join(", ")})`,
      ));
      continue;
    }
    if (seenHarness.has(word)) {
      faults.push(fault("duplicate-harness", `${at} pins ${word} a second time; one word cannot select two harnesses`));
      continue;
    }
    const id = nonblank(entry["id"]);
    if (id === null || !id.startsWith(ID_PREFIX)) {
      faults.push(fault(
        "unpinned-id",
        `${at} (${word}) has no ${ID_PREFIX}-prefixed id; an absent id would let the server choose the harness and nothing would record which one ran`,
      ));
      continue;
    }
    if (seenId.has(id)) {
      faults.push(fault("duplicate-id", `${at} reuses an id already pinned by another harness word`));
      continue;
    }
    const base = nonblank(entry["base"]);
    if (base === null) {
      faults.push(fault("blank-base", `${at} (${word}) pins no base, so a base change could not be detected`));
      continue;
    }
    const declaredDefault = entry["defaultModel"];
    let defaultModel: string | null = null;
    if (declaredDefault !== null && declaredDefault !== undefined) {
      const value = nonblank(declaredDefault);
      if (value === null) {
        faults.push(fault(
          "blank-default-model",
          `${at} (${word}) has a blank defaultModel; write null to mean "this manifest pins no default" rather than an empty string`,
        ));
        continue;
      }
      defaultModel = value;
    }
    seenHarness.add(word);
    seenId.add(id);
    pinned.push({ harness: word as Harness, id, base, defaultModel });
  }

  if (faults.length > 0) return { ok: false, faults };
  return {
    ok: true,
    manifest: {
      version: 1,
      protocol: UHP_VERSION,
      reconciledAt: nonblank(reconciledAt) ?? null,
      reconciledAgainst,
      harnesses: pinned,
    },
  };
}

/**
 * The checked-in manifest, resolved relative to this module rather than to a working directory.
 *
 * `config/` sits beside `dist/` and beside `src/`, so the same relative path resolves from the compiled
 * module and from a `ts-node`-style run. It follows `@rickylabs/routing`'s convention for
 * `config/routing.v1.json`, which is the other pinned document in this workspace.
 */
export const PINNED_HARNESSES_PATH = fileURLToPath(new URL("../config/harnesses.v1.json", import.meta.url));

/**
 * Read and validate the checked-in manifest.
 *
 * A separate function rather than a module-level constant: reading a file at import time makes every
 * consumer of this module pay for I/O it may not need, and makes a parse failure a crash at import rather
 * than a refusal a caller can report. An unreadable or unparseable file is a fault like any other.
 */
export async function loadPinnedHarnesses(path: string = PINNED_HARNESSES_PATH): Promise<ManifestResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // The path is this package's own and contains no caller data, but it is a path, and a refusal is a
    // thing that gets printed. It names the file, not the absolute location.
    return { ok: false, faults: [fault("unreadable", "the pinned harness manifest could not be read from this package's config directory")] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, faults: [fault("unreadable", "the pinned harness manifest is not parseable JSON")] };
  }
  return parseHarnessManifest(raw);
}

/** The harness words this manifest can dispatch, in vocabulary order rather than file order. */
export function manifestHarnesses(manifest: HarnessManifest): readonly Harness[] {
  return HARNESSES.filter((word) => manifest.harnesses.some((entry) => entry.harness === word));
}

/** The pinned entry for a harness word, or `null`. Never a default: an unpinned word is not dispatchable. */
export function pinnedHarness(manifest: HarnessManifest, harness: Harness): PinnedHarness | null {
  return manifest.harnesses.find((entry) => entry.harness === harness) ?? null;
}

/** Whether any console listing has ever been read into this manifest. */
export function isManifestReconciled(manifest: HarnessManifest): boolean {
  return manifest.reconciledAt !== null;
}

/* -------------------------------------------------------------------------------------------------
 * Drift
 * ---------------------------------------------------------------------------------------------- */

/**
 * How the console disagrees with the manifest.
 *
 * `listing-unreadable` is a drift rather than a transport error on purpose: a listing we cannot read is
 * a listing we cannot clear, and the dispatch is refused either way. Keeping it in this vocabulary
 * means one caller-side branch cannot accidentally treat "no answer" as "no drift".
 */
export type HarnessDriftKind =
  | "listing-unreadable"
  | "harness-absent"
  | "base-changed"
  | "default-model-changed"
  | "id-duplicated";

export interface HarnessDrift {
  readonly kind: HarnessDriftKind;
  /** The pinned word this drift concerns, or `null` when the whole listing is at fault. */
  readonly harness: Harness | null;
  readonly detail: string;
}

/** Read one element of `GET /v1/harnesses` as a harness object, or `null` if it is not one. */
export function readUhpHarness(value: unknown): UhpHarness | null {
  if (!isObject(value)) return null;
  const id = nonblank(value["id"]);
  const name = nonblank(value["name"]);
  const base = nonblank(value["base"]);
  // `Harness.required` is `[id, name, base]` (openapi.yaml). An element missing one of the three is
  // not a harness object, and guessing which field was meant is how a drift check stops detecting.
  if (id === null || name === null || base === null) return null;
  const defaultModel = nonblank(value["defaultModel"]);
  return defaultModel === null ? { id, name, base } : { id, name, base, defaultModel };
}

/**
 * Read the body of `GET /v1/harnesses`, or `null` when it is not a harness listing.
 *
 * An empty list is a legitimate answer — Harnesses §1: "The list MAY be empty — a server with no
 * configured harnesses is valid, and a client MUST handle that rather than assuming index `0` exists"
 * — and it is distinguished from an unreadable body, because an empty console drifts every pinned
 * entry while an unreadable one tells us nothing.
 */
export function readUhpHarnessList(body: unknown): readonly UhpHarness[] | null {
  if (!isObject(body)) return null;
  const listed = body["harnesses"];
  if (!Array.isArray(listed)) return null;
  const harnesses: UhpHarness[] = [];
  for (const element of listed) {
    const harness = readUhpHarness(element);
    if (harness === null) return null;
    harnesses.push(harness);
  }
  return harnesses;
}

/**
 * Every way the live console disagrees with the manifest. Empty means agreement on every pinned field.
 *
 * `listed` is the parsed result of `GET /v1/harnesses`, or `null` when the listing could not be read —
 * which is itself reported as drift rather than as agreement.
 *
 * **Manifest-wide, and deliberately so.** This is the reconciliation and audit view: #294 has to see every
 * stale row to fix the file, and an audit that only checked the row someone happened to be dispatching to
 * would report a clean console that is not. A *dispatch* narrows this through `selectHarnessDrift` rather
 * than asking a narrower question here, so the wide answer stays available and the narrowing is one
 * readable function instead of an argument nobody passes.
 */
export function detectHarnessDrift(
  manifest: HarnessManifest,
  listed: readonly UhpHarness[] | null,
): readonly HarnessDrift[] {
  if (listed === null) {
    return [{
      kind: "listing-unreadable",
      harness: null,
      detail:
        "the harness listing could not be read as UHP harness objects, so no pinned id could be cleared; " +
        "an unreadable console is not an unchanged console",
    }];
  }
  const drift: HarnessDrift[] = [];
  for (const entry of manifest.harnesses) {
    const matches = listed.filter((candidate) => candidate.id === entry.id);
    if (matches.length > 1) {
      drift.push({
        kind: "id-duplicated",
        harness: entry.harness,
        detail: `the console listed ${matches.length} harness objects under the id pinned for ${entry.harness}; one id naming two objects means neither can be selected deliberately`,
      });
      continue;
    }
    const live = matches[0];
    if (live === undefined) {
      drift.push({
        kind: "harness-absent",
        harness: entry.harness,
        detail: `the id pinned for ${entry.harness} is not in the console listing; it was deleted, recreated, or belongs to another scope`,
      });
      continue;
    }
    if (live.base !== entry.base) {
      drift.push({
        kind: "base-changed",
        harness: entry.harness,
        detail: `${entry.harness} is pinned to base ${entry.base} and the console reports ${live.base}; a harness object's base must not change, so this is either a different object or a non-conformant server`,
      });
    }
    const liveDefault = live.defaultModel ?? null;
    if (liveDefault !== entry.defaultModel) {
      drift.push({
        kind: "default-model-changed",
        harness: entry.harness,
        detail: `${entry.harness} pins default model ${entry.defaultModel ?? "(none)"} and the console reports ${liveDefault ?? "(none)"}; every task that omits a model would run on the console's value`,
      });
    }
  }
  return drift;
}

/**
 * Drift split by whether it stands between this dispatch and the harness it selected.
 *
 * Two lists rather than a filtered one, because the discarded half is not discardable: `unrelated` is the
 * signal that keeps the narrowing from becoming silence, and a function returning only `blocking` would
 * make dropping it the path of least resistance at every call site.
 */
export interface HarnessDriftSelection {
  /** Drift that refuses the dispatch: on the selected harness, or on the listing as a whole. */
  readonly blocking: readonly HarnessDrift[];
  /** Drift on a harness this dispatch did not select. Reported, never a refusal. */
  readonly unrelated: readonly HarnessDrift[];
}

/**
 * Decide which drift blocks a dispatch to `harness`.
 *
 * Blocking is `harness === selected` **or** `harness === null`. The null arm is the `listing-unreadable`
 * case and it is not an edge: a listing this adapter could not read as harness objects has cleared no
 * pinned id, including the selected one, so there is nothing to narrow to. Reading the null arm as
 * "concerns no harness, therefore concerns not this one" is the inversion that would make an unreachable
 * console look like an agreeing one.
 *
 * Everything else — a `base` change on a row nobody is dispatching to, a console default model moved on
 * another lane — is `unrelated`. It does not refuse this dispatch and it does not disappear either.
 */
export function selectHarnessDrift(
  drift: readonly HarnessDrift[],
  harness: Harness,
): HarnessDriftSelection {
  const blocking = drift.filter((item) => item.harness === null || item.harness === harness);
  const unrelated = drift.filter((item) => item.harness !== null && item.harness !== harness);
  return { blocking, unrelated };
}

/**
 * One sentence naming drift that did **not** block a dispatch, for a signal an operator reads.
 *
 * Separate prose from `describeHarnessDrift` on purpose. A refusal and a proceeding-with-a-warning are
 * different events, and a reader who sees the refusal wording on a dispatch that went ahead learns to
 * distrust both. This names the rows, says it did not block, and says what to do about it — the manifest
 * is one artifact, so a stale row anywhere is a re-reconciliation even when it stopped nothing today.
 *
 * Returns `null` when there is nothing unrelated, so a caller cannot emit an empty warning: a signal that
 * fires on every dispatch is one nobody reads by the end of the week.
 */
export function describeUnrelatedHarnessDrift(
  manifest: HarnessManifest,
  unrelated: readonly HarnessDrift[],
): string | null {
  if (unrelated.length === 0) return null;
  const rows = unrelated.map((item) => `${item.harness ?? "(the listing)"} (${item.kind})`).join(", ");
  const reconciled = manifest.reconciledAt === null
    ? "this manifest has never been reconciled against a console (reconciledAt is null)"
    : `this manifest was reconciled at ${manifest.reconciledAt}`;
  return `the console has drifted from the pinned manifest on ${unrelated.length} harness(es) this dispatch did not select, so the dispatch was not refused for it: ${rows}; ${
    unrelated.map((item) => `${item.kind}: ${item.detail}`).join("; ")
  }; ${reconciled}, and one stale row means the file needs re-reconciling even though it blocked nothing here`;
}

/** One sentence naming every drift, for a refusal an operator has to act on. */
export function describeHarnessDrift(
  manifest: HarnessManifest,
  drift: readonly HarnessDrift[],
): string {
  const reconciled = manifest.reconciledAt === null
    ? "this manifest has never been reconciled against a console (reconciledAt is null), so its ids are unverified"
    : `this manifest was reconciled at ${manifest.reconciledAt}${manifest.reconciledAgainst === null ? "" : ` against ${manifest.reconciledAgainst}`}`;
  return `${drift.map((item) => `${item.kind}: ${item.detail}`).join("; ")}; ${reconciled}`;
}
