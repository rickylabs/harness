import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKENDS,
  BACKEND_REASONS,
  EMPTY_LEDGER,
  HANDOVER_REFUSALS,
  PARITY_ACCOUNTS,
  checkHandover,
  chooseBackend,
  chooseBackends,
  describeBackendReason,
  describeHandoverProblem,
  tallyHandover,
  type BackendPin,
  type BackendReason,
  type HandoverLedger,
  type HandoverRefusal,
  type ParityRecord,
} from "./handover.js";
import type { Target, TargetTable } from "./model.js";

const target = (over: Partial<Target> = {}): Target => ({
  label: "harness",
  repo: "rickylabs/harness",
  agents: ["claude"],
  automerge: false,
  priority: 0,
  disabled: false,
  ...over,
});

const table = (targets: readonly Target[]): TargetTable => ({
  inbox: "rickylabs/harness",
  botLogin: "divybot",
  branchPrefix: "orch/divybot-",
  pollInterval: "30s",
  targets,
  memory: { enabled: false, repo: "rickylabs/harness", branch: "main", dir: "memory", interval: "5m" },
});

const proven = (account: string, over: Partial<ParityRecord> = {}): ParityRecord => ({
  account,
  provider: "n5air",
  provenAt: "2026-09-06",
  evidence: "rickylabs/harness#76",
  note: "",
  ...over,
});

const pin = (label: string, backend: BackendPin["backend"], reason = "because"): BackendPin => ({
  label,
  backend,
  reason,
});

const ledger = (over: Partial<HandoverLedger> = {}): HandoverLedger => ({
  parity: [],
  pins: [],
  ...over,
});

const reasons = (problems: readonly { reason: HandoverRefusal }[]): readonly HandoverRefusal[] =>
  problems.map((problem) => problem.reason);

describe("chooseBackend", () => {
  it("leaves a target on divybot when nothing has been proven", () => {
    // Row 1, and the state of the entire fleet today. An empty ledger has to describe the world as
    // it is, or nobody will believe the rows that say something has moved.
    const choice = chooseBackend(EMPTY_LEDGER, target());
    assert.equal(choice.backend, "divybot");
    assert.equal(choice.reason, "awaiting-parity");
    assert.deepEqual(choice.missing, ["claude"]);
    assert.equal(choice.pin, null);
  });

  it("moves a target once every account it can fall through to has parity", () => {
    const choice = chooseBackend(ledger({ parity: [proven("claude")] }), target());
    assert.equal(choice.backend, "provider");
    assert.equal(choice.reason, "parity-proven");
    assert.deepEqual(choice.missing, []);
    assert.deepEqual(
      choice.parity.map((record) => record.account),
      ["claude"],
    );
  });

  it("holds a target on divybot when it is pinned there, even at parity", () => {
    // The claw-back. This is the one control that has to keep working after a retirement goes wrong,
    // so an explicit hold beats the evidence rather than losing to it.
    const choice = chooseBackend(
      ledger({ parity: [proven("claude")], pins: [pin("harness", "divybot", "spawned twice on #164")] }),
      target(),
    );
    assert.equal(choice.backend, "divybot");
    assert.equal(choice.reason, "held-back");
    assert.equal(choice.pin?.reason, "spawned twice on #164");
  });

  it("honours a pin forward when parity backs it", () => {
    const choice = chooseBackend(
      ledger({ parity: [proven("claude")], pins: [pin("harness", "provider")] }),
      target(),
    );
    assert.equal(choice.backend, "provider");
    assert.equal(choice.reason, "pinned-forward");
  });

  it("refuses a pin forward that no evidence supports", () => {
    // The safety property. A pin is intent; parity is a claim somebody wrote evidence for. When they
    // disagree the evidence wins, and the disagreement surfaces as a problem rather than a move.
    const choice = chooseBackend(ledger({ pins: [pin("harness", "provider")] }), target());
    assert.equal(choice.backend, "divybot");
    assert.equal(choice.reason, "pin-refused");
    assert.deepEqual(choice.missing, ["claude"]);
  });

  it("keeps a target on divybot when only some of its accounts are proven", () => {
    // The all-accounts rule. Which agent runs is a function of live governor budget, so a target that
    // works until quota pressure and then needs an unproven vendor is exactly the failure a staged
    // migration exists to avoid.
    const choice = chooseBackend(
      ledger({ parity: [proven("claude")] }),
      target({ agents: ["claude", "codex"] }),
    );
    assert.equal(choice.backend, "divybot");
    assert.equal(choice.reason, "awaiting-parity");
    assert.deepEqual(choice.missing, ["codex"]);
    assert.deepEqual(
      choice.parity.map((record) => record.account),
      ["claude"],
    );
  });

  it("does not treat a record with no evidence as parity", () => {
    // Otherwise `parity-no-evidence` is a note printed under a target that already moved on the
    // strength of the thing being complained about — the one safety property, reported and not
    // enforced. The account stays in `missing`, where it is visible next to the row it holds back.
    const choice = chooseBackend(ledger({ parity: [proven("claude", { evidence: "   " })] }), target());
    assert.equal(choice.backend, "divybot");
    assert.equal(choice.reason, "awaiting-parity");
    assert.deepEqual(choice.missing, ["claude"]);
    assert.deepEqual(choice.parity, []);
  });

  it("refuses a pin forward that only an evidence-free record supports", () => {
    const choice = chooseBackend(
      ledger({ parity: [proven("claude", { evidence: "" })], pins: [pin("harness", "provider")] }),
      target(),
    );
    assert.equal(choice.backend, "divybot");
    assert.equal(choice.reason, "pin-refused");
  });

  it("does not call a target with no agents proven", () => {
    // Vacuous truth would read as "every account is at parity" and move a row nobody proved anything
    // about. `checkTargets` already refuses an empty agent list; this makes the two agree.
    const choice = chooseBackend(ledger({ parity: [proven("claude")] }), target({ agents: [] }));
    assert.equal(choice.backend, "divybot");
    assert.equal(choice.reason, "awaiting-parity");
  });

  it("reads the first pin for a label and ignores the second", () => {
    const choice = chooseBackend(
      ledger({ pins: [pin("harness", "divybot", "first"), pin("harness", "provider", "second")] }),
      target(),
    );
    assert.equal(choice.reason, "held-back");
    assert.equal(choice.pin?.reason, "first");
  });

  it("reports parity in the target's order, not the ledger's", () => {
    const choice = chooseBackend(
      ledger({ parity: [proven("codex"), proven("claude")] }),
      target({ agents: ["claude", "codex"] }),
    );
    assert.deepEqual(
      choice.parity.map((record) => record.account),
      ["claude", "codex"],
    );
  });
});

describe("chooseBackends", () => {
  it("keeps table order, because that is the order resolution walks", () => {
    const choices = chooseBackends(
      table([target({ label: "a" }), target({ label: "b" }), target({ label: "c" })]),
      EMPTY_LEDGER,
    );
    assert.deepEqual(
      choices.map((choice) => choice.target.label),
      ["a", "b", "c"],
    );
  });
});

describe("tallyHandover", () => {
  it("counts the migration's progress, including the two ways a target stays behind", () => {
    const book = ledger({
      parity: [proven("claude"), proven("agy")],
      pins: [pin("held", "divybot"), pin("wanted", "provider")],
    });
    const choices = chooseBackends(
      table([
        target({ label: "moved" }),
        target({ label: "held" }),
        target({ label: "wanted", agents: ["codex"] }),
        target({ label: "waiting", agents: ["codex"] }),
      ]),
      book,
    );
    assert.deepEqual(tallyHandover(choices, book), {
      targets: 4,
      divybot: 3,
      provider: 1,
      heldBack: 1,
      refused: 1,
      provenAccounts: 2,
    });
  });

  it("counts accounts nothing uses, because a record that matches no target is worth seeing", () => {
    const book = ledger({ parity: [proven("agy")] });
    assert.equal(tallyHandover(chooseBackends(table([target()]), book), book).provenAccounts, 1);
  });

  it("does not count an account whose only record names no evidence", () => {
    const book = ledger({ parity: [proven("agy", { evidence: "" })] });
    assert.equal(tallyHandover(chooseBackends(table([target()]), book), book).provenAccounts, 0);
  });
});

describe("PARITY_ACCOUNTS", () => {
  it("is derived from HARNESSES, and is the set Target.agents can actually contain", () => {
    // `agentsOf` normalises through `accountOf` at the parse, so `opencode` never reaches a target.
    assert.deepEqual([...PARITY_ACCOUNTS].sort(), ["agy", "claude", "codex"]);
  });
});

describe("checkHandover", () => {
  it("says nothing about an empty ledger, which is the default and not a fault", () => {
    assert.deepEqual(checkHandover(table([target()]), EMPTY_LEDGER), []);
  });

  it("names a pin no target can reach", () => {
    const problems = checkHandover(table([target()]), ledger({ pins: [pin("deno", "divybot")] }));
    assert.deepEqual(reasons(problems), ["pin-unknown-label"]);
    assert.equal(problems[0]?.subject, "deno");
  });

  it("names a duplicated pin, because only the first is read", () => {
    const problems = checkHandover(
      table([target()]),
      ledger({ pins: [pin("harness", "divybot"), pin("harness", "provider")] }),
    );
    assert.deepEqual(reasons(problems), ["pin-duplicate"]);
  });

  it("names a pin with no reason", () => {
    const problems = checkHandover(table([target()]), ledger({ pins: [pin("harness", "divybot", "  ")] }));
    assert.deepEqual(reasons(problems), ["pin-no-reason"]);
  });

  it("names a parity record keyed by something no target's agent list can contain", () => {
    // The subtle one: `opencode` is a real harness and a plausible thing to write down, and it is
    // also unreachable — `agentsOf` turned it into `codex` before anything read the table.
    const problems = checkHandover(table([target()]), ledger({ parity: [proven("opencode")] }));
    assert.deepEqual(reasons(problems), ["parity-unreachable"]);
    assert.equal(problems[0]?.subject, "opencode");
  });

  it("names a duplicated parity record", () => {
    const problems = checkHandover(
      table([target()]),
      ledger({ parity: [proven("claude"), proven("claude", { provider: "openrouter" })] }),
    );
    assert.deepEqual(reasons(problems), ["parity-duplicate"]);
  });

  it("names a parity claim with nothing behind it", () => {
    const problems = checkHandover(table([target()]), ledger({ parity: [proven("claude", { evidence: " " })] }));
    assert.deepEqual(reasons(problems), ["parity-no-evidence"]);
  });

  it("names a pin forward the evidence refused, and says which account is missing", () => {
    const problems = checkHandover(
      table([target({ agents: ["claude", "codex"] })]),
      ledger({ parity: [proven("claude")], pins: [pin("harness", "provider")] }),
    );
    assert.deepEqual(reasons(problems), ["pin-refused"]);
    assert.match(problems[0]?.message ?? "", /codex/);
    assert.match(problems[0]?.message ?? "", /has no parity record/);
  });

  it("pluralises the refusal message when more than one account is missing", () => {
    const problems = checkHandover(
      table([target({ agents: ["claude", "codex"] })]),
      ledger({ pins: [pin("harness", "provider")] }),
    );
    assert.match(problems[0]?.message ?? "", /have no parity record/);
  });

  it("does not complain about a target simply sitting on divybot", () => {
    // The line between "wrong" and "not done yet". A check that went red for the fleet's normal
    // state is a check somebody mutes, and then the six real problems above go unread with it.
    assert.deepEqual(checkHandover(table([target(), target({ label: "deno" })]), EMPTY_LEDGER), []);
  });
});

describe("the closed sets", () => {
  it("reaches every backend reason", () => {
    const seen = new Set<BackendReason>();
    const book = ledger({
      parity: [proven("claude")],
      pins: [pin("held", "divybot"), pin("forward", "provider"), pin("refused", "provider")],
    });
    for (const choice of chooseBackends(
      table([
        target({ label: "waiting", agents: ["codex"] }),
        target({ label: "moved" }),
        target({ label: "held" }),
        target({ label: "forward" }),
        target({ label: "refused", agents: ["codex"] }),
      ]),
      book,
    )) {
      seen.add(choice.reason);
    }
    assert.deepEqual([...seen].sort(), [...BACKEND_REASONS].sort());
  });

  it("reaches every handover refusal", () => {
    const problems = checkHandover(
      table([target(), target({ label: "refused", agents: ["codex"] })]),
      ledger({
        parity: [proven("claude"), proven("claude"), proven("opencode"), proven("agy", { evidence: "" })],
        pins: [pin("harness", "divybot"), pin("harness", "divybot"), pin("deno", "divybot", ""), pin("refused", "provider")],
      }),
    );
    assert.deepEqual([...new Set(reasons(problems))].sort(), [...HANDOVER_REFUSALS].sort());
  });

  it("describes every reason and every refusal without falling off the end", () => {
    for (const reason of BACKEND_REASONS) assert.ok(describeBackendReason(reason).length > 0);
    for (const reason of HANDOVER_REFUSALS) {
      assert.match(describeHandoverProblem({ reason, message: "m", subject: "s" }), /^[a-z-]+ \[s\]: m$/);
    }
    assert.equal(describeHandoverProblem({ reason: "pin-duplicate", message: "m", subject: null }), "pin-duplicate: m");
  });

  it("names both backends, and no third one", () => {
    assert.deepEqual([...BACKENDS], ["divybot", "provider"]);
  });
});
