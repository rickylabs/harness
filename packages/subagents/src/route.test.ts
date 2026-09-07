import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ROUTE_FIELDS,
  compareRouteIdentity,
  isRouteEvidenceVerified,
  type RouteField,
  type RouteIdentityInput,
} from "./route.js";

const REQUESTED: RouteIdentityInput = {
  provider: "openai",
  model: "gpt-test",
  effort: "medium",
  cwd: "/work/repo",
};

function withField(input: RouteIdentityInput, field: RouteField, value: unknown): RouteIdentityInput {
  return { ...input, [field]: value };
}

describe("compareRouteIdentity", () => {
  it("verifies all four exact values and records closed provenance", () => {
    const evidence = compareRouteIdentity(REQUESTED, REQUESTED);
    assert.equal(evidence.status, "known");
    assert.deepEqual(evidence.mismatches, []);
    assert.deepEqual(evidence.invalid, []);
    assert.equal(isRouteEvidenceVerified(evidence), true);
    assert.match(evidence.detail, /request\.modelProvider/);
    assert.match(evidence.detail, /thread\/start\.result\.reasoningEffort/);
    assert.match(evidence.detail, /provider\.cwd/);
    assert.match(evidence.detail, /thread\/start\.result\.cwd/);
  });

  for (const [field, value] of [
    ["provider", "other-provider"],
    ["model", "other-model"],
    ["effort", "high"],
    ["cwd", "/work/other"],
  ] as const) {
    it(`reports an exact ${field} mismatch with both values and sources`, () => {
      const evidence = compareRouteIdentity(REQUESTED, withField(REQUESTED, field, value));
      assert.equal(evidence.status, "mismatch");
      assert.deepEqual(evidence.mismatches, [field]);
      assert.match(evidence.detail, new RegExp(`${field} requested`));
      assert.match(evidence.detail, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(evidence.detail, /correct the requested route or server configuration before retry/);
      assert.match(evidence.detail, /unchanged settings may produce the same refusal/);
      assert.equal(isRouteEvidenceVerified(evidence), false);
    });
  }

  it("reports combined mismatches in stable field order", () => {
    const evidence = compareRouteIdentity(REQUESTED, {
      provider: "p",
      model: "m",
      effort: "e",
      cwd: "/c",
    });
    assert.equal(evidence.status, "mismatch");
    assert.deepEqual(evidence.mismatches, ROUTE_FIELDS);
  });

  for (const field of ROUTE_FIELDS) {
    for (const [label, value] of [
      ["missing", undefined],
      ["null", null],
      ["empty", ""],
      ["blank", "  "],
      ["wrong type", 42],
    ] as const) {
      it(`makes ${label} observed ${field} unknown`, () => {
        const evidence = compareRouteIdentity(REQUESTED, withField(REQUESTED, field, value));
        assert.equal(evidence.status, "unknown");
        assert.deepEqual(evidence.invalid, [{ side: "observed", field }]);
        assert.equal(evidence.observed[field].value, null);
        assert.equal(isRouteEvidenceVerified(evidence), false);
      });
    }
  }

  it("keeps known differences visible when another field is invalid", () => {
    const evidence = compareRouteIdentity(REQUESTED, {
      ...REQUESTED,
      provider: "other-provider",
      effort: null,
    });
    assert.equal(evidence.status, "unknown");
    assert.deepEqual(evidence.mismatches, ["provider"]);
    assert.deepEqual(evidence.invalid, [{ side: "observed", field: "effort" }]);
    assert.match(evidence.detail, /invalid observed effort/);
    assert.match(evidence.detail, /provider requested "openai".*observed "other-provider"/);
  });

  for (const [label, observed] of [
    ["provider case", { ...REQUESTED, provider: "OpenAI" }],
    ["provider alias", { ...REQUESTED, provider: "open-ai" }],
    ["effort case", { ...REQUESTED, effort: "Medium" }],
    ["trailing space", { ...REQUESTED, model: "gpt-test " }],
    ["equivalent-looking cwd", { ...REQUESTED, cwd: "/work/repo/." }],
  ] as const) {
    it(`treats ${label} as mismatch rather than normalising it`, () => {
      assert.equal(compareRouteIdentity(REQUESTED, observed).status, "mismatch");
    });
  }

  it("will not certify a relative requested cwd", () => {
    const evidence = compareRouteIdentity({ ...REQUESTED, cwd: "work/repo" }, {
      ...REQUESTED,
      cwd: "work/repo",
    });
    assert.equal(evidence.status, "unknown");
    assert.deepEqual(evidence.invalid, [{ side: "requested", field: "cwd" }]);
  });

  it("rejects a contradictory fabricated known status", () => {
    const evidence = compareRouteIdentity(REQUESTED, REQUESTED);
    const contradictory = {
      ...evidence,
      observed: {
        ...evidence.observed,
        model: { ...evidence.observed.model, value: "other-model" },
      },
    };
    assert.equal(isRouteEvidenceVerified(contradictory), false);
    assert.equal(isRouteEvidenceVerified(undefined), false);
  });

  it("rejects fabricated known evidence with blank values", () => {
    const evidence = compareRouteIdentity(REQUESTED, REQUESTED);
    const blank = {
      ...evidence,
      requested: {
        ...evidence.requested,
        model: { ...evidence.requested.model, value: "" },
      },
      observed: {
        ...evidence.observed,
        model: { ...evidence.observed.model, value: "" },
      },
    };
    assert.equal(isRouteEvidenceVerified(blank), false);
  });

  it("rejects fabricated known evidence with a relative cwd", () => {
    const evidence = compareRouteIdentity(REQUESTED, REQUESTED);
    const relative = {
      ...evidence,
      requested: {
        ...evidence.requested,
        cwd: { ...evidence.requested.cwd, value: "work/repo" },
      },
      observed: {
        ...evidence.observed,
        cwd: { ...evidence.observed.cwd, value: "work/repo" },
      },
    };
    assert.equal(isRouteEvidenceVerified(relative), false);
  });
});
