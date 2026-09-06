import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import type { GovernanceState, PendingApproval } from "@rickylabs/harness-contracts";

import {
  parseGovernanceObservation,
  parseGovernanceText,
  type GovernanceObservation,
  type RefusedDispatch,
} from "./observations.js";

const NOW = "2026-09-07T12:00:00.000Z";
const OBSERVED = "2026-09-07T11:55:00.000Z";
const VALID = "2026-09-07T12:05:00.000Z";

const approval = (id = "approval-1"): PendingApproval => ({
  id,
  kind: "dispatch-admission",
  summary: "Approve paid fallback for item 205",
  item: 205,
  runId: null,
  regime: "metered",
  requestedAt: "2026-09-07T11:54:00.000Z",
  expiresAt: null,
});

function state(pending: readonly PendingApproval[] = []): GovernanceState {
  return {
    generatedAt: OBSERVED,
    regimes: [
      {
        regime: "capacity",
        state: "allow",
        hosts: [
          {
            host: "n5-fixture",
            vramUsedBytes: 8 * 1024 ** 3,
            vramTotalBytes: 24 * 1024 ** 3,
            ramUsedBytes: 32 * 1024 ** 3,
            ramTotalBytes: 128 * 1024 ** 3,
            observedAt: OBSERVED,
          },
        ],
        note: null,
      },
      {
        regime: "subscription",
        state: "allow",
        accounts: [
          {
            seam: "codex",
            account: "primary",
            state: "allow",
            windows: [
              { label: "weekly", windowMinutes: 10_080, usedPercent: 52, resetsAt: null, binding: false },
              { label: "5h", windowMinutes: 300, usedPercent: 63, resetsAt: "2026-09-07T13:00:00.000Z", binding: true },
            ],
            observedAt: OBSERVED,
          },
          {
            seam: "claude",
            account: "backup",
            state: "allow",
            windows: [],
            observedAt: OBSERVED,
          },
        ],
        note: null,
      },
      {
        regime: "metered",
        state: "allow",
        providers: [
          { provider: "openrouter", spentUsd: 12.5, ceilingUsd: 50, windowLabel: "monthly", observedAt: OBSERVED },
        ],
        note: null,
      },
    ],
    pending,
    notes: ["synthetic note b", "synthetic note a"],
  };
}

function observation(over: Partial<GovernanceObservation> = {}): GovernanceObservation {
  return {
    observedAt: OBSERVED,
    validUntil: VALID,
    provenance: "synthetic:test",
    state: state(),
    admissions: [],
    ...over,
  };
}

function refusal(over: Partial<GovernanceObservation["admissions"][number]> = {}): GovernanceObservation["admissions"][number] {
  const outcome: RefusedDispatch = {
    accepted: false,
    reason: "quota-paced",
    detail: "waiting for the next subscription slot",
  };
  return {
    item: { number: 205 },
    regime: "subscription",
    state: "throttle",
    observedAt: "2026-09-07T11:54:00.000Z",
    validUntil: "2026-09-07T12:01:00.000Z",
    provenance: "synthetic:dispatcher",
    outcome,
    ...over,
  };
}

describe("governance observation parser", () => {
  it("keeps the shipped synthetic fixture parseable at its documented reference time", async () => {
    const text = await readFile(new URL("../testdata/governance/fresh.json", import.meta.url), "utf8");
    const parsed = parseGovernanceText(text, NOW);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.governance.availability, "fresh");
    assert.equal(parsed.governance.admissions[0]?.item.number, 205);
  });

  it("reuses the complete governance state and normalizes every ordered collection", () => {
    const first = parseGovernanceObservation(
      observation({
        state: state([approval("z"), approval("a")]),
        admissions: [refusal({ item: { number: 206 }, regime: "capacity" }), refusal()],
      }),
      NOW,
    );
    assert.notEqual(first.availability, "unavailable");
    if (first.availability === "unavailable") return;
    assert.equal(first.availability, "fresh");
    assert.deepEqual(first.state.regimes.map((entry) => entry.regime), ["subscription", "metered", "capacity"]);
    assert.deepEqual(first.state.pending.map((entry) => entry.id), ["a", "z"]);
    assert.deepEqual(first.state.notes, ["synthetic note a", "synthetic note b"]);
    assert.deepEqual(first.admissions.map((entry) => entry.item.number), [205, 206]);
    const subscription = first.state.regimes[0];
    assert.equal(subscription?.regime, "subscription");
    if (subscription?.regime === "subscription") {
      assert.deepEqual(subscription.accounts.map((entry) => `${entry.seam}/${entry.account}`), ["claude/backup", "codex/primary"]);
      assert.equal(subscription.accounts[1]?.windows[0]?.binding, true);
    }
  });

  it("classifies envelope and admission freshness independently", () => {
    const result = parseGovernanceObservation(
      observation({ admissions: [refusal({ validUntil: "2026-09-07T11:59:00.000Z" })] }),
      NOW,
    );
    assert.equal(result.availability, "fresh");
    assert.equal(result.admissions[0]?.availability, "stale");
  });

  it("compares epoch milliseconds rather than ISO spelling", () => {
    const result = parseGovernanceObservation(
      observation({
        observedAt: "2026-09-07T13:55:00+02:00",
        validUntil: "2026-09-07T14:05:00+02:00",
      }),
      NOW,
    );
    assert.equal(result.availability, "fresh");
  });

  it("makes every future observation unavailable instead of maximally fresh", () => {
    for (const input of [
      observation({ observedAt: "2026-09-07T12:00:01.000Z", validUntil: "2026-09-07T12:05:00.000Z" }),
      observation({ admissions: [refusal({ observedAt: "2026-09-07T12:00:01.000Z", validUntil: "2026-09-07T12:05:00.000Z" })] }),
    ]) {
      const result = parseGovernanceObservation(input, NOW);
      assert.equal(result.availability, "unavailable");
      if (result.availability === "unavailable") assert.match(result.unavailableReason, /future/);
    }
  });

  it("preserves null readings as never-read evidence", () => {
    const base = state();
    const capacity = base.regimes.find((entry) => entry.regime === "capacity");
    assert.equal(capacity?.regime, "capacity");
    if (capacity?.regime !== "capacity") return;
    const result = parseGovernanceObservation(
      observation({
        state: {
          ...base,
          regimes: base.regimes.map((entry) => entry.regime === "capacity"
            ? {
                ...capacity,
                hosts: [{
                  ...capacity.hosts[0]!,
                  vramUsedBytes: null,
                  vramTotalBytes: null,
                  observedAt: null,
                }],
              }
            : entry),
        },
      }),
      NOW,
    );
    assert.notEqual(result.availability, "unavailable");
    if (result.availability !== "unavailable") {
      const parsed = result.state.regimes.find((entry) => entry.regime === "capacity");
      if (parsed?.regime === "capacity") assert.equal(parsed.hosts[0]?.observedAt, null);
    }
  });

  it("validates generatedAt, pending and notes instead of defaulting them", () => {
    const complete = state();
    const { pending: _pending, ...withoutPending } = complete;
    const { notes: _notes, ...withoutNotes } = complete;
    const { generatedAt: _generatedAt, ...withoutGeneratedAt } = complete;
    for (const broken of [withoutPending, withoutNotes, withoutGeneratedAt]) {
      assert.equal(parseGovernanceObservation(observation({ state: broken as GovernanceState }), NOW).availability, "unavailable");
    }
  });

  it("preserves every pending approval field", () => {
    const expected = approval();
    const result = parseGovernanceObservation(observation({ state: state([expected]) }), NOW);
    assert.notEqual(result.availability, "unavailable");
    if (result.availability !== "unavailable") assert.deepEqual(result.state.pending, [expected]);
  });

  it("rejects unsafe provenance without echoing the canary", () => {
    const canary = "/home/private/secret";
    const result = parseGovernanceObservation(observation({ provenance: canary }), NOW);
    assert.equal(result.availability, "unavailable");
    assert.equal(JSON.stringify(result).includes(canary), false);
  });

  it("rejects missing regimes, bad states, reversed times, and negative headroom", () => {
    const base = state();
    const capacity = base.regimes.find((entry) => entry.regime === "capacity");
    assert.equal(capacity?.regime, "capacity");
    if (capacity?.regime !== "capacity") return;
    const negativeHeadroom = {
      ...base,
      regimes: base.regimes.map((entry) => entry.regime === "capacity"
        ? { ...capacity, hosts: [{ ...capacity.hosts[0]!, vramUsedBytes: 25, vramTotalBytes: 24 }] }
        : entry),
    };
    const broken: readonly unknown[] = [
      observation({ state: { ...base, regimes: base.regimes.slice(0, 2) } }),
      observation({ state: { ...base, regimes: [{ ...base.regimes[0], state: "green" }, ...base.regimes.slice(1)] } as GovernanceState }),
      observation({ validUntil: "2026-09-07T11:00:00.000Z" }),
      observation({ state: negativeHeadroom }),
      observation({ admissions: [{ ...refusal(), outcome: { accepted: true } } as unknown as GovernanceObservation["admissions"][number]] }),
    ];
    for (const input of broken) assert.equal(parseGovernanceObservation(input, NOW).availability, "unavailable");
  });

  it("reports malformed JSON without retaining its bytes", () => {
    const parsed = parseGovernanceText("{private canary", NOW);
    assert.equal(parsed.ok, false);
    assert.equal(JSON.stringify(parsed).includes("private canary"), false);
  });
});
