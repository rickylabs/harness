/**
 * The decision journal: what was decided, and the inputs it was decided from.
 *
 * #71's whole argument is in its title — persist decisions, not just outcomes. An outcome log says
 * `run-codex-review` reviewed the change. That is a fact, and it is almost useless six weeks later,
 * because the question people actually arrive with is *"why did it pick that one, and would it pick
 * it again?"* Neither is answerable from an outcome. Both are answerable from the inputs.
 *
 * So every entry carries the arguments the decision was made from, canonically serialised, with a
 * digest of the inputs and a digest of the output. Three things fall out of that and they are the
 * three acceptance items:
 *
 * - the same inputs can be fed back through the same code, and the outputs compared (`replay.ts`);
 * - two journals can be diffed, and a changed plan attributed to a **named** input that changed;
 * - a changed output with unchanged inputs has nowhere to hide. It is not a plan change, it is
 *   nondeterminism, and it is reported under its own name rather than as a diff line.
 *
 * `at` is in the entry and in **neither** digest. A replay an hour later is still the same decision;
 * a journal whose digests move with the clock would report drift every time it was checked, which is
 * the fastest way to teach everybody to ignore it.
 */

import type { IntentKey, IntentEntry, SessionPending, DeliveryReceipt, ReceiptEntry, StoreResult, NonDeliveryProof } from "@rickylabs/harness-contracts";
import { canonicalJson, differences, digest } from "./canonical.js";

export interface PersistedDecision {
  /**
   * Stable within a plan, and the key both replay and diff join on. `evaluator:run-42` rather than
   * a counter: a counter renumbers everything downstream when one decision is inserted, and turns a
   * one-line change into a diff nobody reads.
   */
  readonly id: string;
  /** Which decider made it. `replay.ts` looks the decider up by this. */
  readonly kind: string;
  /** When, for a human. Deliberately outside both digests. */
  readonly at: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly output: unknown;
  readonly inputDigest: string;
  readonly outputDigest: string;
}

export interface ParsedJournal {
  readonly decisions: readonly PersistedDecision[];
  readonly notes: readonly string[];
}

/** How many malformed lines are named individually before the rest are counted. */
export const JOURNAL_NOTE_CAP = 5;

export function decisionOf(
  id: string,
  kind: string,
  at: string,
  inputs: Readonly<Record<string, unknown>>,
  output: unknown,
): PersistedDecision {
  return { id, kind, at, inputs, output, inputDigest: digest(inputs), outputDigest: digest(output) };
}

/**
 * The plan, as one digest.
 *
 * Order is part of it. A plan that dispatches B before A is a different plan even when the same two
 * decisions were made, so the sequence is hashed as a sequence. `at` is excluded here too, so
 * "same inputs produce the same plan" is a claim about the inputs and nothing else.
 */
export function planDigest(decisions: readonly PersistedDecision[]): string {
  return digest(
    decisions.map((d) => ({ id: d.id, kind: d.kind, inputDigest: d.inputDigest, outputDigest: d.outputDigest })),
  );
}

/** One JSONL line. The journal is append-only, because a rewritable audit trail is not one. */
export function journalLine(decision: PersistedDecision): string {
  return canonicalJson(decision);
}

function readDecision(value: unknown): PersistedDecision | { readonly reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { reason: "not a JSON object" };
  const source = value as Record<string, unknown>;
  const string_ = (key: string): string | null => {
    const raw = source[key];
    return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
  };
  const id = string_("id");
  if (id === null) return { reason: "no id" };
  const kind = string_("kind");
  if (kind === null) return { reason: "no kind" };
  const inputs = source["inputs"];
  // No inputs, no replay. An entry that records only what came out is the outcome log this module
  // exists to replace, and keeping it would let a journal of them report itself clean.
  if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) return { reason: "no inputs object" };
  // The digests are recomputed rather than trusted. A journal is a file, files are edited, and a
  // determinism check that believes a digest it was handed can be made to pass by editing it.
  return decisionOf(
    id,
    kind,
    string_("at") ?? "",
    inputs as Readonly<Record<string, unknown>>,
    "output" in source ? source["output"] : null,
  );
}

/** Read a JSONL journal, keeping every line that can be read and saying which ones could not. */
export function parseJournal(text: string): ParsedJournal {
  const decisions: PersistedDecision[] = [];
  const notes: string[] = [];
  let dropped = 0;
  let named = 0;
  const drop = (line: number, why: string): void => {
    dropped += 1;
    if (named < JOURNAL_NOTE_CAP) {
      named += 1;
      notes.push(`line ${line} dropped: ${why}`);
    }
  };

  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      drop(index + 1, `not JSON: ${(error as Error).message}`);
      continue;
    }
    const decision = readDecision(parsed);
    if ("reason" in decision) {
      drop(index + 1, decision.reason);
      continue;
    }
    decisions.push(decision);
  }

  if (dropped > named) notes.push(`${dropped} line(s) dropped in total`);
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (seen.has(decision.id)) notes.push(`decision id ${decision.id} appears more than once — a diff cannot join on it`);
    seen.add(decision.id);
  }
  return { decisions, notes };
}

export type Change =
  | { readonly kind: "added"; readonly id: string; readonly decisionKind: string }
  | { readonly kind: "removed"; readonly id: string; readonly decisionKind: string }
  | { readonly kind: "moved"; readonly id: string; readonly from: number; readonly to: number }
  | {
      readonly kind: "explained";
      readonly id: string;
      /** The named inputs that changed. This is the whole point of the exercise. */
      readonly inputs: readonly string[];
      readonly outputChanged: boolean;
    }
  /**
   * The output changed and every input is identical. Not a plan change — a determinism failure, and
   * the reason this comparison exists at all.
   */
  | { readonly kind: "unexplained"; readonly id: string; readonly output: readonly string[] };

export interface JournalComparison {
  readonly identical: boolean;
  readonly planBefore: string;
  readonly planAfter: string;
  readonly changes: readonly Change[];
  /** Changes that no input accounts for. Non-zero means the code is not deterministic. */
  readonly unexplained: number;
}

/**
 * Compare two journals and attribute every difference.
 *
 * The interesting half is what it refuses to do: it never reports a changed output as "the plan
 * changed" without first checking whether any input changed. If none did, the entry comes back as
 * `unexplained`, which is a different claim about a different problem.
 */
export function compareJournals(
  before: readonly PersistedDecision[],
  after: readonly PersistedDecision[],
): JournalComparison {
  const changes: Change[] = [];
  const beforeById = new Map(before.map((d, index) => [d.id, { decision: d, index }]));
  const afterById = new Map(after.map((d, index) => [d.id, { decision: d, index }]));

  for (const [id, left] of beforeById) {
    const right = afterById.get(id);
    if (right === undefined) {
      changes.push({ kind: "removed", id, decisionKind: left.decision.kind });
      continue;
    }
    const inputPaths = differences(left.decision.inputs, right.decision.inputs);
    const outputChanged = left.decision.outputDigest !== right.decision.outputDigest;
    if (inputPaths.length > 0) {
      changes.push({ kind: "explained", id, inputs: inputPaths, outputChanged });
    } else if (outputChanged) {
      changes.push({ kind: "unexplained", id, output: differences(left.decision.output, right.decision.output) });
    }
    if (left.index !== right.index) {
      changes.push({ kind: "moved", id, from: left.index, to: right.index });
    }
  }
  for (const [id, right] of afterById) {
    if (!beforeById.has(id)) changes.push({ kind: "added", id, decisionKind: right.decision.kind });
  }

  changes.sort((a, b) => (a.id === b.id ? a.kind.localeCompare(b.kind) : a.id < b.id ? -1 : 1));
  const planBefore = planDigest(before);
  const planAfter = planDigest(after);
  return {
    identical: planBefore === planAfter,
    planBefore,
    planAfter,
    changes,
    unexplained: changes.filter((c) => c.kind === "unexplained").length,
  };
}

/** Durable effect evidence shares the decision journal's semantic digests, not its tolerant reader. */
export function intentEntryOf(
  key: IntentKey,
  sequence: number,
  generation: number,
  at: string,
): IntentEntry {
  const detached = structuredClone(key);
  const body = { version: 1 as const, kind: "intent" as const, sequence, generation, key: detached,
    inputDigest: digest(detached), outputDigest: digest({ kind: "intent" }) };
  return { ...body, at, digest: digest(body) };
}

export function receiptEntryOf(
  pending: SessionPending,
  receipt: DeliveryReceipt,
  sequence: number,
  at: string,
): ReceiptEntry {
  const body = { version: 1 as const, kind: "receipt" as const, sequence, generation: pending.generation,
    key: structuredClone(pending.key), intentSequence: pending.sinceEntry, receipt: structuredClone(receipt),
    inputDigest: digest({ key: pending.key, intentSequence: pending.sinceEntry }), outputDigest: digest(receipt) };
  return { ...body, at, digest: digest(body) };
}

/** Only negative, integrity-checked receipts can supply the branded non-delivery evidence. */
export function proofFromReceipt(
  entry: ReceiptEntry & { readonly receipt: { readonly delivered: false; readonly reason: string } },
): StoreResult<NonDeliveryProof> {
  try {
    const { at: _at, digest: stored, ...body } = entry;
    const k = entry.key;
    const keyFields = ["attempt", "inputRevision", "repository", "task", "workflowStep"];
    if (entry.version !== 1 || entry.kind !== "receipt" || entry.receipt.delivered !== false ||
        typeof entry.at !== "string" || !entry.at.trim() ||
        !Number.isSafeInteger(entry.sequence) || !Number.isSafeInteger(entry.intentSequence) ||
        entry.intentSequence < 1 || entry.sequence <= entry.intentSequence ||
        !Number.isSafeInteger(entry.generation) || entry.generation < 1 ||
        canonicalJson(Object.keys(k).sort()) !== canonicalJson(keyFields) ||
        ![k.repository, k.task, k.workflowStep, k.inputRevision].every(v => typeof v === "string" && v.trim().length > 0) ||
        !Number.isSafeInteger(k.attempt) || k.attempt < 1 ||
        typeof entry.receipt.reason !== "string" || !entry.receipt.reason.trim() ||
        canonicalJson(Object.keys(entry.receipt).sort()) !== canonicalJson(["delivered", "reason"]) ||
        digest(body) !== stored ||
        canonicalJson(entry) !== canonicalJson(receiptEntryOf({ status: "pending", key: k,
          generation: entry.generation, sinceEntry: entry.intentSequence }, entry.receipt, entry.sequence, entry.at))) {
      return { ok: false, refusal: { kind: "invalid-input" } };
    }
    return { ok: true, value: { receiptSequence: entry.sequence, receiptDigest: entry.digest,
      reason: entry.receipt.reason } as NonDeliveryProof };
  } catch { return { ok: false, refusal: { kind: "invalid-input" } }; }
}
