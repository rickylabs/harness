/**
 * Which backend dispatches a target: divybot today, a provider once it has proven parity.
 *
 * Owned by E7 · #37, defined by #76 — the strangler-fig from decision 6 on #30. divybot/herdr is the
 * only path verified zero-touch across all four harnesses, so it is not retired on day one and it is
 * not retired all at once. It is retired **per vendor, at parity, with the evidence recorded**, and
 * this file is where that record lives.
 *
 * ## Why this is a file of ours and not a key in divybot.json
 *
 * `config.ts` reads the dispatcher's own file and owns none of it. Handover is the opposite: it is a
 * decision the coordinator makes *about* the dispatcher, and divybot would ignore the key. Putting
 * our state in their file would also make the dangerous mistake look tidy — a fleet where both
 * backends believe they own a target double-spawns every run, and the fix for that has to be legible
 * as a change to something we control. So: a sibling file, absent by default, and absent means
 * everything is on divybot, which is exactly today.
 *
 * ## Parity flips the default; a pin overrides it in either direction
 *
 * | pin        | parity            | backend  | reason           |
 * | ---------- | ----------------- | -------- | ---------------- |
 * | (none)     | not proven        | divybot  | `awaiting-parity` |
 * | (none)     | proven            | provider | `parity-proven`  |
 * | `divybot`  | either            | divybot  | `held-back`      |
 * | `provider` | proven            | provider | `pinned-forward` |
 * | `provider` | not proven        | divybot  | `pin-refused`    |
 *
 * The last row is the safety property, and it is the reason the pin is not simply obeyed: a pin is
 * an operator's intent, and parity is a claim somebody has to have written evidence for. When they
 * disagree, the evidence wins and the disagreement is a `checkHandover` problem rather than a silent
 * downgrade. `held-back` is the claw-back — the one control that has to keep working after a
 * retirement goes wrong, which is why an explicit `divybot` pin beats proven parity.
 *
 * "Parity" throughout means a record that names evidence. A record with none is not a weaker claim
 * to be flagged and honoured — it is not parity at all, and `provenParity` is where that is spent.
 *
 * ## Parity is per account, and a target needs all of them
 *
 * `Target.agents` is an *overflow preference already normalised to accounts* (see `agentsOf`), and
 * which one actually runs is a function of live governor budget — not decidable from the table. So a
 * target moves to the provider path only when **every** account it can fall through to has parity.
 * A target listing `["claude", "codex"]` with parity only for `claude` stays on divybot, because the
 * alternative is a target that works until quota pressure and then needs a vendor the provider path
 * cannot serve. That is the failure mode a staged migration exists to avoid.
 */

import { HARNESSES } from "@rickylabs/subagents";

import { accountOf, type Target, type TargetTable } from "./model.js";

/** The conventional name, and what `dsh-forge targets backend` looks for when `--handover` is absent. */
export const HANDOVER_FILE = "handover.json";

/** The two execution backends a target can be dispatched through. */
export const BACKENDS = ["divybot", "provider"] as const;

export type Backend = (typeof BACKENDS)[number];

/**
 * The accounts a target row can actually name, derived rather than listed.
 *
 * `agentsOf` maps every agent through `accountOf` before storing it, so `opencode` is never in a
 * `Target.agents` — it has already become `codex`. A parity record keyed `opencode` can therefore
 * never match anything, and saying so is more useful than letting it sit in the file looking
 * effective. Derived from `HARNESSES` so a harness added upstream widens this set for free.
 */
export const PARITY_ACCOUNTS: readonly string[] = [...new Set(HARNESSES.map((h) => accountOf(h)))];

/**
 * Evidence that the provider path matches divybot for one vendor.
 *
 * `evidence` is required and checked, because "herdr retires per-vendor, at parity, with the parity
 * evidence recorded" is the acceptance criterion and a record without a link is a claim rather than
 * evidence. It is a free string on purpose — a PR url, an issue ref, a run id, a wiki page. What
 * matters is that a reader six months later can go and look.
 */
export interface ParityRecord {
  /** The account, as `Target.agents` stores it: `claude`, `codex`, `agy`. */
  readonly account: string;
  /** The provider id (#33) that was compared against divybot. */
  readonly provider: string;
  /** When the comparison was made — a date, not a timestamp; this is a decision, not a measurement. */
  readonly provenAt: string;
  /** Where the comparison lives. Never empty. */
  readonly evidence: string;
  /** What was actually compared, in the author's words. */
  readonly note: string;
}

/**
 * A per-target override of whatever parity would have decided.
 *
 * `reason` is required for the same motive as `ParityRecord.evidence`: a pin with no reason is a
 * mystery three weeks later, and the person who has to decide whether it is still needed is not the
 * person who set it.
 */
export interface BackendPin {
  /** The inbox label naming the target, matching `Target.label`. */
  readonly label: string;
  readonly backend: Backend;
  readonly reason: string;
}

/** The whole ledger: what has been proven, and what has been overridden. */
export interface HandoverLedger {
  readonly parity: readonly ParityRecord[];
  readonly pins: readonly BackendPin[];
}

/** Today's state, and what a repository with no ledger file means. */
export const EMPTY_LEDGER: HandoverLedger = { parity: [], pins: [] };

/**
 * Why a target ended up on the backend it did, as a closed set.
 *
 * Closed for the reason `TARGET_REFUSALS` is: the suite asserts every one is reachable, so a branch
 * of the table above cannot quietly stop being taken.
 */
export const BACKEND_REASONS = [
  "awaiting-parity",
  "parity-proven",
  "held-back",
  "pinned-forward",
  "pin-refused",
] as const;

export type BackendReason = (typeof BACKEND_REASONS)[number];

/** One target's backend, and everything that decided it. */
export interface BackendChoice {
  readonly target: Target;
  readonly backend: Backend;
  readonly reason: BackendReason;
  /** The pin that applied, or `null` when the ledger names none for this label. */
  readonly pin: BackendPin | null;
  /** The parity record for each of the target's accounts that has one, in the target's own order. */
  readonly parity: readonly ParityRecord[];
  /**
   * The accounts with no usable parity record, in the target's own order. Empty means fully proven.
   * A record that names the account and records no evidence leaves it here — see `provenParity`.
   */
  readonly missing: readonly string[];
}

/**
 * The records that count, which is not all of them.
 *
 * A record with no evidence is a claim, and the acceptance criterion is "at parity, **with the
 * parity evidence recorded**". Reading it as parity anyway would make `parity-no-evidence` a note
 * printed underneath a target that had already moved on the strength of the thing being complained
 * about — the migration's one real safety property, reported and not enforced. So it is not a weaker
 * record: it is not a record, and the account it names stays in `missing` where an operator will
 * see it next to the row it is holding back.
 */
const provenParity = (ledger: HandoverLedger): readonly ParityRecord[] =>
  ledger.parity.filter((record) => record.evidence.trim() !== "");

/**
 * The backend one target dispatches through.
 *
 * The whole table from the header, in five lines, with the losing inputs kept. An operator asking
 * "why is deno still on divybot?" needs `missing` to answer it, and an operator asking "why did this
 * move?" needs `pin` — discarding either would leave the reason string as the only explanation, and
 * a reason string is a label, not a diagnosis.
 */
export function chooseBackend(ledger: HandoverLedger, target: Target): BackendChoice {
  const records = new Map(provenParity(ledger).map((record) => [record.account, record]));
  const parity: ParityRecord[] = [];
  const missing: string[] = [];
  for (const account of target.agents) {
    const record = records.get(account);
    if (record === undefined) missing.push(account);
    else parity.push(record);
  }
  const proven = missing.length === 0 && target.agents.length > 0;
  const pin = ledger.pins.find((candidate) => candidate.label === target.label) ?? null;

  const decide = (): { backend: Backend; reason: BackendReason } => {
    if (pin?.backend === "divybot") return { backend: "divybot", reason: "held-back" };
    if (pin?.backend === "provider") {
      return proven
        ? { backend: "provider", reason: "pinned-forward" }
        : { backend: "divybot", reason: "pin-refused" };
    }
    return proven ? { backend: "provider", reason: "parity-proven" } : { backend: "divybot", reason: "awaiting-parity" };
  };

  return { target, ...decide(), pin, parity, missing };
}

/** Every target's backend, in table order. */
export function chooseBackends(table: TargetTable, ledger: HandoverLedger): readonly BackendChoice[] {
  return table.targets.map((target) => chooseBackend(ledger, target));
}

/** How many targets each backend owns — the number that says how far the migration has got. */
export interface HandoverTally {
  readonly targets: number;
  readonly divybot: number;
  readonly provider: number;
  /** Targets held on divybot by an explicit pin rather than by missing parity. */
  readonly heldBack: number;
  /** Targets whose pin asked for the provider path and did not get it. */
  readonly refused: number;
  /** Accounts with a usable parity record, whether or not any target uses them. */
  readonly provenAccounts: number;
}

export function tallyHandover(choices: readonly BackendChoice[], ledger: HandoverLedger): HandoverTally {
  const count = (reason: BackendReason): number => choices.filter((choice) => choice.reason === reason).length;
  return {
    targets: choices.length,
    divybot: choices.filter((choice) => choice.backend === "divybot").length,
    provider: choices.filter((choice) => choice.backend === "provider").length,
    heldBack: count("held-back"),
    refused: count("pin-refused"),
    provenAccounts: new Set(provenParity(ledger).map((record) => record.account)).size,
  };
}

/**
 * Every way a ledger can be wrong, as a closed set.
 *
 * All seven are about a ledger that *looks* like it is doing something and is not, which is the only
 * interesting failure for a file whose whole job is to be believed. A pin nobody can reach, a record
 * keyed by a name the table can never contain, a claim with nothing behind it: each renders as a
 * perfectly ordinary line in the file and changes no behaviour.
 */
export const HANDOVER_REFUSALS = [
  "pin-unknown-label",
  "pin-duplicate",
  "pin-no-reason",
  "pin-refused",
  "parity-duplicate",
  "parity-unreachable",
  "parity-no-evidence",
] as const;

export type HandoverRefusal = (typeof HANDOVER_REFUSALS)[number];

/** One thing wrong with the ledger, naming the row it is about where there is one. */
export interface HandoverProblem {
  readonly reason: HandoverRefusal;
  readonly message: string;
  /** The label or account the problem is about, or `null` for the ledger as a whole. */
  readonly subject: string | null;
}

/**
 * Every ledger invariant, as problems rather than exceptions.
 *
 * Same shape and the same motive as `checkTargets`: this runs in a CI check and in a CLI that has to
 * print all of what is wrong. It takes the table too, because four of the seven rules are about
 * whether a ledger row can reach anything — and that is not a question the ledger can answer alone.
 */
export function checkHandover(table: TargetTable, ledger: HandoverLedger): readonly HandoverProblem[] {
  const problems: HandoverProblem[] = [];
  const say = (reason: HandoverRefusal, subject: string | null, message: string): void => {
    problems.push({ reason, message, subject });
  };

  const labels = new Set(table.targets.map((target) => target.label));
  const pinned = new Set<string>();
  for (const pin of ledger.pins) {
    if (pinned.has(pin.label)) {
      say("pin-duplicate", pin.label, `${pin.label} is pinned twice — only the first is read`);
    }
    pinned.add(pin.label);
    if (!labels.has(pin.label)) {
      say("pin-unknown-label", pin.label, `no target carries the label ${JSON.stringify(pin.label)}, so this pin is inert`);
    }
    if (pin.reason.trim() === "") {
      say(
        "pin-no-reason",
        pin.label,
        `${pin.label} is pinned to ${pin.backend} with no reason: whoever has to decide whether it is ` +
          `still needed will not be whoever set it`,
      );
    }
  }

  const keyed = new Set<string>();
  for (const record of ledger.parity) {
    if (keyed.has(record.account)) {
      say("parity-duplicate", record.account, `${record.account} has two parity records — only the first is read`);
    }
    keyed.add(record.account);
    if (!PARITY_ACCOUNTS.includes(record.account)) {
      say(
        "parity-unreachable",
        record.account,
        `no target's agent list can contain ${JSON.stringify(record.account)} — agents are normalised to ` +
          `accounts at the parse (${PARITY_ACCOUNTS.join(", ")}), so this record never matches`,
      );
    }
    if (record.evidence.trim() === "") {
      say(
        "parity-no-evidence",
        record.account,
        `the parity record for ${record.account} records no evidence: retiring a verified path on an ` +
          `unsupported claim is the one thing the staged migration exists to prevent`,
      );
    }
  }

  for (const choice of chooseBackends(table, ledger)) {
    if (choice.reason !== "pin-refused") continue;
    say(
      "pin-refused",
      choice.target.label,
      `${choice.target.label} is pinned to the provider path, but ${choice.missing.join(", ")} ` +
        `${choice.missing.length === 1 ? "has" : "have"} no parity record — staying on divybot`,
    );
  }

  return problems;
}

/** One problem as a line an operator can act on. */
export function describeHandoverProblem(problem: HandoverProblem): string {
  const where = problem.subject === null ? "" : ` [${problem.subject}]`;
  return `${problem.reason}${where}: ${problem.message}`;
}

/** Why a target sits where it does, in one clause. */
export function describeBackendReason(reason: BackendReason): string {
  switch (reason) {
    case "awaiting-parity":
      return "no provider has proven parity for every account this target can fall through to";
    case "parity-proven":
      return "every account this target can fall through to has a recorded parity";
    case "held-back":
      return "pinned to divybot — an explicit hold beats proven parity, so a retirement can be undone";
    case "pinned-forward":
      return "pinned to the provider path, and parity backs it";
    case "pin-refused":
      return "pinned to the provider path without parity — the evidence wins and it stays on divybot";
  }
}
