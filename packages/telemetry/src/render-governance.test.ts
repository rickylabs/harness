/** The leading governance block of `status` and `tree`: what it says, and what it refuses to imply. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderSnapshot } from "./render.js";
import { buildSnapshot } from "./snapshot.js";
import { readGovernanceSnapshot, type GovernanceReadSnapshot } from "@rickylabs/harness-contracts";
import { governanceDocument } from "./governance/test-fixture.js";

const NOW = "2026-09-04T22:00:00.000Z";
const empty = buildSnapshot({ generatedAt: NOW, runs: [], items: [] });

type Available = Extract<GovernanceReadSnapshot, { readonly availability: "fresh" | "stale" }>;
const decoded = readGovernanceSnapshot(governanceDocument(NOW));
if (!decoded.ok || decoded.snapshot.availability === "unavailable") throw new Error("the synthetic governance document must decode");
const canonical: Available = decoded.snapshot;

/** The document the one model produces, with display-only overrides for states the renderer must still show. */
function observed(over: Partial<Available> = {}): GovernanceReadSnapshot {
  return { ...canonical, ...over };
}

describe("renderSnapshot governance", () => {
  it("says out loud that governance is unavailable, instead of showing nothing", () => {
    // A missing governance section reads as "all clear", which is the one thing it does not mean.
    assert.match(renderSnapshot(empty, NOW), /governance: UNKNOWN\/UNAVAILABLE — not-configured/);
  });

  it("shows quota, spend, headroom, and the actual admission reason before progress", () => {
    const text = renderSnapshot({ ...empty, governance: observed() }, NOW);
    assert.match(text, /codex\/primary \[throttle\]/);
    assert.match(text, /binding 5h: 63% used/);
    assert.match(text, /openrouter: \$12\.50 spent \/ \$50\.00 ceiling/);
    assert.match(text, /VRAM 8\.0 GiB used \/ 24\.0 GiB total · 16\.0 GiB headroom/);
    assert.match(text, /#205 throttle \[subscription\] — quota-paced · synthetic:dispatcher/);
    assert.ok(text.indexOf("#205 throttle") < text.indexOf("run(s) across"));
  });

  it("marks a stale refusal independently of fresh regime readings", () => {
    const base = observed();
    assert.notEqual(base.availability, "unavailable");
    if (base.availability === "unavailable") return;
    const governance = observed({
      admissions: base.admissions.map(admission => ({
        ...admission,
        validUntil: "2026-09-04T21:59:00.000Z",
        freshness: "stale" as const,
      })),
    });
    const text = renderSnapshot({ ...empty, governance }, NOW);
    assert.match(text, /governance: FRESH/);
    assert.match(text, /#205 STALE throttle/);
  });

  it("renders null leaf measurements and timestamps as unknown and never read", () => {
    const base = observed();
    assert.notEqual(base.availability, "unavailable");
    if (base.availability === "unavailable") return;
    const state = {
      ...base.state,
      regimes: base.state.regimes.map((entry) => entry.regime === "capacity"
        ? {
            ...entry,
            hosts: entry.hosts.map((host) => ({
              ...host,
              vramUsedBytes: null,
              vramTotalBytes: null,
              observedAt: null,
            })),
          }
        : entry),
    };
    const text = renderSnapshot({ ...empty, governance: observed({ state }) }, NOW);
    assert.match(text, /n5-fixture · never read/);
    assert.match(text, /VRAM used\/total\/headroom unknown/);
    assert.doesNotMatch(text, /100% free|healthy/);
  });

});

describe("truthful governance leaf freshness", () => {
  it("qualifies a fresh envelope and counts stale leaves per regime, including all-stale", () => {
    const base = observed();
    assert.notEqual(base.availability, "unavailable");
    if (base.availability === "unavailable") return;
    const original = base.state.regimes[0];
    assert.equal(original?.regime, "subscription");
    if (original?.regime !== "subscription") return;
    for (const allStale of [false, true]) {
      const accounts = original.accounts.map(a => ({ ...a, observedAt: "2026-09-04T21:00:00.000Z" }));
      if (!allStale) accounts.push({ ...original.accounts[0]!, account: "second", observedAt: original.accounts[0]!.observedAt! });
      const governance = observed({ state: { ...base.state, regimes: [{ ...original, accounts }, ...base.state.regimes.slice(1)] } });
      const text = renderSnapshot({ ...empty, governance }, NOW);
      assert.match(text, /governance: FRESH \(1 leaf readings stale\)/);
      assert.match(text, new RegExp(`subscription \\[throttle\\] \\(1 of ${allStale ? 1 : 2} readings stale\\)`));
      assert.match(text, /primary \[throttle\] · STALE · read/);
    }
  });
  it("retains known used or total capacity while headroom remains unknown", () => {
    const base = observed();
    if (base.availability === "unavailable") throw new Error();
    const governance = observed({ state: { ...base.state, regimes: base.state.regimes.map(r => r.regime === "capacity"
      ? { ...r, hosts: r.hosts.map(h => ({ ...h, ramTotalBytes: null, vramUsedBytes: null })) } : r) } });
    const text = renderSnapshot({ ...empty, governance }, NOW);
    assert.match(text, /RAM  32.0 GiB used \/ total unknown · headroom unknown/);
    assert.match(text, /VRAM used unknown \/ 24.0 GiB total · headroom unknown/);
    assert.doesNotMatch(text, /100% free/);
  });
});
